"use client";

import { CRS, latLng } from "leaflet";
import { useState } from "react";

import { ROOM_REGION } from "@/app/e2e/roomRegion";
import MapView from "@/components/map/MapView";
import { DEFAULT_CENTER, WORLD_ZOOM } from "@/components/map/mapDefaults";
import { PIN_LIMIT, sortRoomsNewestFirst, type Viewport } from "@/lib/map/viewport";
import type { Room } from "@/lib/schemas/types";

const cornerPoints = [ROOM_REGION.minLat, ROOM_REGION.maxLat].flatMap((lat) =>
  [ROOM_REGION.minLng, ROOM_REGION.maxLng].map((lng) => ({ lat, lng })),
);
const roomId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const cornerRooms: Room[] = cornerPoints.map((point, index) => ({
  ...point, id: roomId(index + 1), name: `corner-${point.lat}-${point.lng}`,
  createdAt: "2025-01-01T00:00:00.000000Z",
}));
const newerRooms: Room[] = Array.from({ length: 501 }, (_, index) => ({
  id: roomId(index + 5), name: `newer-fixture-${index}`, lat: 45, lng: index / 50,
  createdAt: "2026-01-01T00:00:00.000000Z",
}));
const candidates = [...cornerRooms, ...newerRooms];
const rooms = sortRoomsNewestFirst(candidates).slice(0, PIN_LIMIT);
const ignore = () => {};

/** Real map geometry, synthetic capped pins; no database requests or corner-room reuse. */
export default function MapRegionFixture() {
  const [viewport, setViewport] = useState<Viewport | null>(null);
  const origin = viewport
    ? CRS.EPSG3857.latLngToPoint(latLng(viewport.north, viewport.west), WORLD_ZOOM)
    : null;
  const corners = viewport && origin ? cornerPoints.map(({ lat, lng }) => {
    const point = CRS.EPSG3857.latLngToPoint(latLng(lat, lng), WORLD_ZOOM).subtract(origin);
    return {
      lat, lng, x: point.x, y: point.y,
      inside: lat >= viewport.south && lat <= viewport.north &&
        lng >= viewport.west && lng <= viewport.east,
    };
  }) : [];
  return (
    <div className="relative h-dvh w-full overflow-hidden">
      <MapView center={DEFAULT_CENTER} zoom={WORLD_ZOOM} rooms={rooms}
        onViewportChange={setViewport} onEmptyClick={ignore} onPinClick={ignore} />
      <output role="status" aria-label="Map bounds" className="absolute top-0 left-0 z-10 max-w-full bg-background text-xs">
        {JSON.stringify({ ready: viewport !== null, candidateCount: candidates.length,
          displayedCount: rooms.length,
          cornerPinsIncluded: rooms.some((room) => cornerRooms.some((corner) => corner.id === room.id)),
          corners })}
      </output>
    </div>
  );
}
