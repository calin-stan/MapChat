import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { messageRowSchema, parseRow, roomRowSchema, toRoom } from "@/lib/db/rows";
import {
  insertWithUniqueName,
  type InsertWithUniqueNameOptions,
  NameCollision,
} from "@/lib/names/generate";
import type { Bbox } from "@/lib/schemas/query";
import { type CreateRoomInput, roundCoord } from "@/lib/schemas/room";
import type { Message, Room } from "@/lib/schemas/types";

/** Most rooms one viewport query returns (PRD 4, "Map behavior"). */
export const ROOMS_BBOX_LIMIT = 500;

const ROOM_COLUMNS = "id,name,lat,lng,created_at";

const createRoomResultSchema = z.object({ room: roomRowSchema, message: messageRowSchema });

/** The shape of a PostgREST error as supabase-js reports it. */
type PostgrestErrorLike = { code?: string; message: string };

export type RoomConflict = "name" | "coordinates";

/**
 * Tells the two unique violations of `create_room_with_first_message` apart
 * (PRD 6.3). PostgREST exposes no constraint field, only Postgres's message,
 * so the exact quoted constraint name is extracted from it (README, "Database").
 * Anything else is not a room conflict.
 */
export function classifyRoomConflict(
  error: PostgrestErrorLike | null | undefined,
): RoomConflict | undefined {
  if (error?.code !== "23505") return undefined;
  const constraint = /^duplicate key value violates unique constraint "([^"]+)"$/.exec(
    error.message,
  )?.[1];
  if (constraint === "chatrooms_name_key") return "name";
  if (constraint === "chatrooms_lat_lng_key") return "coordinates";
  return undefined;
}

/** A PostgREST call failed for a reason the caller does not handle (→ 500). */
export class RepositoryError extends Error {
  readonly code: string | undefined;

  constructor(operation: string, error: PostgrestErrorLike) {
    super(`${operation}: ${error.message}`);
    this.name = "RepositoryError";
    this.code = error.code;
  }
}

/** Internal: `(lat, lng)` is taken. Converted to `{ kind: "exists" }` before leaving. */
class CoordinateConflict extends Error {
  constructor() {
    super("A room already exists at these coordinates");
    this.name = "CoordinateConflict";
  }
}

/**
 * Rooms inside one non-crossing box, bounds inclusive, newest first
 * (`created_at desc, id desc`). Reads `limit + 1` rows so `truncated` says
 * whether the box holds more than `limit` rooms (PRD 4). The map splits a
 * viewport that crosses the antimeridian into two boxes (chunk 3 handoff).
 */
export async function findRoomsInBbox(
  db: SupabaseClient,
  bbox: Bbox,
  limit = ROOMS_BBOX_LIMIT,
): Promise<{ rooms: Room[]; truncated: boolean }> {
  const { data, error } = await db
    .from("chatrooms")
    .select(ROOM_COLUMNS)
    .gte("lat", bbox.minLat)
    .lte("lat", bbox.maxLat)
    .gte("lng", bbox.minLng)
    .lte("lng", bbox.maxLng)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);
  if (error) throw new RepositoryError("findRoomsInBbox", error);
  const rooms = (data as unknown[]).map(toRoom);
  return { rooms: rooms.slice(0, limit), truncated: rooms.length > limit };
}

/** One room by id, or null. `id` must already be a valid UUID (the route checks). */
export async function findRoomById(db: SupabaseClient, id: string): Promise<Room | null> {
  const { data, error } = await db
    .from("chatrooms")
    .select(ROOM_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new RepositoryError("findRoomById", error);
  return data === null ? null : toRoom(data);
}

/** The room at exactly these (already rounded) coordinates, or null. */
export async function findRoomByCoords(
  db: SupabaseClient,
  lat: number,
  lng: number,
): Promise<Room | null> {
  const { data, error } = await db
    .from("chatrooms")
    .select(ROOM_COLUMNS)
    .eq("lat", lat)
    .eq("lng", lng)
    .maybeSingle();
  if (error) throw new RepositoryError("findRoomByCoords", error);
  return data === null ? null : toRoom(data);
}

export type CreateRoomResult =
  | { kind: "created"; room: Room; message: Message }
  | { kind: "exists"; room: Room };

/** Test hooks for deterministic names; production callers pass nothing. */
export type CreateRoomOptions = Pick<InsertWithUniqueNameOptions, "generateName" | "suffix">;

/**
 * Creates a room and its first message atomically (PRD 6.3). Coordinates are
 * rounded to 6 decimals first. A name collision retries with a new name
 * (5 times, then once with a suffix; a final NameCollision propagates for the
 * route's 503). A coordinate collision returns the room already there
 * (`exists`, the route's 409). Any other PostgREST error is a RepositoryError.
 */
export async function createRoom(
  db: SupabaseClient,
  input: CreateRoomInput,
  opts: CreateRoomOptions = {},
): Promise<CreateRoomResult> {
  const lat = roundCoord(input.lat);
  const lng = roundCoord(input.lng);

  try {
    return await insertWithUniqueName(async (name): Promise<CreateRoomResult> => {
      const { data, error } = await db.rpc("create_room_with_first_message", {
        p_lat: lat,
        p_lng: lng,
        p_name: name,
        p_author: input.author,
        p_text: input.text,
      });
      if (error) {
        const conflict = classifyRoomConflict(error);
        if (conflict === "name") throw new NameCollision();
        if (conflict === "coordinates") throw new CoordinateConflict();
        throw new RepositoryError("createRoom", error);
      }
      const { room, message } = parseRow(
        createRoomResultSchema,
        data,
        "create_room_with_first_message",
      );
      return { kind: "created", room, message };
    }, opts);
  } catch (error) {
    if (!(error instanceof CoordinateConflict)) throw error;
    const room = await findRoomByCoords(db, lat, lng);
    if (room === null) {
      throw new RepositoryError("createRoom", {
        message: `coordinate conflict reported but no room found at (${lat}, ${lng})`,
      });
    }
    return { kind: "exists", room };
  }
}
