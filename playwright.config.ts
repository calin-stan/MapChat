import { defineConfig, devices } from "@playwright/test";

// The Supbuddy mapping of this project's dev server. Override for CI or another port.
const baseURL = process.env.E2E_BASE_URL ?? "https://map-chat.map-chat.test";

/**
 * End-to-end tests (room-panel design §8): real layout, real scrolling and the
 * full HTTP path, against the dev server and the local Supabase stack.
 * Run with `pnpm test:e2e`; not part of `pnpm test`.
 */
export default defineConfig({
  testDir: "tests/e2e",
  // Every test creates its own room, so files and tests may run in parallel.
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  reporter: "list",
  timeout: process.env.E2E_SLOW_SETUP === "1" ? 120_000 : 60_000,
  use: {
    baseURL,
    ignoreHTTPSErrors: true, // the Supbuddy certificate is local
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      // The explicit viewport comes last, so a device preset can never change it.
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 720 } },
    },
  ],
  webServer: {
    // Next 16 allows one dev server per project directory: a running one is reused.
    command: "pnpm dev",
    url: `${baseURL}/api/health`,
    ignoreHTTPSErrors: true,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
