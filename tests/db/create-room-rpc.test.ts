import { type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { connect, createApiClient, resolveSupabaseApi, truncateAll, type Sql } from "./helpers";

let sql: Sql;
let client: SupabaseClient;

beforeAll(() => {
  sql = connect();
  const { apiUrl, serviceRoleKey } = resolveSupabaseApi();
  client = createApiClient(apiUrl, serviceRoleKey);
});

afterAll(async () => {
  await sql.end();
});

beforeEach(async () => {
  await truncateAll(sql);
});

// The contract classifier the route handler will use (later plan). Defined
// here, not imported, since production route code is out of scope for this
// task; this suite pins its exact behavior.
type RoomConflict = "name" | "coordinates";

function classifyRoomConflict(
  error: { code: string; message: string } | null,
): RoomConflict | undefined {
  if (error?.code !== "23505") return undefined;
  const constraint = /^duplicate key value violates unique constraint "([^"]+)"$/.exec(
    error.message,
  )?.[1];
  if (constraint === "chatrooms_name_key") return "name";
  if (constraint === "chatrooms_lat_lng_key") return "coordinates";
  return undefined;
}

interface RoomJson {
  id: string;
  name: string;
  lat: number;
  lng: number;
  created_at: string;
}

interface MessageJson {
  id: string;
  chatroom_id: string;
  author: string;
  text: string;
  created_at: string;
}

interface CreateResult {
  room: RoomJson;
  message: MessageJson;
}

interface CreateInput {
  lat: number;
  lng: number;
  name: string;
  author: string;
  text: string;
}

const valid: CreateInput = {
  lat: 47.497913,
  lng: 19.040236,
  name: "rpc-brave-crimson-otter",
  author: "ann",
  text: "hello from budapest",
};

function callCreateRoom(input: CreateInput) {
  return client
    .rpc("create_room_with_first_message", {
      p_lat: input.lat,
      p_lng: input.lng,
      p_name: input.name,
      p_author: input.author,
      p_text: input.text,
    })
    .abortSignal(AbortSignal.timeout(10_000));
}

async function snapshotRooms(): Promise<unknown[]> {
  return [...(await sql`select * from public.chatrooms order by id`)];
}

async function snapshotMessages(): Promise<unknown[]> {
  return [...(await sql`select * from public.messages order by id`)];
}

describe("create_room_with_first_message: RPC contract", () => {
  it("creates the room and its first message over HTTP", async () => {
    const { data, error } = await callCreateRoom(valid);

    expect(error).toBeNull();
    const result = data as CreateResult;
    expect(result.room).toMatchObject({
      name: valid.name,
      lat: valid.lat,
      lng: valid.lng,
    });
    expect(result.message).toMatchObject({
      chatroom_id: result.room.id,
      author: valid.author,
      text: valid.text,
    });

    const rooms = await snapshotRooms();
    const messages = await snapshotMessages();
    expect(rooms).toHaveLength(1);
    expect(messages).toHaveLength(1);
    expect((rooms[0] as { id: string }).id).toBe(result.room.id);
    expect((messages[0] as { id: string; chatroom_id: string }).id).toBe(result.message.id);
    expect((messages[0] as { chatroom_id: string }).chatroom_id).toBe(result.room.id);
  });

  it("classifies a name collision as a 409 name conflict and leaves both tables untouched", async () => {
    const first = await callCreateRoom(valid);
    expect(first.error).toBeNull();

    const roomsAfterFirst = await snapshotRooms();
    const messagesAfterFirst = await snapshotMessages();

    const second = await callCreateRoom({
      ...valid,
      lat: 1,
      lng: 1,
      text: "second attempt",
    });

    expect(second.status).toBe(409);
    expect(second.data).toBeNull();
    expect(second.error?.code).toBe("23505");
    expect(second.error).toHaveProperty("message");
    expect(second.error).toHaveProperty("details");
    expect(second.error).toHaveProperty("hint");
    expect(second.error).not.toHaveProperty("constraint_name");
    expect(classifyRoomConflict(second.error)).toBe("name");

    expect(await snapshotRooms()).toEqual(roomsAfterFirst);
    expect(await snapshotMessages()).toEqual(messagesAfterFirst);
  });

  it("classifies a coordinate collision as a 409 coordinates conflict and leaves both tables untouched", async () => {
    const first = await callCreateRoom(valid);
    expect(first.error).toBeNull();

    const roomsAfterFirst = await snapshotRooms();
    const messagesAfterFirst = await snapshotMessages();

    const second = await callCreateRoom({
      ...valid,
      name: "rpc-calm-teal-heron",
      text: "same spot",
    });

    expect(second.status).toBe(409);
    expect(second.data).toBeNull();
    expect(second.error?.code).toBe("23505");
    expect(second.error).toHaveProperty("message");
    expect(second.error).toHaveProperty("details");
    expect(second.error).toHaveProperty("hint");
    expect(second.error).not.toHaveProperty("constraint_name");
    expect(classifyRoomConflict(second.error)).toBe("coordinates");

    expect(await snapshotRooms()).toEqual(roomsAfterFirst);
    expect(await snapshotMessages()).toEqual(messagesAfterFirst);
  });

  it("rolls back the room insert over HTTP when the first message is invalid", async () => {
    const { data, error } = await callCreateRoom({ ...valid, text: "" });

    expect(data).toBeNull();
    expect(error?.code).toBe("23514");
    expect(classifyRoomConflict(error ?? null)).toBeUndefined();

    expect(await snapshotRooms()).toEqual([]);
    expect(await snapshotMessages()).toEqual([]);
  });
});

describe("classifyRoomConflict", () => {
  it("never classifies null, non-23505 errors, or unrecognized constraint names as a conflict", () => {
    expect(classifyRoomConflict(null)).toBeUndefined();

    expect(
      classifyRoomConflict({
        code: "23514",
        message: 'duplicate key value violates unique constraint "chatrooms_name_key"',
      }),
    ).toBeUndefined();

    expect(
      classifyRoomConflict({
        code: "23505",
        message: 'duplicate key value violates unique constraint "messages_pkey"',
      }),
    ).toBeUndefined();

    expect(
      classifyRoomConflict({
        code: "23505",
        message: "chatrooms_name_key already exists, please choose another name",
      }),
    ).toBeUndefined();
  });
});
