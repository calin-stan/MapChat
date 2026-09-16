import { type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { insertMessage, listMessages } from "@/lib/db/messages";

import { insertMessageAt, insertMessageSeries, insertRoom } from "./fixtures";
import { connect, createApiClient, resolveSupabaseApi, truncateAll, type Sql } from "./helpers";

let sql: Sql;
let db: SupabaseClient;

beforeAll(() => {
  sql = connect();
  const { apiUrl, serviceRoleKey } = resolveSupabaseApi();
  db = createApiClient(apiUrl, serviceRoleKey);
});

afterAll(async () => {
  await sql.end();
});

beforeEach(async () => {
  await truncateAll(sql);
});

const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const TIE_AT = "2026-09-16T10:00:00.500Z"; // later than the series, which is one ms apart from 10:00:00

describe("listMessages against the local API", () => {
  it("returns the newest page oldest first with hasMore", async () => {
    const roomId = await insertRoom(sql, "room");
    await insertMessageSeries(sql, roomId, 5);

    const result = await listMessages(db, roomId, { mode: "initial" }, 3);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.hasMore).toBe(true);
    expect(result.messages.map((m) => m.text)).toEqual(["m3", "m4", "m5"]);
    expect(result.messages[0]).toMatchObject({ chatroomId: roomId, author: "ann" });
    expect(result.messages[0].createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/);
  });

  it("pages older messages until hasMore is false", async () => {
    const roomId = await insertRoom(sql, "room");
    const series = await insertMessageSeries(sql, roomId, 5);

    const page = await listMessages(db, roomId, { mode: "before", cursorId: series[2].id }, 5);

    expect(page).toMatchObject({ kind: "ok", hasMore: false });
    expect(page.kind === "ok" && page.messages.map((m) => m.text)).toEqual(["m1", "m2"]);
  });

  it("returns newer messages ascending, breaking ties by id", async () => {
    const roomId = await insertRoom(sql, "room");
    await insertMessageSeries(sql, roomId, 2);
    const tied = [
      await insertMessageAt(sql, roomId, "t1", TIE_AT),
      await insertMessageAt(sql, roomId, "t2", TIE_AT),
    ]
      .map((row) => row.id)
      .sort();
    const later = await insertMessageAt(sql, roomId, "later", "2026-09-16T10:00:01Z");

    const result = await listMessages(db, roomId, { mode: "after", cursorId: tied[0] }, 100);

    expect(result).toMatchObject({ kind: "ok", hasMore: false });
    expect(result.kind === "ok" && result.messages.map((m) => m.id)).toEqual([tied[1], later.id]);
  });

  it("reports room_not_found for an unknown room", async () => {
    await expect(listMessages(db, NIL_UUID, { mode: "initial" }, 10)).resolves.toEqual({
      kind: "room_not_found",
    });
  });

  it("reports cursor_not_found for a cursor of another room", async () => {
    const roomId = await insertRoom(sql, "room");
    await insertMessageSeries(sql, roomId, 1);
    const otherId = await insertRoom(sql, "other");
    const [foreign] = await insertMessageSeries(sql, otherId, 1);

    await expect(listMessages(db, roomId, { mode: "after", cursorId: foreign.id }, 10)).resolves.toEqual({
      kind: "cursor_not_found",
    });
  });
});

describe("insertMessage against the local API", () => {
  it("stores the message and returns the DTO", async () => {
    const roomId = await insertRoom(sql, "room");

    const message = await insertMessage(db, roomId, { author: "ann", text: "hello" });

    expect(message).toMatchObject({ chatroomId: roomId, author: "ann", text: "hello" });
    const [row] = await sql<{ id: string; created_at: Date }[]>`
      select id, created_at from public.messages where chatroom_id = ${roomId}::uuid`;
    expect(row.id).toBe(message?.id);
    // Date parsing is used only for this coarse storage-time check; ordering uses precise strings.
    expect(row.created_at.getTime()).toBe(Date.parse(message?.createdAt ?? ""));
  });

  it("returns null for an unknown room and stores nothing", async () => {
    await expect(insertMessage(db, NIL_UUID, { author: "ann", text: "hello" })).resolves.toBeNull();
    expect(await sql`select 1 from public.messages`).toHaveLength(0);
  });

  it("throws on a check violation the schemas should have caught", async () => {
    const roomId = await insertRoom(sql, "room");

    await expect(insertMessage(db, roomId, { author: "", text: "hello" })).rejects.toThrow(/23514/);
  });
});
