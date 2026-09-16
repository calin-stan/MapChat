import { execFileSync } from "node:child_process";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { expect } from "vitest";

export type Sql = ReturnType<typeof postgres>;

/** The Supabase API roles PostgREST switches to per request. */
export type DbRole = "anon" | "authenticated" | "service_role";

/**
 * `supabase status -o env` as a map. The CLI reads the Supbuddy-rewritten
 * `supabase/config.toml`, so it reports this project's ports and keys. The
 * output is never logged: it contains the service-role key.
 */
function supabaseStatusEnv(): Map<string, string> {
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

  const values = new Map<string, string>();
  for (const line of output.split("\n")) {
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    values.set(
      line.slice(0, eq).trim(),
      line
        .slice(eq + 1)
        .trim()
        .replace(/^"(.*)"$/, "$1"),
    );
  }
  return values;
}

function statusValue(values: Map<string, string>, key: string): string {
  const value = values.get(key);
  if (!value) {
    throw new Error(`\`supabase status -o env\` did not report ${key}. Is the local stack running?`);
  }
  return value;
}

/**
 * Connection string for the local Supabase database.
 * `DATABASE_URL` wins when set. Otherwise ask the Supabase CLI.
 */
export function resolveDatabaseUrl(): string {
  const fromEnv = process.env.DATABASE_URL?.trim();
  if (fromEnv) return fromEnv;
  return statusValue(supabaseStatusEnv(), "DB_URL");
}

/** The local API URL and keys, for tests that go through PostgREST or the route handlers. */
export interface SupabaseApi {
  apiUrl: string;
  anonKey: string;
  serviceRoleKey: string;
}

export function resolveSupabaseApi(): SupabaseApi {
  const values = supabaseStatusEnv();
  return {
    apiUrl: statusValue(values, "API_URL"),
    anonKey: statusValue(values, "ANON_KEY"),
    serviceRoleKey: statusValue(values, "SERVICE_ROLE_KEY"),
  };
}

/** A supabase-js client for the local API with `key`, keeping no session (the app has no sign-in). */
export function createApiClient(apiUrl: string, key: string): SupabaseClient {
  return createClient(apiUrl, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
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
    try {
      await db.unsafe("reset role");
    } finally {
      db.release();
    }
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
