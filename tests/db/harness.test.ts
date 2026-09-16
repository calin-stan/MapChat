import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { asRole, connect, expectPgError, type Sql } from "./helpers";

let sql: Sql;

beforeAll(() => {
  sql = connect();
});

afterAll(async () => {
  await sql.end();
});

describe("database test harness", () => {
  it("connects as the postgres superuser", async () => {
    const [row] = await sql<{ current_user: string }[]>`select current_user`;
    expect(row.current_user).toBe("postgres");
  });

  it("finds the Supabase API roles", async () => {
    const rows = await sql<{ rolname: string }[]>`
      select rolname from pg_roles
      where rolname in ('anon', 'authenticated', 'service_role')
      order by rolname`;
    expect(rows.map((r) => r.rolname)).toEqual(["anon", "authenticated", "service_role"]);
  });

  it("asRole runs the callback as the role and resets afterwards", async () => {
    const inside = await asRole(sql, "anon", async (db) => {
      const [row] = await db<{ current_user: string }[]>`select current_user`;
      return row.current_user;
    });
    expect(inside).toBe("anon");

    const [after] = await sql<{ current_user: string }[]>`select current_user`;
    expect(after.current_user).toBe("postgres");
  });

  it("expectPgError reports the SQLSTATE of a failing statement", async () => {
    const error = await expectPgError(sql`select 1 / 0`, { code: "22012" });
    expect(error.message).toMatch(/division by zero/);
  });

  it("expectPgError fails when the statement succeeds", async () => {
    await expect(expectPgError(sql`select 1`, { code: "22012" })).rejects.toThrow(
      /Expected a PostgresError/,
    );
  });
});
