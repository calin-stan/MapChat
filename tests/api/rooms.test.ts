import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { GET as getRoom } from "@/app/api/rooms/[id]/route";
import { GET as listRooms, POST as postRoom } from "@/app/api/rooms/route";
import { createRoom } from "@/lib/db/rooms";
import { NameCollision } from "@/lib/names/generate";
import type { Message, Room } from "@/lib/schemas/types";

import { apiRequest, connect, routeParams, serviceClient, truncateAll, type Sql } from "./helpers";

// The route modules import `server-only` through `@/lib/supabase/server`; it
// throws outside a React Server build. Hoisted by Vitest above the imports.
vi.mock("server-only", () => ({}));

const ROOM_NAME = /^[a-z]+-[a-z]+-[a-z]+(-[a-z0-9]{4})?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const NIL_UUID = "00000000-0000-4000-8000-000000000000";

// One code point, two UTF-16 units: proves code-point counting end to end.
const ASTRAL = "\u{1D518}";

const spot = { lat: 47.497913, lng: 19.040236 };

interface Created {
  room: Room;
  message: Message;
}

interface ApiErr {
  error: { code: string; fields?: { path: string; message: string }[]; room?: Room };
}

let sql: Sql;

beforeAll(() => {
  sql = connect();
});

afterAll(async () => {
  await sql.end();
});

beforeEach(async () => {
  await truncateAll(sql);
});

async function post(body: unknown): Promise<{ status: number; body: unknown }> {
  const response = await postRoom(apiRequest("/api/rooms", { method: "POST", body }));
  return { status: response.status, body: await response.json() };
}

async function list(bbox: string | null): Promise<{ status: number; body: unknown }> {
  const query = bbox === null ? "" : `?bbox=${encodeURIComponent(bbox)}`;
  const response = await listRooms(apiRequest(`/api/rooms${query}`));
  return { status: response.status, body: await response.json() };
}

async function get(id: string): Promise<{ status: number; body: unknown }> {
  const response = await getRoom(apiRequest(`/api/rooms/${id}`), routeParams(id));
  return { status: response.status, body: await response.json() };
}

async function counts(): Promise<{ rooms: number; messages: number }> {
  const [rooms] = await sql<{ count: number }[]>`select count(*)::int as count from public.chatrooms`;
  const [messages] = await sql<{ count: number }[]>`select count(*)::int as count from public.messages`;
  return { rooms: rooms.count, messages: messages.count };
}

async function seedRooms(rows: { name: string; lat: number; lng: number }[]): Promise<void> {
  const { error } = await serviceClient().from("chatrooms").insert(rows);
  if (error) throw new Error(`seed failed: ${error.message}`);
}

describe("POST /api/rooms", () => {
  it("creates the room and its first message, trimming the text fields", async () => {
    const { status, body } = await post({ ...spot, author: " ann ", text: "hello\n" });

    expect(status).toBe(201);
    const { room, message } = body as Created;
    expect(room).toMatchObject({ lat: spot.lat, lng: spot.lng });
    expect(room.id).toMatch(UUID);
    expect(room.name).toMatch(ROOM_NAME);
    expect(room.createdAt).toMatch(ISO_UTC);
    expect(message).toMatchObject({ chatroomId: room.id, author: "ann", text: "hello" });
    expect(message.id).toMatch(UUID);
    expect(message.createdAt).toMatch(ISO_UTC);
    await expect(counts()).resolves.toEqual({ rooms: 1, messages: 1 });
  });

  it("rounds coordinates to 6 decimals before insert", async () => {
    const { status, body } = await post({ lat: 10.1234564, lng: 20.0000004, author: "ann", text: "hi" });

    expect(status).toBe(201);
    expect((body as Created).room).toMatchObject({ lat: 10.123456, lng: 20 });
  });

  it("answers 409 with the existing room for the same rounded spot, posting nothing", async () => {
    const first = await post({ lat: 10.1234564, lng: 20.0000004, author: "ann", text: "first" });
    expect(first.status).toBe(201);

    const second = await post({ lat: 10.1234561, lng: 20.0000001, author: "bob", text: "second" });

    expect(second.status).toBe(409);
    expect((second.body as ApiErr).error).toEqual({
      code: "conflict",
      room: (first.body as Created).room,
    });
    await expect(counts()).resolves.toEqual({ rooms: 1, messages: 1 });
  });

  it("leaves one room and only the winner's message under concurrent creation (PRD 8)", async () => {
    const [a, b] = await Promise.all([
      post({ ...spot, author: "a", text: "from a" }),
      post({ ...spot, author: "b", text: "from b" }),
    ]);

    expect([a.status, b.status].sort()).toEqual([201, 409]);
    const winner = (a.status === 201 ? a : b).body as Created;
    const loser = (a.status === 409 ? a : b).body as ApiErr;
    expect(loser.error.room).toEqual(winner.room);
    await expect(counts()).resolves.toEqual({ rooms: 1, messages: 1 });

    const [stored] = await sql<{ author: string }[]>`select author from public.messages`;
    expect(stored.author).toBe(winner.message.author);
  });

  it("counts display-name length in code points", async () => {
    const tooLong = await post({ ...spot, author: ASTRAL.repeat(101), text: "hi" });
    expect(tooLong.status).toBe(400);
    expect((tooLong.body as ApiErr).error.fields?.[0].path).toBe("author");

    const justRight = await post({ ...spot, author: ASTRAL.repeat(100), text: "hi" });
    expect(justRight.status).toBe(201);
    expect((justRight.body as Created).message.author).toBe(ASTRAL.repeat(100));
  });

  it("rejects a body that is not JSON or not an object", async () => {
    const notJson = await post("{not json");
    expect(notJson.status).toBe(400);
    expect((notJson.body as ApiErr).error.fields).toEqual([
      { path: "", message: "must be a JSON body" },
    ]);

    const notObject = await post("42");
    expect(notObject.status).toBe(400);
    expect((notObject.body as ApiErr).error.fields?.[0].path).toBe("");
    await expect(counts()).resolves.toEqual({ rooms: 0, messages: 0 });
  });
});

describe("createRoom name collisions (repository, real database)", () => {
  const input = { ...spot, author: "ann", text: "hi" };

  it("retries with a new name when the generated name is taken", async () => {
    await seedRooms([{ name: "taken-name", lat: 1, lng: 1 }]);
    const names = ["taken-name", "free-name"];
    let i = 0;

    const result = await createRoom(serviceClient(), input, {
      generateName: () => names[Math.min(i++, names.length - 1)],
    });

    expect(result.kind).toBe("created");
    if (result.kind !== "created") return;
    expect(result.room.name).toBe("free-name");
    expect(result.message.text).toBe("hi");
    await expect(counts()).resolves.toEqual({ rooms: 2, messages: 1 });
  });

  it("gives up with NameCollision after the suffixed attempt, leaving nothing behind", async () => {
    await seedRooms([
      { name: "taken-name", lat: 1, lng: 1 },
      { name: "taken-name-zzzz", lat: 2, lng: 2 },
    ]);

    await expect(
      createRoom(serviceClient(), input, { generateName: () => "taken-name", suffix: () => "zzzz" }),
    ).rejects.toBeInstanceOf(NameCollision);
    await expect(counts()).resolves.toEqual({ rooms: 2, messages: 0 });
  });
});

describe("GET /api/rooms?bbox", () => {
  it("returns only rooms inside the box, boundaries included", async () => {
    await seedRooms([
      { name: "inside", lat: 0, lng: 0 },
      { name: "on-the-edge", lat: 1, lng: 2 },
      { name: "just-north", lat: 1.000001, lng: 0 },
      { name: "just-west", lat: 0, lng: -2.000001 },
      { name: "far-away", lat: 50, lng: 50 },
    ]);

    const { status, body } = await list("-2,-1,2,1");

    expect(status).toBe(200);
    const { rooms, truncated } = body as { rooms: Room[]; truncated: boolean };
    expect(rooms.map((r) => r.name).sort()).toEqual(["inside", "on-the-edge"]);
    expect(truncated).toBe(false);
  });

  it("orders by created_at desc, then id desc", async () => {
    await seedRooms([{ name: "older", lat: 0, lng: 0 }]);
    await seedRooms([
      { name: "batch-a", lat: 0, lng: 1 },
      { name: "batch-b", lat: 0, lng: 2 },
      { name: "batch-c", lat: 0, lng: 3 },
    ]);

    const { body } = await list("-1,-1,4,1");
    const rooms = (body as { rooms: Room[] }).rooms;

    expect(rooms).toHaveLength(4);
    expect(rooms[3].name).toBe("older");
    const batch = rooms.slice(0, 3);
    expect(new Set(batch.map((r) => r.createdAt)).size).toBe(1);
    expect(batch.map((r) => r.id)).toEqual([...batch.map((r) => r.id)].sort().reverse());
  });

  it("caps the result at 500 rooms and reports truncation", async () => {
    await seedRooms(
      Array.from({ length: 501 }, (_, i) => ({ name: `cap-${i}`, lat: 10 + i * 0.000001, lng: 10 })),
    );

    const capped = await list("9,9,11,11");
    expect(capped.status).toBe(200);
    expect((capped.body as { rooms: Room[] }).rooms).toHaveLength(500);
    expect((capped.body as { truncated: boolean }).truncated).toBe(true);

    const { error } = await serviceClient().from("chatrooms").delete().eq("name", "cap-0");
    expect(error).toBeNull();

    const exact = await list("9,9,11,11");
    expect((exact.body as { rooms: Room[] }).rooms).toHaveLength(500);
    expect((exact.body as { truncated: boolean }).truncated).toBe(false);
  });

  it("rejects a missing or malformed bbox with the bbox path", async () => {
    const missing = await list(null);
    expect(missing.status).toBe(400);
    expect((missing.body as ApiErr).error.fields).toEqual([{ path: "bbox", message: "is required" }]);

    const reversed = await list("3,4,-1,-2");
    expect(reversed.status).toBe(400);
    expect((reversed.body as ApiErr).error.fields?.[0].path).toBe("bbox");

    const threeParts = await list("1,2,3");
    expect(threeParts.status).toBe(400);
    expect((threeParts.body as ApiErr).error.fields?.[0].path).toBe("bbox");
  });
});

describe("GET /api/rooms/:id", () => {
  it("returns the room", async () => {
    const created = (await post({ ...spot, author: "ann", text: "hi" })).body as Created;

    const { status, body } = await get(created.room.id);

    expect(status).toBe(200);
    expect(body).toEqual({ room: created.room });
  });

  it("answers 404 for an unknown id", async () => {
    const { status, body } = await get(NIL_UUID);

    expect(status).toBe(404);
    expect(body).toEqual({ error: { code: "not_found" } });
  });

  it("answers 400 for a malformed id", async () => {
    const { status, body } = await get("not-a-uuid");

    expect(status).toBe(400);
    expect((body as ApiErr).error.fields).toEqual([{ path: "id", message: "must be a UUID" }]);
  });
});
