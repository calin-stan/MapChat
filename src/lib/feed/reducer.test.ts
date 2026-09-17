import { describe, expect, it } from "vitest";

import type { FeedAction, FeedEffect, FeedError, FeedState, FetchOp } from "@/lib/feed/types";
import type { CatchUpPage, Message, MessagePage } from "@/lib/schemas/types";

import {
  EMPTY_HISTORY_MESSAGE,
  connectionOf,
  feedReducer,
  initialFeedState,
  mergeMessages,
} from "@/lib/feed/reducer";

const ROOM = "11111111-1111-4111-8111-111111111111";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** Message `n`, created `micros` microseconds into the same second (default: n). */
function msg(n: number, micros = n): Message {
  return {
    id: id(n),
    chatroomId: ROOM,
    author: `author-${n}`,
    text: `message ${n}`,
    createdAt: `2026-09-16T10:00:00.${String(micros).padStart(6, "0")}Z`,
  };
}

const m0 = msg(0);
const m1 = msg(1);
const m2 = msg(2);
const m3 = msg(3);
const m4 = msg(4);

describe("initialFeedState", () => {
  it("starts opening, empty, visible and without transports", () => {
    expect(initialFeedState(ROOM)).toEqual({
      roomId: ROOM,
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
    } satisfies FeedState);
  });
});

describe("connectionOf", () => {
  it.each<[string, Partial<FeedState>, string]>([
    ["realtime when subscribed", { channel: "subscribed" }, "realtime"],
    ["realtime wins over a polling flag", { channel: "subscribed", polling: true }, "realtime"],
    ["polling with no channel", { channel: "none", polling: true }, "polling"],
    ["polling while re-subscribing", { channel: "subscribing", polling: true }, "polling"],
    ["connecting while subscribing without polling", { channel: "subscribing" }, "connecting"],
    ["connecting before any transport", {}, "connecting"],
  ])("%s", (_name, overrides, expected) => {
    expect(connectionOf({ ...initialFeedState(ROOM), ...overrides })).toBe(expected);
  });
});

describe("mergeMessages", () => {
  it("returns the existing array itself when nothing is new", () => {
    const existing = [m1, m2];
    expect(mergeMessages(existing, [m2])).toBe(existing);
    expect(mergeMessages(existing, [])).toBe(existing);
  });

  it("keeps the existing row when an incoming row has a known id", () => {
    const kept = { ...m1, text: "kept" };
    const replaced = { ...m1, text: "replaced" };
    expect(mergeMessages([kept], [replaced])).toEqual([kept]);
  });

  it("sorts out-of-order arrivals into tuple order", () => {
    expect(mergeMessages([m1, m3], [m4, m2])).toEqual([m1, m2, m3, m4]);
  });

  it("orders by microsecond before UUID within one millisecond", () => {
    const earlierWithLargerId = msg(2, 123100);
    const laterWithSmallerId = msg(1, 123900);
    expect(mergeMessages([], [laterWithSmallerId, earlierWithLargerId])).toEqual([
      earlierWithLargerId,
      laterWithSmallerId,
    ]);
  });

  it("dedupes within the incoming batch", () => {
    expect(mergeMessages([], [m1, m1])).toEqual([m1]);
  });

  it("handles empty inputs", () => {
    expect(mergeMessages([], [])).toEqual([]);
  });

  it("does not mutate its inputs", () => {
    const existing = [m2];
    const incoming = [m1];
    mergeMessages(existing, incoming);
    expect(existing).toEqual([m2]);
    expect(incoming).toEqual([m1]);
  });
});

// ---------------------------------------------------------------------------
// Transition table (spec §5). One row per rule; `after` lists only the fields
// that change, or "ignored" for "same state object back, no effects".
// ---------------------------------------------------------------------------

type Row = {
  name: string;
  before: FeedState;
  action: FeedAction;
  after: Partial<FeedState> | "ignored";
  effects?: FeedEffect[];
};

function check({ before, action, after, effects = [] }: Row): void {
  // Snapshot before reduction: expected values must not inherit an input mutation.
  const beforeSnapshot = structuredClone(before);
  const actionSnapshot = structuredClone(action);
  const expected = after === "ignored" ? beforeSnapshot : structuredClone({ ...before, ...after });
  const [next, fx] = feedReducer(before, action);
  expect(before).toEqual(beforeSnapshot);
  expect(action).toEqual(actionSnapshot);
  if (after === "ignored") {
    expect(next).toBe(before);
    expect(fx).toEqual([]);
    return;
  }
  expect(next).toEqual(expected);
  expect(fx).toEqual(effects);
}

/** `initialFeedState` plus overrides: an opening room. */
function state(overrides: Partial<FeedState> = {}): FeedState {
  return { ...initialFeedState(ROOM), ...overrides };
}

/** An open room showing m1..m2 over a confirmed channel (after history + subscribed). */
function live(overrides: Partial<FeedState> = {}): FeedState {
  return state({
    status: "open",
    messages: [m1, m2],
    olderCursor: m1.id,
    syncCursor: m2.id,
    hasOlder: true,
    channel: "subscribed",
    ...overrides,
  });
}

/** The same room in polling mode with no channel. */
function pollingRoom(overrides: Partial<FeedState> = {}): FeedState {
  return live({ channel: "none", polling: true, ...overrides });
}

const page = (messages: Message[], hasMore: boolean): MessagePage => ({ messages, hasMore });

const fetchInitial: FeedEffect = { type: "fetchInitial" };
const subscribe: FeedEffect = { type: "subscribe" };
const unsubscribe: FeedEffect = { type: "unsubscribe" };
const startPolling: FeedEffect = { type: "startPolling" };
const stopPolling: FeedEffect = { type: "stopPolling" };
const startIdleTimer: FeedEffect = { type: "startIdleTimer" };
const stopIdleTimer: FeedEffect = { type: "stopIdleTimer" };
const fetchNewer = (after: string): FeedEffect => ({ type: "fetchNewer", after });

const notFoundError: FeedError = { op: "newer", message: "gone", notFound: true };

describe("feedReducer guards", () => {
  it.each<Row>([
    {
      name: "ignores every action once closed",
      before: state({ status: "closed" }),
      action: { type: "opened", hidden: false },
      after: "ignored",
    },
    {
      name: "ignores visibility once closed",
      before: live({ status: "closed", channel: "none" }),
      action: { type: "visibilityChanged", hidden: true },
      after: "ignored",
    },
    {
      name: "ignores everything but closed after a room-gone error",
      before: live({ channel: "none", error: notFoundError }),
      action: { type: "visibilityChanged", hidden: true },
      after: "ignored",
    },
    {
      name: "still closes after a room-gone error",
      before: live({ channel: "none", error: notFoundError }),
      action: { type: "closed" },
      after: { status: "closed" },
      effects: [unsubscribe, stopPolling, stopIdleTimer],
    },
  ])("$name", (row) => check(row));
});

describe("feedReducer opening", () => {
  it.each<Row>([
    {
      name: "opened without a seed fetches initial history",
      before: state(),
      action: { type: "opened", hidden: false },
      after: { inflight: "initial" },
      effects: [fetchInitial],
    },
    {
      name: "opened while hidden records visibility and still fetches",
      before: state(),
      action: { type: "opened", hidden: true },
      after: { hidden: true, inflight: "initial" },
      effects: [fetchInitial],
    },
    {
      name: "opened with a seed is open at once and subscribes when visible",
      before: state(),
      action: { type: "opened", hidden: false, seed: m1 },
      after: {
        status: "open",
        messages: [m1],
        syncCursor: m1.id,
        olderCursor: m1.id,
        hasOlder: false,
        channel: "subscribing",
      },
      effects: [subscribe],
    },
    {
      name: "opened with a seed while hidden enters polling with an immediate catch-up",
      before: state(),
      action: { type: "opened", hidden: true, seed: m1 },
      after: {
        hidden: true,
        status: "open",
        messages: [m1],
        syncCursor: m1.id,
        olderCursor: m1.id,
        hasOlder: false,
        polling: true,
        inflight: "newer",
      },
      effects: [startPolling, fetchNewer(m1.id)],
    },
    {
      name: "opened while the initial fetch is in flight is ignored",
      before: state({ inflight: "initial" }),
      action: { type: "opened", hidden: false },
      after: "ignored",
    },
    {
      name: "opened on an open room is ignored",
      before: live(),
      action: { type: "opened", hidden: false },
      after: "ignored",
    },
    {
      name: "historyLoaded sorts the page, sets both cursors and subscribes",
      before: state({ inflight: "initial" }),
      action: { type: "historyLoaded", page: page([m2, m1], true) },
      after: {
        status: "open",
        inflight: null,
        messages: [m1, m2],
        olderCursor: m1.id,
        syncCursor: m2.id,
        hasOlder: true,
        channel: "subscribing",
      },
      effects: [subscribe],
    },
    {
      name: "historyLoaded while hidden enters polling instead of subscribing",
      before: state({ inflight: "initial", hidden: true }),
      action: { type: "historyLoaded", page: page([m1, m2], false) },
      after: {
        status: "open",
        inflight: "newer",
        messages: [m1, m2],
        olderCursor: m1.id,
        syncCursor: m2.id,
        hasOlder: false,
        polling: true,
      },
      effects: [startPolling, fetchNewer(m2.id)],
    },
    {
      name: "historyLoaded clears a previous initial error",
      before: state({
        inflight: "initial",
        initialRetried: true,
        error: { op: "initial", message: EMPTY_HISTORY_MESSAGE, notFound: false },
      }),
      action: { type: "historyLoaded", page: page([m1], false) },
      after: {
        status: "open",
        inflight: null,
        messages: [m1],
        olderCursor: m1.id,
        syncCursor: m1.id,
        hasOlder: false,
        error: null,
        channel: "subscribing",
      },
      effects: [subscribe],
    },
    {
      name: "historyLoaded with an empty page retries once",
      before: state({ inflight: "initial" }),
      action: { type: "historyLoaded", page: page([], false) },
      after: { initialRetried: true },
      effects: [fetchInitial],
    },
    {
      name: "historyLoaded empty a second time fails without a cursor or transport",
      before: state({ inflight: "initial", initialRetried: true }),
      action: { type: "historyLoaded", page: page([], false) },
      after: {
        inflight: null,
        error: { op: "initial", message: EMPTY_HISTORY_MESSAGE, notFound: false },
      },
    },
    {
      name: "historyLoaded without an initial fetch in flight is ignored",
      before: live(),
      action: { type: "historyLoaded", page: page([m3], false) },
      after: "ignored",
    },
  ])("$name", (row) => check(row));
});

describe("feedReducer channel outcomes", () => {
  it.each<Row>([
    {
      name: "subscribed starts the idle timer and catches up after the bookmark",
      before: live({ channel: "subscribing" }),
      action: { type: "subscribed" },
      after: { channel: "subscribed", inflight: "newer" },
      effects: [startIdleTimer, fetchNewer(m2.id)],
    },
    {
      name: "subscribed while polling stops the poll timer first",
      before: pollingRoom({ channel: "subscribing" }),
      action: { type: "subscribed" },
      after: { channel: "subscribed", polling: false, inflight: "newer" },
      effects: [stopPolling, startIdleTimer, fetchNewer(m2.id)],
    },
    {
      name: "subscribed with a backlog does not fetch automatically",
      before: live({ channel: "subscribing", backlog: true }),
      action: { type: "subscribed" },
      after: { channel: "subscribed" },
      effects: [startIdleTimer],
    },
    {
      name: "subscribed while a fetch is in flight owes the catch-up",
      before: live({ channel: "subscribing", inflight: "older" }),
      action: { type: "subscribed" },
      after: { channel: "subscribed", newerWanted: true },
      effects: [startIdleTimer],
    },
    {
      name: "subscribed while hidden is ignored",
      before: live({ channel: "subscribing", hidden: true }),
      action: { type: "subscribed" },
      after: "ignored",
    },
    {
      name: "subscribed with no pending attempt is ignored",
      before: pollingRoom(),
      action: { type: "subscribed" },
      after: "ignored",
    },
    {
      name: "channelFailed on the initial join cleans up and enters polling",
      before: live({ channel: "subscribing" }),
      action: { type: "channelFailed", reason: "too_many_connections" },
      after: { channel: "none", polling: true, inflight: "newer" },
      effects: [unsubscribe, stopIdleTimer, startPolling, fetchNewer(m2.id)],
    },
    {
      name: "channelFailed on a re-subscribe keeps the running poll timer",
      before: pollingRoom({ channel: "subscribing" }),
      action: { type: "channelFailed", reason: "TIMED_OUT" },
      after: { channel: "none" },
      effects: [unsubscribe, stopIdleTimer],
    },
    {
      name: "channelFailed after subscribed enters polling with an immediate catch-up",
      before: live(),
      action: { type: "channelFailed", reason: "CLOSED" },
      after: { channel: "none", polling: true, inflight: "newer" },
      effects: [unsubscribe, stopIdleTimer, startPolling, fetchNewer(m2.id)],
    },
    {
      name: "channelFailed with no channel is ignored",
      before: pollingRoom(),
      action: { type: "channelFailed", reason: "CLOSED" },
      after: "ignored",
    },
    {
      name: "idle in realtime drops the channel and enters polling",
      before: live(),
      action: { type: "idle" },
      after: { channel: "none", polling: true, inflight: "newer" },
      effects: [unsubscribe, stopIdleTimer, startPolling, fetchNewer(m2.id)],
    },
    {
      name: "idle while polling is ignored",
      before: pollingRoom(),
      action: { type: "idle" },
      after: "ignored",
    },
    {
      name: "idle while subscribing is ignored",
      before: live({ channel: "subscribing" }),
      action: { type: "idle" },
      after: "ignored",
    },
    {
      name: "becoming visible only records visibility",
      before: pollingRoom({ hidden: true }),
      action: { type: "visibilityChanged", hidden: false },
      after: { hidden: false },
    },
    {
      name: "becoming visible while already visible is ignored",
      before: live(),
      action: { type: "visibilityChanged", hidden: false },
      after: "ignored",
    },
    {
      name: "hiding in realtime drops the channel and enters polling",
      before: live(),
      action: { type: "visibilityChanged", hidden: true },
      after: { hidden: true, channel: "none", polling: true, inflight: "newer" },
      effects: [unsubscribe, stopIdleTimer, startPolling, fetchNewer(m2.id)],
    },
    {
      name: "hiding during the initial join cancels it and enters polling",
      before: live({ channel: "subscribing" }),
      action: { type: "visibilityChanged", hidden: true },
      after: { hidden: true, channel: "none", polling: true, inflight: "newer" },
      effects: [unsubscribe, stopIdleTimer, startPolling, fetchNewer(m2.id)],
    },
    {
      name: "hiding during a re-subscribe cancels it and keeps polling",
      before: pollingRoom({ channel: "subscribing" }),
      action: { type: "visibilityChanged", hidden: true },
      after: { hidden: true, channel: "none" },
      effects: [unsubscribe, stopIdleTimer],
    },
    {
      name: "hiding while polling only records visibility",
      before: pollingRoom(),
      action: { type: "visibilityChanged", hidden: true },
      after: { hidden: true },
    },
    {
      name: "hiding during opening only records visibility",
      before: state({ inflight: "initial" }),
      action: { type: "visibilityChanged", hidden: true },
      after: { hidden: true },
    },
    {
      name: "a repeated hidden event while polling is ignored",
      before: pollingRoom({ hidden: true }),
      action: { type: "visibilityChanged", hidden: true },
      after: "ignored",
    },
    {
      name: "closed from realtime emits every cleanup",
      before: live(),
      action: { type: "closed" },
      after: { status: "closed", channel: "none", polling: false },
      effects: [unsubscribe, stopPolling, stopIdleTimer],
    },
    {
      name: "closed while opening emits every cleanup too",
      before: state({ inflight: "initial" }),
      action: { type: "closed" },
      after: { status: "closed" },
      effects: [unsubscribe, stopPolling, stopIdleTimer],
    },
    {
      name: "closed while polling stops it",
      before: pollingRoom(),
      action: { type: "closed" },
      after: { status: "closed", polling: false },
      effects: [unsubscribe, stopPolling, stopIdleTimer],
    },
  ])("$name", (row) => check(row));
});

const catchUp = (messages: Message[], nextCursor: string, hasMore: boolean): CatchUpPage => ({
  messages,
  nextCursor,
  hasMore,
});
const fetchOlder = (before: string): FeedEffect => ({ type: "fetchOlder", before });

describe("feedReducer fetching newer", () => {
  it.each<Row>([
    {
      name: "pollTick while polling and idle fetches after the bookmark",
      before: pollingRoom(),
      action: { type: "pollTick" },
      after: { inflight: "newer" },
      effects: [fetchNewer(m2.id)],
    },
    {
      name: "pollTick while a fetch is in flight is ignored",
      before: pollingRoom({ inflight: "older" }),
      action: { type: "pollTick" },
      after: "ignored",
    },
    {
      name: "pollTick during a backlog is ignored",
      before: pollingRoom({ backlog: true }),
      action: { type: "pollTick" },
      after: "ignored",
    },
    {
      name: "pollTick in realtime is ignored",
      before: live(),
      action: { type: "pollTick" },
      after: "ignored",
    },
    {
      name: "pollTick without a bookmark is ignored",
      before: pollingRoom({ syncCursor: null }),
      action: { type: "pollTick" },
      after: "ignored",
    },
    {
      name: "newerRequested drains a backlog while polling",
      before: pollingRoom({ backlog: true }),
      action: { type: "newerRequested" },
      after: { inflight: "newer" },
      effects: [fetchNewer(m2.id)],
    },
    {
      name: "newerRequested drains a backlog in realtime",
      before: live({ backlog: true }),
      action: { type: "newerRequested" },
      after: { inflight: "newer" },
      effects: [fetchNewer(m2.id)],
    },
    {
      name: "newerRequested while a fetch is in flight is ignored",
      before: live({ inflight: "newer" }),
      action: { type: "newerRequested" },
      after: "ignored",
    },
    {
      name: "newerRequested while opening is ignored",
      before: state({ inflight: "initial" }),
      action: { type: "newerRequested" },
      after: "ignored",
    },
    {
      name: "newerLoaded merges and advances the bookmark to nextCursor",
      before: pollingRoom({ inflight: "newer" }),
      action: { type: "newerLoaded", page: catchUp([m3, m4], m4.id, false) },
      after: { inflight: null, messages: [m1, m2, m3, m4], syncCursor: m4.id },
    },
    {
      name: "newerLoaded trusts nextCursor even for an empty page",
      before: pollingRoom({ inflight: "newer" }),
      action: { type: "newerLoaded", page: catchUp([], m3.id, false) },
      after: { inflight: null, syncCursor: m3.id },
    },
    {
      name: "newerLoaded with hasMore records a backlog",
      before: pollingRoom({ inflight: "newer" }),
      action: { type: "newerLoaded", page: catchUp([m3], m3.id, true) },
      after: { inflight: null, messages: [m1, m2, m3], syncCursor: m3.id, backlog: true },
    },
    {
      name: "newerLoaded without hasMore clears the backlog",
      before: pollingRoom({ inflight: "newer", backlog: true }),
      action: { type: "newerLoaded", page: catchUp([m3], m3.id, false) },
      after: { inflight: null, messages: [m1, m2, m3], syncCursor: m3.id, backlog: false },
    },
    {
      name: "newerLoaded runs an owed catch-up from the new bookmark",
      before: pollingRoom({ inflight: "newer", newerWanted: true }),
      action: { type: "newerLoaded", page: catchUp([m3], m3.id, false) },
      after: { inflight: "newer", newerWanted: false, messages: [m1, m2, m3], syncCursor: m3.id },
      effects: [fetchNewer(m3.id)],
    },
    {
      name: "newerLoaded with an owed catch-up but a backlog only clears the flag",
      before: pollingRoom({ inflight: "newer", newerWanted: true }),
      action: { type: "newerLoaded", page: catchUp([m3], m3.id, true) },
      after: {
        inflight: null,
        newerWanted: false,
        backlog: true,
        messages: [m1, m2, m3],
        syncCursor: m3.id,
      },
    },
    {
      name: "newerLoaded dedupes a message already shown from a POST response",
      before: pollingRoom({ inflight: "newer", messages: [m1, m2, m4] }),
      action: { type: "newerLoaded", page: catchUp([m3, m4], m4.id, false) },
      after: { inflight: null, messages: [m1, m2, m3, m4], syncCursor: m4.id },
    },
    {
      name: "newerLoaded clears a newer error",
      before: pollingRoom({
        inflight: "newer",
        error: { op: "newer", message: "boom", notFound: false },
      }),
      action: { type: "newerLoaded", page: catchUp([m3], m3.id, false) },
      after: { inflight: null, messages: [m1, m2, m3], syncCursor: m3.id, error: null },
    },
    {
      name: "newerLoaded keeps an older error",
      before: pollingRoom({
        inflight: "newer",
        error: { op: "older", message: "boom", notFound: false },
      }),
      action: { type: "newerLoaded", page: catchUp([m3], m3.id, false) },
      after: { inflight: null, messages: [m1, m2, m3], syncCursor: m3.id },
    },
    {
      name: "newerLoaded without a newer fetch in flight is ignored",
      before: pollingRoom(),
      action: { type: "newerLoaded", page: catchUp([m3], m3.id, false) },
      after: "ignored",
    },
  ])("$name", (row) => check(row));
});

describe("feedReducer fetching older", () => {
  it.each<Row>([
    {
      name: "olderRequested fetches before the older cursor",
      before: live(),
      action: { type: "olderRequested" },
      after: { inflight: "older" },
      effects: [fetchOlder(m1.id)],
    },
    {
      name: "olderRequested with nothing older is ignored",
      before: live({ hasOlder: false }),
      action: { type: "olderRequested" },
      after: "ignored",
    },
    {
      name: "a second olderRequested before the page lands is ignored",
      before: live({ inflight: "older" }),
      action: { type: "olderRequested" },
      after: "ignored",
    },
    {
      name: "olderRequested while opening is ignored",
      before: state({ inflight: "initial" }),
      action: { type: "olderRequested" },
      after: "ignored",
    },
    {
      name: "olderLoaded prepends, moves the older cursor and leaves the bookmark",
      before: live({ inflight: "older", messages: [m3, m4], olderCursor: m3.id, syncCursor: m4.id }),
      action: { type: "olderLoaded", page: page([m1, m2], true) },
      after: {
        inflight: null,
        messages: [m1, m2, m3, m4],
        olderCursor: m1.id,
        hasOlder: true,
        syncCursor: m4.id,
      },
    },
    {
      name: "olderLoaded on the last page hides Load older",
      before: live({ inflight: "older", messages: [m2, m3], olderCursor: m2.id, syncCursor: m3.id }),
      action: { type: "olderLoaded", page: page([m1], false) },
      after: { inflight: null, messages: [m1, m2, m3], olderCursor: m1.id, hasOlder: false },
    },
    {
      name: "olderLoaded with an empty page keeps the cursor",
      before: live({ inflight: "older" }),
      action: { type: "olderLoaded", page: page([], false) },
      after: { inflight: null, hasOlder: false },
    },
    {
      name: "olderLoaded runs an owed catch-up",
      before: live({ inflight: "older", newerWanted: true }),
      action: { type: "olderLoaded", page: page([m0], false) },
      after: {
        inflight: "newer",
        newerWanted: false,
        messages: [m0, m1, m2],
        olderCursor: m0.id,
        hasOlder: false,
      },
      effects: [fetchNewer(m2.id)],
    },
    {
      name: "olderLoaded clears an older error",
      before: live({ inflight: "older", error: { op: "older", message: "boom", notFound: false } }),
      action: { type: "olderLoaded", page: page([m0], false) },
      after: { inflight: null, messages: [m0, m1, m2], olderCursor: m0.id, hasOlder: false, error: null },
    },
    {
      name: "olderLoaded without an older fetch in flight is ignored",
      before: live(),
      action: { type: "olderLoaded", page: page([m0], false) },
      after: "ignored",
    },
  ])("$name", (row) => check(row));
});

describe("feedReducer receiving and sending", () => {
  it.each<Row>([
    {
      name: "received appends a live message without moving the bookmark",
      before: live(),
      action: { type: "received", message: m3 },
      after: { messages: [m1, m2, m3] },
    },
    {
      name: "received with a duplicate id is a no-op",
      before: live(),
      action: { type: "received", message: m2 },
      after: "ignored",
    },
    {
      name: "received out of order is sorted in",
      before: live({ messages: [m1, m3] }),
      action: { type: "received", message: m2 },
      after: { messages: [m1, m2, m3] },
    },
    {
      name: "received during a backlog is displayed and the backlog stays",
      before: live({ backlog: true }),
      action: { type: "received", message: m3 },
      after: { messages: [m1, m2, m3] },
    },
    {
      name: "received while opening is ignored",
      before: state({ inflight: "initial" }),
      action: { type: "received", message: m1 },
      after: "ignored",
    },
    {
      name: "sent in realtime restarts the idle timer",
      before: live(),
      action: { type: "sent" },
      after: {},
      effects: [startIdleTimer],
    },
    {
      name: "sent while polling tries realtime and keeps polling",
      before: pollingRoom(),
      action: { type: "sent" },
      after: { channel: "subscribing" },
      effects: [subscribe],
    },
    {
      name: "sent while a re-subscribe is pending does not subscribe again",
      before: pollingRoom({ channel: "subscribing" }),
      action: { type: "sent" },
      after: "ignored",
    },
    {
      name: "sent while hidden does not subscribe",
      before: pollingRoom({ hidden: true }),
      action: { type: "sent" },
      after: "ignored",
    },
    {
      name: "sent while opening is ignored",
      before: state({ inflight: "initial" }),
      action: { type: "sent" },
      after: "ignored",
    },
  ])("$name", (row) => check(row));
});

const failure = (op: FetchOp, message = "boom"): FeedError => ({ op, message, notFound: false });
const failed = (op: FetchOp, message = "boom"): FeedAction => ({
  type: "fetchFailed",
  op,
  message,
  notFound: false,
});

describe("feedReducer failures and dismissal", () => {
  it.each<Row>([
    {
      name: "initial failure keeps the room opening with no transport",
      before: state({ inflight: "initial" }),
      action: failed("initial"),
      after: { inflight: null, error: failure("initial") },
    },
    {
      name: "initial failure clears an owed catch-up",
      before: state({ inflight: "initial", newerWanted: true }),
      action: failed("initial"),
      after: { inflight: null, newerWanted: false, error: failure("initial") },
    },
    {
      name: "older failure with nothing owed only records the error",
      before: live({ inflight: "older" }),
      action: failed("older"),
      after: { inflight: null, error: failure("older") },
    },
    {
      name: "older failure releases an owed catch-up even in realtime",
      before: live({ inflight: "older", newerWanted: true }),
      action: failed("older"),
      after: { inflight: "newer", newerWanted: false, error: failure("older") },
      effects: [fetchNewer(m2.id)],
    },
    {
      name: "older failure with an owed catch-up but a backlog only clears the flag",
      before: live({ inflight: "older", newerWanted: true, backlog: true }),
      action: failed("older"),
      after: { inflight: null, newerWanted: false, error: failure("older") },
    },
    {
      name: "newer failure in realtime drops the channel and polls without an immediate retry",
      before: live({ inflight: "newer" }),
      action: failed("newer"),
      after: { inflight: null, channel: "none", polling: true, error: failure("newer") },
      effects: [unsubscribe, stopIdleTimer, startPolling],
    },
    {
      name: "newer failure while polling waits for the next tick",
      before: pollingRoom({ inflight: "newer" }),
      action: failed("newer"),
      after: { inflight: null, error: failure("newer") },
    },
    {
      name: "newer failure during a re-subscribe keeps the interval and the attempt",
      before: pollingRoom({ inflight: "newer", channel: "subscribing" }),
      action: failed("newer"),
      after: { inflight: null, error: failure("newer") },
    },
    {
      name: "newer failure during the initial join leaves the attempt to decide",
      before: live({ inflight: "newer", channel: "subscribing" }),
      action: failed("newer"),
      after: { inflight: null, error: failure("newer") },
    },
    {
      name: "newer failure keeps a backlog and its cursor",
      before: pollingRoom({ inflight: "newer", backlog: true }),
      action: failed("newer"),
      after: { inflight: null, error: failure("newer") },
    },
    {
      name: "newer failure clears an owed catch-up",
      before: pollingRoom({ inflight: "newer", newerWanted: true }),
      action: failed("newer"),
      after: { inflight: null, newerWanted: false, error: failure("newer") },
    },
    {
      name: "a failure for a different operation is ignored",
      before: live({ inflight: "older" }),
      action: failed("newer"),
      after: "ignored",
    },
    {
      name: "a failure with nothing in flight is ignored",
      before: live(),
      action: failed("newer"),
      after: "ignored",
    },
    {
      name: "a 404 in realtime is terminal: every transport stops",
      before: live({ inflight: "newer" }),
      action: { type: "fetchFailed", op: "newer", message: "gone", notFound: true },
      after: {
        inflight: null,
        channel: "none",
        polling: false,
        error: { op: "newer", message: "gone", notFound: true },
      },
      effects: [unsubscribe, stopIdleTimer, stopPolling],
    },
    {
      name: "a 404 while polling is terminal too",
      before: pollingRoom({ inflight: "newer", newerWanted: true }),
      action: { type: "fetchFailed", op: "newer", message: "gone", notFound: true },
      after: {
        inflight: null,
        newerWanted: false,
        polling: false,
        error: { op: "newer", message: "gone", notFound: true },
      },
      effects: [unsubscribe, stopIdleTimer, stopPolling],
    },
    {
      name: "a 404 during opening is terminal",
      before: state({ inflight: "initial" }),
      action: { type: "fetchFailed", op: "initial", message: "gone", notFound: true },
      after: { inflight: null, error: { op: "initial", message: "gone", notFound: true } },
      effects: [unsubscribe, stopIdleTimer, stopPolling],
    },
    {
      name: "errorDismissed clears an ordinary error",
      before: live({ error: failure("older") }),
      action: { type: "errorDismissed" },
      after: { error: null },
    },
    {
      name: "errorDismissed with no error is ignored",
      before: live(),
      action: { type: "errorDismissed" },
      after: "ignored",
    },
    {
      name: "errorDismissed cannot clear a room-gone error",
      before: live({ channel: "none", error: notFoundError }),
      action: { type: "errorDismissed" },
      after: "ignored",
    },
    {
      name: "sent after a room-gone error is ignored",
      before: live({ channel: "none", error: notFoundError }),
      action: { type: "sent" },
      after: "ignored",
    },
    {
      name: "newerRequested after a room-gone error is ignored",
      before: live({ channel: "none", error: notFoundError }),
      action: { type: "newerRequested" },
      after: "ignored",
    },
  ])("$name", (row) => check(row));
});

// ---------------------------------------------------------------------------
// Scenarios: sequences from spec §5 "Edge cases", §9 (F-004) and PRD §8.
// ---------------------------------------------------------------------------

/** Folds `actions` over the reducer; returns the final state and each step's effects. */
function run(start: FeedState, actions: FeedAction[]): { state: FeedState; effects: FeedEffect[][] } {
  const effects: FeedEffect[][] = [];
  const end = actions.reduce((current, action) => {
    const [next, fx] = feedReducer(current, action);
    effects.push(fx);
    return next;
  }, start);
  return { state: end, effects };
}

describe("feedReducer scenarios", () => {
  it("opens an existing room: history, subscribe, confirmation catch-up", () => {
    const { state: end, effects } = run(state(), [
      { type: "opened", hidden: false },
      { type: "historyLoaded", page: page([m1, m2], true) },
      { type: "subscribed" },
      { type: "newerLoaded", page: catchUp([], m2.id, false) },
    ]);
    expect(effects).toEqual([[fetchInitial], [subscribe], [startIdleTimer, fetchNewer(m2.id)], []]);
    expect(connectionOf(end)).toBe("realtime");
    expect(end).toMatchObject({ status: "open", syncCursor: m2.id, olderCursor: m1.id, inflight: null });
  });

  it("falls back to polling when the subscription is refused, then polls on ticks", () => {
    const { state: end, effects } = run(state(), [
      { type: "opened", hidden: false },
      { type: "historyLoaded", page: page([m1, m2], false) },
      { type: "channelFailed", reason: "too_many_connections" },
      { type: "newerLoaded", page: catchUp([], m2.id, false) },
      { type: "pollTick" },
      { type: "newerLoaded", page: catchUp([m3], m3.id, false) },
      { type: "pollTick" },
    ]);
    expect(effects).toEqual([
      [fetchInitial],
      [subscribe],
      [unsubscribe, stopIdleTimer, startPolling, fetchNewer(m2.id)],
      [],
      [fetchNewer(m2.id)],
      [],
      [fetchNewer(m3.id)],
    ]);
    expect(connectionOf(end)).toBe("polling");
    expect(end.messages).toEqual([m1, m2, m3]);
  });

  it("a realtime message during a backlog is shown, the bookmark and notice stay", () => {
    const { state: end, effects } = run(pollingRoom({ backlog: true }), [
      { type: "received", message: m4 },
      { type: "pollTick" },
      { type: "newerRequested" },
    ]);
    expect(end.messages).toEqual([m1, m2, m4]);
    expect(end).toMatchObject({ syncCursor: m2.id, backlog: true, inflight: "newer" });
    expect(effects).toEqual([[], [], [fetchNewer(m2.id)]]);
  });

  it("A/B/C (PRD 6.4): displaying own post C never moves the bookmark past B", () => {
    // Last fetch reached A (m1). Another visitor posts B (m2); this visitor posts C (m3).
    const start = pollingRoom({ messages: [m1], olderCursor: m1.id, syncCursor: m1.id });
    const { state: end, effects } = run(start, [
      { type: "received", message: m3 },
      { type: "pollTick" },
      { type: "newerLoaded", page: catchUp([m2, m3], m3.id, false) },
    ]);
    expect(effects[1]).toEqual([fetchNewer(m1.id)]);
    expect(end.messages).toEqual([m1, m2, m3]);
    expect(end.syncCursor).toBe(m3.id);
  });

  it("idle during an older page: polling starts, the catch-up runs when the page lands", () => {
    const { state: end, effects } = run(live({ inflight: "older" }), [
      { type: "idle" },
      { type: "olderLoaded", page: page([m0], false) },
    ]);
    expect(effects).toEqual([[unsubscribe, stopIdleTimer, startPolling], [fetchNewer(m2.id)]]);
    expect(end).toMatchObject({ polling: true, channel: "none", newerWanted: false, inflight: "newer" });
    expect(end.messages).toEqual([m0, m1, m2]);
  });

  it("subscribed during a poll: the owed catch-up runs from the poll's new bookmark", () => {
    const { effects } = run(pollingRoom({ channel: "subscribing", inflight: "newer" }), [
      { type: "subscribed" },
      { type: "newerLoaded", page: catchUp([m3], m3.id, false) },
    ]);
    expect(effects).toEqual([[stopPolling, startIdleTimer], [fetchNewer(m3.id)]]);
  });

  it("sent twice while a re-subscribe is pending subscribes once", () => {
    const { effects } = run(pollingRoom(), [{ type: "sent" }, { type: "sent" }]);
    expect(effects).toEqual([[subscribe], []]);
  });

  it("two olderRequested before the page lands fetch once", () => {
    const { effects } = run(live(), [{ type: "olderRequested" }, { type: "olderRequested" }]);
    expect(effects).toEqual([[fetchOlder(m1.id)], []]);
  });

  it("a channel that drops after live use polls and re-subscribes only on send", () => {
    const { state: end, effects } = run(live(), [
      { type: "channelFailed", reason: "CLOSED" },
      { type: "newerLoaded", page: catchUp([], m2.id, false) },
      { type: "pollTick" },
      { type: "newerLoaded", page: catchUp([m3], m3.id, false) },
      { type: "sent" },
    ]);
    expect(effects.slice(0, 4).flat()).not.toContainEqual(subscribe);
    expect(effects[4]).toEqual([subscribe]);
    expect(end).toMatchObject({ channel: "subscribing", polling: true });
  });

  it("empty initial history is retried once, then errors with no cursor and no transport", () => {
    const { state: end, effects } = run(state(), [
      { type: "opened", hidden: false },
      { type: "historyLoaded", page: page([], false) },
      { type: "historyLoaded", page: page([], false) },
    ]);
    expect(effects).toEqual([[fetchInitial], [fetchInitial], []]);
    expect(end).toMatchObject({
      status: "opening",
      syncCursor: null,
      olderCursor: null,
      inflight: null,
      polling: false,
      channel: "none",
      error: { op: "initial", message: EMPTY_HISTORY_MESSAGE, notFound: false },
    });
  });

  it("every action after closed is ignored", () => {
    const closed = feedReducer(live(), { type: "closed" })[0];
    const actions: FeedAction[] = [
      { type: "opened", hidden: false },
      { type: "historyLoaded", page: page([m3], false) },
      { type: "olderRequested" },
      { type: "olderLoaded", page: page([m0], false) },
      { type: "newerRequested" },
      { type: "pollTick" },
      { type: "newerLoaded", page: catchUp([m3], m3.id, false) },
      failed("newer"),
      { type: "received", message: m3 },
      { type: "sent" },
      { type: "subscribed" },
      { type: "channelFailed", reason: "CLOSED" },
      { type: "idle" },
      { type: "visibilityChanged", hidden: true },
      { type: "errorDismissed" },
      { type: "closed" },
    ];
    for (const action of actions) {
      expect(feedReducer(closed, action)).toEqual([closed, []]);
      expect(feedReducer(closed, action)[0]).toBe(closed);
    }
  });

  it("F-004: a failed confirmation catch-up polls from the same bookmark and recovers", () => {
    const { state: end, effects } = run(live({ channel: "subscribing" }), [
      { type: "subscribed" },
      failed("newer"),
      { type: "pollTick" },
      { type: "newerLoaded", page: catchUp([m3], m3.id, false) },
    ]);
    expect(effects).toEqual([
      [startIdleTimer, fetchNewer(m2.id)],
      [unsubscribe, stopIdleTimer, startPolling],
      [fetchNewer(m2.id)],
      [],
    ]);
    expect(end).toMatchObject({ channel: "none", polling: true, syncCursor: m3.id, error: null });
    expect(end.messages).toEqual([m1, m2, m3]);
  });

  it("F-004: confirmation during an older page whose fetch then fails still runs the catch-up", () => {
    const { state: end, effects } = run(live({ channel: "subscribing", inflight: "older" }), [
      { type: "subscribed" },
      failed("older"),
      { type: "newerLoaded", page: catchUp([m3], m3.id, false) },
    ]);
    expect(effects).toEqual([[startIdleTimer], [fetchNewer(m2.id)], []]);
    expect(end.error).toEqual(failure("older"));
    expect(end).toMatchObject({ channel: "subscribed", syncCursor: m3.id, inflight: null });
  });

  it("F-004: a failed backlog page keeps the button and the cursor; ticks stay paused", () => {
    const { state: end, effects } = run(pollingRoom({ backlog: true }), [
      { type: "newerRequested" },
      failed("newer"),
      { type: "pollTick" },
      { type: "newerRequested" },
    ]);
    expect(effects).toEqual([[fetchNewer(m2.id)], [], [], [fetchNewer(m2.id)]]);
    expect(end).toMatchObject({ backlog: true, syncCursor: m2.id, error: failure("newer") });
  });

  it("F-004: a 404 is terminal; nothing restarts a transport or re-enables the feed", () => {
    const { state: end, effects } = run(pollingRoom(), [
      { type: "pollTick" },
      { type: "fetchFailed", op: "newer", message: "gone", notFound: true },
      { type: "pollTick" },
      { type: "sent" },
      { type: "newerRequested" },
      { type: "errorDismissed" },
      { type: "visibilityChanged", hidden: false },
      { type: "closed" },
    ]);
    expect(effects).toEqual([
      [fetchNewer(m2.id)],
      [unsubscribe, stopIdleTimer, stopPolling],
      [],
      [],
      [],
      [],
      [],
      [unsubscribe, stopPolling, stopIdleTimer],
    ]);
    expect(end).toMatchObject({ status: "closed", error: notFoundError });
  });

  it("PRD 8: only newerLoaded advances the bookmark", () => {
    const steps: FeedAction[] = [
      { type: "received", message: m4 },
      { type: "olderRequested" },
      { type: "olderLoaded", page: page([m0], false) },
      { type: "pollTick" },
      failed("newer"),
    ];
    const { state: unchanged } = run(pollingRoom(), steps);
    expect(unchanged.syncCursor).toBe(m2.id);
    const { state: advanced } = run(unchanged, [
      { type: "pollTick" },
      { type: "newerLoaded", page: catchUp([m3, m4], m4.id, false) },
    ]);
    expect(advanced.syncCursor).toBe(m4.id);
    expect(advanced.messages).toEqual([m0, m1, m2, m3, m4]);
  });

  it("F-003: hiding during opening selects polling when history lands", () => {
    const { state: end, effects } = run(state(), [
      { type: "opened", hidden: false },
      { type: "visibilityChanged", hidden: true },
      { type: "historyLoaded", page: page([m1, m2], false) },
    ]);
    expect(effects).toEqual([[fetchInitial], [], [startPolling, fetchNewer(m2.id)]]);
    expect(end).toMatchObject({ hidden: true, polling: true, channel: "none" });
  });

  it("F-003: hiding during the join makes a late confirmation harmless", () => {
    const { state: end, effects } = run(live({ channel: "subscribing" }), [
      { type: "visibilityChanged", hidden: true },
      { type: "subscribed" },
      { type: "visibilityChanged", hidden: false },
      { type: "sent" },
    ]);
    expect(effects).toEqual([
      [unsubscribe, stopIdleTimer, startPolling, fetchNewer(m2.id)],
      [],
      [],
      [subscribe],
    ]);
    expect(end).toMatchObject({ hidden: false, polling: true, channel: "subscribing" });
  });

  it("F-003: a seeded room opened while hidden polls at once", () => {
    const { state: end, effects } = run(state(), [{ type: "opened", hidden: true, seed: m1 }]);
    expect(effects).toEqual([[startPolling, fetchNewer(m1.id)]]);
    expect(end).toMatchObject({ status: "open", channel: "none", polling: true, syncCursor: m1.id });
  });
});
