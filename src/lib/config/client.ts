import { parseClientConfig, type ClientConfig } from "@/lib/config/parse";

let cached: ClientConfig | undefined;

/**
 * Browser-safe configuration, parsed once per process on first use.
 *
 * Every `process.env.NEXT_PUBLIC_*` below is written out literally on purpose:
 * Next.js inlines these into the browser bundle at build time by static
 * substitution. Looping over keys or spreading `process.env` would leave them
 * undefined in the browser. Do not "simplify" this into a loop.
 */
export function getClientConfig(): ClientConfig {
  cached ??= parseClientConfig({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_POLL_INTERVAL_MS: process.env.NEXT_PUBLIC_POLL_INTERVAL_MS,
    NEXT_PUBLIC_REALTIME_IDLE_TIMEOUT_MS: process.env.NEXT_PUBLIC_REALTIME_IDLE_TIMEOUT_MS,
  });
  return cached;
}
