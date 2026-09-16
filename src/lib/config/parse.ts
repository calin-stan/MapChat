import { z } from "zod";

/** A plain view of environment variables. `process.env` satisfies it. */
export type Env = Record<string, string | undefined>;

/** Thrown when required configuration is missing or malformed. Lists every problem at once. */
export class ConfigError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(
      `Invalid environment configuration:\n${issues.map((issue) => `  ${issue}`).join("\n")}`,
    );
    this.name = "ConfigError";
    this.issues = issues;
  }
}

/** Undefined or blank values count as "not set". Everything else is trimmed. */
const optionalString = z
  .string()
  .optional()
  .transform((value) => {
    if (value === undefined) return undefined;
    const trimmed = value.trim();
    return trimmed === "" ? undefined : trimmed;
  });

const requiredString = optionalString.pipe(z.string({ error: "is required" }));

const requiredUrl = requiredString
  .pipe(z.url({ protocol: /^https?$/, error: "must be a valid URL" }))
  .transform((value) => value.replace(/\/+$/, ""));

const positiveIntWithDefault = (fallback: number) =>
  optionalString.transform((value, ctx) => {
    if (value === undefined) return fallback;
    if (!/^\d+$/.test(value) || Number(value) < 1) {
      ctx.addIssue({
        code: "custom",
        message: `must be a positive integer, got "${value}"`,
      });
      return z.NEVER;
    }
    return Number(value);
  });

/** Leave one sentinel row under the minimum supported PostgREST max_rows of 1000. */
export const HISTORY_MAX_SIZE = 999;

const historySizeWithDefault = (fallback: number) =>
  positiveIntWithDefault(fallback).refine(
    (value) => Number.isSafeInteger(value) && value <= HISTORY_MAX_SIZE,
    { error: `must be at most ${HISTORY_MAX_SIZE}` },
  );

function parseWith<T>(schema: z.ZodType<T>, env: Env): T {
  const result = schema.safeParse(env);
  if (!result.success) {
    throw new ConfigError(
      result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    );
  }
  return result.data;
}

// ---------------------------------------------------------------------------
// Client configuration (PRD §6.6, scope "client" and "client + server")
// ---------------------------------------------------------------------------

const clientEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: requiredUrl,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: requiredString,
  NEXT_PUBLIC_POLL_INTERVAL_MS: positiveIntWithDefault(30_000),
  NEXT_PUBLIC_REALTIME_IDLE_TIMEOUT_MS: positiveIntWithDefault(180_000),
});

export type ClientConfig = {
  supabaseUrl: string;
  supabaseAnonKey: string;
  pollIntervalMs: number;
  realtimeIdleTimeoutMs: number;
};

/**
 * Parse the browser-safe configuration. Pure: reads only from `env`.
 * Throws {@link ConfigError} listing every invalid or missing variable.
 */
export function parseClientConfig(env: Env): ClientConfig {
  const parsed = parseWith(clientEnvSchema, env);
  return {
    supabaseUrl: parsed.NEXT_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: parsed.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    pollIntervalMs: parsed.NEXT_PUBLIC_POLL_INTERVAL_MS,
    realtimeIdleTimeoutMs: parsed.NEXT_PUBLIC_REALTIME_IDLE_TIMEOUT_MS,
  };
}

// ---------------------------------------------------------------------------
// Server configuration (PRD §6.6, scope "server only" and "client + server")
// ---------------------------------------------------------------------------

const serverEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: requiredUrl,
  SUPABASE_SERVICE_ROLE_KEY: requiredString,
  HISTORY_INITIAL_SIZE: historySizeWithDefault(100),
  HISTORY_PAGE_SIZE: historySizeWithDefault(20),
});

export type ServerConfig = {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  historyInitialSize: number;
  historyPageSize: number;
};

/**
 * Parse the server-only configuration. Pure: reads only from `env`.
 * Throws {@link ConfigError} listing every invalid or missing variable.
 * Never import the result into client components; use `server.ts`.
 */
export function parseServerConfig(env: Env): ServerConfig {
  const parsed = parseWith(serverEnvSchema, env);
  return {
    supabaseUrl: parsed.NEXT_PUBLIC_SUPABASE_URL,
    supabaseServiceRoleKey: parsed.SUPABASE_SERVICE_ROLE_KEY,
    historyInitialSize: parsed.HISTORY_INITIAL_SIZE,
    historyPageSize: parsed.HISTORY_PAGE_SIZE,
  };
}
