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

All variables are validated once when the server starts (`src/instrumentation.ts`); a missing or malformed variable stops startup with a message that lists every problem.

## Tests

Unit tests live next to the code as `*.test.ts` and run in a Node environment. A component
test can opt into jsdom with `// @vitest-environment jsdom` as its first line.
