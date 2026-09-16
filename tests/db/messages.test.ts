import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

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

interface MessageRow {
  id: string;
  chatroom_id: string;
  author: string;
  text: string;
  created_at: Date;
}

async function insertRoom(name: string): Promise<string> {
  return asRole(sql, "service_role", async (db) => {
    const [row] = await db<{ id: string }[]>`
      insert into public.chatrooms (name, lat, lng)
      values (${name}, ${Math.random() * 180 - 90}::double precision, ${Math.random() * 360 - 180}::double precision)
      returning id`;
    return row.id;
  });
}

async function insertMessage(message: {
  chatroomId: string;
  author: string;
  text: string;
}): Promise<MessageRow> {
  return asRole(sql, "service_role", async (db) => {
    const [row] = await db<MessageRow[]>`
      insert into public.messages (chatroom_id, author, text)
      values (${message.chatroomId}::uuid, ${message.author}, ${message.text})
      returning *`;
    return row;
  });
}

// A character outside the Basic Multilingual Plane: one code point, two UTF-16
// units. char_length() and [...s].length both count it as 1 (PRD 4).
const ASTRAL = "\u{1D4B3}";

describe("messages table shape", () => {
  it("has the columns from PRD 6.2", async () => {
    const columns = await sql<
      { column_name: string; data_type: string; is_nullable: string; column_default: string | null }[]
    >`
      select column_name, data_type, is_nullable, column_default
      from information_schema.columns
      where table_schema = 'public' and table_name = 'messages'
      order by ordinal_position`;

    expect([...columns]).toEqual([
      { column_name: "id", data_type: "uuid", is_nullable: "NO", column_default: "gen_random_uuid()" },
      { column_name: "chatroom_id", data_type: "uuid", is_nullable: "NO", column_default: null },
      { column_name: "author", data_type: "text", is_nullable: "NO", column_default: null },
      { column_name: "text", data_type: "text", is_nullable: "NO", column_default: null },
      {
        column_name: "created_at",
        data_type: "timestamp with time zone",
        is_nullable: "NO",
        column_default: "now()",
      },
    ]);
  });

  it("names its constraints", async () => {
    const rows = await sql<{ conname: string; contype: string }[]>`
      select conname, contype from pg_constraint
      where conrelid = 'public.messages'::regclass
      order by conname`;

    expect([...rows]).toEqual([
      { conname: "messages_author_check", contype: "c" },
      { conname: "messages_chatroom_id_fkey", contype: "f" },
      { conname: "messages_pkey", contype: "p" },
      { conname: "messages_text_check", contype: "c" },
    ]);
  });

  it("has the (chatroom_id, created_at desc, id desc) index for history and cursor queries", async () => {
    const [row] = await sql<{ indexdef: string }[]>`
      select indexdef from pg_indexes
      where schemaname = 'public' and tablename = 'messages' and indexname = 'messages_room_created_idx'`;
    expect(row?.indexdef).toBe(
      "CREATE INDEX messages_room_created_idx ON public.messages USING btree (chatroom_id, created_at DESC, id DESC)",
    );
  });
});

describe("messages constraints", () => {
  it("counts author length in code points: 100 is allowed, 101 is not", async () => {
    const chatroomId = await insertRoom("room");
    const ok = await insertMessage({ chatroomId, author: ASTRAL.repeat(100), text: "hi" });
    expect([...ok.author].length).toBe(100);

    await expectPgError(insertMessage({ chatroomId, author: ASTRAL.repeat(101), text: "hi" }), {
      code: "23514",
      constraint: "messages_author_check",
    });
  });

  it("rejects an empty author", async () => {
    const chatroomId = await insertRoom("room");
    await expectPgError(insertMessage({ chatroomId, author: "", text: "hi" }), {
      code: "23514",
      constraint: "messages_author_check",
    });
  });

  it("counts text length in code points: 3000 is allowed, 3001 is not", async () => {
    const chatroomId = await insertRoom("room");
    const ok = await insertMessage({ chatroomId, author: "ann", text: ASTRAL.repeat(3000) });
    expect([...ok.text].length).toBe(3000);

    await expectPgError(insertMessage({ chatroomId, author: "ann", text: ASTRAL.repeat(3001) }), {
      code: "23514",
      constraint: "messages_text_check",
    });
  });

  it("rejects an empty text", async () => {
    const chatroomId = await insertRoom("room");
    await expectPgError(insertMessage({ chatroomId, author: "ann", text: "" }), {
      code: "23514",
      constraint: "messages_text_check",
    });
  });

  it("rejects a message for an unknown room", async () => {
    await expectPgError(
      insertMessage({ chatroomId: "00000000-0000-0000-0000-000000000000", author: "ann", text: "hi" }),
      { code: "23503", constraint: "messages_chatroom_id_fkey" },
    );
  });

  it("deletes messages when their room is deleted", async () => {
    const chatroomId = await insertRoom("room");
    await insertMessage({ chatroomId, author: "ann", text: "one" });
    await insertMessage({ chatroomId, author: "bob", text: "two" });

    await asRole(sql, "service_role", (db) =>
      db`delete from public.chatrooms where id = ${chatroomId}::uuid`.execute(),
    );

    const [row] = await sql<{ count: number }[]>`select count(*)::int as count from public.messages`;
    expect(row.count).toBe(0);
  });

  it("stores created_at as a timestamp with time zone close to now", async () => {
    const chatroomId = await insertRoom("room");
    const [{ dbNow }] = await sql<{ dbNow: Date }[]>`select now() as "dbNow"`;
    const message = await insertMessage({ chatroomId, author: "ann", text: "hi" });
    expect(message.created_at).toBeInstanceOf(Date);
    expect(Math.abs(message.created_at.getTime() - dbNow.getTime())).toBeLessThan(5_000);
  });
});

describe("messages security", () => {
  it("has row level security enabled", async () => {
    const [row] = await sql<{ relrowsecurity: boolean }[]>`
      select relrowsecurity from pg_class where oid = 'public.messages'::regclass`;
    expect(row.relrowsecurity).toBe(true);
  });

  it("has exactly one policy: SELECT for anon", async () => {
    const rows = await sql<{ policyname: string; cmd: string; roles: string[] }[]>`
      select policyname, cmd, roles from pg_policies
      where schemaname = 'public' and tablename = 'messages'`;
    expect([...rows]).toEqual([
      { policyname: "messages are publicly readable", cmd: "SELECT", roles: ["anon"] },
    ]);
  });

  it("lets anon read messages", async () => {
    const chatroomId = await insertRoom("room");
    await insertMessage({ chatroomId, author: "ann", text: "hello" });

    const texts = await asRole(sql, "anon", async (db) => {
      const rows = await db<{ text: string }[]>`select text from public.messages`;
      return rows.map((r) => r.text);
    });
    expect(texts).toEqual(["hello"]);
  });

  it("denies anon inserts, updates and deletes at the grant level", async () => {
    const chatroomId = await insertRoom("room");
    await insertMessage({ chatroomId, author: "ann", text: "hello" });

    await expectPgError(
      asRole(sql, "anon", (db) =>
        db`insert into public.messages (chatroom_id, author, text) values (${chatroomId}::uuid, 'x', 'y')`.execute(),
      ),
      { code: "42501", message: /permission denied for table messages/ },
    );
    await expectPgError(
      asRole(sql, "anon", (db) => db`update public.messages set text = 'edited'`.execute()),
      { code: "42501", message: /permission denied for table messages/ },
    );
    await expectPgError(
      asRole(sql, "anon", (db) => db`delete from public.messages`.execute()),
      { code: "42501", message: /permission denied for table messages/ },
    );
  });

  it("denies authenticated everything", async () => {
    await expectPgError(
      asRole(sql, "authenticated", (db) => db`select * from public.messages`.execute()),
      { code: "42501", message: /permission denied for table messages/ },
    );
  });
});

describe("realtime publication", () => {
  it("publishes messages through supabase_realtime", async () => {
    const rows = await sql<{ tablename: string }[]>`
      select tablename from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public'
      order by tablename`;
    expect(rows.map((r) => r.tablename)).toEqual(["messages"]);
  });
});
