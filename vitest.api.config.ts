import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// Route-handler tests. They import the handlers through the `@` alias, call
// them with `new Request(...)`, and need the local Supabase stack (service-role
// client, real tables). Kept out of `pnpm test` (src/** only) and
// `pnpm test:db` (tests/db/** only). Run with: pnpm test:api
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/api/**/*.test.ts"],
    setupFiles: ["tests/api/setup-env.ts"],
    // Files share one database and truncate between tests: never in parallel.
    fileParallelism: false,
    testTimeout: 15_000,
    hookTimeout: 60_000,
  },
});
