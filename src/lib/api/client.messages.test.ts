import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api as defaultApi, createApi, ApiRequestError, ApiValidationError } from "@/lib/api/client";

const ROOM = "2f1b6a8e-5c1d-4f7e-9a3b-0c2d4e6f8a1b";
const CURSOR = "9c4e2d1a-7b3f-4a5e-8d6c-1f0e2a3b4c5d";

const message = {
  id: "00000000-0000-4000-8000-000000000001",
  chatroomId: ROOM,
  author: "ann",
  text: "hello",
  createdAt: "2026-09-16T10:00:00.001000Z",
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>();
let api: ReturnType<typeof createApi>;

beforeEach(() => {
  fetchMock.mockReset();
  api = createApi(fetchMock);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("injected calls must not use global fetch"); }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function requested(): { url: string; init: RequestInit | undefined } {
  const [input, init] = fetchMock.mock.calls[0];
  return { url: String(input), init };
}

describe("api.messages.list", () => {
  it("GETs the initial history", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { messages: [message], hasMore: true }));

    await expect(api.messages.list(ROOM)).resolves.toEqual({ messages: [message], hasMore: true });

    const { url, init } = requested();
    expect(url).toBe(`/api/rooms/${ROOM}/messages`);
    expect(init?.method ?? "GET").toBe("GET");
  });

  it("the exported singleton uses global fetch", async () => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue(jsonResponse(200, { messages: [], hasMore: false }));
    await expect(defaultApi.messages.list(ROOM)).resolves.toEqual({ messages: [], hasMore: false });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("GETs an older page with the before cursor", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { messages: [], hasMore: false }));

    await api.messages.list(ROOM, { before: CURSOR });

    expect(requested().url).toBe(`/api/rooms/${ROOM}/messages?before=${CURSOR}`);
  });

  it("throws ApiRequestError with status 404 when the room is gone", async () => {
    fetchMock.mockResolvedValue(jsonResponse(404, { error: { code: "not_found" } }));

    await expect(api.messages.list(ROOM)).rejects.toMatchObject({ name: "ApiRequestError", status: 404 });
  });
});

describe("api.messages.listAfter", () => {
  it("GETs the catch-up page and returns nextCursor", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { messages: [message], hasMore: false, nextCursor: message.id }),
    );

    await expect(api.messages.listAfter(ROOM, CURSOR)).resolves.toEqual({
      messages: [message],
      hasMore: false,
      nextCursor: message.id,
    });
    expect(requested().url).toBe(`/api/rooms/${ROOM}/messages?after=${CURSOR}`);
  });

  it("throws ApiRequestError for a server failure", async () => {
    fetchMock.mockResolvedValue(new Response("Internal Server Error", { status: 500 }));

    const failure = api.messages.listAfter(ROOM, CURSOR);
    await expect(failure).rejects.toBeInstanceOf(ApiRequestError);
    await expect(failure).rejects.toMatchObject({ status: 500 });
  });
});

describe("api.messages.post", () => {
  it("POSTs JSON and returns the stored message", async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, { message }));

    await expect(api.messages.post(ROOM, { author: "ann", text: "hello" })).resolves.toEqual(message);

    const { url, init } = requested();
    expect(url).toBe(`/api/rooms/${ROOM}/messages`);
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(JSON.stringify({ author: "ann", text: "hello" }));
    expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
  });

  it("maps a 400 validation body to ApiValidationError with its fields", async () => {
    const fields = [{ path: "text", message: "must be between 1 and 3000 characters" }];
    fetchMock.mockResolvedValue(jsonResponse(400, { error: { code: "validation", fields } }));

    const failure = api.messages.post(ROOM, { author: "ann", text: "" });

    await expect(failure).rejects.toBeInstanceOf(ApiValidationError);
    await expect(failure).rejects.toMatchObject({ fields });
  });

  it("throws ApiRequestError with status 404 for an unknown room", async () => {
    fetchMock.mockResolvedValue(jsonResponse(404, { error: { code: "not_found" } }));

    await expect(api.messages.post(ROOM, { author: "ann", text: "hello" })).rejects.toMatchObject({
      name: "ApiRequestError", status: 404,
    });
  });
});
