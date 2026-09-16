import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { connect, truncateAll, type Sql } from "../db/helpers";

export { connect, truncateAll, type Sql };

/** A service-role client for seeding rows directly, bypassing the handlers under test. */
export function serviceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("tests/api/setup-env.ts did not populate the environment");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/**
 * A Request for a handler under test. `path` starts with "/api/". An object
 * `body` is sent as JSON; a string `body` is sent verbatim (malformed cases).
 */
export function apiRequest(
  path: string,
  init: { method?: "GET" | "POST"; body?: unknown } = {},
): Request {
  const hasBody = init.body !== undefined;
  return new Request(`http://localhost${path}`, {
    method: init.method ?? "GET",
    headers: hasBody
      ? { accept: "application/json", "content-type": "application/json" }
      : { accept: "application/json" },
    body: !hasBody ? undefined : typeof init.body === "string" ? init.body : JSON.stringify(init.body),
  });
}

/** The second argument of a `[id]` route handler (Next 15+: `params` is a Promise). */
export function routeParams(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}
