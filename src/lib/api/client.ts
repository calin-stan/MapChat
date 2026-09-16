import { z } from "zod";

import type { FieldIssue } from "@/lib/api/errors";
import type { Bbox } from "@/lib/schemas/query";
import type { CreateRoomInput } from "@/lib/schemas/room";
import type { Message, Room } from "@/lib/schemas/types";
import type { PostMessageInput } from "@/lib/schemas/message";
import type { CatchUpPage, MessagePage } from "@/lib/schemas/types";

/** The server rejected the input; `fields` follow the `validation` error body. */
export class ApiValidationError extends Error {
  readonly fields: FieldIssue[];

  constructor(fields: FieldIssue[]) {
    super(
      fields.map((f) => (f.path ? `${f.path} ${f.message}` : f.message)).join("; ") ||
        "Invalid input",
    );
    this.name = "ApiValidationError";
    this.fields = fields;
  }
}

/** Any other failed request. `code` is the error body's code when there was one. */
export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string | undefined;

  constructor(status: number, code?: string, message?: string) {
    super(message ?? `Request failed with status ${status}`);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
  }
}

export type CreateRoomOutcome =
  | { status: "created"; room: Room; message: Message }
  | { status: "conflict"; room: Room };

export type RoomsApi = {
  /** Rooms inside one non-crossing viewport box (PRD 6.5), capped and flagged. */
  list(bbox: Bbox): Promise<{ rooms: Room[]; truncated: boolean }>;
  /** One room, or null when the id is unknown. */
  get(id: string): Promise<Room | null>;
  /** Creates a room with its first message, or reports the room already at that spot. */
  create(input: CreateRoomInput): Promise<CreateRoomOutcome>;
};

/** The subset of `fetch` this client needs; tests pass a fake. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const JSON_HEADERS = { accept: "application/json" };

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

// Validate the envelope separately: a code alone does not prove its payload.
const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    fields: z.unknown().optional(),
    room: z.unknown().optional(),
    message: z.unknown().optional(),
  }),
});
const fieldIssuesSchema = z.array(z.object({ path: z.string(), message: z.string() }));
const conflictRoomSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  createdAt: z.iso.datetime({ precision: 6 }),
});

/** Turns a failed response into the matching typed error. Never returns. */
async function failWith(response: Response): Promise<never> {
  const parsed = errorEnvelopeSchema.safeParse(await readJson(response));
  if (!parsed.success) throw new ApiRequestError(response.status);
  const error = parsed.data.error;
  if (response.status === 400 && error.code === "validation") {
    const fields = fieldIssuesSchema.safeParse(error.fields);
    if (fields.success) throw new ApiValidationError(fields.data);
  }
  const message = typeof error.message === "string" ? error.message : undefined;
  throw new ApiRequestError(response.status, error.code, message);
}

function createRoomsApi(fetchImpl: FetchLike): RoomsApi {
  return {
    async list(bbox) {
      const query = new URLSearchParams({
        bbox: `${bbox.minLng},${bbox.minLat},${bbox.maxLng},${bbox.maxLat}`,
      });
      const response = await fetchImpl(`/api/rooms?${query}`, { headers: JSON_HEADERS });
      if (!response.ok) return failWith(response);
      // Our own server: the body follows the route contract.
      return (await response.json()) as { rooms: Room[]; truncated: boolean };
    },

    async get(id) {
      const response = await fetchImpl(`/api/rooms/${encodeURIComponent(id)}`, {
        headers: JSON_HEADERS,
      });
      if (response.status === 404) return null;
      if (!response.ok) return failWith(response);
      const { room } = (await response.json()) as { room: Room };
      return room;
    },

    async create(input) {
      const response = await fetchImpl("/api/rooms", {
        method: "POST",
        headers: { ...JSON_HEADERS, "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      if (response.status === 409) {
        const parsed = errorEnvelopeSchema.safeParse(await readJson(response));
        if (parsed.success && parsed.data.error.code === "conflict") {
          const room = conflictRoomSchema.safeParse(parsed.data.error.room);
          if (room.success) return { status: "conflict", room: room.data };
        }
        throw new ApiRequestError(409, parsed.success ? parsed.data.error.code : undefined);
      }
      if (!response.ok) return failWith(response);
      const { room, message } = (await response.json()) as { room: Room; message: Message };
      return { status: "created", room, message };
    },
  };
}

export type MessagesApi = {
  list(roomId: string, params?: { before?: string }): Promise<MessagePage>;
  listAfter(roomId: string, after: string): Promise<CatchUpPage>;
  post(roomId: string, input: PostMessageInput): Promise<Message>;
};

function messagesUrl(roomId: string, query?: Record<string, string>): string {
  const base = `/api/rooms/${encodeURIComponent(roomId)}/messages`;
  return query ? `${base}?${new URLSearchParams(query).toString()}` : base;
}

function createMessagesApi(fetchImpl: FetchLike): MessagesApi {
  async function request<T>(url: string, init?: { method: "POST"; body: string }): Promise<T> {
    const response = await fetchImpl(url, {
      method: init?.method ?? "GET",
      headers: init
        ? { accept: "application/json", "content-type": "application/json" }
        : { accept: "application/json" },
      body: init?.body,
      cache: "no-store",
    });
    if (!response.ok) return failWith(response);
    return (await response.json()) as T;
  }

  return {
    list(roomId, params) {
      return request<MessagePage>(
        messagesUrl(roomId, params?.before === undefined ? undefined : { before: params.before }),
      );
    },
    listAfter(roomId, after) {
      return request<CatchUpPage>(messagesUrl(roomId, { after }));
    },
    async post(roomId, input) {
      const { message } = await request<{ message: Message }>(messagesUrl(roomId), {
        method: "POST", body: JSON.stringify(input),
      });
      return message;
    },
  };
}

/**
 * Typed wrappers over the JSON API for client components. Chunk 5 adds a
 * `messages` sibling to the returned object. Wrapping `fetch` in an arrow
 * keeps its `this` binding in browsers.
 */
export function createApi(fetchImpl: FetchLike = (input, init) => fetch(input, init)) {
  return { rooms: createRoomsApi(fetchImpl), messages: createMessagesApi(fetchImpl) };
}

export type Api = ReturnType<typeof createApi>;

export const api: Api = createApi();
