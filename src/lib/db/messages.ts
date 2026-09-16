import type { SupabaseClient } from "@supabase/supabase-js";

import type { PostMessageInput } from "@/lib/schemas/message";
import type { Message, MessagePage } from "@/lib/schemas/types";
import { HISTORY_MAX_SIZE } from "@/lib/config/parse";
import { toMessage } from "@/lib/db/rows";
export { toMessage } from "@/lib/db/rows";

/**
 * Newer messages returned per catch-up request (`?after=`), PRD 6.4 and 6.5.
 * Fixed by the PRD, unlike the history sizes in `HISTORY_*` (PRD 6.6).
 */
export const CATCH_UP_PAGE_SIZE = 100;

/** Which page of a room to read (PRD 6.5). Cursors are message ids of that room. */
export type ListMode =
  | { mode: "initial" }
  | { mode: "before"; cursorId: string }
  | { mode: "after"; cursorId: string };

export type ListMessagesResult =
  | ({ kind: "ok" } & MessagePage)
  | { kind: "room_not_found" }
  | { kind: "cursor_not_found" };

/** A `public.messages` row as PostgREST serialises it (`created_at` like "2026-09-16T10:00:00.123456+00:00"). */
export type MessageRow = {
  id: string;
  chatroom_id: string;
  author: string;
  text: string;
  created_at: string;
};

const MESSAGE_COLUMNS = "id, chatroom_id, author, text, created_at";

/**
 * Turns the rows of a `limit + 1` query into a page: at most `limit` messages
 * and `hasMore` when the extra row came back. Rows that arrive newest first
 * (`initial`, `before`) are reversed, so every page is oldest first.
 */
export function toPage(rows: MessageRow[], limit: number, newestFirst: boolean): MessagePage {
  const kept = rows.slice(0, limit).map(toMessage);
  return { messages: newestFirst ? kept.reverse() : kept, hasMore: rows.length > limit };
}

/**
 * One page of a room's messages through `list_messages` (migration
 * 20260916000400). The function raises PT404 for an unknown room and PT400
 * for a cursor that is not a message of that room; both become results here.
 * Any other error is thrown (the route answers 500).
 */
export async function listMessages(
  db: SupabaseClient,
  roomId: string,
  mode: ListMode,
  limit: number,
): Promise<ListMessagesResult> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > HISTORY_MAX_SIZE) {
    throw new RangeError(`limit must be an integer between 1 and ${HISTORY_MAX_SIZE}`);
  }

  const { data, error } = await db.rpc("list_messages", {
    p_room: roomId,
    p_mode: mode.mode,
    p_cursor: mode.mode === "initial" ? null : mode.cursorId,
    p_limit: limit + 1,
  });

  if (error) {
    if (error.code === "PT404") return { kind: "room_not_found" };
    if (error.code === "PT400") return { kind: "cursor_not_found" };
    throw new Error(`list_messages failed: ${error.code} ${error.message}`);
  }

  const rows = (data ?? []) as MessageRow[];
  return { kind: "ok", ...toPage(rows, limit, mode.mode !== "after") };
}

/**
 * Stores a message (PRD 6.5 `POST /api/rooms/:id/messages`). Returns null when
 * the room does not exist: `messages_chatroom_id_fkey` is the table's only
 * foreign key, so SQLSTATE 23503 can mean nothing else. No existence check
 * first: one round trip, and the insert is atomic with the check.
 */
export async function insertMessage(
  db: SupabaseClient,
  roomId: string,
  input: PostMessageInput,
): Promise<Message | null> {
  const { data, error } = await db
    .from("messages")
    .insert({ chatroom_id: roomId, author: input.author, text: input.text })
    .select(MESSAGE_COLUMNS)
    .single();

  if (error) {
    if (error.code === "23503") return null;
    throw new Error(`insert into messages failed: ${error.code} ${error.message}`);
  }

  return toMessage(data as MessageRow);
}
