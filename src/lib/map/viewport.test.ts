import { describe, expect, it } from "vitest";

import {
  boundsToViewport,
  mergeBoxResults,
  PIN_LIMIT,
  sortRoomsNewestFirst,
  toQueryBoxes,
} from "@/lib/map/viewport";
import type { Bbox } from "@/lib/schemas/query";
import type { Room } from "@/lib/schemas/types";

/** A canonical lowercase UUID whose last 12 digits are `n`, zero-padded. */
function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

function room(overrides: Partial<Room> & { id: string }): Room {
  return {
    name: `room-${overrides.id.slice(-4)}`,
    lat: 46.77,
    lng: 23.62,
    createdAt: "2026-09-16T15:00:00.000000Z",
    ...overrides,
  };
}

const LATS = { minLat: 40, maxLat: 50 };
const visibleIn = (boxes: Bbox[], lng: number) =>
  boxes.some((box) => box.minLng <= lng && lng <= box.maxLng);

describe("boundsToViewport", () => {
  it("reads the four edges of a Leaflet-like bounds object", () => {
    const bounds = {
      getWest: () => 170,
      getSouth: () => 40,
      getEast: () => 190,
      getNorth: () => 50,
    };
    expect(boundsToViewport(bounds)).toEqual({ west: 170, south: 40, east: 190, north: 50 });
  });
});

describe("toQueryBoxes", () => {
  it("splits a viewport crossing the antimeridian into two boxes", () => {
    const boxes = toQueryBoxes({ west: 170, south: 40, east: 190, north: 50 });

    expect(boxes).toEqual([
      { minLng: 170, maxLng: 180, ...LATS },
      { minLng: -180, maxLng: -170, ...LATS },
    ]);
    expect(visibleIn(boxes, 175)).toBe(true);
    expect(visibleIn(boxes, -175)).toBe(true);
    expect(visibleIn(boxes, 0)).toBe(false);
  });

  it("normalises a viewport one world copy to the east before splitting", () => {
    expect(toQueryBoxes({ west: 530, south: 40, east: 550, north: 50 })).toEqual([
      { minLng: 170, maxLng: 180, ...LATS },
      { minLng: -180, maxLng: -170, ...LATS },
    ]);
  });

  it("normalises a viewport one world copy to the west before splitting", () => {
    expect(toQueryBoxes({ west: -190, south: 40, east: -170, north: 50 })).toEqual([
      { minLng: 170, maxLng: 180, ...LATS },
      { minLng: -180, maxLng: -170, ...LATS },
    ]);
  });

  it("shifts a fully offset viewport into one box without splitting", () => {
    expect(toQueryBoxes({ west: 190, south: 40, east: 210, north: 50 })).toEqual([
      { minLng: -170, maxLng: -150, ...LATS },
    ]);
  });

  it("returns one world box when the span is 360 degrees or more", () => {
    expect(toQueryBoxes({ west: -200, south: 40, east: 200, north: 50 })).toEqual([
      { minLng: -180, maxLng: 180, ...LATS },
    ]);
    expect(toQueryBoxes({ west: 0, south: 40, east: 360, north: 50 })).toEqual([
      { minLng: -180, maxLng: 180, ...LATS },
    ]);
  });

  it("clamps latitudes to the poles, in every box", () => {
    expect(toQueryBoxes({ west: 10, south: -95, east: 20, north: 95 })).toEqual([
      { minLng: 10, minLat: -90, maxLng: 20, maxLat: 90 },
    ]);
    expect(toQueryBoxes({ west: 170, south: -95, east: 190, north: 95 })).toEqual([
      { minLng: 170, minLat: -90, maxLng: 180, maxLat: 90 },
      { minLng: -180, minLat: -90, maxLng: -170, maxLat: 90 },
    ]);
  });

  it("keeps a viewport that touches ±180 as a single box", () => {
    expect(toQueryBoxes({ west: -180, south: 40, east: -100, north: 50 })).toEqual([
      { minLng: -180, maxLng: -100, ...LATS },
    ]);
    expect(toQueryBoxes({ west: 100, south: 40, east: 180, north: 50 })).toEqual([
      { minLng: 100, maxLng: 180, ...LATS },
    ]);
  });

  it("maps a west edge of exactly 180 to -180", () => {
    expect(toQueryBoxes({ west: 180, south: 40, east: 200, north: 50 })).toEqual([
      { minLng: -180, maxLng: -160, ...LATS },
    ]);
  });
});

describe("sortRoomsNewestFirst", () => {
  it("orders by createdAt descending without mutating the input", () => {
    const older = room({ id: uuid(1), createdAt: "2026-09-16T15:00:00.000000Z" });
    const newer = room({ id: uuid(2), createdAt: "2026-09-16T15:00:01.000000Z" });
    const input = [older, newer];

    expect(sortRoomsNewestFirst(input)).toEqual([newer, older]);
    expect(input).toEqual([older, newer]);
  });
});

describe("mergeBoxResults", () => {
  it("deduplicates rooms that appear in more than one box by id", () => {
    const shared = room({ id: uuid(1) });
    const result = mergeBoxResults([
      { rooms: [shared], truncated: false },
      { rooms: [shared, room({ id: uuid(2) })], truncated: false },
    ]);

    expect(result.rooms.map((r) => r.id)).toEqual([uuid(2), uuid(1)]);
    expect(result.truncated).toBe(false);
  });

  it("orders newest first at microsecond precision", () => {
    const a = room({ id: uuid(1), createdAt: "2026-09-16T15:00:00.123000Z" });
    const b = room({ id: uuid(2), createdAt: "2026-09-16T15:00:00.123001Z" });

    expect(mergeBoxResults([{ rooms: [a, b], truncated: false }]).rooms).toEqual([b, a]);
  });

  it("breaks createdAt ties by id descending, in Postgres byte order", () => {
    // parseInt-style or locale comparisons would put "…09" after "…0a"; SQL puts "…0a" first.
    const nine = room({ id: "00000000-0000-4000-8000-000000000009" });
    const letterA = room({ id: "00000000-0000-4000-8000-00000000000a" });

    expect(mergeBoxResults([{ rooms: [nine, letterA], truncated: false }]).rooms).toEqual([
      letterA,
      nine,
    ]);
  });

  it("slices to the limit and reports truncation when more rooms were distinct", () => {
    // Microsecond `i` makes room `i` newer than room `i - 1`.
    const rooms = Array.from({ length: PIN_LIMIT + 1 }, (_, i) =>
      room({ id: uuid(i), createdAt: `2026-09-16T15:00:00.${String(i).padStart(6, "0")}Z` }),
    );

    const result = mergeBoxResults([
      { rooms: rooms.slice(0, 300), truncated: false },
      { rooms: rooms.slice(300), truncated: false },
    ]);

    expect(result.rooms).toHaveLength(PIN_LIMIT);
    expect(result.truncated).toBe(true);
    expect(result.rooms[0].id).toBe(uuid(PIN_LIMIT)); // the newest survives the slice
  });

  it("propagates a per-box truncated flag even when the merged count is small", () => {
    const result = mergeBoxResults([
      { rooms: [room({ id: uuid(1) })], truncated: true },
      { rooms: [room({ id: uuid(2) })], truncated: false },
    ]);

    expect(result.rooms).toHaveLength(2);
    expect(result.truncated).toBe(true);
  });

  it("honours an explicit limit", () => {
    const rooms = [uuid(1), uuid(2), uuid(3)].map((id) => room({ id }));

    const result = mergeBoxResults([{ rooms, truncated: false }], 2);

    expect(result.rooms.map((r) => r.id)).toEqual([uuid(3), uuid(2)]);
    expect(result.truncated).toBe(true);
  });

  it("returns no rooms and no truncation for no boxes", () => {
    expect(mergeBoxResults([])).toEqual({ rooms: [], truncated: false });
  });
});
