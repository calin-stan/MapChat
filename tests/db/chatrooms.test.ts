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

interface ChatroomRow {
  id: string;
  name: string;
  lat: number;
  lng: number;
  created_at: Date;
}

/** Inserts as service_role (the route handlers' role) and returns the row. */
async function insertRoom(room: { name: string; lat: number; lng: number }): Promise<ChatroomRow> {
  return asRole(sql, "service_role", async (db) => {
    const [row] = await db<ChatroomRow[]>`
      insert into public.chatrooms (name, lat, lng)
      values (${room.name}, ${room.lat}::double precision, ${room.lng}::double precision)
      returning *`;
    return row;
  });
}

describe("chatrooms table shape", () => {
  it("has the columns from PRD 6.2", async () => {
    const columns = await sql<
      { column_name: string; data_type: string; is_nullable: string; column_default: string | null }[]
    >`
      select column_name, data_type, is_nullable, column_default
      from information_schema.columns
      where table_schema = 'public' and table_name = 'chatrooms'
      order by ordinal_position`;

    expect([...columns]).toEqual([
      { column_name: "id", data_type: "uuid", is_nullable: "NO", column_default: "gen_random_uuid()" },
      { column_name: "name", data_type: "text", is_nullable: "NO", column_default: null },
      { column_name: "lat", data_type: "double precision", is_nullable: "NO", column_default: null },
      { column_name: "lng", data_type: "double precision", is_nullable: "NO", column_default: null },
      {
        column_name: "created_at",
        data_type: "timestamp with time zone",
        is_nullable: "NO",
        column_default: "now()",
      },
    ]);
  });

  it("names its constraints so route handlers can tell conflicts apart", async () => {
    const rows = await sql<{ conname: string; contype: string }[]>`
      select conname, contype from pg_constraint
      where conrelid = 'public.chatrooms'::regclass
      order by conname`;

    expect([...rows]).toEqual([
      { conname: "chatrooms_lat_check", contype: "c" },
      { conname: "chatrooms_lat_lng_key", contype: "u" },
      { conname: "chatrooms_lng_check", contype: "c" },
      { conname: "chatrooms_name_key", contype: "u" },
      { conname: "chatrooms_pkey", contype: "p" },
    ]);
  });

  it("generates id and created_at (UTC, now) on insert", async () => {
    const [{ dbNow }] = await sql<{ dbNow: Date }[]>`select now() as "dbNow"`;
    const room = await insertRoom({ name: "brave-crimson-otter", lat: 47.5, lng: 19.05 });

    expect(room.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(room.created_at).toBeInstanceOf(Date);
    expect(Math.abs(room.created_at.getTime() - dbNow.getTime())).toBeLessThan(5_000);
  });
});

describe("chatrooms constraints", () => {
  it("rejects latitude outside [-90, 90]", async () => {
    await expectPgError(insertRoom({ name: "a", lat: 90.000001, lng: 0 }), {
      code: "23514",
      constraint: "chatrooms_lat_check",
    });
    await expectPgError(insertRoom({ name: "b", lat: -90.000001, lng: 0 }), {
      code: "23514",
      constraint: "chatrooms_lat_check",
    });
  });

  it("rejects longitude outside [-180, 180]", async () => {
    await expectPgError(insertRoom({ name: "a", lat: 0, lng: 180.000001 }), {
      code: "23514",
      constraint: "chatrooms_lng_check",
    });
    await expectPgError(insertRoom({ name: "b", lat: 0, lng: -180.000001 }), {
      code: "23514",
      constraint: "chatrooms_lng_check",
    });
  });

  it("accepts the boundary coordinates", async () => {
    await insertRoom({ name: "north-east", lat: 90, lng: 180 });
    await insertRoom({ name: "south-west", lat: -90, lng: -180 });
    const [row] = await sql<{ count: number }[]>`select count(*)::int as count from public.chatrooms`;
    expect(row.count).toBe(2);
  });

  it("rejects a duplicate name with the name constraint", async () => {
    await insertRoom({ name: "brave-crimson-otter", lat: 1, lng: 1 });
    await expectPgError(insertRoom({ name: "brave-crimson-otter", lat: 2, lng: 2 }), {
      code: "23505",
      constraint: "chatrooms_name_key",
    });
  });

  it("rejects duplicate coordinates with the lat/lng constraint (the 409 rule)", async () => {
    await insertRoom({ name: "first", lat: 47.497913, lng: 19.040236 });
    await expectPgError(insertRoom({ name: "second", lat: 47.497913, lng: 19.040236 }), {
      code: "23505",
      constraint: "chatrooms_lat_lng_key",
    });
  });

  it("treats coordinates differing in the 6th decimal as different spots", async () => {
    await insertRoom({ name: "first", lat: 47.497913, lng: 19.040236 });
    await insertRoom({ name: "second", lat: 47.497914, lng: 19.040236 });
    const [row] = await sql<{ count: number }[]>`select count(*)::int as count from public.chatrooms`;
    expect(row.count).toBe(2);
  });
});

describe("chatrooms security", () => {
  it("has row level security enabled", async () => {
    const [row] = await sql<{ relrowsecurity: boolean }[]>`
      select relrowsecurity from pg_class where oid = 'public.chatrooms'::regclass`;
    expect(row.relrowsecurity).toBe(true);
  });

  it("has exactly one policy: SELECT for anon", async () => {
    const rows = await sql<{ policyname: string; cmd: string; roles: string[] }[]>`
      select policyname, cmd, roles from pg_policies
      where schemaname = 'public' and tablename = 'chatrooms'`;
    expect([...rows]).toEqual([
      { policyname: "chatrooms are publicly readable", cmd: "SELECT", roles: ["anon"] },
    ]);
  });

  it("lets anon read rooms", async () => {
    await insertRoom({ name: "visible", lat: 1, lng: 1 });
    const names = await asRole(sql, "anon", async (db) => {
      const rows = await db<{ name: string }[]>`select name from public.chatrooms`;
      return rows.map((r) => r.name);
    });
    expect(names).toEqual(["visible"]);
  });

  it("denies anon inserts at the grant level, not just by policy", async () => {
    await expectPgError(
      asRole(sql, "anon", (db) =>
        db`insert into public.chatrooms (name, lat, lng) values ('nope', 0, 0)`.execute(),
      ),
      { code: "42501", message: /permission denied for table chatrooms/ },
    );
  });

  it("denies anon updates and deletes", async () => {
    await insertRoom({ name: "target", lat: 1, lng: 1 });
    await expectPgError(
      asRole(sql, "anon", (db) => db`update public.chatrooms set name = 'renamed'`.execute()),
      { code: "42501", message: /permission denied for table chatrooms/ },
    );
    await expectPgError(
      asRole(sql, "anon", (db) => db`delete from public.chatrooms`.execute()),
      { code: "42501", message: /permission denied for table chatrooms/ },
    );
  });

  it("denies authenticated everything (the app has no signed-in users)", async () => {
    await expectPgError(
      asRole(sql, "authenticated", (db) => db`select * from public.chatrooms`.execute()),
      { code: "42501", message: /permission denied for table chatrooms/ },
    );
  });

  it("lets service_role write", async () => {
    const room = await insertRoom({ name: "by-service-role", lat: 1, lng: 1 });
    expect(room.name).toBe("by-service-role");
  });
});
