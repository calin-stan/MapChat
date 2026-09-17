import { notFound } from "next/navigation";

import { ROOM_ZOOM } from "@/components/map/mapDefaults";
import { MapShell } from "@/components/map/MapShell";
import { loadSharedRoom } from "@/lib/page/sharedRoom";

/**
 * A shared room (PRD 3): the map centred on the room with its panel open. The
 * same shell as `/`, started from another selection. Rendered per request, as
 * every route with a dynamic segment and no `generateStaticParams` is, so a
 * room created a second ago opens and a removed one answers 404.
 */
export default async function RoomPage({ params }: PageProps<"/room/[id]">) {
  const { id } = await params;
  const room = await loadSharedRoom(id);
  if (room === null) notFound();

  return (
    <MapShell
      initialSelection={{ kind: "room", room }}
      initialCenter={{ lat: room.lat, lng: room.lng }}
      initialZoom={ROOM_ZOOM}
    />
  );
}
