import "server-only";

import { parseServerConfig, type ServerConfig } from "@/lib/config/parse";

let cached: ServerConfig | undefined;

/**
 * Server-only configuration, parsed once per process on first use.
 * The `server-only` import makes any client-component import a build error,
 * which is what keeps the service-role key out of the browser bundle.
 */
export function getServerConfig(): ServerConfig {
  cached ??= parseServerConfig(process.env);
  return cached;
}
