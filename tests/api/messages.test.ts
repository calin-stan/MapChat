import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { GET, POST } from "@/app/api/rooms/[id]/messages/route";
import type { Message } from "@/lib/schemas/types";

import { insertMessageAt, insertMessageSeries, insertRoom } from "../db/fixtures";
import { apiRequest, connect, routeParams, truncateAll, type Sql } from "./helpers";

// The route imports `@/lib/supabase/server` and `@/lib/config/server`, which
// import `server-only`. Outside a React Server bundle that module throws, so
// stub it (as chunk 3's server-client tests do). Hoisted by Vitest.
vi.mock("server-only", () => ({}));

let sql: Sql;

beforeAll(() => {
  // tests/api/setup-env.ts supplies the server environment before imports.
  // Sizes are read lazily by getServerConfig on the first handler call.
  vi.stubEnv("HISTORY_INITIAL_SIZE", "100");
  vi.stubEnv("HISTORY_PAGE_SIZE", "20");
  sql = connect();
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await sql.end();
});

beforeEach(async () => {
  await truncateAll(sql);
});

type FieldError = { path: string; message: string };
type Body = {
  messages?: Message[];
  hasMore?: boolean;
  nextCursor?: string;
  message?: Message;
  error?: { code: string; fields?: FieldError[] };
};
type Result = { status: number; body: Body };

const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const ISO_MICRO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const ASTRAL = "\u{1D4B3}";
const TIE_AT = "2026-09-16T10:00:00.003Z";

async function get(roomId: string, query = ""): Promise<Result> {
  const response = await GET(apiRequest(`/api/rooms/${roomId}/messages${query}`), routeParams(roomId));
  return { status: response.status, body: (await response.json()) as Body };
}

async function postRaw(roomId: string, raw: string): Promise<Result> {
  const response = await POST(
    apiRequest(`/api/rooms/${roomId}/messages`, { method: "POST", body: raw }),
    routeParams(roomId),
  );
  return { status: response.status, body: (await response.json()) as Body };
}

const post = (roomId: string, body: unknown) => postRaw(roomId, JSON.stringify(body));

const texts = (messages: Message[] | undefined) => (messages ?? []).map((m) => m.text);
const ids = (messages: Message[] | undefined) => (messages ?? []).map((m) => m.id);

function validation(fields: FieldError[]): Body {
  return { error: { code: "validation", fields } };
}

describe("GET /api/rooms/:id/messages (initial history)", () => {
  it("returns the newest 100 of 105 messages, oldest first, with hasMore", async () => {
    const roomId = await insertRoom(sql, "room");
    await insertMessageSeries(sql, roomId, 105);

    const { status, body } = await get(roomId);

    expect(status).toBe(200);
    expect(body.messages).toHaveLength(100);
    expect(texts(body.messages)[0]).toBe("m6");
    expect(texts(body.messages)[99]).toBe("m105");
    expect(body.hasMore).toBe(true);
    expect(body).not.toHaveProperty("nextCursor");
  });

  it("returns everything with hasMore false when the room has exactly 100", async () => {
    const roomId = await insertRoom(sql, "room");
    await insertMessageSeries(sql, roomId, 100);

    const { status, body } = await get(roomId);

    expect(status).toBe(200);
    expect(body.messages).toHaveLength(100);
    expect(body.hasMore).toBe(false);
  });

  it("maps rows to the Message DTO with a microsecond UTC timestamp", async () => {
    const roomId = await insertRoom(sql, "room");
    const [row] = await insertMessageSeries(sql, roomId, 1);

    const { body } = await get(roomId);

    expect(body.messages).toEqual([
      {
        id: row.id,
        chatroomId: roomId,
        author: "ann",
        text: "m1",
        createdAt: row.created_at.toISOString().replace(/Z$/, "000Z"),
      },
    ]);
    expect(body.messages?.[0].createdAt).toMatch(ISO_MICRO_UTC);
  });

  it("orders messages with the same created_at by id", async () => {
    const roomId = await insertRoom(sql, "room");
    const tied = [
      await insertMessageAt(sql, roomId, "t1", TIE_AT),
      await insertMessageAt(sql, roomId, "t2", TIE_AT),
      await insertMessageAt(sql, roomId, "t3", TIE_AT),
    ]
      .map((row) => row.id)
      .sort();

    const { body } = await get(roomId);

    expect(ids(body.messages)).toEqual(tied);
  });
});

describe("GET ?before= (older history)", () => {
  it("returns the 5 messages left after a 105-message initial load", async () => {
    const roomId = await insertRoom(sql, "room");
    await insertMessageSeries(sql, roomId, 105);
    const initial = await get(roomId);
    const oldestShown = initial.body.messages?.[0].id ?? "";

    const { status, body } = await get(roomId, `?before=${oldestShown}`);

    expect(status).toBe(200);
    expect(texts(body.messages)).toEqual(["m1", "m2", "m3", "m4", "m5"]);
    expect(body.hasMore).toBe(false);
  });

  it("pages 20 at a time until nothing older remains", async () => {
    const roomId = await insertRoom(sql, "room");
    await insertMessageSeries(sql, roomId, 130);
    const initial = await get(roomId);
    expect(texts(initial.body.messages)[0]).toBe("m31");
    expect(initial.body.hasMore).toBe(true);

    const page1 = await get(roomId, `?before=${initial.body.messages?.[0].id}`);
    expect(texts(page1.body.messages)).toEqual(Array.from({ length: 20 }, (_, i) => `m${11 + i}`));
    expect(page1.body.hasMore).toBe(true);

    const page2 = await get(roomId, `?before=${page1.body.messages?.[0].id}`);
    expect(texts(page2.body.messages)).toEqual(Array.from({ length: 10 }, (_, i) => `m${1 + i}`));
    expect(page2.body.hasMore).toBe(false);

    const page3 = await get(roomId, `?before=${page2.body.messages?.[0].id}`);
    expect(page3.body).toEqual({ messages: [], hasMore: false });
  });

  it("excludes the cursor and splits a tie by id", async () => {
    const roomId = await insertRoom(sql, "room");
    const [older] = await insertMessageSeries(sql, roomId, 1);
    const tied = [
      await insertMessageAt(sql, roomId, "t1", TIE_AT),
      await insertMessageAt(sql, roomId, "t2", TIE_AT),
      await insertMessageAt(sql, roomId, "t3", TIE_AT),
    ]
      .map((row) => row.id)
      .sort();

    const { body } = await get(roomId, `?before=${tied[1]}`);

    expect(ids(body.messages)).toEqual([older.id, tied[0]]);
  });
});

describe("GET ?after= (catch-up)", () => {
  it("returns B and C after A, so a poll after A cannot miss B", async () => {
    const roomId = await insertRoom(sql, "room");
    const [a, b, c] = await insertMessageSeries(sql, roomId, 3);

    const { status, body } = await get(roomId, `?after=${a.id}`);

    expect(status).toBe(200);
    expect(ids(body.messages)).toEqual([b.id, c.id]);
    expect(body.hasMore).toBe(false);
    expect(body.nextCursor).toBe(c.id);
  });

  it("drains a 250-message backlog as 100, 100, 50 with continuation cursors", async () => {
    const roomId = await insertRoom(sql, "room");
    const series = await insertMessageSeries(sql, roomId, 251);
    const bookmark = series[0].id;

    const first = await get(roomId, `?after=${bookmark}`);
    expect(first.body.messages).toHaveLength(100);
    expect(texts(first.body.messages)[0]).toBe("m2");
    expect(first.body.hasMore).toBe(true);
    expect(first.body.nextCursor).toBe(series[100].id);

    const second = await get(roomId, `?after=${first.body.nextCursor}`);
    expect(second.body.messages).toHaveLength(100);
    expect(texts(second.body.messages)[0]).toBe("m102");
    expect(second.body.hasMore).toBe(true);
    expect(second.body.nextCursor).toBe(series[200].id);

    const third = await get(roomId, `?after=${second.body.nextCursor}`);
    expect(third.body.messages).toHaveLength(50);
    expect(texts(third.body.messages)[49]).toBe("m251");
    expect(third.body.hasMore).toBe(false);
    expect(third.body.nextCursor).toBe(series[250].id);
  });

  it("returns an empty page and echoes the cursor after the newest message", async () => {
    const roomId = await insertRoom(sql, "room");
    const series = await insertMessageSeries(sql, roomId, 3);
    const newest = series[2].id;

    const { body } = await get(roomId, `?after=${newest}`);

    expect(body).toEqual({ messages: [], hasMore: false, nextCursor: newest });
  });

  it("continues past a tied message by id", async () => {
    const roomId = await insertRoom(sql, "room");
    const tied = [
      await insertMessageAt(sql, roomId, "t1", TIE_AT),
      await insertMessageAt(sql, roomId, "t2", TIE_AT),
      await insertMessageAt(sql, roomId, "t3", TIE_AT),
    ]
      .map((row) => row.id)
      .sort();
    const later = await insertMessageAt(sql, roomId, "later", "2026-09-16T10:00:01Z");

    const { body } = await get(roomId, `?after=${tied[0]}`);

    expect(ids(body.messages)).toEqual([tied[1], tied[2], later.id]);
  });
});

describe("GET cursor validation", () => {
  it.each(["before", "after"])("rejects a %s cursor from another room with 400 on that field", async (key) => {
    const roomId = await insertRoom(sql, "room");
    await insertMessageSeries(sql, roomId, 1);
    const otherId = await insertRoom(sql, "other");
    const [foreign] = await insertMessageSeries(sql, otherId, 1);

    const { status, body } = await get(roomId, `?${key}=${foreign.id}`);

    expect(status).toBe(400);
    expect(body).toEqual(validation([{ path: key, message: "is not a message in this room" }]));
  });

  it("rejects an unknown cursor", async () => {
    const roomId = await insertRoom(sql, "room");
    await insertMessageSeries(sql, roomId, 1);

    const { status, body } = await get(roomId, `?before=${NIL_UUID}`);

    expect(status).toBe(400);
    expect(body).toEqual(validation([{ path: "before", message: "is not a message in this room" }]));
  });

  it("rejects before and after together", async () => {
    const roomId = await insertRoom(sql, "room");
    const [only] = await insertMessageSeries(sql, roomId, 1);

    const { status, body } = await get(roomId, `?before=${only.id}&after=${only.id}`);

    expect(status).toBe(400);
    expect(body).toEqual(validation([{ path: "", message: "use either before or after, not both" }]));
  });

  it.each(["before", "after"])("rejects a malformed %s cursor", async (key) => {
    const roomId = await insertRoom(sql, "room");

    const { status, body } = await get(roomId, `?${key}=abc`);

    expect(status).toBe(400);
    expect(body).toEqual(validation([{ path: key, message: "must be a UUID" }]));
  });
});

describe("room validation", () => {
  it("answers 404 for an unknown room", async () => {
    const { status, body } = await get(NIL_UUID);

    expect(status).toBe(404);
    expect(body).toEqual({ error: { code: "not_found" } });
  });

  it("answers 400 for a malformed room id", async () => {
    const { status, body } = await get("abc");

    expect(status).toBe(400);
    expect(body).toEqual(validation([{ path: "id", message: "must be a UUID" }]));
  });
});

describe("POST /api/rooms/:id/messages", () => {
  it("stores the message, answers 201, and the next catch-up returns it", async () => {
    const roomId = await insertRoom(sql, "room");
    const [first] = await insertMessageSeries(sql, roomId, 1);

    const { status, body } = await post(roomId, { author: "  ann ", text: " hello\nthere " });

    expect(status).toBe(201);
    expect(body.message).toMatchObject({ chatroomId: roomId, author: "ann", text: "hello\nthere" });
    expect(body.message?.createdAt).toMatch(ISO_MICRO_UTC);

    const rows = await sql<{ id: string; author: string; text: string }[]>`
      select id, author, text from public.messages where chatroom_id = ${roomId}::uuid order by created_at`;
    expect([...rows]).toEqual([
      { id: first.id, author: "ann", text: "m1" },
      { id: body.message?.id, author: "ann", text: "hello\nthere" },
    ]);

    const catchUp = await get(roomId, `?after=${first.id}`);
    expect(ids(catchUp.body.messages)).toEqual([body.message?.id]);
  });

  it("answers 404 for an unknown room and stores nothing", async () => {
    const { status, body } = await post(NIL_UUID, { author: "ann", text: "hello" });

    expect(status).toBe(404);
    expect(body).toEqual({ error: { code: "not_found" } });
    expect(await sql`select 1 from public.messages`).toHaveLength(0);
  });

  it("answers 400 for a malformed room id", async () => {
    const { status, body } = await post("abc", { author: "ann", text: "hello" });

    expect(status).toBe(400);
    expect(body).toEqual(validation([{ path: "id", message: "must be a UUID" }]));
  });

  it("answers 400 with the field for text of 3001 code points", async () => {
    const roomId = await insertRoom(sql, "room");

    const { status, body } = await post(roomId, { author: "ann", text: ASTRAL.repeat(3001) });

    expect(status).toBe(400);
    expect(body).toEqual(validation([{ path: "text", message: "must be between 1 and 3000 characters" }]));
  });

  it("answers 400 with the field for an author of 101 code points", async () => {
    const roomId = await insertRoom(sql, "room");

    const { status, body } = await post(roomId, { author: ASTRAL.repeat(101), text: "hello" });

    expect(status).toBe(400);
    expect(body).toEqual(validation([{ path: "author", message: "must be between 1 and 100 characters" }]));
  });

  it("answers 400 for a body that is not JSON", async () => {
    const roomId = await insertRoom(sql, "room");

    const { status, body } = await postRaw(roomId, "{not json");

    expect(status).toBe(400);
    expect(body).toEqual(validation([{ path: "", message: "must be a JSON body" }]));
  });

  it("answers 400 for a JSON body that is not an object", async () => {
    const roomId = await insertRoom(sql, "room");

    const { status, body } = await post(roomId, ["ann", "hello"]);

    expect(status).toBe(400);
    expect(body.error?.code).toBe("validation");
    expect(body.error?.fields).toHaveLength(1);
    expect(body.error?.fields?.[0].path).toBe("");
  });

  it("ignores keys the client must not control", async () => {
    const roomId = await insertRoom(sql, "room");
    const otherId = await insertRoom(sql, "other");

    const { status, body } = await post(roomId, {
      author: "ann",
      text: "hello",
      chatroomId: otherId,
      createdAt: "2000-01-01T00:00:00.000000Z",
    });

    expect(status).toBe(201);
    expect(body.message?.chatroomId).toBe(roomId);
    expect(body.message?.createdAt).not.toBe("2000-01-01T00:00:00.000000Z");
  });
});
