import { describe, expect, it, vi } from "vitest";

import { ApiRequestError, ApiValidationError, createApi, type FetchLike } from "@/lib/api/client";
import type { Message, Room } from "@/lib/schemas/types";

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

const bbox = { minLng: -1, minLat: -2, maxLng: 3, maxLat: 4 };

/** A fetch that answers every call with `status` and `body` (JSON unless a string). */
function answering(status: number, body: unknown) {
  const fetchImpl = vi.fn<FetchLike>(async () =>
    typeof body === "string"
      ? new Response(body, { status, headers: { "content-type": "text/plain" } })
      : Response.json(body, { status }),
  );
  return { api: createApi(fetchImpl), fetchImpl };
}

function requested(fetchImpl: ReturnType<typeof vi.fn<FetchLike>>) {
  const [input, init] = fetchImpl.mock.calls[0];
  return { url: new URL(input, "http://test"), init };
}

describe("api.rooms.list", () => {
  it("requests /api/rooms with the bbox query and returns rooms and truncated", async () => {
    const { api, fetchImpl } = answering(200, { rooms: [room], truncated: false });

    await expect(api.rooms.list(bbox)).resolves.toEqual({ rooms: [room], truncated: false });

    const { url, init } = requested(fetchImpl);
    expect(url.pathname).toBe("/api/rooms");
    expect(url.searchParams.get("bbox")).toBe("-1,-2,3,4");
    expect(init?.method ?? "GET").toBe("GET");
    expect(new Headers(init?.headers).get("accept")).toBe("application/json");
  });

  it("throws ApiValidationError with the fields on a 400 validation body", async () => {
    const fields = [{ path: "bbox", message: "is required" }];
    const { api } = answering(400, { error: { code: "validation", fields } });

    const error = await api.rooms.list(bbox).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiValidationError);
    expect((error as ApiValidationError).fields).toEqual(fields);
    expect((error as ApiValidationError).message).toBe("bbox is required");
  });

  it.each([
    undefined, null, {}, [{ path: 1, message: "bad" }], [{ path: "author" }],
  ])("maps malformed validation fields %j to ApiRequestError", async (fields) => {
    const { api } = answering(400, { error: { code: "validation", fields } });
    const error = await api.rooms.list(bbox).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({ status: 400, code: "validation" });
  });

  it("throws ApiRequestError with the status on a non-JSON failure", async () => {
    const { api } = answering(502, "Bad Gateway");

    const error = await api.rooms.list(bbox).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({ status: 502, code: undefined });
  });
});

describe("api.rooms.get", () => {
  it("requests /api/rooms/<id> and returns the room", async () => {
    const { api, fetchImpl } = answering(200, { room });

    await expect(api.rooms.get(room.id)).resolves.toEqual(room);
    expect(requested(fetchImpl).url.pathname).toBe(`/api/rooms/${room.id}`);
  });

  it("URL-encodes the id", async () => {
    const { api, fetchImpl } = answering(200, { room });

    await api.rooms.get("a/b c");

    expect(requested(fetchImpl).url.pathname).toBe("/api/rooms/a%2Fb%20c");
  });

  it("returns null on 404", async () => {
    const { api } = answering(404, { error: { code: "not_found" } });

    await expect(api.rooms.get(room.id)).resolves.toBeNull();
  });

  it("throws ApiRequestError on other failures", async () => {
    const { api } = answering(500, { error: { code: "internal" } });

    await expect(api.rooms.get(room.id)).rejects.toMatchObject({ status: 500, code: "internal" });
  });
});

describe("api.rooms.create", () => {
  const input = { lat: 47.497913, lng: 19.040236, author: "ann", text: "hello" };

  it("posts the input as JSON and returns the created room and message", async () => {
    const { api, fetchImpl } = answering(201, { room, message });

    await expect(api.rooms.create(input)).resolves.toEqual({ status: "created", room, message });

    const { url, init } = requested(fetchImpl);
    expect(url.pathname).toBe("/api/rooms");
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
    expect(JSON.parse(String(init?.body))).toEqual(input);
  });

  it("returns the existing room on a 409 conflict body", async () => {
    const { api } = answering(409, { error: { code: "conflict", room } });

    await expect(api.rooms.create(input)).resolves.toEqual({ status: "conflict", room });
  });

  it("throws ApiValidationError on a 400 validation body", async () => {
    const fields = [{ path: "author", message: "must be between 1 and 100 characters" }];
    const { api } = answering(400, { error: { code: "validation", fields } });

    const error = await api.rooms.create(input).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiValidationError);
    expect((error as ApiValidationError).fields).toEqual(fields);
  });

  it("throws ApiRequestError carrying the code and message on 503", async () => {
    const { api } = answering(503, {
      error: { code: "unavailable", message: "Could not find a free room name, please try again" },
    });

    await expect(api.rooms.create(input)).rejects.toMatchObject({
      name: "ApiRequestError",
      status: 503,
      code: "unavailable",
      message: "Could not find a free room name, please try again",
    });
  });

  it.each([
    undefined, null, {}, { ...room, lat: "wrong" }, { ...room, createdAt: "wrong" },
  ])("rejects malformed conflict room %j as ApiRequestError", async (invalidRoom) => {
    const { api } = answering(409, { error: { code: "conflict", room: invalidRoom } });
    const error = await api.rooms.create(input).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({ status: 409, code: "conflict" });
  });

  it("ignores a non-string error message", async () => {
    const { api } = answering(503, { error: { code: "unavailable", message: { unsafe: true } } });
    await expect(api.rooms.create(input)).rejects.toMatchObject({
      name: "ApiRequestError", status: 503, code: "unavailable",
      message: "Request failed with status 503",
    });
  });

  it("treats a 409 without a conflict body as a request error", async () => {
    const { api } = answering(409, "conflict");

    await expect(api.rooms.create(input)).rejects.toMatchObject({ status: 409 });
  });
});

describe("createApi", () => {
  it("uses the global fetch by default", () => {
    expect(createApi().rooms).toMatchObject({
      list: expect.any(Function),
      get: expect.any(Function),
      create: expect.any(Function),
    });
  });
});
