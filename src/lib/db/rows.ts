import { z } from "zod";

import type { Message, Room } from "@/lib/schemas/types";

import { normalizeCreatedAt } from "@/lib/time/ordering";

/** Shared by HTTP and Realtime: preserve microseconds in canonical UTC form. */
const isoUtc = z.string().transform((value, ctx) => {
  try {
    return normalizeCreatedAt(value);
  } catch {
    ctx.addIssue({ code: "custom", message: `not a timestamp: ${JSON.stringify(value)}` });
    return z.NEVER;
  }
});

/** A `public.chatrooms` row (columns `id,name,lat,lng,created_at`) → `Room`. */
export const roomRowSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    lat: z.number(),
    lng: z.number(),
    created_at: isoUtc,
  })
  .transform(
    (row): Room => ({
      id: row.id,
      name: row.name,
      lat: row.lat,
      lng: row.lng,
      createdAt: row.created_at,
    }),
  );

/** A `public.messages` row (columns `id,chatroom_id,author,text,created_at`) → `Message`. */
export const messageRowSchema = z
  .object({
    id: z.uuid(),
    chatroom_id: z.uuid(),
    author: z.string(),
    text: z.string(),
    created_at: isoUtc,
  })
  .transform(
    (row): Message => ({
      id: row.id,
      chatroomId: row.chatroom_id,
      author: row.author,
      text: row.text,
      createdAt: row.created_at,
    }),
  );

/** The database answered with a shape this code does not expect (schema drift). */
export class RowShapeError extends Error {
  constructor(source: string, error: z.ZodError) {
    const issues = error.issues
      .map((issue) => `${issue.path.map(String).join(".") || "<row>"} ${issue.message}`)
      .join("; ");
    super(`Unexpected ${source} row: ${issues}`);
    this.name = "RowShapeError";
  }
}

/** Parses one row (or RPC result) with `schema`; `source` names it in the error. */
export function parseRow<T>(schema: z.ZodType<T>, row: unknown, source: string): T {
  const result = schema.safeParse(row);
  if (!result.success) throw new RowShapeError(source, result.error);
  return result.data;
}

export function toRoom(row: unknown): Room {
  return parseRow(roomRowSchema, row, "chatrooms");
}

export function toMessage(row: unknown): Message {
  return parseRow(messageRowSchema, row, "messages");
}
