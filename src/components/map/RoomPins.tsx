"use client";

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
        <Marker
          key={room.id}
          position={[room.lat, room.lng]}
          icon={pinIcon(room.id === selectedRoomId ? "selected" : "room")}
          title={room.name}
          eventHandlers={{ click: () => onPinClick(room) }}
        />
      ))}
    </>
  );
}
