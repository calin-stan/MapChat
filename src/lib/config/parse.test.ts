import { describe, expect, it } from "vitest";

import { ConfigError, parseClientConfig, parseServerConfig } from "@/lib/config/parse";

const validClientEnv = {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
};

describe("parseClientConfig", () => {
  it("applies defaults when optional variables are absent", () => {
    const config = parseClientConfig(validClientEnv);

    expect(config).toEqual({
      supabaseUrl: "http://127.0.0.1:54321",
      supabaseAnonKey: "anon-key",
      pollIntervalMs: 30000,
      realtimeIdleTimeoutMs: 180000,
    });
  });

  it("parses numeric overrides", () => {
    const config = parseClientConfig({
      ...validClientEnv,
      NEXT_PUBLIC_POLL_INTERVAL_MS: "5000",
      NEXT_PUBLIC_REALTIME_IDLE_TIMEOUT_MS: "60000",
    });

    expect(config.pollIntervalMs).toBe(5000);
    expect(config.realtimeIdleTimeoutMs).toBe(60000);
  });

  it("treats a blank optional value as unset", () => {
    const config = parseClientConfig({
      ...validClientEnv,
      NEXT_PUBLIC_POLL_INTERVAL_MS: "",
    });

    expect(config.pollIntervalMs).toBe(30000);
  });

  it("trims surrounding whitespace from values", () => {
    const config = parseClientConfig({
      ...validClientEnv,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "  anon-key  ",
      NEXT_PUBLIC_POLL_INTERVAL_MS: " 5000 ",
    });

    expect(config.supabaseAnonKey).toBe("anon-key");
    expect(config.pollIntervalMs).toBe(5000);
  });

  it("ignores unrelated variables and never exposes server secrets", () => {
    const config = parseClientConfig({
      ...validClientEnv,
      SUPABASE_SERVICE_ROLE_KEY: "service-key",
      HISTORY_PAGE_SIZE: "7",
    });

    expect(Object.keys(config).sort()).toEqual([
      "pollIntervalMs",
      "realtimeIdleTimeoutMs",
      "supabaseAnonKey",
      "supabaseUrl",
    ]);
    expect(JSON.stringify(config)).not.toContain("service-key");
  });
});

describe("parseClientConfig errors", () => {
  it("throws a ConfigError listing every missing required variable", () => {
    expect(() => parseClientConfig({})).toThrow(ConfigError);
    expect(() => parseClientConfig({})).toThrow(
      /NEXT_PUBLIC_SUPABASE_URL[\s\S]*NEXT_PUBLIC_SUPABASE_ANON_KEY/,
    );
  });

  it("treats a blank required value as missing", () => {
    expect(() =>
      parseClientConfig({ ...validClientEnv, NEXT_PUBLIC_SUPABASE_ANON_KEY: "   " }),
    ).toThrow(/NEXT_PUBLIC_SUPABASE_ANON_KEY: is required/);
  });

  it("rejects a Supabase URL that is not a URL", () => {
    expect(() =>
      parseClientConfig({ ...validClientEnv, NEXT_PUBLIC_SUPABASE_URL: "not a url" }),
    ).toThrow(/NEXT_PUBLIC_SUPABASE_URL: must be a valid URL/);
  });

  it.each(["localhost:54321", "javascript:alert(1)", "ftp://x"])(
    "rejects a Supabase URL with a non-http(s) protocol: %j",
    (value) => {
      expect(() =>
        parseClientConfig({ ...validClientEnv, NEXT_PUBLIC_SUPABASE_URL: value }),
      ).toThrow(/NEXT_PUBLIC_SUPABASE_URL: must be a valid URL/);
    },
  );

  it("strips a trailing slash from the Supabase URL", () => {
    const config = parseClientConfig({
      ...validClientEnv,
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321/",
    });

    expect(config.supabaseUrl).toBe("http://127.0.0.1:54321");
  });

  it.each(["abc", "0", "-5", "1.5", "1e3"])(
    "rejects poll interval %j because it is not a positive integer",
    (value) => {
      expect(() =>
        parseClientConfig({ ...validClientEnv, NEXT_PUBLIC_POLL_INTERVAL_MS: value }),
      ).toThrow(/NEXT_PUBLIC_POLL_INTERVAL_MS: must be a positive integer/);
    },
  );

  it("reports several problems in one error", () => {
    expect(() =>
      parseClientConfig({
        NEXT_PUBLIC_SUPABASE_URL: "nope",
        NEXT_PUBLIC_POLL_INTERVAL_MS: "x",
      }),
    ).toThrow(
      /NEXT_PUBLIC_SUPABASE_URL[\s\S]*NEXT_PUBLIC_SUPABASE_ANON_KEY[\s\S]*NEXT_PUBLIC_POLL_INTERVAL_MS/,
    );
  });
});

describe("parseServerConfig", () => {
  const validServerEnv = {
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
  };

  it("applies defaults when optional variables are absent", () => {
    const config = parseServerConfig(validServerEnv);

    expect(config).toEqual({
      supabaseUrl: "http://127.0.0.1:54321",
      supabaseServiceRoleKey: "service-key",
      historyInitialSize: 100,
      historyPageSize: 20,
    });
  });

  it("parses numeric overrides", () => {
    const config = parseServerConfig({
      ...validServerEnv,
      HISTORY_INITIAL_SIZE: "50",
      HISTORY_PAGE_SIZE: "10",
    });

    expect(config.historyInitialSize).toBe(50);
    expect(config.historyPageSize).toBe(10);
  });

  it("throws a ConfigError listing every missing required variable", () => {
    expect(() => parseServerConfig({})).toThrow(ConfigError);
    expect(() => parseServerConfig({})).toThrow(
      /NEXT_PUBLIC_SUPABASE_URL[\s\S]*SUPABASE_SERVICE_ROLE_KEY/,
    );
  });

  it("rejects a non-positive page size", () => {
    expect(() =>
      parseServerConfig({ ...validServerEnv, HISTORY_PAGE_SIZE: "0" }),
    ).toThrow(/HISTORY_PAGE_SIZE: must be a positive integer/);
  });

  it("does not require the anon key", () => {
    expect(() => parseServerConfig(validServerEnv)).not.toThrow();
  });

  it("strips a trailing slash from the Supabase URL", () => {
    const config = parseServerConfig({
      ...validServerEnv,
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321/",
    });

    expect(config.supabaseUrl).toBe("http://127.0.0.1:54321");
  });
});
