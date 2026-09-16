"use client";

import "leaflet/dist/leaflet.css";

import { MapContainer, TileLayer } from "react-leaflet";

import { DraftPin } from "@/components/map/DraftPin";
import { MapEvents } from "@/components/map/MapEvents";
import { MAX_ZOOM, MIN_ZOOM } from "@/components/map/mapDefaults";
import { RoomPins } from "@/components/map/RoomPins";
import type { LatLng, Viewport } from "@/lib/map/viewport";
import type { Room } from "@/lib/schemas/types";

export type MapViewProps = {
  center: LatLng;
  zoom: number;
  /** Pins to draw; already includes the selected room. */
  rooms: Room[];
  selectedRoomId?: string;
  draft?: LatLng;
  /** Once after mount, then on every `moveend`. */
  onViewportChange(viewport: Viewport): void;
  /** Map click not consumed by a marker. */
  onEmptyClick(point: LatLng): void;
  onPinClick(room: Room): void;
};

/** One world copy; pins never need wrapping (spec §4). */
const WORLD_BOUNDS: [[number, number], [number, number]] = [
  [-90, -180],
  [90, 180],
];
const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/**
 * The Leaflet map: data in through props, three events out, no application
 * state (spec §2). Loaded by `MapShell` with `next/dynamic` and `ssr: false`,
 * which is why this module owns the Leaflet CSS import. `center` and `zoom`
 * are the initial view only; the user moves the map afterwards.
 */
export default function MapView({
  center,
  zoom,
  rooms,
  selectedRoomId,
  draft,
  onViewportChange,
  onEmptyClick,
  onPinClick,
}: MapViewProps) {
  return (
    <MapContainer
      center={[center.lat, center.lng]}
      zoom={zoom}
      minZoom={MIN_ZOOM}
      maxZoom={MAX_ZOOM}
      maxBounds={WORLD_BOUNDS}
      maxBoundsViscosity={1}
      // This disables zoom only. MapEvents arbitrates click/double-click draft placement.
      doubleClickZoom={false}
      worldCopyJump={false}
      className="h-full w-full"
    >
      <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} noWrap maxZoom={MAX_ZOOM} />
      <MapEvents onViewportChange={onViewportChange} onEmptyClick={onEmptyClick} />
      <RoomPins rooms={rooms} selectedRoomId={selectedRoomId} onPinClick={onPinClick} />
      {draft ? <DraftPin lat={draft.lat} lng={draft.lng} /> : null}
    </MapContainer>
  );
}
