"use client";

import dynamic from "next/dynamic";
import { useCallback, useMemo, useReducer } from "react";

import { MapStatus } from "@/components/map/MapStatus";
import type { MapViewProps } from "@/components/map/MapView";
import { PanelSlot } from "@/components/panel/PanelSlot";
import { RoomGoneNotice } from "@/components/panel/RoomGoneNotice";
import { WelcomeCard } from "@/components/panel/WelcomeCard";
import { NewRoomPopup } from "@/components/room/NewRoomPopup";
import { RoomPanel } from "@/components/room/RoomPanel";
import { useRoomPins } from "@/lib/map/useRoomPins";
import type { LatLng } from "@/lib/map/viewport";
import { draftPanelKey, handoffReducer, initialHandoff, roomPanelKey } from "@/lib/page/handoff";
import type { Prefill, Selection } from "@/lib/page/selection";
import { useSelectionUrl } from "@/lib/page/selectionUrl";
import type { CreateRoomInput } from "@/lib/schemas/room";
import type { Message, Room } from "@/lib/schemas/types";

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
 *
 * It also owns the new-room hand-off (new-room design §6): a create outcome
 * always takes over the panel, whatever is selected by then, and the handoff
 * revision in the panel keys makes that panel a fresh mount.
 */
export function MapShell({ initialSelection, initialCenter, initialZoom }: MapShellProps) {
  const [handoff, dispatch] = useReducer(handoffReducer, initialSelection, initialHandoff);
  const { selection, recovery } = handoff;
  const pins = useRoomPins();
  const { insertRoom, refresh } = pins;
  useSelectionUrl(selection);
  const rooms = useMemo(() => pinsToRender(pins.rooms, selection), [pins.rooms, selection]);

  const onEmptyClick = useCallback(
    (point: LatLng) => dispatch({ type: "clickEmpty", lat: point.lat, lng: point.lng }),
    [],
  );
  const onPinClick = useCallback((room: Room) => dispatch({ type: "clickPin", room }), []);
  const close = useCallback(() => dispatch({ type: "close" }), []);

  // Called when a create request settles, possibly long after its popup
  // unmounted. They touch only `dispatch` and `insertRoom`, both stable, so a
  // callback captured by an old request is as good as the current one. The pin
  // insert and the selection land in one render.
  const onCreated = useCallback(
    (room: Room, message: Message) => {
      insertRoom(room);
      dispatch({ type: "created", room, message });
    },
    [insertRoom],
  );
  const onConflict = useCallback(
    (room: Room, prefill: Prefill) => {
      insertRoom(room);
      dispatch({ type: "conflict", room, prefill });
    },
    [insertRoom],
  );
  const onFailed = useCallback(
    (input: CreateRoomInput, error: unknown) => dispatch({ type: "failed", input, error }),
    [],
  );
  // The open room answered 404: close its panel, say so, and fetch the pins
  // again so the dead one goes. The reducer ignores a report about any other room.
  const onGone = useCallback(
    (room: Room) => {
      refresh();
      dispatch({ type: "roomGone", roomId: room.id });
    },
    [refresh],
  );

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
        {selection.kind === "none" && selection.gone ? (
          <RoomGoneNotice room={selection.gone} onDismiss={close} />
        ) : null}
        {selection.kind === "none" ? <WelcomeCard /> : null}
        {selection.kind === "draft" ? (
          // The key survives ordinary draft moves, so typed text does; a rejected create gets a new one.
          <NewRoomPopup
            key={draftPanelKey(handoff)}
            lat={selection.lat}
            lng={selection.lng}
            recovery={recovery ?? undefined}
            onCreated={onCreated}
            onConflict={onConflict}
            onFailed={onFailed}
            onClose={close}
          />
        ) : null}
        {selection.kind === "room" ? (
          // Keyed by room id and handoff revision: another room, or a create
          // outcome for this same room, remounts the panel with a fresh feed.
          <RoomPanel
            key={roomPanelKey(handoff, selection.room)}
            room={selection.room}
            seed={selection.seed}
            prefill={selection.prefill}
            onClose={close}
            onGone={onGone}
          />
        ) : null}
      </PanelSlot>
    </div>
  );
}
