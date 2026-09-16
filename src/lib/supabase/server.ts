import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { getServerConfig } from "@/lib/config/server";

/**
 * A Supabase client authenticated with the service-role key, for route handlers
 * (PRD 6.1). It bypasses Row Level Security, so it must never reach the browser;
 * the `server-only` import turns a client-side import into a build error.
 * Create one per request. It keeps no session: the app has no signed-in users.
 */
export function createServiceClient(): SupabaseClient {
  const { supabaseUrl, supabaseServiceRoleKey } = getServerConfig();
  return createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
