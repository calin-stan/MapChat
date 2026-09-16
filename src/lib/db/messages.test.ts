import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import {
  CATCH_UP_PAGE_SIZE,
  insertMessage,
  listMessages,
  toMessage,
  toPage,
  type MessageRow,
} from "@/lib/db/messages";

const ROOM = "2f1b6a8e-5c1d-4f7e-9a3b-0c2d4e6f8a1b";
const CURSOR = "9c4e2d1a-7b3f-4a5e-8d6c-1f0e2a3b4c5d";

function row(n: number, createdAt = `2026-09-16T10:00:00.00${n}+00:00`): MessageRow {
  return {
    id: `00000000-0000-4000-8000-00000000000${n}`,
    chatroom_id: ROOM,
    author: "ann",
    text: `m${n}`,
    created_at: createdAt,
  };
}

type RpcResult = { data: unknown; error: { code: string; message: string } | null };

/** A client whose `rpc` is the given mock; nothing else is touched. */
function fakeRpcDb(result: RpcResult) {
  const rpc = vi.fn(async () => result);
  return { db: { rpc } as unknown as SupabaseClient, rpc };
}

/** A client that records `from(table).insert(row)` and answers `select().single()` with `result`. */
function fakeInsertDb(result: RpcResult) {
  const inserts: { table: string; row: unknown; columns?: string }[] = [];
  const db = {
    from: (table: string) => ({
      insert: (value: unknown) => ({
        select: (columns: string) => {
          inserts.push({ table, row: value, columns });
          return { single: async () => result };
        },
      }),
    }),
  } as unknown as SupabaseClient;
  return { db, inserts };
}

describe("CATCH_UP_PAGE_SIZE", () => {
  it("is the PRD 6.4 limit of 100", () => {
    expect(CATCH_UP_PAGE_SIZE).toBe(100);
  });
});

describe("toMessage", () => {
  it.each([
    ["2026-09-16T10:00:00.123456+00:00", "2026-09-16T10:00:00.123456Z"],
    ["2026-09-16T10:00:00.45639+00:00", "2026-09-16T10:00:00.456390Z"],
    ["2026-09-16T10:00:00+00:00", "2026-09-16T10:00:00.000000Z"],
    ["2026-09-16T12:00:00+02:00", "2026-09-16T10:00:00.000000Z"],
  ])("normalises %s to %s", (input, expected) => {
    expect(toMessage(row(1, input)).createdAt).toBe(expected);
  });

  it("maps snake_case columns to the Message DTO", () => {
    expect(toMessage(row(1))).toEqual({
      id: "00000000-0000-4000-8000-000000000001",
      chatroomId: ROOM,
      author: "ann",
      text: "m1",
      createdAt: "2026-09-16T10:00:00.001000Z",
    });
  });
});

describe("toPage", () => {
  it("reports hasMore and drops the extra row when limit + 1 rows came back", () => {
    const page = toPage([row(3), row(2), row(1)], 2, true);
    expect(page.hasMore).toBe(true);
    expect(page.messages.map((m) => m.text)).toEqual(["m2", "m3"]);
  });

  it("keeps every row with hasMore false when at most limit rows came back", () => {
    const page = toPage([row(2), row(1)], 2, true);
    expect(page.hasMore).toBe(false);
    expect(page.messages.map((m) => m.text)).toEqual(["m1", "m2"]);
  });

  it("keeps ascending rows in order when newestFirst is false", () => {
    const page = toPage([row(1), row(2), row(3)], 2, false);
    expect(page).toMatchObject({ hasMore: true });
    expect(page.messages.map((m) => m.text)).toEqual(["m1", "m2"]);
  });

  it("returns an empty page for no rows", () => {
    expect(toPage([], 5, true)).toEqual({ messages: [], hasMore: false });
  });
});

describe("listMessages", () => {
  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 1000, Number.MAX_SAFE_INTEGER])(
    "rejects the limit %s before calling the database",
    async (limit) => {
      const { db, rpc } = fakeRpcDb({ data: [], error: null });

      await expect(listMessages(db, ROOM, { mode: "initial" }, limit)).rejects.toThrow(RangeError);
      expect(rpc).not.toHaveBeenCalled();
    },
  );

  it("asks for limit + 1 rows with a null cursor for initial and reverses to ascending", async () => {
    const { db, rpc } = fakeRpcDb({ data: [row(3), row(2), row(1)], error: null });

    const result = await listMessages(db, ROOM, { mode: "initial" }, 2);

    expect(rpc).toHaveBeenCalledWith("list_messages", {
      p_room: ROOM,
      p_mode: "initial",
      p_cursor: null,
      p_limit: 3,
    });
    expect(result).toMatchObject({ kind: "ok", hasMore: true });
    expect(result.kind === "ok" && result.messages.map((m) => m.text)).toEqual(["m2", "m3"]);
  });

  it("passes the cursor for before and reverses to ascending", async () => {
    const { db, rpc } = fakeRpcDb({ data: [row(2), row(1)], error: null });

    const result = await listMessages(db, ROOM, { mode: "before", cursorId: CURSOR }, 20);

    expect(rpc).toHaveBeenCalledWith("list_messages", {
      p_room: ROOM,
      p_mode: "before",
      p_cursor: CURSOR,
      p_limit: 21,
    });
    expect(result).toMatchObject({ kind: "ok", hasMore: false });
    expect(result.kind === "ok" && result.messages.map((m) => m.text)).toEqual(["m1", "m2"]);
  });

  it("keeps after pages ascending as the database returns them", async () => {
    const { db, rpc } = fakeRpcDb({ data: [row(1), row(2), row(3)], error: null });

    const result = await listMessages(db, ROOM, { mode: "after", cursorId: CURSOR }, 2);

    expect(rpc).toHaveBeenCalledWith("list_messages", {
      p_room: ROOM,
      p_mode: "after",
      p_cursor: CURSOR,
      p_limit: 3,
    });
    expect(result).toMatchObject({ kind: "ok", hasMore: true });
    expect(result.kind === "ok" && result.messages.map((m) => m.text)).toEqual(["m1", "m2"]);
  });

  it("treats a null data with no error as an empty page", async () => {
    const { db } = fakeRpcDb({ data: null, error: null });

    await expect(listMessages(db, ROOM, { mode: "initial" }, 2)).resolves.toEqual({
      kind: "ok",
      messages: [],
      hasMore: false,
    });
  });

  it("maps PT404 to room_not_found", async () => {
    const { db } = fakeRpcDb({ data: null, error: { code: "PT404", message: "room not found" } });

    await expect(listMessages(db, ROOM, { mode: "initial" }, 2)).resolves.toEqual({
      kind: "room_not_found",
    });
  });

  it("maps PT400 to cursor_not_found", async () => {
    const { db } = fakeRpcDb({ data: null, error: { code: "PT400", message: "cursor not found in room" } });

    await expect(listMessages(db, ROOM, { mode: "after", cursorId: CURSOR }, 2)).resolves.toEqual({
      kind: "cursor_not_found",
    });
  });

  it("throws any other database error", async () => {
    const { db } = fakeRpcDb({ data: null, error: { code: "PGRST202", message: "not in schema cache" } });

    await expect(listMessages(db, ROOM, { mode: "initial" }, 2)).rejects.toThrow(/PGRST202/);
  });
});

describe("insertMessage", () => {
  const input = { author: "ann", text: "hello" };

  it("inserts into messages and returns the stored Message", async () => {
    const { db, inserts } = fakeInsertDb({ data: row(1), error: null });

    await expect(insertMessage(db, ROOM, input)).resolves.toEqual(toMessage(row(1)));
    expect(inserts).toEqual([
      {
        table: "messages",
        row: { chatroom_id: ROOM, author: "ann", text: "hello" },
        columns: "id, chatroom_id, author, text, created_at",
      },
    ]);
  });

  it("returns null when the room does not exist (foreign key violation)", async () => {
    const { db } = fakeInsertDb({
      data: null,
      error: {
        code: "23503",
        message: 'insert or update on table "messages" violates foreign key constraint "messages_chatroom_id_fkey"',
      },
    });

    await expect(insertMessage(db, ROOM, input)).resolves.toBeNull();
  });

  it("throws any other database error", async () => {
    const { db } = fakeInsertDb({
      data: null,
      error: { code: "23514", message: 'new row for relation "messages" violates check constraint "messages_text_check"' },
    });

    await expect(insertMessage(db, ROOM, input)).rejects.toThrow(/23514/);
  });
});
