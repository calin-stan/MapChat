import type {
  Connection,
  FeedAction,
  FeedEffect,
  FeedState,
  FetchOp,
} from "@/lib/feed/types";
import type { Message } from "@/lib/schemas/types";

import { compareCreatedAtId } from "@/lib/time/ordering";

/** Error message when initial history is empty twice (spec §5 "Opening"). */
export const EMPTY_HISTORY_MESSAGE = "Room has no messages";

type Result = [FeedState, FeedEffect[]];

export function initialFeedState(roomId: string): FeedState {
  return {
    roomId,
    status: "opening",
    hidden: false,
    messages: [],
    olderCursor: null,
    hasOlder: false,
    syncCursor: null,
    backlog: false,
    newerWanted: false,
    inflight: null,
    polling: false,
    channel: "none",
    error: null,
    initialRetried: false,
  };
}

/** What the panel shows: a confirmed channel wins, then a running poll timer. */
export function connectionOf(state: FeedState): Connection {
  if (state.channel === "subscribed") return "realtime";
  if (state.polling) return "polling";
  return "connecting";
}

/**
 * Dedupes `incoming` against `existing` by id (the existing row wins) and
 * returns the union in `compareCreatedAtId` order. `existing` must already be
 * sorted (the state invariant); it is returned as is when nothing is new.
 * Never mutates its inputs and never touches cursors.
 */
export function mergeMessages(existing: Message[], incoming: Message[]): Message[] {
  const known = new Set(existing.map((message) => message.id));
  const fresh: Message[] = [];
  for (const message of incoming) {
    if (known.has(message.id)) continue;
    known.add(message.id);
    fresh.push(message);
  }
  if (fresh.length === 0) return existing;
  return [...existing, ...fresh].sort(compareCreatedAtId);
}

// ---------------------------------------------------------------------------
// Helpers. Each takes the effect list to append to and returns the next state.
// Effect order inside a helper is part of the contract (spec §5).
// ---------------------------------------------------------------------------

/** The action does not apply: same state object, no effects. */
function ignore(state: FeedState): Result {
  return [state, []];
}

/** A server page in tuple order, deduped, so cursors never depend on arrival order. */
function sortPage(messages: Message[]): Message[] {
  return mergeMessages([], messages);
}

/** Clears the error only when it belongs to the operation that just succeeded. */
function clearError(state: FeedState, op: FetchOp): FeedState {
  return state.error?.op === op ? { ...state, error: null } : state;
}

function fetchNewer(state: FeedState, after: string, fx: FeedEffect[]): FeedState {
  fx.push({ type: "fetchNewer", after });
  return { ...state, inflight: "newer" };
}

/**
 * Auto catch-up (spec §5): a backlog owns the cursor, so do nothing; an
 * in-flight fetch defers it (`newerWanted`); otherwise fetch after the bookmark.
 */
function autoCatchUp(state: FeedState, fx: FeedEffect[]): FeedState {
  if (state.backlog) return state;
  if (state.inflight !== null) return { ...state, newerWanted: true };
  if (state.syncCursor === null) return state;
  return fetchNewer(state, state.syncCursor, fx);
}

/** Runs a deferred catch-up once the blocking fetch has settled (spec §5 `newerLoaded`). */
function runOwedCatchUp(state: FeedState, fx: FeedEffect[]): FeedState {
  if (!state.newerWanted) return state;
  return autoCatchUp({ ...state, newerWanted: false }, fx);
}

/** Enter polling: start the timer once, then auto catch-up. Already polling: no-op. */
function enterPolling(state: FeedState, fx: FeedEffect[]): FeedState {
  if (state.polling) return state;
  fx.push({ type: "startPolling" });
  return autoCatchUp({ ...state, polling: true }, fx);
}

/** Drop channel: unsubscribe (idempotent), stop the idle timer, forget the channel. */
function dropChannel(state: FeedState, fx: FeedEffect[]): FeedState {
  fx.push({ type: "unsubscribe" }, { type: "stopIdleTimer" });
  return { ...state, channel: "none" };
}

/** Select initial transport: hidden rooms poll; visible rooms try realtime. */
function selectInitialTransport(state: FeedState, fx: FeedEffect[]): FeedState {
  if (state.hidden) return enterPolling(state, fx);
  fx.push({ type: "subscribe" });
  return { ...state, channel: "subscribing" };
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

/**
 * Pure transition function of the room feed (spec §5). Returns the next state
 * and the effects the store must run, in order. An action the state does not
 * accept returns the same state object and no effects.
 */
export function feedReducer(state: FeedState, action: FeedAction): Result {
  if (state.status === "closed") return ignore(state);
  if (state.error?.notFound && action.type !== "closed") return ignore(state);

  const fx: FeedEffect[] = [];

  switch (action.type) {
    case "opened": {
      if (state.status !== "opening" || state.inflight !== null) return ignore(state);
      if (!action.seed) {
        fx.push({ type: "fetchInitial" });
        return [{ ...state, hidden: action.hidden, inflight: "initial" }, fx];
      }
      const seeded: FeedState = {
        ...state,
        hidden: action.hidden,
        status: "open",
        messages: [action.seed],
        syncCursor: action.seed.id,
        olderCursor: action.seed.id,
        hasOlder: false,
      };
      return [selectInitialTransport(seeded, fx), fx];
    }

    case "historyLoaded": {
      if (state.inflight !== "initial") return ignore(state);
      const messages = sortPage(action.page.messages);
      if (messages.length === 0) {
        if (!state.initialRetried) {
          fx.push({ type: "fetchInitial" });
          return [{ ...state, initialRetried: true }, fx];
        }
        const error = { op: "initial" as const, message: EMPTY_HISTORY_MESSAGE, notFound: false };
        return [{ ...state, inflight: null, error }, fx];
      }
      const loaded: FeedState = {
        ...clearError(state, "initial"),
        status: "open",
        inflight: null,
        messages,
        olderCursor: messages[0].id,
        syncCursor: messages[messages.length - 1].id,
        hasOlder: action.page.hasMore,
      };
      return [selectInitialTransport(loaded, fx), fx];
    }

    case "subscribed": {
      if (state.channel !== "subscribing" || state.hidden) return ignore(state);
      let next: FeedState = { ...state, channel: "subscribed" };
      if (next.polling) {
        fx.push({ type: "stopPolling" });
        next = { ...next, polling: false };
      }
      fx.push({ type: "startIdleTimer" });
      return [autoCatchUp(next, fx), fx];
    }

    case "channelFailed": {
      if (state.channel === "none") return ignore(state);
      // `action.reason` is for the store's logging; the state has no field for it.
      return [enterPolling(dropChannel(state, fx), fx), fx];
    }

    case "idle": {
      if (state.channel !== "subscribed") return ignore(state);
      return [enterPolling(dropChannel(state, fx), fx), fx];
    }

    case "visibilityChanged": {
      if (action.hidden === state.hidden) return ignore(state);
      if (!action.hidden) return [{ ...state, hidden: false }, fx];
      let next: FeedState = { ...state, hidden: true };
      if (next.channel !== "none") next = dropChannel(next, fx);
      if (next.status === "open" && !next.polling) next = enterPolling(next, fx);
      return [next, fx];
    }

    case "closed": {
      fx.push({ type: "unsubscribe" }, { type: "stopPolling" }, { type: "stopIdleTimer" });
      return [{ ...state, status: "closed", channel: "none", polling: false }, fx];
    }

    case "pollTick": {
      if (!state.polling || state.inflight !== null || state.backlog) return ignore(state);
      if (state.syncCursor === null) return ignore(state);
      return [fetchNewer(state, state.syncCursor, fx), fx];
    }

    case "newerRequested": {
      if (state.status !== "open" || state.inflight !== null) return ignore(state);
      if (state.syncCursor === null) return ignore(state);
      return [fetchNewer(state, state.syncCursor, fx), fx];
    }

    case "newerLoaded": {
      if (state.inflight !== "newer") return ignore(state);
      const next: FeedState = {
        ...clearError(state, "newer"),
        inflight: null,
        messages: mergeMessages(state.messages, action.page.messages),
        syncCursor: action.page.nextCursor,
        backlog: action.page.hasMore,
      };
      return [runOwedCatchUp(next, fx), fx];
    }

    case "olderRequested": {
      if (state.status !== "open" || state.inflight !== null || !state.hasOlder) {
        return ignore(state);
      }
      if (state.olderCursor === null) return ignore(state);
      fx.push({ type: "fetchOlder", before: state.olderCursor });
      return [{ ...state, inflight: "older" }, fx];
    }

    case "olderLoaded": {
      if (state.inflight !== "older") return ignore(state);
      const older = sortPage(action.page.messages);
      const next: FeedState = {
        ...clearError(state, "older"),
        inflight: null,
        messages: mergeMessages(state.messages, older),
        olderCursor: older.length > 0 ? older[0].id : state.olderCursor,
        hasOlder: action.page.hasMore,
      };
      return [runOwedCatchUp(next, fx), fx];
    }

    case "received": {
      if (state.status !== "open") return ignore(state);
      const messages = mergeMessages(state.messages, [action.message]);
      if (messages === state.messages) return ignore(state);
      return [{ ...state, messages }, fx];
    }

    case "sent": {
      if (state.hidden) return ignore(state);
      if (state.channel === "subscribed") {
        fx.push({ type: "startIdleTimer" });
        return [state, fx];
      }
      if (state.status === "open" && state.channel === "none") {
        fx.push({ type: "subscribe" });
        return [{ ...state, channel: "subscribing" }, fx];
      }
      return ignore(state);
    }

    default:
      return ignore(state);
  }
}
