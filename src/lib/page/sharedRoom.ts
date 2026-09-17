import "server-only";

import { findRoomById } from "@/lib/db/rooms";
import { uuidSchema } from "@/lib/schemas/query";
import type { Room } from "@/lib/schemas/types";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * The room behind a shared `/room/<id>` URL (PRD 3), or null when the address
 * names no room: an id that is not a UUID never reaches the database. A
 * database failure throws `RepositoryError`; it is not a missing room.
 */
export async function loadSharedRoom(id: string): Promise<Room | null> {
  const parsed = uuidSchema.safeParse(id);
  if (!parsed.success) return null;
  return findRoomById(createServiceClient(), parsed.data);
}
