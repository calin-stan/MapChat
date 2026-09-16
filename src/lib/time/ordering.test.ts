import { describe, expect, it } from "vitest";

import { compareCreatedAtId, normalizeCreatedAt } from "@/lib/time/ordering";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const item = (n: number, fraction: string) => ({
  id: id(n), createdAt: normalizeCreatedAt(`2026-09-16T10:00:00.${fraction}+00:00`),
});

describe("normalizeCreatedAt", () => {
  it.each([
    ["2026-09-16T10:00:00.123456+00:00", "2026-09-16T10:00:00.123456Z"],
    ["2026-09-16T10:00:00.45639+00:00", "2026-09-16T10:00:00.456390Z"],
    ["2026-09-16T10:00:00.1Z", "2026-09-16T10:00:00.100000Z"],
    ["2026-09-16T10:00:00Z", "2026-09-16T10:00:00.000000Z"],
    ["2026-09-16T12:00:00.123456+02:00", "2026-09-16T10:00:00.123456Z"],
    ["2026-09-16T23:30:00.000001-02:00", "2026-09-17T01:30:00.000001Z"],
    ["2026-09-16T00:30:00.999999+02:00", "2026-09-15T22:30:00.999999Z"],
    ["2026-09-16T10:00:00.123456Z", "2026-09-16T10:00:00.123456Z"],
  ])("normalizes %s without losing precision", (input, expected) => {
    expect(normalizeCreatedAt(input)).toBe(expected);
  });

  it.each([
    "yesterday", "2026-02-30T10:00:00Z", "2026-09-16T10:00:00",
    "2026-09-16T10:00:00.1234567Z", "2026-09-16T25:00:00Z",
    "2026-09-16T10:00:00+25:00", "2026-09-16", "infinity",
  ])("rejects invalid or unsupported timestamp %s", (input) => {
    expect(() => normalizeCreatedAt(input)).toThrow(RangeError);
  });
});

describe("compareCreatedAtId", () => {
  it("preserves microseconds before applying the UUID tie-breaker", () => {
    const older = item(2, "123100");
    const newer = item(1, "123900");
    expect([newer, older].sort(compareCreatedAtId)).toEqual([older, newer]);
  });

  it("orders exact timestamp ties by UUID and returns zero for equal tuples", () => {
    const a = item(1, "123100");
    const b = item(2, "123100");
    expect(compareCreatedAtId(a, b)).toBeLessThan(0);
    expect(compareCreatedAtId(b, a)).toBeGreaterThan(0);
    expect(compareCreatedAtId(a, { ...a })).toBe(0);
  });

  it("selects the newer boundary room when merging two boxes under the 500 cap", () => {
    const newer = item(1, "123900");
    const older = item(2, "123100");
    const aboveBoundary = Array.from({ length: 499 }, (_, i) => item(i + 3, "124000"));
    const boxes = [[...aboveBoundary, older], [newer]];
    const merged = [...new Map(boxes.flat().map((room) => [room.id, room])).values()]
      .sort((a, b) => compareCreatedAtId(b, a)).slice(0, 500);
    expect(merged).toHaveLength(500);
    expect(merged[499]).toEqual(newer);
    expect(merged).not.toContainEqual(older);
  });

  it("advances older-history continuation with opposing UUID and microsecond order", () => {
    // X exists before the initial A/B/C page. A, B and C share one millisecond.
    const x = item(4, "122000");
    const a = item(3, "123100");
    const b = item(1, "123200");
    const c = item(2, "123300");
    const displayed = [c, a, b].sort(compareCreatedAtId);
    expect(displayed[0]).toEqual(a);
    // Model SQL's before=<A> page size 1 using the known database order.
    const databaseOrder = [x, a, b, c];
    const boundary = databaseOrder.findIndex((row) => row.id === displayed[0].id);
    const before = databaseOrder.slice(0, boundary).slice(-1);
    const merged = [...new Map([...displayed, ...before].map((row) => [row.id, row])).values()]
      .sort(compareCreatedAtId);
    expect(before).toEqual([x]);
    expect(merged[0]).toEqual(x);
  });
});
