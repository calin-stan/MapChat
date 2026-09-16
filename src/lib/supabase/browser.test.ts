import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createClient } = vi.hoisted(() => ({
  createClient: vi.fn<(...args: unknown[]) => unknown>(() => ({ kind: "fake-client" })),
}));

vi.mock("@supabase/supabase-js", () => ({ createClient }));

const NO_SESSION = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false };

beforeEach(() => {
  // The client and the configuration are memoised per module instance.
  vi.resetModules();
  createClient.mockClear();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getBrowserClient", () => {
  it("creates a client with the anon key and no session handling", async () => {
    const { getBrowserClient } = await import("@/lib/supabase/browser");

    expect(getBrowserClient()).toEqual({ kind: "fake-client" });
    expect(createClient).toHaveBeenCalledWith("http://127.0.0.1:54321", "anon-key", {
      auth: NO_SESSION,
    });
  });

  it("returns the same client on every call", async () => {
    const { getBrowserClient } = await import("@/lib/supabase/browser");

    expect(getBrowserClient()).toBe(getBrowserClient());
    expect(createClient).toHaveBeenCalledTimes(1);
  });

  it("never passes the service-role key, even when it is in the environment", async () => {
    const { getBrowserClient } = await import("@/lib/supabase/browser");

    getBrowserClient();

    expect(JSON.stringify(createClient.mock.calls)).not.toContain("service-key");
  });

  it("throws a configuration error naming the missing anon key", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", undefined);
    const { getBrowserClient } = await import("@/lib/supabase/browser");

    expect(() => getBrowserClient()).toThrow(/NEXT_PUBLIC_SUPABASE_ANON_KEY: is required/);
    expect(createClient).not.toHaveBeenCalled();
  });
});
