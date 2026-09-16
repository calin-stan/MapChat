# Scaffolding and Config Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Map Chat repository: a Next.js 16 app with TypeScript, Tailwind, shadcn/ui, react-icons and Vitest, registered with Supbuddy, a local Supabase stack managed by Supbuddy, and the startup configuration parser from PRD section 6.6 with unit tests.

**Architecture:** The app is a standard App Router project under `src/`. The project is registered with Supbuddy in thin isolation, so it gets its own loopback IP, its own Supabase port block, and Caddy domains; the dev server is started through `supbuddy run` and Supabase through Supbuddy's MCP tools. Configuration is parsed once per process by pure functions (`parseClientConfig`, `parseServerConfig`) built on zod, wrapped by lazy memoised accessors (`getClientConfig`, `getServerConfig`). The client accessor references every `process.env.NEXT_PUBLIC_*` variable literally so Next.js can inline it into the browser bundle; the server accessor is guarded by `server-only`. A tiny `/api/health` route handler is the end-to-end proof that the dev server, config parsing, and the Supabase stack all work together.

**Tech Stack:** Next.js 16 (App Router, Node.js runtime), React 19, TypeScript, Tailwind CSS 4, shadcn/ui, react-icons, zod 4, Vitest 5, Supabase CLI 2.x driven by Supbuddy (thin isolation), pnpm.

**Spec:** `docs/PRD.md` (sections 5, 6.1, 6.6, 8) and `docs/KNOWN_LIMITATIONS.md`.

**Feedback:** `docs/superpowers/plans/2026-09-16-scaffolding-and-config-feedback.md`. Read this companion document before changing or executing the plan, and update each item's implementation status as work is completed.

## Global Constraints

- Language: "TypeScript throughout" (PRD §5).
- Web framework: "Next.js 16 (App Router) with React, Node.js runtime for route handlers" (PRD §5).
- UI components: "shadcn/ui (Tailwind based) wherever a suitable component exists" (PRD §5).
- Icons: "react-icons" (PRD §5).
- Validation: "zod, shared between client and server" (PRD §5).
- Local dev: "Supabase CLI (local stack) plus `next dev`" (PRD §5). On this machine both are driven by Supbuddy (see below).
- Config: "Client-side values must carry the `NEXT_PUBLIC_` prefix to be bundled by Next.js. All values are parsed and validated once at startup with defaults applied." (PRD §6.6).
- Config variables and defaults, copied from PRD §6.6:

  | Variable                               | Scope           | Default |
  | -------------------------------------- | --------------- | ------- |
  | `NEXT_PUBLIC_SUPABASE_URL`             | client + server | —       |
  | `NEXT_PUBLIC_SUPABASE_ANON_KEY`        | client + server | —       |
  | `SUPABASE_SERVICE_ROLE_KEY`            | server only     | —       |
  | `NEXT_PUBLIC_POLL_INTERVAL_MS`         | client          | 30000   |
  | `NEXT_PUBLIC_REALTIME_IDLE_TIMEOUT_MS` | client          | 180000  |
  | `HISTORY_INITIAL_SIZE`                 | server          | 100     |
  | `HISTORY_PAGE_SIZE`                    | server          | 20      |

- Security: "No secrets in the browser bundle other than the Supabase anon key." (PRD §7). The service-role key must never be referenced from client code.
- Testing: unit tests run under Vitest; "config parsing" is an explicitly listed unit-test target (PRD §8).
- Supbuddy (from the global supbuddy skill and `.supbuddy/do-not.md` of existing projects):
  - Thin isolation: the project has its own loopback IP; dev servers keep their canonical port (Next.js `:3000`). Never move the app to another port because `127.0.0.1:3000` is busy.
  - Start dev servers with `supbuddy run -- next dev`.
  - Prefer Supbuddy MCP tools over manual edits for Supabase lifecycle, mappings and env files.
  - Do not edit `/etc/resolver/` files, the `Caddyfile`, or Supbuddy-managed certificates. Do not bypass plan→apply for destructive MCP tools.
  - Do not commit `*.supbuddy-backup-*` files or `.supbuddy/meta.json` (Supbuddy adds both to `.gitignore`).

## Supbuddy on this machine

Supbuddy is the desktop app plus daemon that manages every local Supabase stack here. Facts verified on 2026-09-16:

- MCP endpoint `http://127.0.0.1:9877/mcp`, reachable (`get_account_info` succeeds). CLI at `/Users/calin/.local/bin/supbuddy`.
- Default isolation `thin`, default TLD `test`, auto subdomain mapping on. Two projects are registered (`netszin-seap` on `127.0.0.2`, ports 55000–55009; `book-recap` on `127.0.0.3`, ports 55010–55019). This project will get the next free loopback IP and port block. **Never assume the values; read them.**
- Registering writes `.supbuddy/` (README, project.md, mappings.md, services.md, mcp.md, do-not.md, docs.md, meta.json), prepends a managed block to `CLAUDE.md` and `AGENTS.md`, and adds its own lines to `.gitignore`.
- `supbuddy run -- next dev` only recognises the literal command `next dev`; wrapped forms such as `pnpm dev` are not detected. So the package script itself must be `"dev": "supbuddy run -- next dev"` (Supbuddy's own docs recommend exactly this). pnpm puts `node_modules/.bin` on PATH, so `next` resolves.
- Next.js 16 validates cross-origin dev requests against `allowedDevOrigins`. Supbuddy passes the real browser `Origin` through, so the project's Supbuddy hostnames must be listed there or the proxied dev URL breaks. Supbuddy's `apply_next_origins` tool writes that list.
- `preview_connection` / `write_connection` (Supbuddy's `.env` writer) are blocked in this Claude Code permission mode as credential materialisation, and their emitted key names could not be verified. Task 5 therefore writes `.env.local` with a small script over `supabase status -o env`, which produces exactly the PRD's variable names. Supbuddy's own writer remains available to the user from the app's **Connect** button.

**Helper used in every dev-server check below.** The project's loopback IP comes from `.supbuddy/meta.json`:

```bash
SB_IP=$(node -p "require('/Users/calin/dev/other/wp/.supbuddy/meta.json').loopbackIp")
SB_URL=$(node -p "require('/Users/calin/dev/other/wp/.supbuddy/meta.json').urls[0].url")
```

`SB_IP` is where `pnpm dev` binds (`http://$SB_IP:3000`). `SB_URL` is the Caddy-proxied HTTPS address (for example `https://map-chat.map-chat.test`).

## Assumptions (not stated in the spec)

- **Package manager: pnpm.** The PRD does not name one. pnpm 10 is installed on this machine and is used for every command below. Do not mix in npm or yarn lockfiles.
- **Supbuddy label `map-chat`.** The folder is named `wp`, so the label sets the domain (`map-chat.test`) and keeps it meaningful.
- **Config accessors are lazy and memoised** (evaluated on first call, once per process) rather than module-level constants. This still satisfies "parsed once at startup" while keeping `next build` from requiring a `.env.local` for pages that never touch config.
- **A blank value counts as unset.** `NEXT_PUBLIC_POLL_INTERVAL_MS=` in a `.env` file applies the default instead of failing. Required variables that are blank fail as missing.
- **Numeric config values must be positive integers.** Zero, negatives, decimals and non-numeric text are rejected.
- **Zod 4** is used (current major). Its API differs slightly from zod 3: `z.url()`, `{ error }` params, and `ctx.addIssue` inside `transform`. The parser code in Task 3 was verified against zod 4.6.5.
- **`NEXT_PUBLIC_SUPABASE_URL` is the raw `http://127.0.0.1:<port>` API URL** reported by `supabase status`, not the `https://api.map-chat.test` Caddy domain. The raw URL works from Node without CA trust. Switching to the domain later is a one-line `.env.local` change.

## Verified environment (2026-09-16)

| Tool                | Version                  |
| ------------------- | ------------------------ |
| Node                | 22.23.0                  |
| pnpm                | 10.9.0                   |
| Supabase CLI        | 2.113.0                  |
| Docker              | 29.4.0, daemon running   |
| Supbuddy daemon     | running, MCP reachable   |
| create-next-app     | 16.3.5                   |
| Latest next         | 16.3.5                   |
| Latest vitest       | 5.0.1                    |
| Latest zod          | 4.6.5                    |
| Latest react-icons  | 5.7.0                    |

The repository currently has **no commits**. `docs/PRD.md` and `docs/KNOWN_LIMITATIONS.md` exist and are uncommitted. Task 1 commits them first so the plan starts from a clean tree.

## File structure

| Path                                     | Responsibility                                                                     |
| ---------------------------------------- | ---------------------------------------------------------------------------------- |
| `package.json`                           | Scripts: dev (via supbuddy run), build, lint, typecheck, test, db:status, db:env   |
| `next.config.ts`                         | `allowedDevOrigins` with the Supbuddy hostnames (written by Supbuddy)              |
| `.supbuddy/*`                            | Supbuddy project context (generated; `meta.json` is git-ignored)                   |
| `CLAUDE.md`, `AGENTS.md`                 | Managed Supbuddy block on top (generated); AGENTS.md body from create-next-app     |
| `src/app/layout.tsx`                     | Root layout (from create-next-app; title updated)                                  |
| `src/app/page.tsx`                       | Placeholder home page proving Tailwind, shadcn/ui and react-icons render           |
| `src/app/api/health/route.ts`            | `GET /api/health`: proves server config parses and the Supabase stack is reachable |
| `src/components/ui/button.tsx`           | shadcn/ui Button (generated)                                                       |
| `src/lib/utils.ts`                       | shadcn/ui `cn` helper (generated)                                                  |
| `src/lib/config/parse.ts`                | Pure parsers: `ConfigError`, `parseClientConfig`, `parseServerConfig`, types       |
| `src/lib/config/parse.test.ts`           | Unit tests for the parsers                                                         |
| `src/lib/config/client.ts`               | `getClientConfig()`: memoised, literal `process.env.NEXT_PUBLIC_*` references      |
| `src/lib/config/server.ts`               | `getServerConfig()`: memoised, `server-only` guarded                               |
| `vitest.config.ts`                       | Vitest config: node environment, `@/` alias                                        |
| `supabase/config.toml`                   | Local stack config (generated by Supbuddy's `init_supabase`, ports rewritten)      |
| `scripts/write-env-local.sh`             | Writes `.env.local` from `supabase status`                                         |
| `.env.example`                           | Documented variables, committed                                                    |
| `.env.local`                             | Real local values, git-ignored                                                     |
| `README.md`                              | Developer setup                                                                    |

---

### Task 1: Commit docs, scaffold the Next.js 16 app, register with Supbuddy

**Files:**
- Create: everything `create-next-app` generates at the repo root (`package.json`, `src/app/*`, `next.config.ts`, `tsconfig.json`, `eslint.config.mjs`, `postcss.config.mjs`, `.gitignore`, `README.md`, `AGENTS.md`, `public/*`); everything Supbuddy generates (`.supbuddy/*`, `CLAUDE.md`, managed block in `AGENTS.md`, lines in `.gitignore`)
- Modify: `package.json` (name, `dev` and `typecheck` scripts), `next.config.ts` (`allowedDevOrigins`, written by Supbuddy)

**Interfaces:**
- Consumes: nothing.
- Produces: a runnable Next.js project with `pnpm dev` (bound to the project's loopback IP), `pnpm lint`, `pnpm typecheck`; the `@/*` import alias pointing at `src/`; a registered Supbuddy project whose id and loopback IP are in `.supbuddy/meta.json`.

- [ ] **Step 1: Commit the existing docs**

```bash
cd /Users/calin/dev/other/wp
git add docs/PRD.md docs/KNOWN_LIMITATIONS.md docs/superpowers/plans/2026-09-16-scaffolding-and-config.md
git commit -m "docs: add PRD, known limitations, and scaffolding plan"
```

Expected: one commit on `main`; `git status` shows a clean tree.

- [ ] **Step 2: Scaffold with create-next-app into the current directory**

`create-next-app` tolerates an existing `docs/` folder and `.git` directory, so it can run in place.

```bash
cd /Users/calin/dev/other/wp
pnpm dlx create-next-app@16 . --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-pnpm --disable-git --yes
```

Expected: it prints "Success!" and creates `src/app/`, `package.json`, `pnpm-lock.yaml`, `node_modules/`. Any prompt not covered by a flag (React Compiler) is answered with the default by `--yes`.

If it refuses because the directory is "not empty", scaffold into a scratch directory and move the result in:

```bash
pnpm dlx create-next-app@16 /private/tmp/claude-501/-Users-calin-dev-other-wp/d866d90e-43b2-4eab-899f-1ff7a8c16aa0/scratchpad/map-chat --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-pnpm --disable-git --yes
rsync -a --exclude node_modules /private/tmp/claude-501/-Users-calin-dev-other-wp/d866d90e-43b2-4eab-899f-1ff7a8c16aa0/scratchpad/map-chat/ /Users/calin/dev/other/wp/
cd /Users/calin/dev/other/wp && pnpm install
```

- [ ] **Step 3: Rename the package, route `dev` through Supbuddy, add a typecheck script**

```bash
cd /Users/calin/dev/other/wp
node -e '
const fs = require("fs");
const p = JSON.parse(fs.readFileSync("package.json", "utf8"));
p.name = "map-chat";
p.scripts.dev = "supbuddy run -- next dev";
p.scripts.typecheck = "tsc --noEmit";
fs.writeFileSync("package.json", JSON.stringify(p, null, 2) + "\n");
'
cat package.json
```

Expected `scripts` block contains at least:

```json
"dev": "supbuddy run -- next dev",
"build": "next build",
"start": "next start",
"lint": "eslint",
"typecheck": "tsc --noEmit"
```

(The exact `lint` value is whatever create-next-app generated; keep it.)

- [ ] **Step 4: Register the project with Supbuddy**

Call the Supbuddy MCP tool:

```
register_project { "root_path": "/Users/calin/dev/other/wp", "label": "map-chat" }
```

CLI equivalent if MCP is unavailable:

```bash
supbuddy project add /Users/calin/dev/other/wp --label=map-chat
```

Expected: the response contains the new project `id`, `isolation: "thin"`, and an `isolation_note` saying thin was chosen (no Supabase stack is running on the host for this folder). Read the note; do not assume. The scan should detect one app of type `next` on port 3000 with package manager `pnpm`.

Then confirm the generated context:

```bash
cd /Users/calin/dev/other/wp
ls .supbuddy/
node -p "const m=require('./.supbuddy/meta.json'); JSON.stringify({id:m.project_id, isolation:m.isolation_mode, ip:m.loopbackIp, urls:m.urls}, null, 2)"
grep -n 'supbuddy' .gitignore
head -3 CLAUDE.md
```

Expected: `.supbuddy/` lists `README.md project.md mappings.md services.md mcp.md do-not.md docs.md meta.json`; `meta.json` shows `isolation: "thin"`, an `ip` of the form `127.0.0.N`, and one URL of the form `https://map-chat.map-chat.test` (the app sub-domain is derived from the package name); `.gitignore` contains `*.supbuddy-backup-*` and `.supbuddy/meta.json`; `CLAUDE.md` starts with the `<!-- BEGIN SUPBUDDY` managed block.

If `isolation` is not `thin`, call `switch_isolation { "project_id": "<id>", "target_mode": "thin", "auto_start": false }` and poll `get_project { "id": "<id>" }` until `isolation` reads `thin` and `loopbackIp` is set.

- [ ] **Step 5: Allow the Supbuddy origins in next.config.ts**

Collect the hostnames from `meta.json` and hand them to Supbuddy's writer:

```bash
cd /Users/calin/dev/other/wp
node -p "require('./.supbuddy/meta.json').urls.map(u => new URL(u.url).hostname).join(',')"
```

Then call the MCP tool with that list (example values; use the printed ones):

```
apply_next_origins {
  "config_path": "/Users/calin/dev/other/wp/next.config.ts",
  "origins": ["map-chat.map-chat.test"]
}
```

If MCP is unavailable, edit `next.config.ts` by hand so it reads:

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["map-chat.map-chat.test"],
};

export default nextConfig;
```

Verify:

```bash
cd /Users/calin/dev/other/wp
grep -n -A3 allowedDevOrigins next.config.ts
```

Expected: the `allowedDevOrigins` array lists every hostname printed above.

- [ ] **Step 6: Refresh Supbuddy's view of the project**

Call `refresh_project_context { "project_id": "<id>", "force": true }`, then `get_project { "id": "<id>" }`.

Expected: `apps[0]` has `type: "next"`, `port: 3000`, `packageManager: "pnpm"`; `scripts` includes `dev` with command `supbuddy run -- next dev`. `.supbuddy/project.md` now lists the same scripts.

- [ ] **Step 7: Verify lint and typecheck pass on the fresh scaffold**

```bash
cd /Users/calin/dev/other/wp
pnpm lint && pnpm typecheck
```

Expected: both exit 0 with no errors.

- [ ] **Step 8: Verify the dev server serves the home page on the project's loopback IP and through Supbuddy's proxy**

```bash
cd /Users/calin/dev/other/wp
SB_IP=$(node -p "require('./.supbuddy/meta.json').loopbackIp")
SB_URL=$(node -p "require('./.supbuddy/meta.json').urls[0].url")
pnpm dev > /private/tmp/claude-501/-Users-calin-dev-other-wp/d866d90e-43b2-4eab-899f-1ff7a8c16aa0/scratchpad/dev.log 2>&1 &
DEV_PID=$!
for i in $(seq 1 30); do curl -s -o /dev/null -w '%{http_code}\n' "http://$SB_IP:3000/" 2>/dev/null | grep -q 200 && break; sleep 1; done
curl -s -o /dev/null -w "direct  HTTP %{http_code}\n" "http://$SB_IP:3000/"
curl -sk -o /dev/null -w "proxied HTTP %{http_code}\n" "$SB_URL/"
kill $DEV_PID
head -3 /private/tmp/claude-501/-Users-calin-dev-other-wp/d866d90e-43b2-4eab-899f-1ff7a8c16aa0/scratchpad/dev.log
```

Expected: `direct  HTTP 200`, `proxied HTTP 200`, and the log's first lines include `[supbuddy] → https://map-chat.map-chat.test` (or whatever `SB_URL` is). If the proxied request fails but the direct one works, run `supbuddy doctor` and report its findings; do not edit resolver files or the Caddyfile.

- [ ] **Step 9: Commit**

```bash
cd /Users/calin/dev/other/wp
git status --short
git add -A
git status --short | grep -E 'meta.json|supbuddy-backup' && echo "STOP: Supbuddy-ignored file staged" || echo "staging clean"
git commit -m "feat: scaffold Next.js 16 app and register it with Supbuddy"
```

Expected: `staging clean`; `.supbuddy/meta.json` is not in the commit; the other `.supbuddy/*` docs, `CLAUDE.md`, `AGENTS.md`, and `next.config.ts` are.

---

### Task 2: shadcn/ui, react-icons, and a placeholder home page

**Files:**
- Create: `components.json`, `src/components/ui/button.tsx`, `src/lib/utils.ts` (all generated by shadcn)
- Modify: `src/app/globals.css` (rewritten by shadcn init), `src/app/page.tsx`, `src/app/layout.tsx`
- Delete: `public/*.svg` (create-next-app sample assets)

**Interfaces:**
- Consumes: the `@/*` alias and `pnpm dev` from Task 1.
- Produces: `Button` from `@/components/ui/button`; `cn` from `@/lib/utils`; `react-icons` installed.

- [ ] **Step 1: Initialise shadcn/ui**

```bash
cd /Users/calin/dev/other/wp
pnpm dlx shadcn@latest init -d
```

Expected: creates `components.json`, `src/lib/utils.ts`, rewrites `src/app/globals.css` with the theme tokens, and installs `clsx`, `tailwind-merge`, `class-variance-authority` and the base component library. If it asks anything, accept the default answer.

- [ ] **Step 2: Add the Button component and react-icons**

```bash
cd /Users/calin/dev/other/wp
pnpm dlx shadcn@latest add button
pnpm add react-icons
ls src/components/ui/button.tsx && grep -c react-icons package.json
```

Expected: `src/components/ui/button.tsx` exists; `react-icons` appears in `dependencies`.

- [ ] **Step 3: Replace the sample home page**

Delete the sample assets and write `src/app/page.tsx`:

```bash
cd /Users/calin/dev/other/wp
rm -f public/*.svg
cat > src/app/page.tsx <<'EOF'
import { FaMapMarkerAlt } from "react-icons/fa";

import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <h1 className="flex items-center gap-2 text-3xl font-semibold">
        <FaMapMarkerAlt aria-hidden className="text-red-600" />
        Map Chat
      </h1>
      <p className="text-muted-foreground">
        Scaffold is up. The map arrives in the next plan.
      </p>
      <Button>shadcn/ui button</Button>
    </main>
  );
}
EOF
```

- [ ] **Step 4: Set the page title in the root layout**

In `src/app/layout.tsx`, replace the generated `metadata` export with:

```ts
export const metadata: Metadata = {
  title: "Map Chat",
  description: "Anonymous, location-based chat on a map.",
};
```

Leave the rest of the generated layout (fonts, `<html>`, `<body>`) unchanged.

- [ ] **Step 5: Verify lint, typecheck, and that the page renders the three integrations**

```bash
cd /Users/calin/dev/other/wp
pnpm lint && pnpm typecheck
SB_IP=$(node -p "require('./.supbuddy/meta.json').loopbackIp")
pnpm dev > /private/tmp/claude-501/-Users-calin-dev-other-wp/d866d90e-43b2-4eab-899f-1ff7a8c16aa0/scratchpad/dev.log 2>&1 &
DEV_PID=$!
for i in $(seq 1 30); do curl -s "http://$SB_IP:3000/" 2>/dev/null | grep -q 'Map Chat' && break; sleep 1; done
curl -s "http://$SB_IP:3000/" | grep -o 'Map Chat\|shadcn/ui button\|<svg[^>]*' | head -5
kill $DEV_PID
```

Expected: lint and typecheck exit 0; the output contains `Map Chat`, `shadcn/ui button`, and an `<svg` tag (the react-icons marker).

- [ ] **Step 6: Commit**

```bash
cd /Users/calin/dev/other/wp
git add -A
git commit -m "feat: add shadcn/ui, react-icons, and placeholder home page"
```

---

### Task 3: Vitest and the client config parser

**Files:**
- Create: `vitest.config.ts`, `src/lib/config/parse.ts`, `src/lib/config/parse.test.ts`
- Modify: `package.json` (test scripts)

**Interfaces:**
- Consumes: nothing from earlier tasks besides the `@/*` alias.
- Produces (from `src/lib/config/parse.ts`):

```ts
export type Env = Record<string, string | undefined>;
export class ConfigError extends Error { readonly issues: string[] }
export type ClientConfig = {
  supabaseUrl: string;
  supabaseAnonKey: string;
  pollIntervalMs: number;
  realtimeIdleTimeoutMs: number;
};
export function parseClientConfig(env: Env): ClientConfig; // throws ConfigError
```

- [ ] **Step 1: Install Vitest and zod, add test scripts**

```bash
cd /Users/calin/dev/other/wp
pnpm add zod
pnpm add -D vitest @vitejs/plugin-react jsdom
node -e '
const fs = require("fs");
const p = JSON.parse(fs.readFileSync("package.json", "utf8"));
p.scripts.test = "vitest run";
p.scripts["test:watch"] = "vitest";
fs.writeFileSync("package.json", JSON.stringify(p, null, 2) + "\n");
'
```

Expected: `zod` in `dependencies`; `vitest`, `@vitejs/plugin-react`, `jsdom` in `devDependencies`. A peer-dependency warning about `vite` versions from pnpm is acceptable; an error is not.

- [ ] **Step 2: Write the Vitest config**

```bash
cd /Users/calin/dev/other/wp
cat > vitest.config.ts <<'EOF'
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname,
    },
  },
  test: {
    // Pure logic runs in node. Component tests opt in per file with
    // `// @vitest-environment jsdom` on the first line.
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
EOF
pnpm test
```

Expected: Vitest starts and reports "No test files found" and exits with code 1. That is the correct state before the first test exists.

- [ ] **Step 3: Write the failing tests for the client parser**

```bash
cd /Users/calin/dev/other/wp
mkdir -p src/lib/config
cat > src/lib/config/parse.test.ts <<'EOF'
import { describe, expect, it } from "vitest";

import { ConfigError, parseClientConfig } from "@/lib/config/parse";

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
EOF
```

- [ ] **Step 4: Run the tests to verify they fail**

```bash
cd /Users/calin/dev/other/wp
pnpm test
```

Expected: FAIL. The suite cannot load because `@/lib/config/parse` does not exist ("Failed to resolve import" or similar).

- [ ] **Step 5: Implement the parser core and the client parser**

```bash
cd /Users/calin/dev/other/wp
cat > src/lib/config/parse.ts <<'EOF'
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

const requiredUrl = requiredString.pipe(z.url({ error: "must be a valid URL" }));

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
EOF
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
cd /Users/calin/dev/other/wp
pnpm test
```

Expected: PASS, 14 tests (5 happy path, 9 error cases including the 5 `it.each` rows).

This schema code was executed against zod 4.6.5 during planning and produced exactly the messages the tests assert. If a future zod release changes a detail, fix the implementation, not the tests: the message must contain `<VARIABLE>: is required`, `<VARIABLE>: must be a valid URL`, or `<VARIABLE>: must be a positive integer`.

- [ ] **Step 7: Lint and typecheck**

```bash
cd /Users/calin/dev/other/wp
pnpm lint && pnpm typecheck
```

Expected: both exit 0.

- [ ] **Step 8: Commit**

```bash
cd /Users/calin/dev/other/wp
git add package.json pnpm-lock.yaml vitest.config.ts src/lib/config/parse.ts src/lib/config/parse.test.ts
git commit -m "feat: add Vitest and the client config parser"
```

---

### Task 4: Server config parser and memoised accessors

**Files:**
- Modify: `src/lib/config/parse.ts` (append server section), `src/lib/config/parse.test.ts` (append server tests)
- Create: `src/lib/config/client.ts`, `src/lib/config/server.ts`

**Interfaces:**
- Consumes: `Env`, `ConfigError`, `optionalString`, `requiredString`, `requiredUrl`, `positiveIntWithDefault`, `parseWith` from Task 3.
- Produces:

```ts
// src/lib/config/parse.ts
export type ServerConfig = {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  historyInitialSize: number;
  historyPageSize: number;
};
export function parseServerConfig(env: Env): ServerConfig; // throws ConfigError

// src/lib/config/client.ts
export function getClientConfig(): ClientConfig; // memoised

// src/lib/config/server.ts  (import "server-only")
export function getServerConfig(): ServerConfig; // memoised
```

- [ ] **Step 1: Write the failing server parser tests**

Append to `src/lib/config/parse.test.ts`:

```bash
cd /Users/calin/dev/other/wp
cat >> src/lib/config/parse.test.ts <<'EOF'

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
});
EOF
```

Then update the import line at the top of the test file so it reads:

```ts
import { ConfigError, parseClientConfig, parseServerConfig } from "@/lib/config/parse";
```

```bash
cd /Users/calin/dev/other/wp
sed -i '' 's|import { ConfigError, parseClientConfig } from "@/lib/config/parse";|import { ConfigError, parseClientConfig, parseServerConfig } from "@/lib/config/parse";|' src/lib/config/parse.test.ts
grep -n 'parseServerConfig } from' src/lib/config/parse.test.ts
```

Expected: the grep prints the updated import line.

- [ ] **Step 2: Run the tests to verify the new ones fail**

```bash
cd /Users/calin/dev/other/wp
pnpm test
```

Expected: FAIL. Either a resolution/type error that `parseServerConfig` is not exported, or 5 failing tests with "parseServerConfig is not a function".

- [ ] **Step 3: Implement the server parser**

Append to `src/lib/config/parse.ts`:

```bash
cd /Users/calin/dev/other/wp
cat >> src/lib/config/parse.ts <<'EOF'

// ---------------------------------------------------------------------------
// Server configuration (PRD §6.6, scope "server only" and "client + server")
// ---------------------------------------------------------------------------

const serverEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: requiredUrl,
  SUPABASE_SERVICE_ROLE_KEY: requiredString,
  HISTORY_INITIAL_SIZE: positiveIntWithDefault(100),
  HISTORY_PAGE_SIZE: positiveIntWithDefault(20),
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
EOF
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd /Users/calin/dev/other/wp
pnpm test
```

Expected: PASS, 19 tests.

- [ ] **Step 5: Add the memoised accessors**

Install the `server-only` guard package, then create the two accessor modules.

```bash
cd /Users/calin/dev/other/wp
pnpm add server-only
cat > src/lib/config/client.ts <<'EOF'
import { parseClientConfig, type ClientConfig } from "@/lib/config/parse";

let cached: ClientConfig | undefined;

/**
 * Browser-safe configuration, parsed once per process on first use.
 *
 * Every `process.env.NEXT_PUBLIC_*` below is written out literally on purpose:
 * Next.js inlines these into the browser bundle at build time by static
 * substitution. Looping over keys or spreading `process.env` would leave them
 * undefined in the browser. Do not "simplify" this into a loop.
 */
export function getClientConfig(): ClientConfig {
  cached ??= parseClientConfig({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_POLL_INTERVAL_MS: process.env.NEXT_PUBLIC_POLL_INTERVAL_MS,
    NEXT_PUBLIC_REALTIME_IDLE_TIMEOUT_MS: process.env.NEXT_PUBLIC_REALTIME_IDLE_TIMEOUT_MS,
  });
  return cached;
}
EOF
cat > src/lib/config/server.ts <<'EOF'
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
EOF
```

- [ ] **Step 6: Lint, typecheck, test**

```bash
cd /Users/calin/dev/other/wp
pnpm lint && pnpm typecheck && pnpm test
```

Expected: all three exit 0; still 19 passing tests.

- [ ] **Step 7: Commit**

```bash
cd /Users/calin/dev/other/wp
git add package.json pnpm-lock.yaml src/lib/config/
git commit -m "feat: add server config parser and memoised config accessors"
```

---

### Task 5: Supabase stack via Supbuddy, env files, and the health route

**Files:**
- Create: `supabase/config.toml` (generated by Supbuddy's `init_supabase`), `supabase/.gitignore` (written explicitly), `scripts/write-env-local.sh`, `.env.example`, `.env.local` (git-ignored), `src/app/api/health/route.ts`
- Modify: `.gitignore` (un-ignore `.env.example`), `package.json` (db scripts)

**Interfaces:**
- Consumes: `getServerConfig()` from Task 4; the Supbuddy project id from `.supbuddy/meta.json` (Task 1).
- Produces: a running Supbuddy-managed Supabase stack on this project's port block; a populated `.env.local`; `GET /api/health` returning HTTP 200 with `{ ok: true, supabaseUrl, supabase: "reachable" }` when Supabase is healthy, or HTTP 503 with `{ ok: false, supabaseUrl, supabase: "unreachable" }` otherwise.

- [ ] **Step 1: Initialise Supabase through Supbuddy**

Get the project id, then call the MCP tool:

```bash
node -p "require('/Users/calin/dev/other/wp/.supbuddy/meta.json').project_id"
```

```
init_supabase { "project_id": "<id>" }
```

Then inspect what it wrote:

```bash
cd /Users/calin/dev/other/wp
cat > supabase/.gitignore <<'EOF'
.branches/
.temp/
EOF
ls supabase/
cat supabase/.gitignore
grep -n '^project_id\|^port\|^shadow_port' supabase/config.toml
```

Expected: `supabase/config.toml` and the explicitly written `supabase/.gitignore` exist; the latter excludes `.branches/` and `.temp/`. `project_id` is `sb-map-chat-<8 hex chars>` and the port values are in the `55000+` range (Supbuddy's thin-isolation block), not the stock `54321` family. Record the `[api] port` value; it is the `<api-port>` referenced below.

If MCP is unavailable: run `supabase init --yes`, then call `refresh_project_context { "project_id": "<id>", "force": true }` or click Rescan in the Supbuddy app, and re-check that the ports were rewritten into the 55000+ block. If they were not, stop and report; do not hand-edit the port block (Supbuddy owns those keys while the project is thin).

- [ ] **Step 2: Start the stack through Supbuddy**

```
start_supabase { "project_id": "<id>" }
```

This pulls Docker images on first run and can take several minutes. Poll:

```
get_supabase_status { "project_id": "<id>" }
```

until the stack reports running and healthy. Then confirm from the CLI that `supabase status` agrees:

```bash
cd /Users/calin/dev/other/wp
supabase status | grep -E 'API URL|Studio URL'
```

Expected: `API URL: http://127.0.0.1:<api-port>` with the Supbuddy port, and a Studio URL on the same block. `list_mappings` (or `.supbuddy/mappings.md`) also shows `api.map-chat.test` and `studio.map-chat.test` pointing at those ports.

If MCP is unavailable, the CLI equivalent is `supbuddy supabase start --follow` from the project directory.

- [ ] **Step 3: Add the env-writing script and package scripts**

`supabase status` reads the Supbuddy-rewritten `config.toml`, so the URL it reports already carries the right port.

```bash
cd /Users/calin/dev/other/wp
mkdir -p scripts
cat > scripts/write-env-local.sh <<'EOF'
#!/usr/bin/env bash
# Writes .env.local from the running Supabase stack (Supbuddy-managed).
# Usage: pnpm db:env   (the stack must be running: Supbuddy app, or `start_supabase` over MCP)
set -euo pipefail
cd "$(dirname "$0")/.."

supabase status -o env \
  --override-name api.url=NEXT_PUBLIC_SUPABASE_URL \
  --override-name auth.anon_key=NEXT_PUBLIC_SUPABASE_ANON_KEY \
  --override-name auth.service_role_key=SUPABASE_SERVICE_ROLE_KEY \
  | grep -E '^(NEXT_PUBLIC_SUPABASE_URL|NEXT_PUBLIC_SUPABASE_ANON_KEY|SUPABASE_SERVICE_ROLE_KEY)=' \
  > .env.local

echo "Wrote .env.local:"
sed -E 's/(KEY=).*/\1<redacted>/' .env.local
EOF
chmod +x scripts/write-env-local.sh
node -e '
const fs = require("fs");
const p = JSON.parse(fs.readFileSync("package.json", "utf8"));
p.scripts["db:status"] = "supabase status";
p.scripts["db:env"] = "./scripts/write-env-local.sh";
fs.writeFileSync("package.json", JSON.stringify(p, null, 2) + "\n");
'
pnpm db:env
grep -c '=' .env.local
```

Expected: the script prints the URL line (with `<api-port>`) and two redacted key lines; the grep count is `3`.

No `db:start` / `db:stop` scripts are added: starting and stopping is Supbuddy's job (app, MCP `start_supabase` / `stop_supabase`, or `supbuddy supabase start|stop`), and a bare `supabase start` outside Supbuddy would compete with it.

If `--override-name` does not rename a variable on this CLI version, the grep yields fewer than 3 lines. In that case run `supabase status -o env`, note the actual names (`API_URL`, `ANON_KEY`, `SERVICE_ROLE_KEY`), and change the script to `sed` those names into the three required ones instead:

```bash
supabase status -o env \
  | sed -E 's/^API_URL=/NEXT_PUBLIC_SUPABASE_URL=/; s/^ANON_KEY=/NEXT_PUBLIC_SUPABASE_ANON_KEY=/; s/^SERVICE_ROLE_KEY=/SUPABASE_SERVICE_ROLE_KEY=/' \
  | grep -E '^(NEXT_PUBLIC_SUPABASE_URL|NEXT_PUBLIC_SUPABASE_ANON_KEY|SUPABASE_SERVICE_ROLE_KEY)=' \
  > .env.local
```

- [ ] **Step 4: Add `.env.example` and make sure git tracks it but not `.env.local`**

```bash
cd /Users/calin/dev/other/wp
cat > .env.example <<'EOF'
# Copy to .env.local, or run `pnpm db:env` to fill the three Supabase values
# from the running stack. The stack is managed by Supbuddy (thin isolation),
# so the API port is project-specific: read it from `pnpm db:status`.

# Required (client + server)
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:<api-port>
NEXT_PUBLIC_SUPABASE_ANON_KEY=

# Required (server only). Never exposed to the browser.
SUPABASE_SERVICE_ROLE_KEY=

# Optional. Defaults shown; positive integers only.
# NEXT_PUBLIC_POLL_INTERVAL_MS=30000
# NEXT_PUBLIC_REALTIME_IDLE_TIMEOUT_MS=180000
# HISTORY_INITIAL_SIZE=100
# HISTORY_PAGE_SIZE=20
EOF
printf '\n# keep the documented example, ignore real values\n!.env.example\n' >> .gitignore
git check-ignore -v .env.local; echo "---"; git check-ignore -v .env.example || echo ".env.example is tracked (good)"
```

Expected: the first command prints the `.env*` rule matching `.env.local`; the second prints `.env.example is tracked (good)`.

- [ ] **Step 5: Confirm the Supabase health endpoint is reachable with a key**

```bash
cd /Users/calin/dev/other/wp
set -a; source .env.local; set +a
curl -s -w '\nHTTP %{http_code}\n' -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" "$NEXT_PUBLIC_SUPABASE_URL/auth/v1/health"
```

Expected: a JSON body with `"name":"GoTrue"` and `HTTP 200`.

- [ ] **Step 6: Write the health route**

```bash
cd /Users/calin/dev/other/wp
mkdir -p src/app/api/health
cat > src/app/api/health/route.ts <<'EOF'
import { NextResponse } from "next/server";

import { getServerConfig } from "@/lib/config/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/health
 * Proves that server configuration parses and the Supabase stack answers.
 * Returns 200 only when Supabase is reachable and healthy; otherwise 503.
 */
export async function GET() {
  const config = getServerConfig();

  let ok = false;
  try {
    const response = await fetch(`${config.supabaseUrl}/auth/v1/health`, {
      headers: { apikey: config.supabaseServiceRoleKey },
      cache: "no-store",
      signal: AbortSignal.timeout(2_000),
    });
    ok = response.ok;
  } catch {
    ok = false;
  }

  return NextResponse.json(
    {
      ok,
      supabaseUrl: config.supabaseUrl,
      supabase: ok ? "reachable" : "unreachable",
    },
    { status: ok ? 200 : 503 },
  );
}
EOF
```

- [ ] **Step 7: Verify the dev server, config parsing and the stack together**

```bash
cd /Users/calin/dev/other/wp
pnpm lint && pnpm typecheck
SB_IP=$(node -p "require('./.supbuddy/meta.json').loopbackIp")
SB_URL=$(node -p "require('./.supbuddy/meta.json').urls[0].url")
pnpm dev > /private/tmp/claude-501/-Users-calin-dev-other-wp/d866d90e-43b2-4eab-899f-1ff7a8c16aa0/scratchpad/dev.log 2>&1 &
DEV_PID=$!
for i in $(seq 1 30); do curl -s "http://$SB_IP:3000/api/health" 2>/dev/null | grep -q '"supabase":"reachable"' && break; sleep 1; done
curl -s "http://$SB_IP:3000/api/health"; echo
curl -sk "$SB_URL/api/health"; echo
kill $DEV_PID
```

Expected: lint and typecheck exit 0; both bodies match `{"ok":true,"supabaseUrl":"http://127.0.0.1:<api-port>","supabase":"reachable"}` where `<api-port>` is the Supbuddy port from Step 1.

- [ ] **Step 8: Verify a missing variable fails fast with the parser's message**

```bash
cd /Users/calin/dev/other/wp
SB_IP=$(node -p "require('./.supbuddy/meta.json').loopbackIp")
mv .env.local .env.local.bak
pnpm dev > /private/tmp/claude-501/-Users-calin-dev-other-wp/d866d90e-43b2-4eab-899f-1ff7a8c16aa0/scratchpad/dev.log 2>&1 &
DEV_PID=$!
for i in $(seq 1 30); do curl -s -o /dev/null "http://$SB_IP:3000/api/health" 2>/dev/null && break; sleep 1; done
curl -s -o /dev/null -w 'HTTP %{http_code}\n' "http://$SB_IP:3000/api/health"
kill $DEV_PID
mv .env.local.bak .env.local
grep -A3 'Invalid environment configuration' /private/tmp/claude-501/-Users-calin-dev-other-wp/d866d90e-43b2-4eab-899f-1ff7a8c16aa0/scratchpad/dev.log | head -5
```

Expected: `HTTP 500`, and the dev log contains `Invalid environment configuration:` followed by lines naming `NEXT_PUBLIC_SUPABASE_URL: is required` and `SUPABASE_SERVICE_ROLE_KEY: is required`. `.env.local` is restored at the end.

- [ ] **Step 9: Refresh Supbuddy's context and commit**

Call `refresh_project_context { "project_id": "<id>", "force": true }` so `.supbuddy/project.md` and `services.md` reflect the new scripts and the running stack. Then:

```bash
cd /Users/calin/dev/other/wp
git status --short
git add .gitignore .env.example package.json scripts/write-env-local.sh supabase/ src/app/api/health/route.ts .supbuddy/ CLAUDE.md AGENTS.md
git status --short | grep -E '\.env\.local|meta\.json|supbuddy-backup' && echo "STOP: secret or Supbuddy-ignored file staged" || echo "staging clean"
git commit -m "feat: add Supbuddy-managed Supabase stack, env files, and health route"
```

Expected: `staging clean`. `.env.local` and `.supbuddy/meta.json` never appear in the commit. If either does, stop and fix `.gitignore` before committing.

---

### Task 6: README and full verification

**Files:**
- Modify: `README.md` (replace the create-next-app boilerplate)

**Interfaces:**
- Consumes: every script defined in Tasks 1, 3 and 5.
- Produces: the documented developer workflow and a green full run.

- [ ] **Step 1: Write the README**

```bash
cd /Users/calin/dev/other/wp
cat > README.md <<'EOF'
# Map Chat

Anonymous, location-based chat on an OpenStreetMap map. Proof of concept.
See [docs/PRD.md](docs/PRD.md) and [docs/KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md).

## Stack

Next.js 16 (App Router, TypeScript), Tailwind CSS, shadcn/ui, react-icons, zod, Vitest,
Supabase (Postgres + Realtime). Local development is managed by Supbuddy.

## Prerequisites

- Node 22 and pnpm 10
- Docker (running)
- Supabase CLI 2.x (`brew install supabase/tap/supabase`)
- Supbuddy (desktop app or daemon) with this project registered. Registration writes
  `.supbuddy/`; read `.supbuddy/README.md` for this project's IP, domains and ports.

## First run

```bash
pnpm install
# Start Supabase from the Supbuddy app (project "map-chat" → Start), or over MCP:
#   start_supabase { "project_id": "<id from .supbuddy/meta.json>" }
pnpm db:env          # writes .env.local from the running stack
pnpm dev             # supbuddy run -- next dev; open the https://… URL it prints
```

`pnpm dev` binds the project's own loopback IP (see `loopbackIp` in `.supbuddy/meta.json`)
so it keeps port 3000 without colliding with other projects. Open the Supbuddy URL it
prints (`https://map-chat.map-chat.test`), not `localhost`.

Check `/api/health` on that URL. It reports `"supabase":"reachable"` when the app can talk
to the stack.

## Scripts

| Script            | What it does                                        |
| ----------------- | --------------------------------------------------- |
| `pnpm dev`        | Next.js dev server via `supbuddy run` (project IP)  |
| `pnpm build`      | Production build                                    |
| `pnpm lint`       | ESLint                                              |
| `pnpm typecheck`  | `tsc --noEmit`                                      |
| `pnpm test`       | Vitest, single run                                  |
| `pnpm test:watch` | Vitest in watch mode                                |
| `pnpm db:status`  | `supabase status` (URLs and keys for this project)  |
| `pnpm db:env`     | Regenerate `.env.local` from the running stack      |

Starting, stopping and restarting Supabase is done through Supbuddy (app, MCP tools
`start_supabase` / `stop_supabase`, or `supbuddy supabase start|stop`). Do not run a bare
`supabase start`; it would compete with Supbuddy for the same containers.

Without Supbuddy (for example in CI), run `pnpm exec next dev` instead of `pnpm dev`.

## Configuration

All variables are listed with defaults in [.env.example](.env.example) and specified in
PRD section 6.6. They are validated once per process by `src/lib/config`:

- `getClientConfig()` from `@/lib/config/client` for browser-safe values (`NEXT_PUBLIC_*`).
- `getServerConfig()` from `@/lib/config/server` for route handlers. It imports `server-only`,
  so importing it from a client component is a build error.

A missing or malformed variable throws on first use with a message that lists every problem.

## Tests

Unit tests live next to the code as `*.test.ts` and run in a Node environment. A component
test can opt into jsdom with `// @vitest-environment jsdom` as its first line.
EOF
```

- [ ] **Step 2: Run the full verification**

```bash
cd /Users/calin/dev/other/wp
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

Expected: all four exit 0. `pnpm test` reports 19 passing tests. `pnpm build` lists `/` as static and `/api/health` as dynamic.

- [ ] **Step 3: Final dev-server smoke against the running stack**

```bash
cd /Users/calin/dev/other/wp
pnpm db:status | grep -i 'API URL'
SB_IP=$(node -p "require('./.supbuddy/meta.json').loopbackIp")
SB_URL=$(node -p "require('./.supbuddy/meta.json').urls[0].url")
pnpm dev > /private/tmp/claude-501/-Users-calin-dev-other-wp/d866d90e-43b2-4eab-899f-1ff7a8c16aa0/scratchpad/dev.log 2>&1 &
DEV_PID=$!
for i in $(seq 1 30); do curl -s "http://$SB_IP:3000/api/health" 2>/dev/null | grep -q '"supabase":"reachable"' && break; sleep 1; done
curl -s -o /dev/null -w 'home HTTP %{http_code}\n' "http://$SB_IP:3000/"
curl -sk -o /dev/null -w 'proxied home HTTP %{http_code}\n' "$SB_URL/"
curl -s "http://$SB_IP:3000/api/health"; echo
kill $DEV_PID
```

Expected: `home HTTP 200`, `proxied home HTTP 200`, and `{"ok":true,"supabaseUrl":"http://127.0.0.1:<api-port>","supabase":"reachable"}`.

- [ ] **Step 4: Commit**

```bash
cd /Users/calin/dev/other/wp
git add README.md
git commit -m "docs: add developer README for setup and scripts"
git log --oneline
```

Expected: seven commits, newest first: README, Supabase/health, server config, Vitest/client config, shadcn/react-icons, scaffold/Supbuddy, initial docs.

---

## Self-review

**Spec coverage.** PRD §5 stack items in scope for this plan: TypeScript (Task 1), Next.js 16 App Router with Node runtime route handlers (Tasks 1, 5), shadcn/ui (Task 2), react-icons (Task 2), zod (Task 3), Supabase CLI local stack (Task 5, driven through Supbuddy). PRD §6.6: all seven variables with their scopes and defaults are covered by `parseClientConfig` and `parseServerConfig` (Tasks 3, 4); the `NEXT_PUBLIC_` inlining rule is honoured by literal references in `client.ts` (Task 4); "parsed once at startup" is the memoised accessor (Task 4). PRD §7 "no secrets in the browser bundle" is enforced by `server-only` on `server.ts` and tested by the "never exposes server secrets" case. PRD §8 "config parsing" unit tests exist (Tasks 3, 4). Supbuddy conventions: registration (Task 1 Step 4), `supbuddy run` as the `dev` script (Task 1 Step 3), `allowedDevOrigins` (Task 1 Step 5), Supabase lifecycle through MCP (Task 5 Steps 1, 2), no bare `supabase start` scripts (Task 5 Step 3), Supbuddy-ignored files kept out of commits (Task 1 Step 9, Task 5 Step 9). Out of scope by the user's request: map, data model, API routes, realtime; those are later plans.

**Placeholder scan.** Every code step has full code; every verify step has a command and an expected result. The "if MCP is unavailable" notes give the exact CLI or manual alternative. `<id>` and `<api-port>` are values the executor reads in Task 1 Step 4 and Task 5 Step 1, never guesses.

**Type consistency.** `ClientConfig` and `ServerConfig` field names (`supabaseUrl`, `supabaseAnonKey`, `pollIntervalMs`, `realtimeIdleTimeoutMs`, `supabaseServiceRoleKey`, `historyInitialSize`, `historyPageSize`) are identical in the parser, the tests, the accessors, and the health route. `getServerConfig` / `getClientConfig` are named the same in Task 4, Task 5 and the README. Test counts: 14 after Task 3, 19 after Task 4, referenced consistently in Task 6. Every dev-server check reads `SB_IP` / `SB_URL` from `.supbuddy/meta.json` the same way.
