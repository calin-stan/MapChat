import type { Bbox } from "@/lib/schemas/query";
import type { Room } from "@/lib/schemas/types";
import { compareCreatedAtId } from "@/lib/time/ordering";

export type LatLng = { lat: number; lng: number };

/** Raw Leaflet bounds in degrees; longitudes are unwrapped and may exceed ±180. */
export type Viewport = { west: number; south: number; east: number; north: number };

/**
 * Most pins the map shows at once. Same value as the server's
 * `ROOMS_BBOX_LIMIT` (src/lib/db/rooms.ts), kept separate so the browser
 * never imports lib/db.
 */
export const PIN_LIMIT = 500;

/** The four accessors of Leaflet's `LatLngBounds` this module needs; no leaflet import. */
export type BoundsLike = {
  getWest(): number;
  getSouth(): number;
  getEast(): number;
  getNorth(): number;
};

export function boundsToViewport(bounds: BoundsLike): Viewport {
  return {
    west: bounds.getWest(),
    south: bounds.getSouth(),
    east: bounds.getEast(),
    north: bounds.getNorth(),
  };
}

function clampLat(lat: number): number {
  return Math.min(90, Math.max(-90, lat));
}

/**
 * The non-crossing query boxes for a viewport (chunk 3 handoff, PRD 6.5):
 * latitudes clamped to the poles, a span of 360° or more queries the whole
 * world, otherwise both longitudes shift by the same multiple of 360 so
 * `west` lies in [-180, 180) and a viewport crossing the antimeridian splits
 * into two boxes. Longitude endpoints are never clamped on their own.
 */
export function toQueryBoxes(viewport: Viewport): Bbox[] {
  const minLat = clampLat(viewport.south);
  const maxLat = clampLat(viewport.north);
  if (viewport.east - viewport.west >= 360) {
    return [{ minLng: -180, minLat, maxLng: 180, maxLat }];
  }
  const shift = Math.floor((viewport.west + 180) / 360) * 360;
  const west = viewport.west - shift;
  const east = viewport.east - shift;
  if (east > 180) {
    return [
      { minLng: west, minLat, maxLng: 180, maxLat },
      { minLng: -180, minLat, maxLng: east - 360, maxLat },
    ];
  }
  return [{ minLng: west, minLat, maxLng: east, maxLat }];
}

/** `created_at desc, id desc`, the server's order (PRD 4). Returns a new array. */
export function sortRoomsNewestFirst(rooms: Room[]): Room[] {
  return [...rooms].sort((a, b) => compareCreatedAtId(b, a));
}

/**
 * Combines the responses of one refresh: deduplicates by id, orders newest
 * first, caps at `limit`, and reports truncation when any box was truncated
 * or the distinct count exceeded the cap.
 */
export function mergeBoxResults(
  results: { rooms: Room[]; truncated: boolean }[],
  limit = PIN_LIMIT,
): { rooms: Room[]; truncated: boolean } {
  const byId = new Map<string, Room>();
  for (const result of results) {
    for (const room of result.rooms) byId.set(room.id, room);
  }
  const sorted = sortRoomsNewestFirst([...byId.values()]);
  const truncated = results.some((result) => result.truncated) || sorted.length > limit;
  return { rooms: sorted.slice(0, limit), truncated };
}
