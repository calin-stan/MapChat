import { describe, expect, it } from "vitest";

import {
  NEAR_BOTTOM_PX,
  anchorAdjustment,
  classifyChange,
  decideResize,
  decideScroll,
  hasIncoming,
  isNearBottom,
  pickAnchor,
  type ListChange,
} from "@/components/room/listScroll";
import type { Message } from "@/lib/schemas/types";

/** One message per letter; letters sort like the feed's chronological order. */
function rows(letters: string): Message[] {
  return [...letters].map((letter) => ({
    id: letter,
    chatroomId: "room",
    author: "ann",
    text: letter,
    createdAt: "2026-09-16T10:00:00.000000Z",
  }));
}

const NONE: ListChange = { initial: false, before: [], within: [], after: [] };

describe("isNearBottom", () => {
  const at = (distance: number) => ({ scrollHeight: 1000, clientHeight: 200, scrollTop: 800 - distance });

  it("is true up to 32 px from the bottom and false at 33 px", () => {
    expect(NEAR_BOTTOM_PX).toBe(32);
    expect(isNearBottom(at(0))).toBe(true);
    expect(isNearBottom(at(32))).toBe(true);
    expect(isNearBottom(at(33))).toBe(false);
  });

  it("is true with all-zero metrics (no layout yet)", () => {
    expect(isNearBottom({ scrollTop: 0, scrollHeight: 0, clientHeight: 0 })).toBe(true);
  });

  it("accepts another threshold", () => {
    expect(isNearBottom(at(5), 4)).toBe(false);
  });
});

describe("classifyChange", () => {
  it.each<[string, string, string, Partial<ListChange>]>([
    ["empty to empty", "", "", {}],
    ["first nonempty snapshot is initial, with no additions", "", "AB", { initial: true }],
    ["same ids in a new array", "AB", "AB", {}],
    ["prepend", "CD", "ABCD", { before: ["A", "B"] }],
    ["append", "AB", "ABCD", { after: ["C", "D"] }],
    ["interior insert", "AC", "ABC", { within: ["B"] }],
    ["before and after", "BC", "ABCD", { before: ["A"], after: ["D"] }],
    ["before and within", "BD", "ABCD", { before: ["A"], within: ["C"] }],
    ["within and after", "AC", "ABCD", { within: ["B"], after: ["D"] }],
    ["before, within and after", "BD", "ABCDE", { before: ["A"], within: ["C"], after: ["E"] }],
    ["around a single previous row", "B", "ABC", { before: ["A"], after: ["C"] }],
  ])("%s", (_name, prev, next, expected) => {
    expect(classifyChange(rows(prev), rows(next))).toEqual({ ...NONE, ...expected });
  });

  it("counts within and after as incoming, but not before", () => {
    expect(hasIncoming({ ...NONE, within: ["B"] })).toBe(true);
    expect(hasIncoming({ ...NONE, after: ["D"] })).toBe(true);
    expect(hasIncoming({ ...NONE, before: ["A"] })).toBe(false);
    expect(hasIncoming({ ...NONE, initial: true })).toBe(false);
  });
});

describe("decideScroll", () => {
  const base = { change: NONE, bottomRequested: false, holding: false, wasNearBottom: false };
  const incoming: ListChange = { ...NONE, after: ["D"] };
  const interior: ListChange = { ...NONE, within: ["B"] };
  const mixed: ListChange = { ...NONE, before: ["A"], after: ["D"] };

  it.each<[string, Partial<typeof base>, ReturnType<typeof decideScroll>]>([
    ["an explicit request wins, even during a hold", { change: incoming, bottomRequested: true, holding: true }, { scroll: "bottom", pill: "clear" }],
    ["initial history goes to the bottom", { change: { ...NONE, initial: true } }, { scroll: "bottom", pill: "clear" }],
    ["a hold keeps the position and shows the pill, even near the bottom", { change: incoming, holding: true, wasNearBottom: true }, { scroll: "anchor", pill: "show" }],
    ["a hold covers interior inserts", { change: interior, holding: true }, { scroll: "anchor", pill: "show" }],
    ["incoming near the bottom follows", { change: incoming, wasNearBottom: true }, { scroll: "bottom", pill: "clear" }],
    ["interior incoming near the bottom follows", { change: interior, wasNearBottom: true }, { scroll: "bottom", pill: "clear" }],
    ["incoming while scrolled up shows the pill", { change: incoming }, { scroll: "anchor", pill: "show" }],
    ["interior incoming while scrolled up shows the pill", { change: interior }, { scroll: "anchor", pill: "show" }],
    ["mixed additions while scrolled up keep the anchor and show the pill", { change: mixed }, { scroll: "anchor", pill: "show" }],
    ["only older rows keep the anchor and leave the pill alone", { change: { ...NONE, before: ["A"] }, wasNearBottom: true }, { scroll: "anchor", pill: "keep" }],
    ["no added ids change nothing, hold or not", { holding: true }, { scroll: "anchor", pill: "keep" }],
  ])("%s", (_name, input, expected) => {
    expect(decideScroll({ ...base, ...input })).toEqual(expected);
  });
});

describe("decideResize", () => {
  it("keeps following the bottom only outside a hold", () => {
    expect(decideResize({ wasNearBottom: true, holding: false })).toBe("bottom");
    expect(decideResize({ wasNearBottom: true, holding: true })).toBe("anchor");
    expect(decideResize({ wasNearBottom: false, holding: false })).toBe("anchor");
  });
});

describe("pickAnchor and anchorAdjustment", () => {
  const boxes = [
    { id: "A", top: -120, bottom: -60 },
    { id: "B", top: -60, bottom: 0 }, // ends exactly at the top edge: not visible
    { id: "C", top: 0, bottom: 60 },
  ];

  it("picks the first row with any part inside the viewport", () => {
    expect(pickAnchor(boxes, 200)).toEqual({ id: "C", offset: 0 });
    expect(pickAnchor([{ id: "A", top: -20, bottom: 40 }, ...boxes], 200)).toEqual({ id: "A", offset: -20 });
  });

  it("returns null when no row is visible", () => {
    expect(pickAnchor([], 200)).toBeNull();
    expect(pickAnchor([{ id: "A", top: 200, bottom: 260 }], 200)).toBeNull();
  });

  it("stops measuring at the first visible row", () => {
    let measured = 0;
    function* lazy() {
      for (const box of boxes) {
        measured += 1;
        yield box;
      }
      throw new Error("measured past the anchor");
    }
    expect(pickAnchor(lazy(), 200)).toEqual({ id: "C", offset: 0 });
    expect(measured).toBe(3);
  });

  it("compensates only for displacement above the anchor", () => {
    // 100 px added above moved the row from 40 to 140; rows added below moved nothing.
    expect(anchorAdjustment({ id: "C", offset: 40 }, 140)).toBe(100);
    expect(anchorAdjustment({ id: "C", offset: -10 }, -10)).toBe(0);
    expect(anchorAdjustment({ id: "C", offset: 40 }, 0)).toBe(-40); // "Load older" disappeared above
  });
});
