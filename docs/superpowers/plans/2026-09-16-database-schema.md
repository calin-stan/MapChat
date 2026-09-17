# Database Schema Implementation Plan

**Review feedback:** [2026-09-16-database-schema-feedback.md](2026-09-16-database-schema-feedback.md)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create the Map Chat database as versioned Supabase migrations: the `chatrooms` and `messages` tables, the messages index, Row Level Security with anonymous SELECT only, the realtime publication on `messages`, and the atomic `create_room_with_first_message` Postgres function, all proven by tests that run against the local stack.

**Architecture:** Three plain-SQL migration files under `supabase/migrations/` are applied to the Supbuddy-managed local Supabase stack with the Supabase CLI through package scripts (`pnpm db:migrate`, `pnpm db:reset`). Constraint, security, and function behaviour are verified by a second Vitest suite (`pnpm test:db`) that connects to the local Postgres with the `postgres` driver and exercises each rule as the real API roles (`anon`, `authenticated`, `service_role`) using `SET ROLE`. A separate file in that suite calls the function through Supabase’s `.rpc()` to verify the HTTP error contract consumed by route handlers. The default `pnpm test` suite stays database-free.

**Tech Stack:** Postgres 17 (Supabase local image), Supabase CLI 2.113 driven through Supbuddy, plain SQL migrations, PL/pgSQL, Vitest 5, `postgres` (postgres.js) 3.4 as the test driver, `@supabase/supabase-js` 2 for RPC contract tests and later route handlers, pnpm.

**Spec:** `docs/PRD.md` sections 4 (input rules), 6.1 (security model), 6.2 (data model), 6.3 (room naming and atomic creation), 6.4 (realtime), 8 (testing). Also `docs/KNOWN_LIMITATIONS.md`.

## Global Constraints

- Language: "TypeScript throughout" (PRD §5). Migrations are SQL; every test and helper is TypeScript.
- Database: "Postgres on Supabase" (PRD §5). Live updates: "Supabase Realtime, Postgres Changes on the `messages` table" (PRD §5).
- Data model, copied from PRD §6.2 (constraint names are added by this plan, see Assumptions):

  ```sql
  create table chatrooms (
    id          uuid primary key default gen_random_uuid(),
    name        text not null unique,
    lat         double precision not null check (lat between -90 and 90),
    lng         double precision not null check (lng between -180 and 180),
    created_at  timestamptz not null default now(),
    unique (lat, lng)
  );

  create table messages (
    id           uuid primary key default gen_random_uuid(),
    chatroom_id  uuid not null references chatrooms(id) on delete cascade,
    author       text not null check (char_length(author) between 1 and 100),
    text         text not null check (char_length(text) between 1 and 3000),
    created_at   timestamptz not null default now()
  );
  create index messages_room_created_idx on messages (chatroom_id, created_at desc, id desc);
  ```

- Input rules (PRD §4): display name 1 to 100 characters, message 1 to 3000 characters, where "character" means a Unicode code point counted by `char_length` in Postgres. Latitude in [-90, 90], longitude in [-180, 180].
- Security (PRD §6.1): "Row Level Security is enabled on both tables with a SELECT-only policy and SELECT grants for `anon`; there are no anon write policies or table write grants." "The room-creation function uses `SECURITY INVOKER`. Revoke EXECUTE from `PUBLIC`, `anon`, and `authenticated`, and grant it only to `service_role`. A caller using the anon key must not be able to invoke the write function."
- Atomicity (PRD §6.3): "Room creation (room row + first message) runs in a single Postgres function so it is atomic." Name uniqueness "is guaranteed by the database, not by the generator"; the name retry loop lives in the Node route handler, not in the function.
- Conflict detection (PRD §6.3): "Distinguish conflicts by the violated constraint, not SQLSTATE alone: both the name and coordinate constraints produce 23505." The constraint names are therefore part of the contract with the route handlers.
- Coordinates (PRD §6.2): "rounded to 6 decimal places by the server before insert, and the unique constraint on `(lat, lng)` is what detects 'a room already exists at this spot'."
- Timestamps (PRD §4): "Posting time is stored as UTC by the database" (`timestamptz`, default `now()`).
- Testing (PRD §8): "Verify anonymous reads are allowed, but anonymous table writes and function execution fail."
- Supbuddy rules (from `.supbuddy/do-not.md` of managed projects): do not edit `/etc/resolver/`, the `Caddyfile`, or managed certificates; do not bypass plan→apply for destructive MCP tools; do not commit `*.supbuddy-backup-*` files or `.supbuddy/meta.json`. Start and stop the Supabase stack through Supbuddy (app, MCP `start_supabase` / `stop_supabase`, or `supbuddy supabase start|stop`), never with a bare `supabase start`.

## Prerequisites (verified state on 2026-09-16)

- Git: `main` and branch `scaffolding-and-config` are at `a8f835e feat: add server config parser and memoised config accessors`; the tree is clean. Scaffolding plan Tasks 1 to 4 are done.
- **Scaffolding plan Task 5 is NOT done yet**: there is no `supabase/config.toml`, no running stack, no `.env.local`, and no `.supbuddy/` directory. Supbuddy's `list_projects` shows this repo registered as `map-chat` (id `f9e13085-553a-464e-b693-5b7a6d2642e4`) in `host` isolation with `isolationError: "Failed to create loopback alias 127.0.0.4"` and no services. **This plan requires a running local Supabase stack for this project.** Finish scaffolding Task 5 first (initialise through Supbuddy's `init_supabase`, start with `start_supabase`); if the isolation error blocks it, report that to the user rather than working around Supbuddy. Task 1 Step 1 below checks for the stack and stops if it is missing.
- Supabase CLI 2.113.0 at `/opt/homebrew/bin/supabase`. `supabase status -o env` prints `DB_URL=...` among its variables (verified against another Supbuddy project on this machine). `supabase migration up --local` applies pending migrations; `supabase db reset --local` rebuilds the local database from all migrations.
- Node 22.23.0, pnpm 10.9.0, Vitest 5.0.1 already installed. Latest `postgres` on npm is 3.4.9.
- Every command below is run from `/Users/calin/dev/other/wp`.

## Assumptions (not stated in the spec)

- **Package scripts run with pnpm.** The project uses pnpm (`packageManager: pnpm@10.9.0`, `pnpm-lock.yaml`). The migration and test scripts are added to `package.json` and run with `pnpm`. Do not introduce another package manager or lockfile.
- **"Via MCP" is not scripted here.** Supbuddy's MCP tool list (checked on 2026-09-16) has no migration-applying tool, and no Supabase MCP server is configured for this repo. The migrations are plain SQL files, so if the user later adds the official Supabase MCP server its `apply_migration` tool can apply the same files unchanged. The verified path in this plan is `pnpm db:migrate`.
- **Three migration files, fixed timestamps.** `20260916000100_create_chatrooms.sql`, `20260916000200_create_messages.sql`, `20260916000300_create_room_with_first_message.sql`. Fixed names keep the plan deterministic; `supabase migration new` is not used.
- **Explicit constraint names.** Postgres would generate the same names, but the route handlers will branch on them, so they are spelled out: `chatrooms_pkey`, `chatrooms_name_key`, `chatrooms_lat_lng_key`, `chatrooms_lat_check`, `chatrooms_lng_check`, `messages_pkey`, `messages_chatroom_id_fkey`, `messages_author_check`, `messages_text_check`.
- **Supabase default privileges must be undone explicitly.** The Supabase image defines default privileges on schema `public` that grant anon, authenticated and service_role ALL on new tables and EXECUTE on new functions. Each migration revokes what the PRD forbids instead of relying on RLS alone.
- **`authenticated` gets no table grants.** The PRD only names `anon`; the app has no signed-in users, so `authenticated` is revoked entirely. `service_role` keeps full table privileges (it is what the route handlers use through PostgREST).
- **The function does not round coordinates.** PRD §6.2 puts rounding in the server before insert; the function inserts what it is given. It returns `jsonb` of shape `{ "room": <chatrooms row>, "message": <messages row> }` so one RPC call yields both entities.
- **The function does not catch unique violations.** The name-retry loop is a route-handler concern (PRD §6.3). Direct SQL callers receive `23505` and the `constraint_name` diagnostic. Supabase RPC callers receive `code`, `message`, `details`, and `hint`; they extract the exact quoted constraint name from `message` only when `code === "23505"`. Task 4 defines and tests this HTTP contract. Unrecognized errors are not treated as room conflicts or retried.
- **The realtime publication is created if missing.** Supabase ships a `supabase_realtime` publication with no tables; the migration adds `public.messages` to it and, defensively, creates the publication first if it does not exist.
- **DB tests use the `postgres` driver over the CLI-reported `DB_URL`.** The test helper reads `DATABASE_URL` if set, otherwise runs `supabase status -o env` and takes `DB_URL`. The local connection is the `postgres` superuser, so role behaviour is tested by `SET ROLE anon | authenticated | service_role` on a pinned connection. This checks SQL role behavior; the additional RPC suite checks the actual HTTP response through the local API. If `DATABASE_URL` is set when running that suite, it must point to the same project as the CLI-reported API URL so fixture cleanup and RPC calls use the same data.
- **DB tests live in `tests/db/` and run with `pnpm test:db`.** `pnpm test` (the existing `vitest.config.ts`, `src/**`) must keep passing with no database. `supabase/tests/` is avoided because `supabase test db` treats that folder as pgTAP input.
- **Tests truncate the tables before each test** (as `postgres`). The local database is disposable; no test data survives.

## File structure

| Path                                                                | Responsibility                                                                                     |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `package.json`                                                      | Adds DB scripts, the `postgres` dev dependency, and `@supabase/supabase-js`                 |
| `vitest.db.config.ts`                                               | Vitest config for database tests: `tests/db/**/*.test.ts`, files run one at a time                 |
| `tests/db/helpers.ts`                                               | `resolveDatabaseUrl`, `connect`, `asRole`, `truncateAll`, `expectPgError`, row types              |
| `tests/db/harness.test.ts`                                          | Proves the harness: connection, roles exist, `asRole` switches and resets, `expectPgError` works   |
| `supabase/migrations/20260916000100_create_chatrooms.sql`           | `chatrooms` table, named constraints, RLS, anon SELECT policy, grants                              |
| `tests/db/chatrooms.test.ts`                                        | Column shape, checks, unique constraints, RLS, grants for `chatrooms`                              |
| `supabase/migrations/20260916000200_create_messages.sql`            | `messages` table, named constraints, index, RLS, policy, grants, realtime publication              |
| `tests/db/messages.test.ts`                                         | Column shape, checks, FK cascade, index, RLS, grants, publication membership                       |
| `supabase/migrations/20260916000300_create_room_with_first_message.sql` | `create_room_with_first_message()` function, EXECUTE revoked from PUBLIC/anon/authenticated    |
| `tests/db/create-room-with-first-message.test.ts`                   | Return shape, atomicity, constraint names on conflict, execute privileges by role                   |
| `tests/db/create-room-rpc.test.ts` | Supabase RPC success, both HTTP conflict forms, rollback, and conflict classification |
| `README.md`                                                         | "Database" section: how to apply migrations and run the DB tests                                    |

Migrations are applied in filename order, so the file numbering is the dependency order: tables before the function, `chatrooms` before `messages`.

---

### Task 1: Migration scripts and the database test harness

**Files:**
- Modify: `package.json` (scripts, devDependency)
- Create: `vitest.db.config.ts`, `tests/db/helpers.ts`, `tests/db/harness.test.ts`

**Interfaces:**
- Consumes: a running local Supabase stack for this project (scaffolding plan Task 5); `supabase` CLI on PATH.
- Produces, for Tasks 2 to 4:
  - `pnpm db:migrate` (applies pending migrations), `pnpm db:reset` (rebuilds from scratch), `pnpm test:db` (runs `tests/db/**/*.test.ts`).
  - From `tests/db/helpers.ts`:
    - `type Sql = ReturnType<typeof postgres>`
    - `type DbRole = "anon" | "authenticated" | "service_role"`
    - `resolveDatabaseUrl(): string`
    - `connect(): Sql`
    - `asRole<T>(sql: Sql, role: DbRole, fn: (db: postgres.ReservedSql) => Promise<T>): Promise<T>`
    - `truncateAll(sql: Sql): Promise<void>` (truncates `public.chatrooms` cascade; only valid once Task 2's migration exists)
    - `expectPgError(promise: Promise<unknown>, expected: { code: string; constraint?: string; message?: RegExp }): Promise<Error & PgErrorFields>`
    - `interface PgErrorFields { code: string; message: string; constraint_name?: string }`

- [ ] **Step 1: Check the prerequisites and stop if the stack is missing**

```bash
cd /Users/calin/dev/other/wp
test -f supabase/config.toml && echo "config.toml: ok" || echo "STOP: no supabase/config.toml. Finish scaffolding plan Task 5 (init_supabase + start_supabase via Supbuddy) first."
supabase status -o env 2>/dev/null | cut -d= -f1 | grep -qx DB_URL && echo "stack: running (DB_URL reported)" || echo "STOP: local stack not running. Start it through Supbuddy (start_supabase) and re-run."
ls supabase/migrations 2>/dev/null || echo "no migrations dir yet (expected)"
```

Expected: both lines print `ok` / `running`. If either prints `STOP`, do not continue this plan; report the state to the user.

- [ ] **Step 2: Add the scripts and the `postgres` dev dependency**

```bash
cd /Users/calin/dev/other/wp
pnpm add -D postgres@^3.4.9
node -e '
const fs = require("fs");
const p = JSON.parse(fs.readFileSync("package.json", "utf8"));
p.scripts["db:migrate"] = "supabase migration up --local";
p.scripts["db:reset"] = "supabase db reset --local";
p.scripts["test:db"] = "vitest run --config vitest.db.config.ts";
fs.writeFileSync("package.json", JSON.stringify(p, null, 2) + "\n");
'
node -p "JSON.stringify(require('./package.json').scripts, null, 2)"
grep -n '"postgres"' package.json
```

Expected: scripts now include `db:migrate`, `db:reset`, `test:db` next to the existing ones; `"postgres": "^3.4.9"` is under `devDependencies`.

- [ ] **Step 3: Write the Vitest config for database tests**

```bash
cd /Users/calin/dev/other/wp
cat > vitest.db.config.ts <<'EOF'
import { defineConfig } from "vitest/config";

// Database tests. They need the local Supabase stack, so they are kept out of
// the default `pnpm test` run (vitest.config.ts only includes src/**).
// Run with: pnpm test:db
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/db/**/*.test.ts"],
    // All files share one database and truncate tables between tests, so
    // files must not run concurrently. Tests inside a file are sequential
    // by default.
    fileParallelism: false,
    testTimeout: 15_000,
    hookTimeout: 30_000,
  },
});
EOF
```

- [ ] **Step 4: Write the helpers**

```bash
cd /Users/calin/dev/other/wp
mkdir -p tests/db
cat > tests/db/helpers.ts <<'EOF'
import { execFileSync } from "node:child_process";

import postgres from "postgres";
import { expect } from "vitest";

export type Sql = ReturnType<typeof postgres>;

/** The Supabase API roles PostgREST switches to per request. */
export type DbRole = "anon" | "authenticated" | "service_role";

/**
 * Connection string for the local Supabase database.
 * `DATABASE_URL` wins when set. Otherwise ask the Supabase CLI, which reads the
 * Supbuddy-rewritten `supabase/config.toml` and so reports the project's port.
 */
export function resolveDatabaseUrl(): string {
  const fromEnv = process.env.DATABASE_URL?.trim();
  if (fromEnv) return fromEnv;

  let output: string;
  try {
    output = execFileSync("supabase", ["status", "-o", "env"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    throw new Error(
      "Could not run `supabase status`. Is the local stack running? Start it through Supbuddy (start_supabase).",
    );
  }

  const line = output.split("\n").find((l) => l.startsWith("DB_URL="));
  if (!line) {
    throw new Error("`supabase status -o env` did not report DB_URL. Is the local stack running?");
  }
  return line
    .slice("DB_URL=".length)
    .trim()
    .replace(/^"(.*)"$/, "$1");
}

/** One small pool. `asRole` reserves a connection, so keep at least two. */
export function connect(): Sql {
  return postgres(resolveDatabaseUrl(), { max: 2, onnotice: () => {} });
}

/**
 * Runs `fn` on one pinned connection with `SET ROLE <role>` active, then resets
 * the role and releases the connection. Inside `fn`, use only the `db` argument,
 * never the outer `sql`, so every statement really runs as `role`.
 */
export async function asRole<T>(
  sql: Sql,
  role: DbRole,
  fn: (db: postgres.ReservedSql) => Promise<T>,
): Promise<T> {
  const db = await sql.reserve();
  try {
    await db.unsafe(`set role ${role}`);
    return await fn(db);
  } finally {
    await db.unsafe("reset role");
    db.release();
  }
}

/** Empties both tables. `messages` goes with `chatrooms` through the cascade. */
export async function truncateAll(sql: Sql): Promise<void> {
  await sql`truncate table public.chatrooms cascade`;
}

/** The Postgres error fields the tests assert on. */
export interface PgErrorFields {
  code: string;
  message: string;
  constraint_name?: string;
}

function isPgError(error: unknown): error is Error & PgErrorFields {
  return error instanceof postgres.PostgresError;
}

/**
 * Awaits `promise`, expects it to reject with a Postgres error, and asserts the
 * SQLSTATE (`code`), optionally the violated constraint and a message pattern.
 */
export async function expectPgError(
  promise: Promise<unknown>,
  expected: { code: string; constraint?: string; message?: RegExp },
): Promise<Error & PgErrorFields> {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  if (!isPgError(caught)) {
    throw new Error(
      `Expected a PostgresError, got: ${caught === undefined ? "no error (the statement succeeded)" : String(caught)}`,
    );
  }
  expect(caught.code).toBe(expected.code);
  if (expected.constraint !== undefined) {
    expect(caught.constraint_name).toBe(expected.constraint);
  }
  if (expected.message !== undefined) {
    expect(caught.message).toMatch(expected.message);
  }
  return caught;
}
EOF
```

- [ ] **Step 5: Write the harness test**

```bash
cd /Users/calin/dev/other/wp
cat > tests/db/harness.test.ts <<'EOF'
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
EOF
```

- [ ] **Step 6: Run the harness test, lint and typecheck**

```bash
cd /Users/calin/dev/other/wp
pnpm test:db
pnpm lint && pnpm typecheck
```

Expected: `pnpm test:db` reports 1 file, 5 tests passed. Lint and typecheck exit 0.

If `pnpm test:db` fails with "Could not run `supabase status`", the stack is not running; go back to Step 1. If typecheck complains about `postgres.ReservedSql`, the installed `postgres` is older than 3.4; re-run `pnpm add -D postgres@^3.4.9`.

- [ ] **Step 7: Confirm `pnpm test` still runs without touching the database, and that `db:migrate` is wired up**

```bash
cd /Users/calin/dev/other/wp
pnpm test
mkdir -p supabase/migrations
pnpm db:migrate
```

Expected: `pnpm test` runs only `src/lib/config/parse.test.ts` (and any other `src/**` tests) and passes. `pnpm db:migrate` exits 0 and reports nothing to apply (there are no migration files yet), proving the CLI can reach the local database.

- [ ] **Step 8: Commit**

```bash
cd /Users/calin/dev/other/wp
git add package.json pnpm-lock.yaml vitest.db.config.ts tests/db/helpers.ts tests/db/harness.test.ts
git commit -m "test: add database test harness and migration scripts"
```

---

### Task 2: `chatrooms` migration

**Files:**
- Create: `supabase/migrations/20260916000100_create_chatrooms.sql`, `tests/db/chatrooms.test.ts`

**Interfaces:**
- Consumes: `connect`, `asRole`, `truncateAll`, `expectPgError`, `Sql` from `tests/db/helpers.ts`; `pnpm db:migrate`, `pnpm db:reset`, `pnpm test:db` from Task 1.
- Produces: table `public.chatrooms (id uuid, name text, lat double precision, lng double precision, created_at timestamptz)` with constraints `chatrooms_pkey`, `chatrooms_name_key` (unique name), `chatrooms_lat_lng_key` (unique (lat, lng)), `chatrooms_lat_check`, `chatrooms_lng_check`; RLS enabled; policy `chatrooms are publicly readable` (SELECT to anon); grants: anon SELECT only, authenticated nothing, service_role ALL.

- [ ] **Step 1: Write the failing test**

```bash
cd /Users/calin/dev/other/wp
cat > tests/db/chatrooms.test.ts <<'EOF'
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
    const before = Date.now();
    const room = await insertRoom({ name: "brave-crimson-otter", lat: 47.5, lng: 19.05 });

    expect(room.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(room.created_at).toBeInstanceOf(Date);
    expect(Math.abs(room.created_at.getTime() - before)).toBeLessThan(5_000);
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
EOF
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/calin/dev/other/wp
pnpm test:db tests/db/chatrooms.test.ts
```

Expected: FAIL. Every test errors in `beforeEach` with `relation "public.chatrooms" does not exist` (SQLSTATE 42P01).

- [ ] **Step 3: Write the migration**

```bash
cd /Users/calin/dev/other/wp
mkdir -p supabase/migrations
cat > supabase/migrations/20260916000100_create_chatrooms.sql <<'EOF'
-- Chatrooms: one row per map pin (PRD 6.2).
-- Constraint names are part of the API contract: the route handlers tell a
-- name collision (chatrooms_name_key -> regenerate the name) from a coordinate
-- collision (chatrooms_lat_lng_key -> 409 with the existing room). Both are
-- SQLSTATE 23505, so the name is what distinguishes them (PRD 6.3).

create table public.chatrooms (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  lat         double precision not null,
  lng         double precision not null,
  created_at  timestamptz not null default now(),
  constraint chatrooms_name_key unique (name),
  constraint chatrooms_lat_lng_key unique (lat, lng),
  constraint chatrooms_lat_check check (lat between -90 and 90),
  constraint chatrooms_lng_check check (lng between -180 and 180)
);

comment on table public.chatrooms is
  'One row per map pin. Created together with its first message by create_room_with_first_message(). Coordinates are rounded to 6 decimals by the server before insert.';

-- Row Level Security (PRD 6.1): anonymous visitors may read, never write.
alter table public.chatrooms enable row level security;

create policy "chatrooms are publicly readable"
  on public.chatrooms
  for select
  to anon
  using (true);

-- Supabase's default privileges grant anon and authenticated ALL on new tables
-- in public. Take that back: anon gets SELECT only (needed for reads and for
-- realtime RLS checks), authenticated gets nothing (no signed-in users), and
-- service_role keeps everything for the route handlers.
revoke all on table public.chatrooms from anon, authenticated;
grant select on table public.chatrooms to anon;
grant all on table public.chatrooms to service_role;
EOF
```

- [ ] **Step 4: Apply it and run the test to verify it passes**

```bash
cd /Users/calin/dev/other/wp
pnpm db:migrate
pnpm test:db tests/db/chatrooms.test.ts
```

Expected: `db:migrate` prints `Applying migration 20260916000100_create_chatrooms.sql...` and exits 0. The test file reports 16 tests passed.

If `has exactly one policy` fails because `roles` comes back as `{anon}` (a string), change the expectation to `roles: "{anon}"`; postgres.js normally parses `name[]` into a JavaScript array.

- [ ] **Step 5: Prove the migration applies from scratch, then run the whole DB suite**

```bash
cd /Users/calin/dev/other/wp
pnpm db:reset
pnpm test:db
```

Expected: `db:reset` recreates the database, applies `20260916000100_create_chatrooms.sql`, and exits 0 (a notice that `supabase/seed.sql` is missing is fine). `pnpm test:db` runs 2 files, all tests pass.

If `db:reset` leaves the stack unhealthy under Supbuddy (Studio or Kong not responding), call the MCP tool `get_supabase_status { "project_id": "f9e13085-553a-464e-b693-5b7a6d2642e4" }` and wait for it to report healthy before re-running tests. Do not restart containers by hand.

- [ ] **Step 6: Commit**

```bash
cd /Users/calin/dev/other/wp
git add supabase/migrations/20260916000100_create_chatrooms.sql tests/db/chatrooms.test.ts
git commit -m "feat(db): add chatrooms table with RLS and anon read-only grants"
```

---

### Task 3: `messages` migration, index, and realtime publication

**Files:**
- Create: `supabase/migrations/20260916000200_create_messages.sql`, `tests/db/messages.test.ts`

**Interfaces:**
- Consumes: `public.chatrooms` from Task 2 (`id` for the foreign key); helpers and scripts from Task 1.
- Produces: table `public.messages (id uuid, chatroom_id uuid, author text, text text, created_at timestamptz)` with constraints `messages_pkey`, `messages_chatroom_id_fkey` (on delete cascade), `messages_author_check`, `messages_text_check`; index `messages_room_created_idx on (chatroom_id, created_at desc, id desc)`; RLS with policy `messages are publicly readable` (SELECT to anon); grants like `chatrooms`; `public.messages` is a member of publication `supabase_realtime`.

- [ ] **Step 1: Write the failing test**

```bash
cd /Users/calin/dev/other/wp
cat > tests/db/messages.test.ts <<'EOF'
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
    const before = Date.now();
    const message = await insertMessage({ chatroomId, author: "ann", text: "hi" });
    expect(message.created_at).toBeInstanceOf(Date);
    expect(Math.abs(message.created_at.getTime() - before)).toBeLessThan(5_000);
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
EOF
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/calin/dev/other/wp
pnpm test:db tests/db/messages.test.ts
```

Expected: FAIL. The shape tests get empty results (`expected [] to deeply equal [...]`), the constraint tests fail with `relation "public.messages" does not exist`, and the publication test gets `[]`.

- [ ] **Step 3: Write the migration**

```bash
cd /Users/calin/dev/other/wp
cat > supabase/migrations/20260916000200_create_messages.sql <<'EOF'
-- Messages: posts inside a chatroom (PRD 6.2). Length limits count Unicode
-- code points with char_length(), matching [...s].length in JavaScript (PRD 4).

create table public.messages (
  id           uuid primary key default gen_random_uuid(),
  chatroom_id  uuid not null,
  author       text not null,
  text         text not null,
  created_at   timestamptz not null default now(),
  constraint messages_chatroom_id_fkey
    foreign key (chatroom_id) references public.chatrooms (id) on delete cascade,
  constraint messages_author_check check (char_length(author) between 1 and 100),
  constraint messages_text_check check (char_length(text) between 1 and 3000)
);

comment on table public.messages is
  'Messages in a chatroom. Ordered by (created_at, id); the id breaks ties for cursor pagination (PRD 6.5).';

-- Serves initial history, "before" pages and "after" catch-up, all of which
-- filter by chatroom_id and order by (created_at, id) (PRD 6.5).
create index messages_room_created_idx
  on public.messages (chatroom_id, created_at desc, id desc);

-- Row Level Security (PRD 6.1): anonymous visitors may read, never write.
-- Realtime evaluates this policy for anon subscribers of Postgres Changes.
alter table public.messages enable row level security;

create policy "messages are publicly readable"
  on public.messages
  for select
  to anon
  using (true);

revoke all on table public.messages from anon, authenticated;
grant select on table public.messages to anon;
grant all on table public.messages to service_role;

-- Realtime (PRD 6.4): Postgres Changes fan out INSERTs on messages. Supabase
-- ships the supabase_realtime publication with no tables; create it only if
-- an environment is missing it, then add messages. chatrooms is deliberately
-- not published (pins are fetched over HTTP).
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end
$$;

alter publication supabase_realtime add table public.messages;
EOF
```

- [ ] **Step 4: Apply it and run the test to verify it passes**

```bash
cd /Users/calin/dev/other/wp
pnpm db:migrate
pnpm test:db tests/db/messages.test.ts
```

Expected: `db:migrate` applies `20260916000200_create_messages.sql`. The test file reports 16 tests passed.

If the publication test finds `chatrooms` too, some earlier manual step added it; fix with `alter publication supabase_realtime drop table public.chatrooms` and re-run `pnpm db:reset` to confirm the migrations alone produce the right state.

- [ ] **Step 5: Rebuild from scratch and run everything**

```bash
cd /Users/calin/dev/other/wp
pnpm db:reset
pnpm test:db
pnpm lint && pnpm typecheck
```

Expected: `db:reset` applies both migrations in order; `pnpm test:db` runs 3 files, all pass; lint and typecheck exit 0.

- [ ] **Step 6: Commit**

```bash
cd /Users/calin/dev/other/wp
git add supabase/migrations/20260916000200_create_messages.sql tests/db/messages.test.ts
git commit -m "feat(db): add messages table, history index, RLS, and realtime publication"
```

---

### Task 4: `create_room_with_first_message` function

**Files:**
- Create: `supabase/migrations/20260916000300_create_room_with_first_message.sql`, `tests/db/create-room-with-first-message.test.ts`, `tests/db/create-room-rpc.test.ts`
- Modify: `package.json`, `pnpm-lock.yaml` (Supabase client dependency)

**Interfaces:**
- Consumes: `public.chatrooms` (Task 2), `public.messages` (Task 3), helpers and scripts (Task 1).
- Produces, for the `POST /api/rooms` route handler in a later plan:

  ```sql
  public.create_room_with_first_message(
    p_lat    double precision,
    p_lng    double precision,
    p_name   text,
    p_author text,
    p_text   text
  ) returns jsonb
  ```

  Returns `{ "room": <chatrooms row as JSON>, "message": <messages row as JSON> }`. On failure nothing is written. EXECUTE: `service_role` only. Callable through PostgREST as `rpc('create_room_with_first_message', { p_lat, p_lng, p_name, p_author, p_text })` with the service-role key.

  **Direct SQL errors:** postgres.js exposes `code` and `constraint_name`. Unique violations use `23505` with `chatrooms_name_key` or `chatrooms_lat_lng_key`. Check violations use `23514` with `messages_author_check`, `messages_text_check`, `chatrooms_lat_check`, or `chatrooms_lng_check` (normally caught by zod before the call).

  **Supabase RPC errors:** `.rpc()` returns `{ data, error }`; PostgREST errors expose `code`, `message`, `details`, and `hint`, without a separate `constraint_name`. For `23505`, extract the exact quoted constraint name from `message` and allow only these two names: `chatrooms_name_key` means generate another name and retry within the PRD limit; `chatrooms_lat_lng_key` means return 409 with the existing room. Do not branch on HTTP 409 or SQLSTATE alone, because both conflicts share them. Unknown constraints, unrecognized message formats, and other error codes follow the route's unexpected-error path (HTTP 500, preserve the draft, no name retry). This POC uses the local stack's English PostgreSQL error text; the live RPC tests must fail if that format changes. See [PostgREST errors](https://docs.postgrest.org/en/stable/references/errors.html#errors-from-postgresql) and [Supabase RPC](https://supabase.com/docs/reference/javascript/rpc).

- [ ] **Step 1: Write the failing test**

```bash
cd /Users/calin/dev/other/wp
cat > tests/db/create-room-with-first-message.test.ts <<'EOF'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { asRole, connect, expectPgError, truncateAll, type DbRole, type Sql } from "./helpers";

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

const FN_SIGNATURE =
  "public.create_room_with_first_message(double precision, double precision, text, text, text)";

interface RoomJson {
  id: string;
  name: string;
  lat: number;
  lng: number;
  created_at: string;
}

interface MessageJson {
  id: string;
  chatroom_id: string;
  author: string;
  text: string;
  created_at: string;
}

interface CreateResult {
  room: RoomJson;
  message: MessageJson;
}

interface CreateInput {
  lat: number;
  lng: number;
  name: string;
  author: string;
  text: string;
}

/** Calls directly as `role`; HTTP responses are tested in create-room-rpc.test.ts. */
async function createRoom(role: DbRole, input: CreateInput): Promise<CreateResult> {
  return asRole(sql, role, async (db) => {
    const [row] = await db<{ result: CreateResult }[]>`
      select public.create_room_with_first_message(
        ${input.lat}::double precision,
        ${input.lng}::double precision,
        ${input.name},
        ${input.author},
        ${input.text}
      ) as result`;
    return row.result;
  });
}

const valid: CreateInput = {
  lat: 47.497913,
  lng: 19.040236,
  name: "brave-crimson-otter",
  author: "ann",
  text: "hello from budapest",
};

async function countRooms(): Promise<number> {
  const [row] = await sql<{ count: number }[]>`select count(*)::int as count from public.chatrooms`;
  return row.count;
}

async function countMessages(): Promise<number> {
  const [row] = await sql<{ count: number }[]>`select count(*)::int as count from public.messages`;
  return row.count;
}

describe("create_room_with_first_message: happy path", () => {
  it("creates the room and its first message and returns both", async () => {
    const result = await createRoom("service_role", valid);

    expect(result.room).toMatchObject({
      name: "brave-crimson-otter",
      lat: 47.497913,
      lng: 19.040236,
    });
    expect(result.room.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.message).toMatchObject({
      chatroom_id: result.room.id,
      author: "ann",
      text: "hello from budapest",
    });
    expect(result.message.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(new Date(result.message.created_at).getTime()).toBeGreaterThanOrEqual(
      new Date(result.room.created_at).getTime(),
    );

    expect(await countRooms()).toBe(1);
    expect(await countMessages()).toBe(1);
  });
});

describe("create_room_with_first_message: atomicity and conflicts", () => {
  it("writes nothing when the first message is invalid", async () => {
    await expectPgError(createRoom("service_role", { ...valid, text: "" }), {
      code: "23514",
      constraint: "messages_text_check",
    });

    expect(await countRooms()).toBe(0);
    expect(await countMessages()).toBe(0);
  });

  it("writes nothing when the author is invalid", async () => {
    await expectPgError(createRoom("service_role", { ...valid, author: "" }), {
      code: "23514",
      constraint: "messages_author_check",
    });

    expect(await countRooms()).toBe(0);
  });

  it("surfaces a name collision as chatrooms_name_key and leaves the existing room untouched", async () => {
    await createRoom("service_role", valid);

    await expectPgError(
      createRoom("service_role", { ...valid, lat: 1, lng: 1, text: "second attempt" }),
      { code: "23505", constraint: "chatrooms_name_key" },
    );

    expect(await countRooms()).toBe(1);
    expect(await countMessages()).toBe(1);
  });

  it("surfaces a coordinate collision as chatrooms_lat_lng_key (the 409 rule)", async () => {
    await createRoom("service_role", valid);

    await expectPgError(
      createRoom("service_role", { ...valid, name: "calm-teal-heron", text: "same spot" }),
      { code: "23505", constraint: "chatrooms_lat_lng_key" },
    );

    expect(await countRooms()).toBe(1);
    expect(await countMessages()).toBe(1);
  });

  it("rejects out-of-range coordinates with the chatrooms checks", async () => {
    await expectPgError(createRoom("service_role", { ...valid, lat: 91 }), {
      code: "23514",
      constraint: "chatrooms_lat_check",
    });
    await expectPgError(createRoom("service_role", { ...valid, lng: -181 }), {
      code: "23514",
      constraint: "chatrooms_lng_check",
    });
    expect(await countRooms()).toBe(0);
  });
});

describe("create_room_with_first_message: privileges", () => {
  it("is SECURITY INVOKER with a pinned search_path", async () => {
    const [row] = await sql<{ prosecdef: boolean; proconfig: string[] | null }[]>`
      select prosecdef, proconfig from pg_proc
      where oid = ${FN_SIGNATURE}::regprocedure`;
    expect(row.prosecdef).toBe(false);
    expect(row.proconfig).toEqual(["search_path="]);
  });

  it("grants EXECUTE to service_role only", async () => {
    const [row] = await sql<{ anon: boolean; authenticated: boolean; service_role: boolean; acl: string }[]>`
      select
        has_function_privilege('anon', ${FN_SIGNATURE}, 'EXECUTE') as anon,
        has_function_privilege('authenticated', ${FN_SIGNATURE}, 'EXECUTE') as authenticated,
        has_function_privilege('service_role', ${FN_SIGNATURE}, 'EXECUTE') as service_role,
        coalesce(array_to_string(proacl, ','), '') as acl
      from pg_proc where oid = ${FN_SIGNATURE}::regprocedure`;

    expect(row.anon).toBe(false);
    expect(row.authenticated).toBe(false);
    expect(row.service_role).toBe(true);
    // An entry with an empty grantee ("=X/owner") would mean PUBLIC can execute.
    expect(row.acl).not.toMatch(/(^|,)=X\//);
  });

  it("refuses anon callers (the anon key must never create rooms)", async () => {
    await expectPgError(createRoom("anon", valid), {
      code: "42501",
      message: /permission denied for function create_room_with_first_message/,
    });
    expect(await countRooms()).toBe(0);
  });

  it("refuses authenticated callers", async () => {
    await expectPgError(createRoom("authenticated", valid), {
      code: "42501",
      message: /permission denied for function create_room_with_first_message/,
    });
    expect(await countRooms()).toBe(0);
  });
});
EOF
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/calin/dev/other/wp
pnpm test:db tests/db/create-room-with-first-message.test.ts
```

Expected: FAIL. Calls fail with `function public.create_room_with_first_message(double precision, double precision, text, text, text) does not exist` (SQLSTATE 42883), and the privilege tests fail resolving `::regprocedure`.

- [ ] **Step 3: Write the migration**

```bash
cd /Users/calin/dev/other/wp
cat > supabase/migrations/20260916000300_create_room_with_first_message.sql <<'EOF'
-- Atomic room creation (PRD 6.3): the room row and its first message are
-- inserted in one function call, so a failure on either leaves nothing behind.
--
-- The function deliberately does NOT catch unique violations. The route
-- handler inspects the violated constraint name on SQLSTATE 23505:
--   chatrooms_name_key     -> generate a new name and retry (up to 5 times)
--   chatrooms_lat_lng_key  -> 409 Conflict with the existing room
-- Coordinates are rounded to 6 decimals by the server before calling this.

create function public.create_room_with_first_message(
  p_lat    double precision,
  p_lng    double precision,
  p_name   text,
  p_author text,
  p_text   text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_room    public.chatrooms;
  v_message public.messages;
begin
  insert into public.chatrooms (name, lat, lng)
  values (p_name, p_lat, p_lng)
  returning * into v_room;

  insert into public.messages (chatroom_id, author, text)
  values (v_room.id, p_author, p_text)
  returning * into v_message;

  return jsonb_build_object(
    'room', to_jsonb(v_room),
    'message', to_jsonb(v_message)
  );
end;
$$;

comment on function public.create_room_with_first_message(double precision, double precision, text, text, text) is
  'Creates a chatroom and its first message atomically. Returns {"room": ..., "message": ...}. Executable by service_role only.';

-- PRD 6.1: no privileged write function may be publicly executable. Supabase's
-- default privileges grant EXECUTE on new public functions to anon,
-- authenticated and service_role; PUBLIC has EXECUTE on every function by
-- default in Postgres. Revoke all of them, then grant service_role alone.
revoke execute on function public.create_room_with_first_message(double precision, double precision, text, text, text)
  from public, anon, authenticated;
grant execute on function public.create_room_with_first_message(double precision, double precision, text, text, text)
  to service_role;
EOF
```

- [ ] **Step 4: Apply it and run the test to verify it passes**

```bash
cd /Users/calin/dev/other/wp
pnpm db:migrate
pnpm test:db tests/db/create-room-with-first-message.test.ts
```

Expected: `db:migrate` applies `20260916000300_create_room_with_first_message.sql`. The test file reports 10 tests passed.

If `is SECURITY INVOKER with a pinned search_path` fails on `proconfig`, print the actual value (`select proconfig from pg_proc where proname = 'create_room_with_first_message'`); Postgres stores `set search_path = ''` as `search_path=`. Adjust only the expectation string, never remove the `set search_path`.

- [ ] **Step 5: Verify the conflict contract through the real Supabase RPC client**

Install the client as a runtime dependency, also consumed by the later route handlers:

```bash
cd /Users/calin/dev/other/wp
pnpm add @supabase/supabase-js@^2
```

Create `tests/db/create-room-rpc.test.ts`. Use `createClient` from `@supabase/supabase-js` and the existing `connect`, `truncateAll`, and `Sql` helpers. In `beforeAll`, run `supabase status -o env` through `execFileSync` with captured stdout and suppressed stderr, as in Task 1. Parse `API_URL` and `SERVICE_ROLE_KEY`, splitting each assignment at its first `=` and removing enclosing double quotes. Reject missing or empty values with an error naming only the missing variable; never print the CLI output or key. Vitest does not automatically load `.env.local`, so do not depend on it here. Initialize the client with `auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }`. Use `connect()` for database assertions, `truncateAll(sql)` before each test, and close that pool in `afterAll`.

Every integration call must use `client.rpc('create_room_with_first_message', { p_lat, p_lng, p_name, p_author, p_text })` against the running local API. Inspect its returned `error`; do not pass the response to the direct-SQL `expectPgError` helper. No network mocks or skipped tests when the stack is unavailable. Bound requests with `.abortSignal(AbortSignal.timeout(10_000))`.

Use the following contract classifier inside the test file. The later API plan must use this same behavior in its route error handling; production route code is still out of scope here:

```ts
type RoomConflict = "name" | "coordinates";

function classifyRoomConflict(
  error: { code: string; message: string } | null,
): RoomConflict | undefined {
  if (error?.code !== "23505") return undefined;
  const constraint = /^duplicate key value violates unique constraint "([^"]+)"$/.exec(
    error.message,
  )?.[1];
  if (constraint === "chatrooms_name_key") return "name";
  if (constraint === "chatrooms_lat_lng_key") return "coordinates";
  return undefined;
}
```

Write these five tests with deterministic coordinates and names:

1. **Successful RPC creation:** assert `error === null`, both returned row shapes, matching room/message IDs, and exactly one persisted room and its first message. Assert the returned IDs match the persisted rows.
2. **Name collision over HTTP:** first create a valid room through RPC and assert success. Capture both tables' rows. Call again with the same name, different coordinates and different message text. Require HTTP status 409, `data === null`, `error.code === "23505"`, an error with `message`, `details`, and `hint` but no `constraint_name` property, and `classifyRoomConflict(error) === "name"`. Assert both tables still exactly match the captured rows, including the winning first message.
3. **Coordinate collision over HTTP:** repeat with the same coordinates and a different name. Require the same error shape and status, but classification `"coordinates"`. Assert both tables remain identical to the successful first call's snapshot; the losing message must not be inserted into the existing room.
4. **Atomic rollback through RPC:** on an empty database, call with valid room fields and an empty first-message text. Require `data === null`, `error.code === "23514"`, classification `undefined`, and zero rows in both tables. This exercises failure after the room insertion inside the function.
5. **Unrecognized errors:** assert classification `undefined` for `null`, a non-23505 error containing a recognized constraint name, a 23505 message naming another constraint, and a 23505 message that mentions a recognized name without the expected constraint-error format. These must never trigger a name retry or a coordinate-conflict response.

For snapshots, query all columns from each table ordered by `id`, and compare plain row arrays. Keep the SQL function unchanged: the new checks validate its existing behavior through the HTTP boundary.

```bash
pnpm exec vitest list --config vitest.db.config.ts --filesOnly tests/db/create-room-rpc.test.ts
pnpm test:db tests/db/create-room-rpc.test.ts
```

Expected: file selection prints only `tests/db/create-room-rpc.test.ts`; five tests pass. A `PGRST202` response means the function is not visible in PostgREST's schema cache: verify the migration was applied to this project's database, request a reload with `NOTIFY pgrst, 'reload schema'` if necessary, then rerun the suite. Do not mask a schema-cache error as a conflict or add automatic write retries.

- [ ] **Step 6: Rebuild from scratch and run everything**

```bash
cd /Users/calin/dev/other/wp
pnpm db:reset
pnpm test:db
pnpm lint && pnpm typecheck
```

Expected: `db:reset` applies all three migrations in order; `pnpm test:db` runs 5 files, including the RPC contract suite, all tests pass; lint and typecheck exit 0.

- [ ] **Step 7: Commit**

```bash
cd /Users/calin/dev/other/wp
git add supabase/migrations/20260916000300_create_room_with_first_message.sql tests/db/create-room-with-first-message.test.ts tests/db/create-room-rpc.test.ts package.json pnpm-lock.yaml
git commit -m "feat(db): add atomic create_room_with_first_message function"
```

---

### Task 5: README section and final verification

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: everything above.
- Produces: developer documentation for the database workflow; a verified clean state.

- [ ] **Step 1: Add a Database section to the README**

Append the section (the scaffolding plan's Task 6 rewrites the rest of the README; this section is self-contained and survives that rewrite if it is kept as-is):

```bash
cd /Users/calin/dev/other/wp
cat >> README.md <<'EOF'

## Database

The schema lives in `supabase/migrations/` as plain SQL, applied to the Supbuddy-managed local
Supabase stack with the Supabase CLI. Start and stop the stack through Supbuddy (app or MCP
`start_supabase` / `stop_supabase`), not with `supabase start`.

| Command           | What it does                                                          |
| ----------------- | --------------------------------------------------------------------- |
| `pnpm db:migrate` | Applies migrations not yet applied to the local database              |
| `pnpm db:reset`   | Drops and rebuilds the local database from all migrations             |
| `pnpm test:db`    | Runs the database tests in `tests/db/` against the local stack        |

`pnpm test` does not touch the database; `pnpm test:db` needs the stack running. The tests connect
with `DATABASE_URL` if set, otherwise with the `DB_URL` reported by `supabase status -o env`.
The RPC contract tests also read `API_URL` and `SERVICE_ROLE_KEY` from that CLI command and call
the local API through Supabase’s client. Any `DATABASE_URL` override must refer to the same project.

Schema summary (see `docs/PRD.md` section 6):

- `chatrooms` and `messages` have Row Level Security enabled. `anon` may only SELECT; there are no
  anon write grants or policies. `service_role` (used by the route handlers) has full access.
- `messages` is in the `supabase_realtime` publication for Postgres Changes.
- `create_room_with_first_message(p_lat, p_lng, p_name, p_author, p_text)` inserts a room and its
  first message atomically and returns `{"room", "message"}`. Only `service_role` may execute it.
  Direct SQL errors include `constraint_name`. RPC errors expose the name inside `message`:
  after checking `code === "23505"`, extract the exact quoted constraint name and recognize only
  `chatrooms_name_key` (retry with a new name) or `chatrooms_lat_lng_key` (a room already exists
  at that spot). Unrecognized errors follow the unexpected-error path without a name retry.
EOF
tail -30 README.md
```

- [ ] **Step 2: Full verification from a clean database**

```bash
cd /Users/calin/dev/other/wp
pnpm db:reset
pnpm test:db
pnpm test
pnpm lint && pnpm typecheck
supabase migration list --local
git status --short
```

Expected:
- `db:reset` applies the three migrations in order and exits 0.
- `pnpm test:db`: 5 files, all tests pass, including the five RPC contract tests.
- `pnpm test`: passes without the database (only `src/**` tests).
- lint and typecheck exit 0.
- `supabase migration list --local` shows `20260916000100`, `20260916000200`, `20260916000300` as applied locally.
- `git status --short` shows only `README.md` modified. If `supabase/.temp/` or `*.supbuddy-backup-*` files appear, they must be git-ignored (scaffolding Task 5 wrote `supabase/.gitignore`); do not commit them.

- [ ] **Step 3: Commit**

```bash
cd /Users/calin/dev/other/wp
git add README.md
git commit -m "docs: describe database migrations and tests"
```

---

## Self-review notes

- **Spec coverage.** PRD §6.2 tables, index, constraints: Tasks 2 and 3. §6.1 RLS, anon SELECT-only, no write grants, function SECURITY INVOKER with EXECUTE only for service_role: Tasks 2, 3, 4. §6.3 atomic creation and constraint-name discrimination: Task 4. §6.4 realtime publication on `messages`: Task 3. §4 code-point length rules and coordinate ranges: Tasks 2 and 3 (astral-character tests). §8 "anonymous reads allowed, anonymous writes and function execution fail": Tasks 2, 3, 4. The request's "migrations apply locally": `pnpm db:migrate` and `pnpm db:reset` are exercised in every task.
- **Out of this plan's scope.** Route handlers, name generation with retry, cursor queries, and the concurrent-creation integration test from PRD §8 belong to the API plan; they consume the function signature and constraint names produced here. The "via MCP" application path is not available with the currently configured MCP servers (see Assumptions).
- **Type consistency.** `asRole(sql, role, fn)` and `expectPgError(promise, { code, constraint, message })` are used with the same signatures in Tasks 2 to 4. Constraint names in the migrations match the test expectations and the function's documented contract exactly.
- **RPC boundary (F-002).** Task 4 separately specifies postgres.js diagnostics and PostgREST errors. The real Supabase client tests cover successful creation, exact constraint extraction for each conflict, and rollback on invalid input. Unknown errors are never classified from SQLSTATE alone. The later API plan consumes this contract for name retry versus coordinate-conflict handling.
