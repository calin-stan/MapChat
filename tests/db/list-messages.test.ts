import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { insertMessageAt, insertMessageSeries, insertRoom, type DbMessageRow } from "./fixtures";
import { asRole, connect, expectPgError, truncateAll, type Sql } from "./helpers";

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

const FN_SIGNATURE = "public.list_messages(uuid, text, uuid, integer)";
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const T0 = "2026-09-16T10:00:00Z";
const TIE_AT = "2026-09-16T10:00:00.003Z"; // same instant as m3 of a series starting at T0

type Mode = "initial" | "before" | "after";

async function list(
  roomId: string,
  mode: Mode,
  cursor: string | null,
  limit: number,
): Promise<DbMessageRow[]> {
  const rows = await sql<DbMessageRow[]>`
    select id, chatroom_id, author, text, created_at
    from public.list_messages(${roomId}::uuid, ${mode}, ${cursor}::uuid, ${limit}::integer)`;
  return [...rows];
}

const texts = (rows: DbMessageRow[]) => rows.map((row) => row.text);

/** Full ascending order the database uses: (created_at, id). */
async function ascending(roomId: string): Promise<DbMessageRow[]> {
  const rows = await sql<DbMessageRow[]>`
    select id, chatroom_id, author, text, created_at from public.messages
    where chatroom_id = ${roomId}::uuid
    order by created_at asc, id asc`;
  return [...rows];
}

/** m1..m5 one ms apart plus three messages sharing m3's instant. */
async function roomWithTies(): Promise<{ roomId: string; all: DbMessageRow[] }> {
  const roomId = await insertRoom(sql, "ties");
  await insertMessageSeries(sql, roomId, 5, T0);
  await insertMessageAt(sql, roomId, "t1", TIE_AT);
  await insertMessageAt(sql, roomId, "t2", TIE_AT);
  await insertMessageAt(sql, roomId, "t3", TIE_AT);
  return { roomId, all: await ascending(roomId) };
}

describe("list_messages: initial", () => {
  it("returns the newest p_limit messages, newest first", async () => {
    const roomId = await insertRoom(sql, "room");
    await insertMessageSeries(sql, roomId, 5, T0);

    expect(texts(await list(roomId, "initial", null, 3))).toEqual(["m5", "m4", "m3"]);
  });

  it("returns every message when the room has fewer than p_limit", async () => {
    const roomId = await insertRoom(sql, "room");
    await insertMessageSeries(sql, roomId, 5, T0);

    expect(texts(await list(roomId, "initial", null, 100))).toEqual(["m5", "m4", "m3", "m2", "m1"]);
  });

  it("orders messages with the same created_at by id, descending", async () => {
    const { roomId, all } = await roomWithTies();

    const rows = await list(roomId, "initial", null, 100);
    expect(rows.map((row) => row.id)).toEqual([...all].reverse().map((row) => row.id));
  });
});

describe("list_messages: before", () => {
  it("returns messages strictly older than the cursor, newest first", async () => {
    const roomId = await insertRoom(sql, "room");
    const series = await insertMessageSeries(sql, roomId, 5, T0);

    expect(texts(await list(roomId, "before", series[2].id, 10))).toEqual(["m2", "m1"]);
  });

  it("walks the whole history in pages of 2 without gaps or duplicates across ties", async () => {
    const { roomId, all } = await roomWithTies();
    const newest = all[all.length - 1];

    const walked = [newest.id];
    let cursor = newest.id;
    for (;;) {
      const page = await list(roomId, "before", cursor, 2);
      if (page.length === 0) break;
      walked.push(...page.map((row) => row.id));
      cursor = page[page.length - 1].id;
    }

    expect(walked).toEqual([...all].reverse().map((row) => row.id));
  });

  it("returns nothing before the oldest message", async () => {
    const roomId = await insertRoom(sql, "room");
    const series = await insertMessageSeries(sql, roomId, 3, T0);

    expect(await list(roomId, "before", series[0].id, 10)).toEqual([]);
  });
});

describe("list_messages: after", () => {
  it("returns messages strictly newer than the cursor, oldest first", async () => {
    const roomId = await insertRoom(sql, "room");
    const series = await insertMessageSeries(sql, roomId, 5, T0);

    expect(texts(await list(roomId, "after", series[2].id, 10))).toEqual(["m4", "m5"]);
  });

  it("walks forward in pages of 3 without gaps or duplicates across ties", async () => {
    const { roomId, all } = await roomWithTies();
    const oldest = all[0];

    const walked = [oldest.id];
    let cursor = oldest.id;
    for (;;) {
      const page = await list(roomId, "after", cursor, 3);
      if (page.length === 0) break;
      walked.push(...page.map((row) => row.id));
      cursor = page[page.length - 1].id;
    }

    expect(walked).toEqual(all.map((row) => row.id));
  });

  it("returns nothing after the newest message", async () => {
    const roomId = await insertRoom(sql, "room");
    const series = await insertMessageSeries(sql, roomId, 3, T0);

    expect(await list(roomId, "after", series[2].id, 10)).toEqual([]);
  });

  it("splits a tie exactly: before and after a tied message partition the room", async () => {
    const { roomId, all } = await roomWithTies();
    const tied = all.filter((row) => row.text.startsWith("t"));
    const middle = tied[1]; // second by id among the three tied rows

    const before = await list(roomId, "before", middle.id, 100);
    const after = await list(roomId, "after", middle.id, 100);

    expect([...before.reverse().map((r) => r.id), middle.id, ...after.map((r) => r.id)]).toEqual(
      all.map((row) => row.id),
    );
  });
});

describe("list_messages: errors", () => {
  it("raises PT404 for an unknown room", async () => {
    await expectPgError(list(NIL_UUID, "initial", null, 10), {
      code: "PT404",
      message: /room not found/,
    });
  });

  it("raises PT400 for a cursor that belongs to another room", async () => {
    const roomId = await insertRoom(sql, "room");
    await insertMessageSeries(sql, roomId, 1, T0);
    const otherId = await insertRoom(sql, "other");
    const [foreign] = await insertMessageSeries(sql, otherId, 1, T0);

    await expectPgError(list(roomId, "after", foreign.id, 10), {
      code: "PT400",
      message: /cursor not found in room/,
    });
  });

  it("raises PT400 for an unknown cursor", async () => {
    const roomId = await insertRoom(sql, "room");
    await insertMessageSeries(sql, roomId, 1, T0);

    await expectPgError(list(roomId, "before", NIL_UUID, 10), {
      code: "PT400",
      message: /cursor not found in room/,
    });
  });

  it.each([
    { label: "an unknown mode", mode: "sideways" as Mode, cursor: null, limit: 10, message: /p_mode/ },
    { label: "a zero limit", mode: "initial" as Mode, cursor: null, limit: 0, message: /p_limit/ },
    { label: "a cursor with initial", mode: "initial" as Mode, cursor: "self", limit: 10, message: /p_cursor must be null/ },
    { label: "before without a cursor", mode: "before" as Mode, cursor: null, limit: 10, message: /p_cursor is required/ },
    { label: "after without a cursor", mode: "after" as Mode, cursor: null, limit: 10, message: /p_cursor is required/ },
  ])("raises 22023 for $label", async ({ mode, cursor, limit, message }) => {
    const roomId = await insertRoom(sql, "room");
    const [only] = await insertMessageSeries(sql, roomId, 1, T0);

    await expectPgError(list(roomId, mode, cursor === "self" ? only.id : cursor, limit), {
      code: "22023",
      message,
    });
  });
});

describe("list_messages: privileges", () => {
  it("is STABLE and SECURITY INVOKER with a pinned search_path", async () => {
    const [row] = await sql<{ provolatile: string; prosecdef: boolean; proconfig: string[] | null }[]>`
      select provolatile, prosecdef, proconfig from pg_proc
      where oid = ${FN_SIGNATURE}::regprocedure`;
    expect(row.provolatile).toBe("s");
    expect(row.prosecdef).toBe(false);
    expect(row.proconfig).toEqual(['search_path=""']);
  });

  it("grants EXECUTE to service_role only", async () => {
    const [row] = await sql<{ anon: boolean; authenticated: boolean; service_role: boolean }[]>`
      select
        has_function_privilege('anon', ${FN_SIGNATURE}, 'EXECUTE') as anon,
        has_function_privilege('authenticated', ${FN_SIGNATURE}, 'EXECUTE') as authenticated,
        has_function_privilege('service_role', ${FN_SIGNATURE}, 'EXECUTE') as service_role`;
    expect(row).toEqual({ anon: false, authenticated: false, service_role: true });
  });

  it.each(["anon", "authenticated"] as const)("refuses %s callers", async (role) => {
    const roomId = await insertRoom(sql, "room");
    await insertMessageSeries(sql, roomId, 1, T0);

    await expectPgError(
      asRole(sql, role, (db) => db`select * from public.list_messages(${roomId}::uuid, 'initial', null, 10)`),
      { code: "42501", message: /permission denied for function list_messages/ },
    );
  });
});
