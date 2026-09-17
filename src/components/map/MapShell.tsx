"use client";

import dynamic from "next/dynamic";
import { useCallback, useMemo, useReducer } from "react";

import { MapStatus } from "@/components/map/MapStatus";
import type { MapViewProps } from "@/components/map/MapView";
import { PanelFrame } from "@/components/panel/PanelFrame";
import { PanelSlot } from "@/components/panel/PanelSlot";
import { WelcomeCard } from "@/components/panel/WelcomeCard";
import { RoomPanel } from "@/components/room/RoomPanel";
import { useRoomPins } from "@/lib/map/useRoomPins";
import type { LatLng } from "@/lib/map/viewport";
import { type Selection, selectionReducer } from "@/lib/page/selection";
import type { Room } from "@/lib/schemas/types";

// Leaflet touches `window` at import time, so the map is a client-only bundle.
// The neutral placeholder keeps the panel slot positioned before it arrives.
const MapView = dynamic<MapViewProps>(() => import("@/components/map/MapView"), {
  ssr: false,
  loading: () => <div className="h-full w-full bg-muted" />,
});

export type MapShellProps = {
  initialSelection: Selection;
  initialCenter: LatLng;
  initialZoom: number;
};

/** The fetched rooms plus the selected room when the capped response omits it (spec §5.3, PRD 4). */
export function pinsToRender(rooms: Room[], selection: Selection): Room[] {
  if (selection.kind !== "room") return rooms;
  const selectedId = selection.room.id;
  return rooms.some((room) => room.id === selectedId) ? rooms : [...rooms, selection.room];
}

/**
 * The map page (spec §3): owns the selection and the pins, renders the map,
 * the status pill and the one floating panel. The panel and the pill are
 * siblings of the Leaflet container, so their pointer events never reach the
 * map and Leaflet's own z-indexes stay scoped to its container.
 */
export function MapShell({ initialSelection, initialCenter, initialZoom }: MapShellProps) {
  const [selection, dispatch] = useReducer(selectionReducer, initialSelection);
  const pins = useRoomPins();
  const rooms = useMemo(() => pinsToRender(pins.rooms, selection), [pins.rooms, selection]);

  const onEmptyClick = useCallback(
    (point: LatLng) => dispatch({ type: "clickEmpty", lat: point.lat, lng: point.lng }),
    [],
  );
  const onPinClick = useCallback((room: Room) => dispatch({ type: "clickPin", room }), []);
  const close = useCallback(() => dispatch({ type: "close" }), []);

  return (
    <div className="relative h-dvh w-full overflow-hidden">
      <div className="absolute inset-0 z-0">
        <MapView
          center={initialCenter}
          zoom={initialZoom}
          rooms={rooms}
          selectedRoomId={selection.kind === "room" ? selection.room.id : undefined}
          draft={selection.kind === "draft" ? { lat: selection.lat, lng: selection.lng } : undefined}
          onViewportChange={pins.setViewport}
          onEmptyClick={onEmptyClick}
          onPinClick={onPinClick}
        />
      </div>
      <MapStatus truncated={pins.truncated} refreshFailed={pins.status === "error"} />
      <PanelSlot>
        {selection.kind === "none" ? <WelcomeCard /> : null}
        {selection.kind === "draft" ? (
          // Chunk 10 replaces the body and footer with NewRoomPopup.
          <PanelFrame title="New chatroom" onClose={close}>
            <p className="text-muted-foreground">
              {selection.lat.toFixed(6)}, {selection.lng.toFixed(6)}
            </p>
          </PanelFrame>
        ) : null}
        {selection.kind === "room" ? (
          // Keyed by room id so selecting another room remounts the panel and resets its feed.
          <RoomPanel
            key={selection.room.id}
            room={selection.room}
            seed={selection.seed}
            prefill={selection.prefill}
            onClose={close}
          />
        ) : null}
      </PanelSlot>
    </div>
  );
}
