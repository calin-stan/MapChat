"use client";

import { Marker } from "react-leaflet";

import { pinIcon } from "@/components/map/pinIcon";

export type DraftPinProps = { lat: number; lng: number };

/** The grey pin under a "New chatroom" draft. Not interactive: a click on it reaches the map and moves the draft (spec §7). */
export function DraftPin({ lat, lng }: DraftPinProps) {
  return <Marker position={[lat, lng]} icon={pinIcon("draft")} interactive={false} keyboard={false} />;
}
