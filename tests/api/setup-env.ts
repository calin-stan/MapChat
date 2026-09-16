import { execFileSync } from "node:child_process";

/**
 * Points the route handlers at the local Supabase stack. `getServerConfig()`
 * reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from
 * process.env on first use; fill them (and the anon key) from
 * `supabase status -o env` unless the shell already set them. Vitest runs this
 * before every test file (setupFiles). Never logs the CLI output or the keys.
 */
const SOURCE = {
  NEXT_PUBLIC_SUPABASE_URL: "API_URL",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "ANON_KEY",
  SUPABASE_SERVICE_ROLE_KEY: "SERVICE_ROLE_KEY",
} as const;

type Target = keyof typeof SOURCE;

function readStatus(): Map<string, string> {
  let output: string;
  try {
    output = execFileSync("supabase", ["status", "-o", "env"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    throw new Error(
      "Could not run `supabase status`. Is the local stack running? Start it through Supbuddy (start_supabase).",
    );
  }
  const values = new Map<string, string>();
  for (const line of output.split("\n")) {
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    values.set(
      line.slice(0, eq).trim(),
      line
        .slice(eq + 1)
        .trim()
        .replace(/^"(.*)"$/, "$1"),
    );
  }
  return values;
}

const missing = (Object.keys(SOURCE) as Target[]).filter((name) => !process.env[name]?.trim());

if (missing.length > 0) {
  const status = readStatus();
  for (const name of missing) {
    const value = status.get(SOURCE[name]);
    if (!value) {
      throw new Error(
        `\`supabase status -o env\` did not report ${SOURCE[name]}. Is the local stack running?`,
      );
    }
    process.env[name] = value;
  }
}
