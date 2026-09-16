import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// Database tests. They need the local Supabase stack, so they are kept out of
// the default `pnpm test` run (vitest.config.ts only includes src/**).
// Run with: pnpm test:db
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
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
