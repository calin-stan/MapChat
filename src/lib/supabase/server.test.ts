import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createClient } = vi.hoisted(() => ({
  createClient: vi.fn<(...args: unknown[]) => unknown>(() => ({ kind: "fake-client" })),
}));

vi.mock("@supabase/supabase-js", () => ({ createClient }));

const NO_SESSION = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false };

beforeEach(() => {
  // Configuration is memoised per module instance, so each test imports fresh.
  vi.resetModules();
  createClient.mockClear();
  // The real `server-only` throws outside a React Server build. Stub it here;
  // the last test removes the stub to prove the guard is in place.
  vi.doMock("server-only", () => ({}));
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321/");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", undefined);
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("createServiceClient", () => {
  it("creates a client with the service-role key and no session handling", async () => {
    const { createServiceClient } = await import("@/lib/supabase/server");

    expect(createServiceClient()).toEqual({ kind: "fake-client" });
    expect(createClient).toHaveBeenCalledTimes(1);
    expect(createClient).toHaveBeenCalledWith("http://127.0.0.1:54321", "service-key", {
      auth: NO_SESSION,
    });
  });

  it("creates a new client on every call", async () => {
    const { createServiceClient } = await import("@/lib/supabase/server");

    createServiceClient();
    createServiceClient();

    expect(createClient).toHaveBeenCalledTimes(2);
  });

  it("throws a configuration error naming the missing service-role key", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", undefined);
    const { createServiceClient } = await import("@/lib/supabase/server");

    expect(() => createServiceClient()).toThrow(/SUPABASE_SERVICE_ROLE_KEY: is required/);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("cannot be imported outside server code", async () => {
    vi.doUnmock("server-only");

    await expect(import("@/lib/supabase/server")).rejects.toThrow(/Client Component/);
  });
});
