/**
 * Validates the full environment configuration once at server startup, so a
 * misconfigured deployment fails fast instead of surfacing lazily on first
 * request (see docs/superpowers/plans/2026-09-16-scaffolding-and-config-feedback.md,
 * item 1). The client and server accessors in `@/lib/config/{client,server}`
 * remain memoised and still validate lazily on first use; this only adds an
 * eager check at boot so failures are visible immediately.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { parseClientConfig, parseServerConfig, ConfigError } = await import(
    "@/lib/config/parse"
  );

  const issues: string[] = [];
  for (const parse of [parseClientConfig, parseServerConfig] as const) {
    try {
      parse(process.env);
    } catch (error) {
      if (!(error instanceof ConfigError)) throw error;
      issues.push(...error.issues);
    }
  }

  if (issues.length > 0) {
    throw new ConfigError([...new Set(issues)]);
  }
}
