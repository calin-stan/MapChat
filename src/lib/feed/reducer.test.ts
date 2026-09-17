import { describe, expect, it } from "vitest";

import type { FeedAction, FeedEffect, FeedError, FeedState } from "@/lib/feed/types";
import type { Message, MessagePage } from "@/lib/schemas/types";

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
