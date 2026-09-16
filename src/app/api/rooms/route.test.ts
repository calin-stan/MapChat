import { beforeEach, describe, expect, it, vi } from "vitest";

import { NameCollision } from "@/lib/names/generate";
import type { Message, Room } from "@/lib/schemas/types";

const { createRoom, findRoomsInBbox } = vi.hoisted(() => ({
  createRoom: vi.fn(),
  findRoomsInBbox: vi.fn(),
}));

vi.mock("@/lib/db/rooms", () => ({ createRoom, findRoomsInBbox }));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: () => ({ kind: "fake-client" }) }));

import { GET, POST } from "@/app/api/rooms/route";

const room: Room = {
  id: "0f6c1d1e-6c2c-4d7e-9a8b-1f2e3d4c5b6a",
  name: "brave-crimson-otter",
  lat: 47.497913,
  lng: 19.040236,
  createdAt: "2026-09-16T15:00:00.123000Z",
};

const message: Message = {
  id: "263debd5-7a6a-44d3-b9d0-7271248715bd",
  chatroomId: room.id,
  author: "ann",
  text: "hello",
  createdAt: "2026-09-16T15:00:00.123000Z",
};

function post(body: string): Promise<Response> {
  return POST(
    new Request("http://localhost/api/rooms", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    }),
  );
}

function get(query: string): Promise<Response> {
  return GET(new Request(`http://localhost/api/rooms${query}`));
}

beforeEach(() => {
  createRoom.mockReset();
  findRoomsInBbox.mockReset();
});

describe("POST /api/rooms", () => {
  it("answers 201 with the room and message, passing the trimmed input", async () => {
    createRoom.mockResolvedValue({ kind: "created", room, message });

    const response = await post(
      JSON.stringify({ lat: 47.497913, lng: 19.040236, author: " ann ", text: "hello\n" }),
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ room, message });
    expect(createRoom).toHaveBeenCalledWith(
      { kind: "fake-client" },
      { lat: 47.497913, lng: 19.040236, author: "ann", text: "hello" },
    );
  });

  it("answers 409 with the existing room", async () => {
    createRoom.mockResolvedValue({ kind: "exists", room });

    const response = await post(
      JSON.stringify({ lat: 47.497913, lng: 19.040236, author: "ann", text: "hello" }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: { code: "conflict", room } });
  });

  it("answers 503 when no free room name could be found", async () => {
    createRoom.mockRejectedValue(new NameCollision());

    const response = await post(
      JSON.stringify({ lat: 47.497913, lng: 19.040236, author: "ann", text: "hello" }),
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("1");
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "unavailable",
        message: "Could not find a free room name, please try again",
      },
    });
  });

  it("lets other errors propagate", async () => {
    createRoom.mockRejectedValue(new Error("database down"));

    await expect(
      post(JSON.stringify({ lat: 47.497913, lng: 19.040236, author: "ann", text: "hello" })),
    ).rejects.toThrow("database down");
  });

  it("answers 400 for a body that is not JSON", async () => {
    const response = await post("{not json");

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { code: "validation", fields: [{ path: "", message: "must be a JSON body" }] },
    });
    expect(createRoom).not.toHaveBeenCalled();
  });

  it("answers 400 for a JSON body that is not an object", async () => {
    const response = await post("42");

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("validation");
    expect(body.error.fields).toHaveLength(1);
    expect(body.error.fields[0].path).toBe("");
  });

  it("answers 400 with field paths for invalid fields", async () => {
    const response = await post(
      JSON.stringify({ lat: 91, lng: 19.040236, author: "𝔘".repeat(101), text: "" }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "validation",
        fields: [
          { path: "lat", message: "must be between -90 and 90" },
          { path: "author", message: "must be between 1 and 100 characters" },
          { path: "text", message: "must be between 1 and 3000 characters" },
        ],
      },
    });
    expect(createRoom).not.toHaveBeenCalled();
  });
});

describe("GET /api/rooms", () => {
  it("answers 200 with the rooms in the parsed bbox", async () => {
    findRoomsInBbox.mockResolvedValue({ rooms: [room], truncated: false });

    const response = await get("?bbox=-1,-2,3,4");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ rooms: [room], truncated: false });
    expect(findRoomsInBbox).toHaveBeenCalledWith(
      { kind: "fake-client" },
      { minLng: -1, minLat: -2, maxLng: 3, maxLat: 4 },
    );
  });

  it("answers 400 when bbox is missing", async () => {
    const response = await get("");

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { code: "validation", fields: [{ path: "bbox", message: "is required" }] },
    });
    expect(findRoomsInBbox).not.toHaveBeenCalled();
  });

  it("answers 400 with corner paths when a corner is out of range", async () => {
    const response = await get("?bbox=-1,-2,3,91");

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "validation",
        fields: [{ path: "bbox.maxLat", message: "must be between -90 and 90" }],
      },
    });
  });

  it("answers 400 for a box whose minimum exceeds its maximum", async () => {
    const response = await get("?bbox=3,4,-1,-2");

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "validation",
        fields: [{ path: "bbox", message: "minimum must not be greater than maximum" }],
      },
    });
  });
});
