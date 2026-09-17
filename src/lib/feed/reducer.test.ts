import { describe, expect, it } from "vitest";

import type { FeedState } from "@/lib/feed/types";
import type { Message } from "@/lib/schemas/types";

import { connectionOf, initialFeedState, mergeMessages } from "@/lib/feed/reducer";

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
