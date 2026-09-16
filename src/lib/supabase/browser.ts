import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { getClientConfig } from "@/lib/config/client";

let client: SupabaseClient | undefined;

/**
 * The browser's only Supabase client: anon key, used for Realtime subscriptions
 * (PRD 6.1, 6.4). Memoised, so every open room shares one websocket connection
 * against the project-wide connection limit. It keeps no session and never
 * writes: all writes go through the route handlers.
 *
 * Call it from effects or event handlers in client components, not during
 * render, so server rendering does not create a client on the server.
 */
export function getBrowserClient(): SupabaseClient {
  if (client === undefined) {
    const { supabaseUrl, supabaseAnonKey } = getClientConfig();
    client = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  }
  return client;
}
