import { ApiRequestError, type MessagesApi } from "@/lib/api/client";
import type { RealtimeHandle, SubscribeToRoom } from "@/lib/feed/realtime";
import { feedReducer, initialFeedState } from "@/lib/feed/reducer";
import type { FeedAction, FeedEffect, FeedState, FetchOp } from "@/lib/feed/types";
import type { PostMessageInput } from "@/lib/schemas/message";
import type { Message } from "@/lib/schemas/types";

export type FeedTimers = {
  setTimeout: typeof globalThis.setTimeout;
  clearTimeout: typeof globalThis.clearTimeout;
  setInterval: typeof globalThis.setInterval;
  clearInterval: typeof globalThis.clearInterval;
};

export type FeedDeps = {
  /** `api.messages` (chunk 5). */
  messages: MessagesApi;
  /** Chunk 11's adapter; chunk 9's hook defaults to a stub that always fails. */
  subscribe: SubscribeToRoom;
  config: { pollIntervalMs: number; realtimeIdleTimeoutMs: number };
  /** Defaults to the globals, looked up at call time so fake timers apply. */
  timers?: FeedTimers;
};

export type FeedStore = {
  /** Once, after the owning effect has committed. Repeated calls do nothing. */
  start(opts: { hidden: boolean }): void;
  getState(): FeedState;
  /** `useSyncExternalStore` contract: returns the detach function. */
  subscribe(listener: () => void): () => void;
  dispatch(action: FeedAction): void;
  loadOlder(): void;
  /** Resolves once the fetch this call started is reduced and published; at once when ignored. */
  loadNewer(): Promise<void>;
  send(input: PostMessageInput): Promise<Message>;
  /** Restarts the idle timer while one is running. Never dispatches. */
  activity(): void;
  setHidden(hidden: boolean): void;
  dismissError(): void;
  dispose(): void;
};

/** `send` was called while the room cannot accept a message. Nothing was posted. */
export class FeedNotReadyError extends Error {
  readonly code = "feed_not_ready";

  constructor() {
    super("Wait for the room to load, or reopen it if loading failed.");
    this.name = "FeedNotReadyError";
  }
}

/** One `subscribe` effect. `live` gates its callbacks; `released` means its handle is cleaned up. */
type Attempt = { live: boolean; released: boolean; handle: RealtimeHandle | null };

/** A queued action; `settled` is the completion of the manual `loadNewer()` that queued it. */
type Queued = { action: FeedAction; settled?: () => void };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Runs `feedReducer` and interprets its effects against injected dependencies
 * (room-feed design §6). Framework-free. Construction is inert: nothing is
 * fetched, subscribed or scheduled until `start`.
 */
export function createFeedStore(roomId: string, deps: FeedDeps, seed?: Message): FeedStore {
  let state = initialFeedState(roomId);
  let started = false;
  let disposed = false;
  let draining = false;
  const queue: Queued[] = [];
  const listeners = new Set<() => void>();
  const completions = new Set<() => void>();
  let attempt: Attempt | null = null;
  let pollTimer: ReturnType<FeedTimers["setInterval"]> | undefined;
  let idleTimer: ReturnType<FeedTimers["setTimeout"]> | undefined;

  const timers = (): FeedTimers => deps.timers ?? globalThis;

  function notify() {
    for (const listener of [...listeners]) listener();
  }

  /** Queues the action; the outermost call drains iteratively, so reentrant actions never recurse. */
  function enqueue(entry: Queued) {
    if (!started || disposed) {
      entry.settled?.();
      return;
    }
    queue.push(entry);
    if (draining) return;
    draining = true;
    try {
      for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
        reduce(next);
      }
    } finally {
      draining = false;
    }
  }

  function reduce({ action, settled }: Queued) {
    const [next, effects] = feedReducer(state, action);
    if (next !== state) {
      state = next;
      notify();
    }
    let completion = settled;
    for (const effect of effects) {
      if (disposed) break;
      if (effect.type === "fetchNewer") {
        runFetchNewer(effect.after, completion);
        completion = undefined;
      } else {
        run(effect);
      }
    }
    // A manual request that started no fetch (ignored, or disposed meanwhile) is complete.
    completion?.();
  }

  function dispatch(action: FeedAction) {
    enqueue({ action });
  }

  function run(effect: Exclude<FeedEffect, { type: "fetchNewer" }>) {
    switch (effect.type) {
      case "fetchInitial":
        return runFetch("initial", () => deps.messages.list(roomId), (page) => ({
          type: "historyLoaded",
          page,
        }));
      case "fetchOlder":
        return runFetch(
          "older",
          () => deps.messages.list(roomId, { before: effect.before }),
          (page) => ({ type: "olderLoaded", page }),
        );
      case "subscribe":
        return openChannel();
      case "unsubscribe":
        return releaseChannel();
      case "startPolling":
        stopPolling();
        pollTimer = timers().setInterval(() => dispatch({ type: "pollTick" }), deps.config.pollIntervalMs);
        return;
      case "stopPolling":
        return stopPolling();
      case "startIdleTimer":
        return startIdleTimer();
      case "stopIdleTimer":
        return stopIdleTimer();
    }
  }

  function runFetch<T>(
    op: FetchOp,
    request: () => Promise<T>,
    loaded: (page: T) => FeedAction,
    settled?: () => void,
  ) {
    if (settled) completions.add(settled);
    const finish = () => {
      if (settled && completions.delete(settled)) settled();
    };
    let pending: Promise<T>;
    try {
      pending = request();
    } catch (error) {
      pending = Promise.reject(error);
    }
    pending.then(
      (page) => {
        // `dispatch` is a no-op once disposed: late results never reach the state.
        dispatch(loaded(page));
        finish();
      },
      (error: unknown) => {
        dispatch({
          type: "fetchFailed",
          op,
          message: errorMessage(error),
          notFound: error instanceof ApiRequestError && error.status === 404,
        });
        finish();
      },
    );
  }

  function runFetchNewer(after: string, settled?: () => void) {
    runFetch(
      "newer",
      () => deps.messages.listAfter(roomId, after),
      (page) => ({ type: "newerLoaded", page }),
      settled,
    );
  }

  function openChannel() {
    releaseChannel(); // never two live attempts
    const mine: Attempt = { live: true, released: false, handle: null };
    attempt = mine;
    const alive = () => mine.live && !disposed;
    const fail = (reason: string) => {
      if (!alive()) return;
      mine.live = false; // the first failure is terminal for this attempt
      dispatch({ type: "channelFailed", reason });
    };
    let handle: RealtimeHandle;
    try {
      handle = deps.subscribe(roomId, {
        onSubscribed: () => {
          if (alive()) dispatch({ type: "subscribed" });
        },
        onFailed: fail,
        onInsert: (message) => {
          if (alive()) dispatch({ type: "received", message });
        },
      });
    } catch (error) {
      fail(errorMessage(error));
      return;
    }
    // The attempt may already be released (hidden, disposed) by a synchronous callback.
    if (mine.released) handle.unsubscribe();
    else mine.handle = handle;
  }

  /** Invalidates the attempt first, then cleans up its handle. Safe to repeat. */
  function releaseChannel() {
    const current = attempt;
    attempt = null;
    if (current === null) return;
    current.live = false;
    current.released = true;
    const handle = current.handle;
    current.handle = null;
    handle?.unsubscribe();
  }

  function stopPolling() {
    if (pollTimer === undefined) return;
    timers().clearInterval(pollTimer);
    pollTimer = undefined;
  }

  function startIdleTimer() {
    stopIdleTimer();
    idleTimer = timers().setTimeout(() => {
      idleTimer = undefined;
      dispatch({ type: "idle" });
    }, deps.config.realtimeIdleTimeoutMs);
  }

  function stopIdleTimer() {
    if (idleTimer === undefined) return;
    timers().clearTimeout(idleTimer);
    idleTimer = undefined;
  }

  return {
    start({ hidden }) {
      if (started || disposed) return;
      started = true;
      dispatch({ type: "opened", hidden, seed });
    },
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispatch,
    loadOlder: () => dispatch({ type: "olderRequested" }),
    loadNewer: () =>
      new Promise<void>((resolve) => enqueue({ action: { type: "newerRequested" }, settled: resolve })),
    async send(input) {
      if (!started || disposed || state.status !== "open" || state.error?.notFound) {
        throw new FeedNotReadyError();
      }
      const message = await deps.messages.post(roomId, input);
      dispatch({ type: "received", message });
      dispatch({ type: "sent" });
      return message;
    },
    activity() {
      if (idleTimer === undefined || state.channel !== "subscribed" || state.hidden) return;
      startIdleTimer();
    },
    setHidden: (hidden) => dispatch({ type: "visibilityChanged", hidden }),
    dismissError: () => dispatch({ type: "errorDismissed" }),
    dispose() {
      if (disposed) return;
      disposed = true; // from here every callback and public action is inert
      for (const dropped of queue.splice(0)) dropped.settled?.();
      [state] = feedReducer(state, { type: "closed" });
      releaseChannel();
      stopPolling();
      stopIdleTimer();
      for (const settled of [...completions]) settled();
      completions.clear();
      listeners.clear();
    },
  };
}
