"use client";

import { memo, useMemo } from "react";
import { Marker } from "react-leaflet";

import { pinIcon } from "@/components/map/pinIcon";
import type { Room } from "@/lib/schemas/types";

export type RoomPinsProps = {
  rooms: Room[];
  selectedRoomId?: string;
  onPinClick(room: Room): void;
};

/**
 * One marker per room (spec §7). `title` gives the native tooltip; Leaflet
 * markers are keyboard focusable and Enter fires `click`. Marker clicks do
 * not bubble to the map, so they never place a draft pin.
 */
export function RoomPins({ rooms, selectedRoomId, onPinClick }: RoomPinsProps) {
  return (
    <>
      {rooms.map((room) => (
        <RoomPin
          key={room.id}
          room={room}
          selected={room.id === selectedRoomId}
          onPinClick={onPinClick}
        />
      ))}
    </>
  );
}

/**
 * Internal marker component. Position and event handlers are memoised per room
 * to prevent unnecessary re-renders and handler rebinding when other rooms' pins change.
 */
const RoomPin = memo(function RoomPin({
  room,
  selected,
  onPinClick,
}: {
  room: Room;
  selected: boolean;
  onPinClick(room: Room): void;
}) {
  const position = useMemo<[number, number]>(
    () => [room.lat, room.lng],
    [room.lat, room.lng]
  );

  const eventHandlers = useMemo(
    () => ({ click: () => onPinClick(room) }),
    [room, onPinClick]
  );

  return (
    <Marker
      position={position}
      icon={pinIcon(selected ? "selected" : "room")}
      title={room.name}
      eventHandlers={eventHandlers}
    />
  );
});
