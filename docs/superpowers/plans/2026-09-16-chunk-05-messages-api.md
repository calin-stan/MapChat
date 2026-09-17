# Chunk 5: Messages API Implementation Plan

**Review feedback:** [2026-09-16-chunk-05-messages-api-feedback.md](2026-09-16-chunk-05-messages-api-feedback.md)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve a room's message history, older and newer pages with `(created_at, id)` tuple cursors, and message posting through `GET`/`POST /api/rooms/:id/messages`, plus the browser-side typed client for those calls.

**Architecture:** A `list_messages` SQL function does the tuple comparison in Postgres (one snapshot, one round trip, uses `messages_room_created_idx` in both directions). A small repository, `src/lib/db/messages.ts`, calls it through the service-role client and maps rows to the shared `Message` DTO. The route handler validates the id, query and body with chunk 3's zod schemas, picks the page size from `getServerConfig()`, and turns repository results into the chunk 4 error responses. The browser reaches it through `api.messages` in `src/lib/api/client.ts`.

**Tech Stack:** TypeScript 5 (`strict`), Next.js 16.3.5 route handlers on the Node.js runtime, `@supabase/supabase-js` 2.116, zod 4.6, Postgres 17 on the Supbuddy-managed local Supabase stack, Vitest 5 (unit tests under `src/`, database tests under `tests/db/` via `vitest.db.config.ts`), postgres.js 3.4 for test fixtures, pnpm 10, Node 22.

**Spec:** `docs/superpowers/specs/2026-09-16-map-chat-implementation-chunks.md`, "Chunk 5 — Messages API" (plus §0 Global constraints, §0.1 layout, §0.2 DTOs and `ApiError`). PRD (`docs/PRD.md`, v4): §4 "History", §6.4 "Synchronization bookmark", §6.5 API and cursor semantics, §6.6 sizes, §8 integration tests. The PRD is newer than the chunk spec (which cites PRD v2); where they disagree the PRD wins, see "Spec reconciliation".

## Global Constraints

Copied from the spec §0 where they apply to this chunk, adjusted to the repository as it exists:

- Language: TypeScript, `strict: true`, no `any` in committed code.
- Package manager: pnpm (`packageManager: pnpm@10.9.0`). Node 22 LTS. No new dependencies in this chunk.
- Framework: Next.js 16, App Router, route handlers on the Node.js runtime (never Edge). Route handler `params` is a `Promise` and must be awaited (`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md`).
- Data: `@supabase/supabase-js@2.x`. "Browser holds only the anon key. All writes go through route handlers using the service-role key. RLS on with anon SELECT only."
- Validation: `zod` 4.x (`^4.6.5`). "One schema module shared by client and server." This chunk reuses chunk 3's schemas and adds none.
- Character counting: "`[...s].length` in JS, `char_length()` in Postgres. Limits: author 1..100, text 1..3000, after `trim()`." Enforced by `postMessageInputSchema` (chunk 3) and the `messages_*_check` constraints (chunk 2).
- Sizes: history defaults 100/20, both constrained to 1..999 (Task 1b) under PostgREST `max_rows >= 1000`, from `HISTORY_INITIAL_SIZE` / `HISTORY_PAGE_SIZE` (defaults in `src/lib/config/parse.ts`). Catch-up (`?after=`) returns at most 100 (PRD §6.4, §6.5); this is a constant, not a variable (PRD §6.6 lists none).
- Ordering: "by creation time; two messages with the same creation time are ordered by id" (PRD §4). Cursors compare `(created_at, id)` tuples: `before` uses `<`, `after` uses `>` (PRD §6.5).
- API errors (spec §0.2): `400 { error: { code: 'validation', fields: { path, message }[] } }`, `404 { error: { code: 'not_found' } }`.
- Tests: Vitest, TDD (failing test first). Unit tests colocated as `*.test.ts` under `src/` (`pnpm test`, database-free). Database/repository tests under `tests/db/` (`pnpm test:db`) and route tests under `tests/api/` (`pnpm test:api`); both require the local stack and truncate `chatrooms`/`messages`, so run sequentially. Target one file with `pnpm test <path>`, `pnpm test:db <path>` or `pnpm test:api <path>`, **without** `--` (with `--`, Vitest ignores the filter and runs every file).
- Commits: conventional commits, one commit per task. The repository has no GitButler workspace (no `.git/gitbutler`), so the steps use plain `git`; if GitButler is active by the time you execute, use the `commit` skill with the same messages.

## Prerequisites (verified on 2026-09-16)

- `main` is at `021a72a Merge branch 'chunk-03-shared-domain-layer'`. Chunk 2 is merged: migrations `20260916000100_create_chatrooms.sql`, `..000200_create_messages.sql`, `..000300_create_room_with_first_message.sql`; `tests/db/{helpers,harness.test,chatrooms.test,messages.test,create-room-with-first-message.test,create-room-rpc.test}.ts`; `vitest.db.config.ts` (`tests/db/**/*.test.ts`, `fileParallelism: false`, `testTimeout` 15 s); scripts `db:migrate`, `db:reset`, `test:db`.
- Chunk 3 is merged into `main` (`021a72a`); its schemas, name helpers and Supabase clients are present.
- Chunk 4 has a plan: `docs/superpowers/plans/2026-09-16-chunk-04-rooms-api.md`. Its implementation files are currently absent in this checkout (the earlier review saw temporary untracked files). Its documented contracts, including `validationError(FieldIssue[])`, `createApi(fetchImpl)`, shared row mappers and `tests/api`, are prerequisites below; existence in another checkout is not delivery here.
- Historical stack probes from drafting follow; recheck connectivity at execution time.
- The local stack is running (Supbuddy project `sb-map-chat-f9e13085`): API `http://127.0.0.1:55021`, database port `55022`. `supabase status -o env` reports `API_URL`, `ANON_KEY`, `SERVICE_ROLE_KEY`, `DB_URL`.
- Probe of the exact `list_messages` function below against that stack (function created, exercised, then dropped; no rows left behind):
  - Pagination: eight messages with three sharing one `created_at` walk backwards with `before` in pages of 2 and forwards with `after` in pages of 3 with no gaps or duplicates; ties are ordered by id in both directions.
  - Both `before` and `after` queries use `Index Scan` / `Index Scan Backward` on `messages_room_created_idx` with the `ROW(created_at, id)` comparison inside the index condition.
  - `raise exception ... using errcode = 'PT404'` reaches the direct-SQL client as SQLSTATE `PT404`; through PostgREST the response is HTTP 404 with body `{ code: "PT404", message: "room not found", details: null, hint: null }`. `PT400` gives HTTP 400 the same way. `22023` gives HTTP 400.
  - After `revoke ... from public, anon, authenticated; grant ... to service_role`, `set role anon` gets `42501 permission denied for function list_messages`; over PostgREST with the anon key, status 401, code `42501`.
  - `insert` through PostgREST into `messages` with an unknown `chatroom_id` answers HTTP 409, code `23503`, message `insert or update on table "messages" violates foreign key constraint "messages_chatroom_id_fkey"`. An empty author answers 400, code `23514`, constraint `messages_author_check`.
  - PostgREST serialises `created_at` as `"2026-09-16T10:00:00.123456+00:00"` (fractional digits vary: `.45639+00:00`, or none). `new Date(value).toISOString()` yields `"2026-09-16T10:00:00.123Z"` (truncated to milliseconds).
- Every command runs from the repository root of the checkout you execute in.

## Dependencies on other chunks and how to proceed when blocked

The user asked for this explicitly: when a task needs something that another chunk has not delivered yet, do not write a local substitute. Record it, move to the next task that can proceed, and resume when told the work has landed. Tasks are ordered so the unblocked work comes first.

| Needed symbol | Module | Owner | Status on 2026-09-16 | First needed in |
| --- | --- | --- | --- | --- |
| `Message` type | `@/lib/schemas/types` | chunk 3 | merged (`021a72a`) | Task 2 |
| `PostMessageInput`, `postMessageInputSchema` | `@/lib/schemas/message` | chunk 3 | same | Task 2 (type), Task 3 (schema) |
| `messagesQuerySchema`, `uuidSchema` | `@/lib/schemas/query` | chunk 3 | same | Task 3 |
| `createServiceClient()` | `@/lib/supabase/server` | chunk 3 | same | Task 3 |
| `json(data, status)`, `notFound()`, `fieldIssues(zodError)`, `validationError(fields)` | `@/lib/api/errors` | chunk 4 | planned in chunk 4; absent here | Task 3 |
| `createApi`, `FetchLike`, `ApiRequestError`, `ApiValidationError` | `@/lib/api/client` | chunk 4 | planned in chunk 4; absent here | Task 4 |
| `toMessage`, `toRoom`, row schemas; `normalizeCreatedAt`, `compareCreatedAtId` | `@/lib/db/rows`, `@/lib/time/ordering` | chunk 4 | approved precision contract; absent here | Task 2 |
| API harness, `test:api` script | `tests/api`, `vitest.api.config.ts`, `package.json` | chunk 4 | planned; absent here | Task 3 |

Expected contracts (from the chunk 4 plan; verify against delivered files on resume):

- `fieldIssues(error: z.ZodError): FieldIssue[]` maps issues in order; `validationError(fields: FieldIssue[]): Response` answers `400 { error: { code: "validation", fields } }`. Use the same helper for explicit errors.
- `notFound(): Response` answers `404` with `{ error: { code: "not_found" } }`.
- `json(data: unknown, status: number): Response` answers with `Content-Type: application/json`.
- `ApiValidationError` is constructed as `new ApiValidationError(fields)` and exposes `.fields: { path: string; message: string }[]`.
- `createApi(fetchImpl?: FetchLike)` returns the API object, `Api = ReturnType<typeof createApi>`, and `api: Api = createApi()`. Task 4 adds `messages: createMessagesApi(fetchImpl)` inside the factory and reuses its error helpers.

Rules for the executor:

1. **Task 1 needs only `main`.** Start it immediately on a fresh branch `chunk-05-messages-api` created from `main` (worktree via superpowers:using-git-worktrees, for example `/Users/calin/dev/other/wp-worktrees/chunk-05-messages-api`; run `pnpm install` there first).
2. **Before Task 2**, verify chunk 3 modules and chunk 4's `src/lib/db/rows.ts` and `src/lib/time/ordering.ts`, with their tests, are delivered on this branch. Task 2 reuses the shared precise timestamp mapper so room creation, history, POST and future realtime consumers agree. If chunk 4 is absent, finish Tasks 1 and 1b, report "blocked on chunk 4 (rows.ts / precise ordering)", and wait. Merge `main` after dependencies land; do not copy temporary files or merge another feature branch without authorization.
3. **Before Task 3**, verify `src/lib/api/errors.ts`, `tests/api/{helpers,setup-env}.ts`, `vitest.api.config.ts`, and the `test:api` package script. Read the helper signatures, not only export names. Use `fieldIssues` plus `validationError`; do not add a duplicate `fieldErrors` helper. If missing, stop and report the exact dependency.
4. **Before Task 4**, verify `src/lib/api/client.ts` exports `createApi`, `FetchLike`, `ApiRequestError` and `ApiValidationError`. Reuse its imported `ApiErrorBody`, `failWith` and the parsing helpers it uses; do not redeclare them. A message 404 is `ApiRequestError` with `status === 404`.
5. Whenever blocked, leave completed tasks committed and report completed/blocked work. Dependency checks refer to committed deliverables on the execution branch, not merely files observed during review.

## Spec reconciliation

Where the chunk spec, the PRD and the repository disagree, this plan follows the repository first and the PRD (v4) second:

1. **`src/` layout.** Every path is under `src/` with the `@/` alias: `src/app/api/rooms/[id]/messages/route.ts`, `src/lib/db/messages.ts`, `src/lib/api/client.ts`.
2. **Migration name.** The spec says `20260916000005_list_messages_fn.sql`; the repository numbers migrations `..000100`, `..000200`, `..000300`. This chunk adds `supabase/migrations/20260916000400_list_messages.sql`.
3. **Test layout.** SQL/repository integration uses `tests/db/**` and `pnpm test:db`. Route integration reuses chunk 4's `tests/api/**`, setup file and `pnpm test:api`; handlers are called directly with Requests and promised params. Run the two database-backed suites sequentially.
4. **`after` follows PRD v4, not the spec.** The spec says `after` "returns ALL newer messages, no limit; hasMore always false". PRD v4 §6.4/§6.5 say: at most 100, read 101 to compute `hasMore`, respond `{ messages, hasMore, nextCursor }` where `nextCursor` is the last returned id or the supplied cursor when empty. The PRD wins. `CATCH_UP_PAGE_SIZE = 100` is exported from `src/lib/db/messages.ts`.
5. **Cursor errors are 400, not 404.** The spec's acceptance says `after=<id from another room>` → 404; PRD v4 §6.5 says "malformed cursors, a cursor outside the requested room, an unknown cursor, or supplying both `before` and `after` return 400. An unknown room returns 404." The PRD wins: an unknown or foreign cursor answers `400 { error: { code: "validation", fields: [{ path: "before" | "after", message: "is not a message in this room" }] } }`.
6. **Repository results instead of exceptions.** `listMessages` returns a discriminated union (`ok` / `room_not_found` / `cursor_not_found`) so the route maps them without `try`/`catch`; `insertMessage` returns `null` when the room does not exist, detected from the `23503` foreign-key violation on `messages_chatroom_id_fkey` (no separate existence query; one round trip, and atomic). Any other database error is thrown and becomes a 500.
7. **Custom SQLSTATEs.** The function raises `PT404` ("room not found") and `PT400` ("cursor not found in room"). PostgREST maps `PTxyz` to HTTP `xyz` and keeps the code in the error body, so both the direct-SQL tests and supabase-js see the same `code`. Argument misuse (bad mode, non-positive limit, wrong cursor presence) raises `22023` (`invalid_parameter_value`); the route never sends those, so they surface as a thrown error.
8. **`createdAt` precision.** The DTO spec's three-digit timestamp is an example, not a precision limit. The approved chunk 4 plan now supplies canonical UTC timestamps with exactly six fractional digits, preserving Postgres microseconds, through `toRoom`, `toMessage`, `normalizeCreatedAt` and `compareCreatedAtId`. Task 2 consumes that contract; it does not duplicate normalization. Compare canonical strings and UUIDs, never `Date` values for ordering; `Date` remains appropriate for display formatting. [Chunk 4 feedback F-001](2026-09-16-chunk-04-rooms-api-feedback.md#f-001-preserve-timestamp-precision-needed-by-downstream-ordering) owns the shared fix; this plan's F-004 owns the downstream SQL continuation regression and handoff.
9. **Client shape.** The spec proposes one `api.messages.list(roomId, params?: { before?: string } | { after?: string })`. Because `after` responses carry `nextCursor` and history responses do not, Task 4 splits it: `list(roomId, params?: { before?: string }): Promise<MessagePage>` and `listAfter(roomId, after: string): Promise<CatchUpPage>`. `post(roomId, input)` is unchanged. Chunks 8, 9 and 11 read the real signatures from `src/lib/api/client.ts`.
10. **Page types live in `types.ts`.** `MessagePage` and `CatchUpPage` are API DTOs used by the repository, the route and the client, so Task 2 appends them to chunk 3's `src/lib/schemas/types.ts` (append only).
11. **Shared test helper.** Chunk 2 kept `resolveSupabaseConfig()` local to `tests/db/create-room-rpc.test.ts` "since the RPC contract is the only consumer". This chunk adds two more consumers, so Task 1 moves it into `tests/db/helpers.ts` as `resolveSupabaseApi()` (also returning `anonKey`) with a `createApiClient()` companion, and updates the RPC test to import them.
12. **History configuration bound.** Task 1b limits both `HISTORY_*` values to 1..999, leaving one sentinel row under the configured PostgREST `max_rows = 1000`. Keep that API cap at least 1000 in every environment; do not silently lower it. This explicit configuration contract also covers catch-up (101 requested rows).
13. **Function volatility.** `list_messages` is `stable` (read-only), `security invoker`, `set search_path = ''`, executable by `service_role` only, matching `create_room_with_first_message` and PRD §6.1 ("no privileged function may be publicly executable"). Anonymous reads still work through the table grants; the function is an app-internal helper.

## Integration with chunk 4

Merge delivered dependencies before the tasks that consume them. Preserve both chunks' additions to these shared files:

- `tests/db/helpers.ts` (this chunk adds `resolveSupabaseApi`, `createApiClient`), `tests/db/create-room-rpc.test.ts` (imports them); keep chunk 4's API harness imports compatible.
- `vitest.db.config.ts` (this chunk adds the `@` alias); keep chunk 4's separate `vitest.api.config.ts`.
- `src/lib/schemas/types.ts` (append of `MessagePage`, `CatchUpPage`).
- `src/lib/api/client.ts` (extend `createApi`). The API error module and chunk 4's precise row mappers/comparator are consumed unchanged.
- `README.md` (this chunk inserts "## Messages API" before "## Tests" and one bullet in "## Database").
- **Shared database.** Both `pnpm test:db` and `pnpm test:api` truncate the same local database. Never run either concurrently with the other or with another worktree's database-backed tests or reset. This chunk's migration must be applied (`pnpm db:migrate`) in whichever worktree runs its tests; a `pnpm db:reset` from a worktree without `20260916000400_list_messages.sql` drops the function, so rerun `pnpm db:migrate` here afterwards.

## Handoff to chunks 8, 9 and 11

- Initialise `syncCursor` from `messages.at(-1)?.id` of the initial history response (PRD §6.4). If the initial response is empty, reload initial history; do not invent a cursor.
- Catch-up: `api.messages.listAfter(roomId, syncCursor)`; on success merge by id and set `syncCursor = nextCursor` (also when `messages` is empty, where `nextCursor === syncCursor`). If `hasMore` is true, keep `nextCursor` as the "Load more messages" continuation and pause periodic polling until it is false.
- Older history: retain `olderCursor = page.messages[0]?.id` from each successful initial/before response, before any merge; keep it independent of realtime, POST, catch-up and display sorting. Use that cursor for `before` and hide "Load older" when `hasMore` is false. Do not infer synchronization or history progress from newly displayed messages.
- `api.messages.post` resolves to the stored `Message`; add it to the display, never to `syncCursor`.
- Every page is ascending (oldest first). All DTO timestamps have exactly six fractional digits in UTC. Use `compareCreatedAtId` from `@/lib/time/ordering` to merge/sort, retaining microseconds. Chunk 11 maps Realtime `payload.new` through the browser-safe shared `toMessage` in `@/lib/db/rows`; this module must not import service clients. Use `Date` only for time display. Chunk 6 uses the same comparator in reverse for merged viewport results before applying the room cap.
- `ApiRequestError` with `status === 404` from any `api.messages` call means the room no longer exists (chunk 12 closes the panel with a notice).

## File structure

| Path | Responsibility |
| --- | --- |
| `supabase/migrations/20260916000400_list_messages.sql` | `list_messages(p_room, p_mode, p_cursor, p_limit)`: tuple-cursor history query, grants |
| `tests/db/fixtures.ts` | Row fixtures shared by the new database tests: `insertRoom`, `insertMessageAt`, `insertMessageSeries` |
| `tests/db/helpers.ts` (modify) | `resolveSupabaseApi()`, `createApiClient()`; `resolveDatabaseUrl()` shares the status parser |
| `tests/db/create-room-rpc.test.ts` (modify) | Imports the shared resolver instead of its private copy |
| `tests/db/list-messages.test.ts` | Direct-SQL tests of the function: ordering, ties, walks, error codes, privileges |
| `tests/db/list-messages-rpc.test.ts` | The same function through PostgREST: status codes and `code` values supabase-js sees |
| `src/lib/schemas/types.ts` (modify) | Append page types; retain chunk 4's precise timestamp contract |
| `src/lib/time/ordering.ts`, `src/lib/db/rows.ts` (consume) | Shared normalization/comparator and precise mappers delivered by chunk 4 |
| `src/lib/config/parse.ts`, `.test.ts` (modify) | Bounded history sizes under the PostgREST row cap |
| `src/lib/db/messages.ts` | Repository: `CATCH_UP_PAGE_SIZE`, `ListMode`, `ListMessagesResult`, `MessageRow`, `toMessage`, `toPage`, `listMessages`, `insertMessage` |
| `src/lib/db/messages.test.ts` | Unit tests with fake clients: mapping, paging, error-code mapping, arguments |
| `tests/db/messages-repository.test.ts` | Repository against the real local API |
| `vitest.db.config.ts` (modify) | `@` alias so `tests/db` can import `src/` |
| `src/app/api/rooms/[id]/messages/route.ts` | `GET` (initial, before, after) and `POST` handlers |
| `tests/api/messages.test.ts`, `tests/api/messages-boundaries.test.ts` | Route handlers, API-cap sentinel and microsecond continuation against the local stack |
| `src/lib/api/client.ts` (modify) | `createMessagesApi(fetchImpl)`, `MessagesApi`, `api.messages.{list,listAfter,post}` |
| `src/lib/api/client.messages.test.ts` | Client wrapper tests with a stubbed `fetch` |
| `README.md` (modify) | "Messages API" section, `list_messages` bullet |

Dependency order: Task 1 (SQL) → Task 1b (history config) → Task 2 (repository) → Task 3 (route) → Task 4 (client) → Task 5 (docs, verification). Tasks 1 and 1b can run now; Task 2 waits for chunk 4's shared mapper, then Tasks 3 and 4 use its remaining contracts.

---

### Task 1: `list_messages` SQL function, fixtures and database tests

**Files:**
- Create: `supabase/migrations/20260916000400_list_messages.sql`, `tests/db/fixtures.ts`, `tests/db/list-messages.test.ts`, `tests/db/list-messages-rpc.test.ts`
- Modify: `tests/db/helpers.ts`, `tests/db/create-room-rpc.test.ts`

**Interfaces:**
- Consumes: `public.chatrooms`, `public.messages`, `messages_room_created_idx` (chunk 2); `connect`, `asRole`, `truncateAll`, `expectPgError`, `Sql` from `tests/db/helpers.ts`.
- Produces:

  ```sql
  public.list_messages(p_room uuid, p_mode text, p_cursor uuid, p_limit integer)
    returns setof public.messages   -- stable, security invoker, search_path ''
  ```

  - `p_mode = 'initial'` (`p_cursor` must be null): the newest `p_limit` messages of the room, **newest first**.
  - `p_mode = 'before'`: messages with `(created_at, id) < cursor`, **newest first**, at most `p_limit`.
  - `p_mode = 'after'`: messages with `(created_at, id) > cursor`, **oldest first**, at most `p_limit`.
  - Raises `PT404` `room not found` when `p_room` does not exist (checked after limit validation); `PT400` `cursor not found in room` when `p_cursor` is not a message of that room; `22023` for a bad mode, `p_limit < 1` or null, a cursor with `initial`, or no cursor with `before`/`after`.
  - EXECUTE for `service_role` only.
  - Through supabase-js `rpc("list_messages", { p_room, p_mode, p_cursor, p_limit })`: `data` is the row array (`created_at` as `"…+00:00"` strings); errors expose `code` (`"PT404"`, `"PT400"`, `"22023"`, `"42501"`) and `message`.
- Test helpers (`tests/db/helpers.ts`): `resolveSupabaseApi(): { apiUrl: string; anonKey: string; serviceRoleKey: string }`, `createApiClient(apiUrl: string, key: string): SupabaseClient`.
- Fixtures (`tests/db/fixtures.ts`): `DbMessageRow = { id; chatroom_id; author; text; created_at: Date }`, `insertRoom(sql, name): Promise<string>`, `insertMessageAt(sql, roomId, text, createdAt, author = "ann"): Promise<DbMessageRow>`, `insertMessageSeries(sql, roomId, count, startAt = "2026-09-16T10:00:00Z"): Promise<DbMessageRow[]>` (texts `m1`..`m<count>`, one millisecond apart, returned oldest first).

- [ ] **Step 1: Share the `supabase status` parser in the test helpers**

In `tests/db/helpers.ts`, replace everything from the first line through the end of `resolveDatabaseUrl()` (the block ending with `.replace(/^"(.*)"$/, "$1");` and its closing `}`) with:

```ts
import { execFileSync } from "node:child_process";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { expect } from "vitest";

export type Sql = ReturnType<typeof postgres>;

/** The Supabase API roles PostgREST switches to per request. */
export type DbRole = "anon" | "authenticated" | "service_role";

/**
 * `supabase status -o env` as a map. The CLI reads the Supbuddy-rewritten
 * `supabase/config.toml`, so it reports this project's ports and keys. The
 * output is never logged: it contains the service-role key.
 */
function supabaseStatusEnv(): Map<string, string> {
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

function statusValue(values: Map<string, string>, key: string): string {
  const value = values.get(key);
  if (!value) {
    throw new Error(`\`supabase status -o env\` did not report ${key}. Is the local stack running?`);
  }
  return value;
}

/**
 * Connection string for the local Supabase database.
 * `DATABASE_URL` wins when set. Otherwise ask the Supabase CLI.
 */
export function resolveDatabaseUrl(): string {
  const fromEnv = process.env.DATABASE_URL?.trim();
  if (fromEnv) return fromEnv;
  return statusValue(supabaseStatusEnv(), "DB_URL");
}

/** The local API URL and keys, for tests that go through PostgREST or the route handlers. */
export interface SupabaseApi {
  apiUrl: string;
  anonKey: string;
  serviceRoleKey: string;
}

export function resolveSupabaseApi(): SupabaseApi {
  const values = supabaseStatusEnv();
  return {
    apiUrl: statusValue(values, "API_URL"),
    anonKey: statusValue(values, "ANON_KEY"),
    serviceRoleKey: statusValue(values, "SERVICE_ROLE_KEY"),
  };
}

/** A supabase-js client for the local API with `key`, keeping no session (the app has no sign-in). */
export function createApiClient(apiUrl: string, key: string): SupabaseClient {
  return createClient(apiUrl, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
```

Keep `connect`, `asRole`, `truncateAll`, `PgErrorFields`, `isPgError` and `expectPgError` exactly as they are below that block.

- [ ] **Step 2: Point the existing RPC test at the shared helpers**

In `tests/db/create-room-rpc.test.ts`, replace everything from the first line (`import { execFileSync } from "node:child_process";`) through the `});` that closes the `beforeAll` block (the block whose last statement is the `createClient(...)` call with `auth: { persistSession: false, ... }`) with:

```ts
import { type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { connect, createApiClient, resolveSupabaseApi, truncateAll, type Sql } from "./helpers";

let sql: Sql;
let client: SupabaseClient;

beforeAll(() => {
  sql = connect();
  const { apiUrl, serviceRoleKey } = resolveSupabaseApi();
  client = createApiClient(apiUrl, serviceRoleKey);
});
```

The `afterAll`, `beforeEach`, `classifyRoomConflict` and every test stay as they are.

- [ ] **Step 3: Check the refactor changed nothing observable**

```bash
pnpm exec vitest list --config vitest.db.config.ts --filesOnly tests/db/create-room-rpc.test.ts
pnpm test:db tests/db/create-room-rpc.test.ts tests/db/harness.test.ts
pnpm lint && pnpm typecheck
```

Expected: file selection prints only the requested files; 5 RPC tests and 5 harness tests pass; lint and typecheck exit 0.

- [ ] **Step 4: Write the fixtures**

Create `tests/db/fixtures.ts`:

```ts
import type { Sql } from "./helpers";

/** A `public.messages` row as postgres.js returns it (timestamptz becomes a Date). */
export interface DbMessageRow {
  id: string;
  chatroom_id: string;
  author: string;
  text: string;
  created_at: Date;
}

/** A room at random coordinates; message tests only need it to exist. */
export async function insertRoom(sql: Sql, name: string): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    insert into public.chatrooms (name, lat, lng)
    values (
      ${name},
      ${Math.random() * 180 - 90}::double precision,
      ${Math.random() * 360 - 180}::double precision
    )
    returning id`;
  return row.id;
}

/** One message with an explicit creation time, for ordering and tie cases. */
export async function insertMessageAt(
  sql: Sql,
  roomId: string,
  text: string,
  createdAt: string,
  author = "ann",
): Promise<DbMessageRow> {
  const [row] = await sql<DbMessageRow[]>`
    insert into public.messages (chatroom_id, author, text, created_at)
    values (${roomId}::uuid, ${author}, ${text}, ${createdAt}::timestamptz)
    returning id, chatroom_id, author, text, created_at`;
  return row;
}

/**
 * `count` messages "m1".."m<count>" by "ann", one millisecond apart from
 * `startAt`, returned oldest first. One statement, so 250 rows are quick.
 */
export async function insertMessageSeries(
  sql: Sql,
  roomId: string,
  count: number,
  startAt = "2026-09-16T10:00:00Z",
): Promise<DbMessageRow[]> {
  const rows = await sql<DbMessageRow[]>`
    insert into public.messages (chatroom_id, author, text, created_at)
    select
      ${roomId}::uuid,
      'ann',
      'm' || g,
      ${startAt}::timestamptz + (g * interval '1 millisecond')
    from generate_series(1, ${count}::integer) g
    returning id, chatroom_id, author, text, created_at`;
  return [...rows].sort((a, b) => a.created_at.getTime() - b.created_at.getTime());
}
```

- [ ] **Step 5: Write the failing direct-SQL tests**

Create `tests/db/list-messages.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { insertMessageAt, insertMessageSeries, insertRoom, type DbMessageRow } from "./fixtures";
import { asRole, connect, expectPgError, truncateAll, type Sql } from "./helpers";

let sql: Sql;

beforeAll(() => {
  sql = connect();
});

afterAll(async () => {
  await sql.end();
});

beforeEach(async () => {
  await truncateAll(sql);
});

const FN_SIGNATURE = "public.list_messages(uuid, text, uuid, integer)";
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const T0 = "2026-09-16T10:00:00Z";
const TIE_AT = "2026-09-16T10:00:00.003Z"; // same instant as m3 of a series starting at T0

type Mode = "initial" | "before" | "after";

async function list(
  roomId: string,
  mode: Mode,
  cursor: string | null,
  limit: number,
): Promise<DbMessageRow[]> {
  const rows = await sql<DbMessageRow[]>`
    select id, chatroom_id, author, text, created_at
    from public.list_messages(${roomId}::uuid, ${mode}, ${cursor}::uuid, ${limit}::integer)`;
  return [...rows];
}

const texts = (rows: DbMessageRow[]) => rows.map((row) => row.text);

/** Full ascending order the database uses: (created_at, id). */
async function ascending(roomId: string): Promise<DbMessageRow[]> {
  const rows = await sql<DbMessageRow[]>`
    select id, chatroom_id, author, text, created_at from public.messages
    where chatroom_id = ${roomId}::uuid
    order by created_at asc, id asc`;
  return [...rows];
}

/** m1..m5 one ms apart plus three messages sharing m3's instant. */
async function roomWithTies(): Promise<{ roomId: string; all: DbMessageRow[] }> {
  const roomId = await insertRoom(sql, "ties");
  await insertMessageSeries(sql, roomId, 5, T0);
  await insertMessageAt(sql, roomId, "t1", TIE_AT);
  await insertMessageAt(sql, roomId, "t2", TIE_AT);
  await insertMessageAt(sql, roomId, "t3", TIE_AT);
  return { roomId, all: await ascending(roomId) };
}

describe("list_messages: initial", () => {
  it("returns the newest p_limit messages, newest first", async () => {
    const roomId = await insertRoom(sql, "room");
    await insertMessageSeries(sql, roomId, 5, T0);

    expect(texts(await list(roomId, "initial", null, 3))).toEqual(["m5", "m4", "m3"]);
  });

  it("returns every message when the room has fewer than p_limit", async () => {
    const roomId = await insertRoom(sql, "room");
    await insertMessageSeries(sql, roomId, 5, T0);

    expect(texts(await list(roomId, "initial", null, 100))).toEqual(["m5", "m4", "m3", "m2", "m1"]);
  });

  it("orders messages with the same created_at by id, descending", async () => {
    const { roomId, all } = await roomWithTies();

    const rows = await list(roomId, "initial", null, 100);
    expect(rows.map((row) => row.id)).toEqual([...all].reverse().map((row) => row.id));
  });
});

describe("list_messages: before", () => {
  it("returns messages strictly older than the cursor, newest first", async () => {
    const roomId = await insertRoom(sql, "room");
    const series = await insertMessageSeries(sql, roomId, 5, T0);

    expect(texts(await list(roomId, "before", series[2].id, 10))).toEqual(["m2", "m1"]);
  });

  it("walks the whole history in pages of 2 without gaps or duplicates across ties", async () => {
    const { roomId, all } = await roomWithTies();
    const newest = all[all.length - 1];

    const walked = [newest.id];
    let cursor = newest.id;
    for (;;) {
      const page = await list(roomId, "before", cursor, 2);
      if (page.length === 0) break;
      walked.push(...page.map((row) => row.id));
      cursor = page[page.length - 1].id;
    }

    expect(walked).toEqual([...all].reverse().map((row) => row.id));
  });

  it("returns nothing before the oldest message", async () => {
    const roomId = await insertRoom(sql, "room");
    const series = await insertMessageSeries(sql, roomId, 3, T0);

    expect(await list(roomId, "before", series[0].id, 10)).toEqual([]);
  });
});

describe("list_messages: after", () => {
  it("returns messages strictly newer than the cursor, oldest first", async () => {
    const roomId = await insertRoom(sql, "room");
    const series = await insertMessageSeries(sql, roomId, 5, T0);

    expect(texts(await list(roomId, "after", series[2].id, 10))).toEqual(["m4", "m5"]);
  });

  it("walks forward in pages of 3 without gaps or duplicates across ties", async () => {
    const { roomId, all } = await roomWithTies();
    const oldest = all[0];

    const walked = [oldest.id];
    let cursor = oldest.id;
    for (;;) {
      const page = await list(roomId, "after", cursor, 3);
      if (page.length === 0) break;
      walked.push(...page.map((row) => row.id));
      cursor = page[page.length - 1].id;
    }

    expect(walked).toEqual(all.map((row) => row.id));
  });

  it("returns nothing after the newest message", async () => {
    const roomId = await insertRoom(sql, "room");
    const series = await insertMessageSeries(sql, roomId, 3, T0);

    expect(await list(roomId, "after", series[2].id, 10)).toEqual([]);
  });

  it("splits a tie exactly: before and after a tied message partition the room", async () => {
    const { roomId, all } = await roomWithTies();
    const tied = all.filter((row) => row.text.startsWith("t"));
    const middle = tied[1]; // second by id among the three tied rows

    const before = await list(roomId, "before", middle.id, 100);
    const after = await list(roomId, "after", middle.id, 100);

    expect([...before.reverse().map((r) => r.id), middle.id, ...after.map((r) => r.id)]).toEqual(
      all.map((row) => row.id),
    );
  });
});

describe("list_messages: errors", () => {
  it("raises PT404 for an unknown room", async () => {
    await expectPgError(list(NIL_UUID, "initial", null, 10), {
      code: "PT404",
      message: /room not found/,
    });
  });

  it("raises PT400 for a cursor that belongs to another room", async () => {
    const roomId = await insertRoom(sql, "room");
    await insertMessageSeries(sql, roomId, 1, T0);
    const otherId = await insertRoom(sql, "other");
    const [foreign] = await insertMessageSeries(sql, otherId, 1, T0);

    await expectPgError(list(roomId, "after", foreign.id, 10), {
      code: "PT400",
      message: /cursor not found in room/,
    });
  });

  it("raises PT400 for an unknown cursor", async () => {
    const roomId = await insertRoom(sql, "room");
    await insertMessageSeries(sql, roomId, 1, T0);

    await expectPgError(list(roomId, "before", NIL_UUID, 10), {
      code: "PT400",
      message: /cursor not found in room/,
    });
  });

  it.each([
    { label: "an unknown mode", mode: "sideways" as Mode, cursor: null, limit: 10, message: /p_mode/ },
    { label: "a zero limit", mode: "initial" as Mode, cursor: null, limit: 0, message: /p_limit/ },
    { label: "a cursor with initial", mode: "initial" as Mode, cursor: "self", limit: 10, message: /p_cursor must be null/ },
    { label: "before without a cursor", mode: "before" as Mode, cursor: null, limit: 10, message: /p_cursor is required/ },
    { label: "after without a cursor", mode: "after" as Mode, cursor: null, limit: 10, message: /p_cursor is required/ },
  ])("raises 22023 for $label", async ({ mode, cursor, limit, message }) => {
    const roomId = await insertRoom(sql, "room");
    const [only] = await insertMessageSeries(sql, roomId, 1, T0);

    await expectPgError(list(roomId, mode, cursor === "self" ? only.id : cursor, limit), {
      code: "22023",
      message,
    });
  });
});

describe("list_messages: privileges", () => {
  it("is STABLE and SECURITY INVOKER with a pinned search_path", async () => {
    const [row] = await sql<{ provolatile: string; prosecdef: boolean; proconfig: string[] | null }[]>`
      select provolatile, prosecdef, proconfig from pg_proc
      where oid = ${FN_SIGNATURE}::regprocedure`;
    expect(row.provolatile).toBe("s");
    expect(row.prosecdef).toBe(false);
    expect(row.proconfig).toEqual(['search_path=""']);
  });

  it("grants EXECUTE to service_role only", async () => {
    const [row] = await sql<{ anon: boolean; authenticated: boolean; service_role: boolean }[]>`
      select
        has_function_privilege('anon', ${FN_SIGNATURE}, 'EXECUTE') as anon,
        has_function_privilege('authenticated', ${FN_SIGNATURE}, 'EXECUTE') as authenticated,
        has_function_privilege('service_role', ${FN_SIGNATURE}, 'EXECUTE') as service_role`;
    expect(row).toEqual({ anon: false, authenticated: false, service_role: true });
  });

  it.each(["anon", "authenticated"] as const)("refuses %s callers", async (role) => {
    const roomId = await insertRoom(sql, "room");
    await insertMessageSeries(sql, roomId, 1, T0);

    await expectPgError(
      asRole(sql, role, (db) => db`select * from public.list_messages(${roomId}::uuid, 'initial', null, 10)`),
      { code: "42501", message: /permission denied for function list_messages/ },
    );
  });
});
```

- [ ] **Step 6: Run the tests to verify they fail**

```bash
pnpm exec vitest list --config vitest.db.config.ts --filesOnly tests/db/list-messages.test.ts
pnpm test:db tests/db/list-messages.test.ts
```

Expected: file selection prints only `tests/db/list-messages.test.ts`; the run fails. Every test that calls the function reports SQLSTATE `42883` (`function public.list_messages(uuid, text, uuid, integer) does not exist`); the two metadata tests fail on `regprocedure` lookup. 0 of 22 pass.

- [ ] **Step 7: Write the migration**

Create `supabase/migrations/20260916000400_list_messages.sql`:

```sql
-- History and cursor pagination for one room (PRD 4 "History", 6.5 "Cursor
-- semantics"). The route handler calls this through PostgREST with the
-- service-role key; doing the tuple comparison here keeps it one query on
-- messages_room_created_idx instead of emulating (created_at, id) < (a, b)
-- with PostgREST filters.
--
--   p_mode = 'initial'  newest p_limit messages, newest first (p_cursor null)
--   p_mode = 'before'   messages with (created_at, id) < cursor, newest first
--   p_mode = 'after'    messages with (created_at, id) > cursor, oldest first
--
-- The caller asks for one row more than it needs to learn whether more exist,
-- and reverses 'initial'/'before' results so every page is oldest first.
--
-- Errors use SQLSTATEs that PostgREST maps to HTTP statuses (PTxyz -> xyz)
-- and that supabase-js exposes as error.code:
--   PT404  room not found
--   PT400  cursor not found in room (unknown id, or a message of another room)
--   22023  argument misuse (invalid_parameter_value); the route never sends these

create function public.list_messages(
  p_room   uuid,
  p_mode   text,
  p_cursor uuid,
  p_limit  integer
)
returns setof public.messages
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_cursor_at timestamptz;
  v_cursor_id uuid;
begin
  if p_limit is null or p_limit < 1 then
    raise exception 'p_limit must be at least 1' using errcode = '22023';
  end if;

  if not exists (select 1 from public.chatrooms c where c.id = p_room) then
    raise exception 'room not found' using errcode = 'PT404';
  end if;

  if p_mode = 'initial' then
    if p_cursor is not null then
      raise exception 'p_cursor must be null for mode initial' using errcode = '22023';
    end if;
    return query
      select m.* from public.messages m
      where m.chatroom_id = p_room
      order by m.created_at desc, m.id desc
      limit p_limit;
    return;
  end if;

  if p_mode not in ('before', 'after') then
    raise exception 'p_mode must be initial, before or after' using errcode = '22023';
  end if;
  if p_cursor is null then
    raise exception 'p_cursor is required for mode %', p_mode using errcode = '22023';
  end if;

  select m.created_at, m.id into v_cursor_at, v_cursor_id
  from public.messages m
  where m.id = p_cursor and m.chatroom_id = p_room;
  if not found then
    raise exception 'cursor not found in room' using errcode = 'PT400';
  end if;

  if p_mode = 'before' then
    return query
      select m.* from public.messages m
      where m.chatroom_id = p_room
        and (m.created_at, m.id) < (v_cursor_at, v_cursor_id)
      order by m.created_at desc, m.id desc
      limit p_limit;
  else
    return query
      select m.* from public.messages m
      where m.chatroom_id = p_room
        and (m.created_at, m.id) > (v_cursor_at, v_cursor_id)
      order by m.created_at asc, m.id asc
      limit p_limit;
  end if;
end;
$$;

comment on function public.list_messages(uuid, text, uuid, integer) is
  'History page for a room: mode initial (newest first), before (older than cursor, newest first) or after (newer than cursor, oldest first); cursors compare (created_at, id). Raises PT404 for an unknown room and PT400 for a cursor outside the room. Executable by service_role only.';

-- PRD 6.1: app helper functions are not publicly executable. Anonymous reads
-- of the tables themselves stay allowed through the table grants.
revoke execute on function public.list_messages(uuid, text, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.list_messages(uuid, text, uuid, integer)
  to service_role;
```

- [ ] **Step 8: Apply the migration and run the tests**

```bash
pnpm db:migrate
pnpm test:db tests/db/list-messages.test.ts
```

Expected: `db:migrate` applies `20260916000400_list_messages.sql`; 22 tests pass (3 initial, 3 before, 4 after, 3 + 5 errors, 2 + 2 privileges).

If `is STABLE and SECURITY INVOKER with a pinned search_path` fails on `proconfig`, print the stored value (`select proconfig from pg_proc where proname = 'list_messages'`) and adjust only the expectation string; never drop the `set search_path`.

- [ ] **Step 9: Write the failing RPC contract test**

Create `tests/db/list-messages-rpc.test.ts`:

```ts
import { type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { insertMessageSeries, insertRoom } from "./fixtures";
import { connect, createApiClient, resolveSupabaseApi, truncateAll, type Sql } from "./helpers";

let sql: Sql;
let service: SupabaseClient;
let anon: SupabaseClient;

beforeAll(() => {
  sql = connect();
  const { apiUrl, anonKey, serviceRoleKey } = resolveSupabaseApi();
  service = createApiClient(apiUrl, serviceRoleKey);
  anon = createApiClient(apiUrl, anonKey);
});

afterAll(async () => {
  await sql.end();
});

beforeEach(async () => {
  await truncateAll(sql);
});

const NIL_UUID = "00000000-0000-0000-0000-000000000000";

interface RpcRow {
  id: string;
  chatroom_id: string;
  author: string;
  text: string;
  created_at: string;
}

function call(client: SupabaseClient, args: { p_room: string; p_mode: string; p_cursor: string | null; p_limit: number }) {
  return client.rpc("list_messages", args).abortSignal(AbortSignal.timeout(10_000));
}

// The contract the repository (src/lib/db/messages.ts) relies on: the SQLSTATE
// raised in the function arrives unchanged as error.code, and PostgREST maps
// PTxyz to HTTP xyz.
describe("list_messages: RPC contract", () => {
  it("returns rows newest first with created_at as an ISO string", async () => {
    const roomId = await insertRoom(sql, "room");
    const series = await insertMessageSeries(sql, roomId, 3);

    const { data, error, status } = await call(service, {
      p_room: roomId,
      p_mode: "initial",
      p_cursor: null,
      p_limit: 10,
    });

    expect(error).toBeNull();
    expect(status).toBe(200);
    const rows = data as RpcRow[];
    expect(rows.map((row) => row.id)).toEqual([series[2].id, series[1].id, series[0].id]);
    expect(rows[0]).toMatchObject({ chatroom_id: roomId, author: "ann", text: "m3" });
    expect(new Date(rows[0].created_at).toISOString()).toBe(series[2].created_at.toISOString());
  });

  it("answers 404 with code PT404 for an unknown room", async () => {
    const { data, error, status } = await call(service, {
      p_room: NIL_UUID,
      p_mode: "initial",
      p_cursor: null,
      p_limit: 10,
    });

    expect(data).toBeNull();
    expect(status).toBe(404);
    expect(error).toMatchObject({ code: "PT404", message: "room not found" });
  });

  it("answers 400 with code PT400 for a cursor from another room", async () => {
    const roomId = await insertRoom(sql, "room");
    await insertMessageSeries(sql, roomId, 1);
    const otherId = await insertRoom(sql, "other");
    const [foreign] = await insertMessageSeries(sql, otherId, 1);

    const { data, error, status } = await call(service, {
      p_room: roomId,
      p_mode: "after",
      p_cursor: foreign.id,
      p_limit: 10,
    });

    expect(data).toBeNull();
    expect(status).toBe(400);
    expect(error).toMatchObject({ code: "PT400", message: "cursor not found in room" });
  });

  it("refuses the anon key with code 42501", async () => {
    const roomId = await insertRoom(sql, "room");
    await insertMessageSeries(sql, roomId, 1);

    const { data, error, status } = await call(anon, {
      p_room: roomId,
      p_mode: "initial",
      p_cursor: null,
      p_limit: 10,
    });

    expect(data).toBeNull();
    expect([401, 403]).toContain(status);
    expect(error).toMatchObject({ code: "42501" });
  });
});
```

- [ ] **Step 10: Run the RPC test**

```bash
pnpm test:db tests/db/list-messages-rpc.test.ts
```

Expected: 4 tests pass. A `PGRST202` error ("could not find the function") means PostgREST's schema cache predates the migration: run `pnpm exec supabase db query --local "notify pgrst, 'reload schema'"` (or restart the stack through Supbuddy) and rerun. Do not mask a schema-cache error as a not-found result.

This step has no separate failing run: the migration from Step 7 is already applied. The test still guards the contract from now on.

- [ ] **Step 11: Rebuild from scratch and run the whole database suite**

```bash
pnpm db:reset
pnpm test:db
pnpm lint && pnpm typecheck
```

Expected: `db:reset` applies all four migrations; `pnpm test:db` runs 7 files and every test passes (the 5 existing files plus 22 + 4 new tests); lint and typecheck exit 0.

- [ ] **Step 12: Commit**

```bash
git add supabase/migrations/20260916000400_list_messages.sql tests/db/fixtures.ts tests/db/helpers.ts tests/db/create-room-rpc.test.ts tests/db/list-messages.test.ts tests/db/list-messages-rpc.test.ts
git commit -m "feat(db): add list_messages function with tuple cursors"
```

---

### Task 1b: Bound history sizes below the API row cap

This task needs only the existing config module and can finish while waiting for chunk 4.

**Files:** Modify `src/lib/config/parse.ts`, `src/lib/config/parse.test.ts`.
**Contract:** `HISTORY_INITIAL_SIZE` and `HISTORY_PAGE_SIZE` accept 1..999. Defaults remain 100/20. Other numeric configuration is unchanged. `HISTORY_MAX_SIZE = 999` is exported for the repository guard. `supabase/config.toml` must retain `api.max_rows >= HISTORY_MAX_SIZE + 1`; enforce the same relationship when configuring another environment. Catch-up requests 101 rows and also fits this cap. The current cap is documented by [PostgREST](https://docs.postgrest.org/en/stable/references/configuration.html#db-max-rows).

- [ ] **Step 1: Append failing configuration boundary tests**

The existing test file already imports `describe`, `expect`, `it`, `ConfigError` and `parseServerConfig`. Append:

```ts
describe("history size bounds", () => {
  const env = {
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    SUPABASE_SERVICE_ROLE_KEY: "test-service-key",
  };

  it.each(["HISTORY_INITIAL_SIZE", "HISTORY_PAGE_SIZE"] as const)(
    "%s allows the sentinel at the API cap",
    (key) => {
      const config = parseServerConfig({ ...env, [key]: "999" });
      expect(key === "HISTORY_INITIAL_SIZE" ? config.historyInitialSize : config.historyPageSize).toBe(999);
    },
  );

  it.each(["HISTORY_INITIAL_SIZE", "HISTORY_PAGE_SIZE"] as const)(
    "%s rejects values that cannot fetch a sentinel",
    (key) => {
      for (const value of ["1000", "1001", "9007199254740991"]) {
        const parse = () => parseServerConfig({ ...env, [key]: value });
        expect(parse).toThrow(ConfigError);
        expect(parse).toThrow(new RegExp(`${key}: must be at most 999`));
      }
    },
  );
});
```

Run `pnpm test src/lib/config/parse.test.ts`; rejection cases must fail before implementation.

- [ ] **Step 2: Add the bound only to history configuration**

In `src/lib/config/parse.ts`, after `positiveIntWithDefault`, add:

```ts
/** Leave one sentinel row under the minimum supported PostgREST max_rows of 1000. */
export const HISTORY_MAX_SIZE = 999;

const historySizeWithDefault = (fallback: number) =>
  positiveIntWithDefault(fallback).refine(
    (value) => Number.isSafeInteger(value) && value <= HISTORY_MAX_SIZE,
    { error: `must be at most ${HISTORY_MAX_SIZE}` },
  );
```

Replace the two history entries in `serverEnvSchema`:

```ts
  HISTORY_INITIAL_SIZE: historySizeWithDefault(100),
  HISTORY_PAGE_SIZE: historySizeWithDefault(20),
```

- [ ] **Step 3: Verify configuration and commit**

```bash
pnpm test src/lib/config/parse.test.ts
pnpm lint
pnpm typecheck
git add src/lib/config/parse.ts src/lib/config/parse.test.ts
git commit -m "fix(config): bound history pages below the API row cap"
```

Expected: defaults and existing config tests still pass; both history keys reject 1000 while accepting 999. Task 3 adds a real RPC/route regression with 1001 rows; these unit tests alone do not verify the database boundary.

---

### Task 2: Messages repository

**Blocked until chunk 3 and chunk 4's `src/lib/db/rows.ts` are delivered.** See Dependencies rule 2. Task 2 reuses the shared precise mapper and comparator.

**Files:**
- Modify: `src/lib/schemas/types.ts` (append page types), `vitest.db.config.ts` (alias)
- Consume unchanged: chunk 4's `src/lib/db/rows.ts` and `src/lib/time/ordering.ts`
- Create: `src/lib/db/messages.ts`
- Test: `src/lib/db/messages.test.ts` (unit, fake clients), `tests/db/messages-repository.test.ts` (real local API)

**Interfaces:**
- Consumes: `Message` from `@/lib/schemas/types`; `PostMessageInput` from `@/lib/schemas/message`; `SupabaseClient` from `@supabase/supabase-js`; `list_messages` (Task 1); fixtures and helpers (Task 1).
- Produces (`@/lib/schemas/types`):
  - `type MessagePage = { messages: Message[]; hasMore: boolean }` (messages ascending)
  - `type CatchUpPage = MessagePage & { nextCursor: string }`
- Produces (`@/lib/db/messages`):
  - `CATCH_UP_PAGE_SIZE = 100`
  - `type ListMode = { mode: "initial" } | { mode: "before"; cursorId: string } | { mode: "after"; cursorId: string }`
  - `type ListMessagesResult = ({ kind: "ok" } & MessagePage) | { kind: "room_not_found" } | { kind: "cursor_not_found" }`
  - `type MessageRow = { id: string; chatroom_id: string; author: string; text: string; created_at: string }`
  - `toMessage(row: unknown): Message` — re-export chunk 4's shared mapper with six-digit UTC timestamps
  - `toPage(rows: MessageRow[], limit: number, newestFirst: boolean): MessagePage` — `hasMore = rows.length > limit`; keeps the first `limit`; reverses when `newestFirst`
  - `listMessages(db: SupabaseClient, roomId: string, mode: ListMode, limit: number): Promise<ListMessagesResult>` — calls `rpc("list_messages", { p_room, p_mode, p_cursor, p_limit: limit + 1 })`; `PT404` → `room_not_found`, `PT400` → `cursor_not_found`, any other error thrown; `limit` must be an integer in 1..999 (`RangeError` otherwise, before any call)
  - `insertMessage(db: SupabaseClient, roomId: string, input: PostMessageInput): Promise<Message | null>` — `null` on `23503` (room does not exist); other errors thrown

- [ ] **Step 1: Confirm chunk 3 is present**

```bash
test -f src/lib/schemas/types.ts && test -f src/lib/schemas/message.ts && test -f src/lib/db/rows.ts && test -f src/lib/time/ordering.ts
```

Expected: exit 0 and all four modules are committed on this branch. If the mapper is missing, stop after Tasks 1/1b and report "blocked on chunk 4 (rows.ts / precise ordering)"; do not introduce a parallel mapper.

- [ ] **Step 1a: Verify the shared precision contract from chunk 4**

Read chunk 4's delivered `src/lib/time/ordering.ts` and `src/lib/db/rows.ts`. Required contracts:

- `normalizeCreatedAt(value: string): string` returns canonical UTC with six fractional digits, preserving microseconds and timezone rollover.
- `compareCreatedAtId(a, b): number` orders those canonical strings, then lowercase UUIDs; it must not truncate through `Date`.
- Both `toRoom` and `toMessage` use that normalizer and remain browser-safe. Room creation uses the shared mapper too.

```bash
test -f src/lib/time/ordering.ts && test -f src/lib/db/rows.ts
pnpm test src/lib/time/ordering.test.ts src/lib/db/rows.test.ts
```

Expected: chunk 4's precise normalization and adversarial UUID-order tests pass. If only the historical millisecond mapper landed, stop and report "blocked on chunk 4 precision contract (F-001)". Do not create another mapper or rewrite chunk 4's helpers. Its approved plan now owns this fix; this plan owns the repository expectations, real SQL continuation regression in Task 3, and downstream handoff. See [chunk 4 feedback F-001](2026-09-16-chunk-04-rooms-api-feedback.md#f-001-preserve-timestamp-precision-needed-by-downstream-ordering).

- [ ] **Step 2: Add the page types**

Append to `src/lib/schemas/types.ts`:

```ts
/**
 * One page of a room's history (PRD 6.5): `GET /api/rooms/:id/messages` with
 * no cursor or `?before=`. Messages are ascending, oldest first. `hasMore`
 * tells whether an older page exists (it describes the query's snapshot).
 */
export type MessagePage = {
  messages: Message[];
  hasMore: boolean;
};

/**
 * A catch-up page (`?after=`, PRD 6.4): ascending, at most 100 messages.
 * `nextCursor` is the last returned id, or the requested cursor when the page
 * is empty; the client stores it as its synchronization bookmark.
 */
export type CatchUpPage = MessagePage & {
  nextCursor: string;
};
```

- [ ] **Step 3: Write the failing unit tests**

Create `src/lib/db/messages.test.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import {
  CATCH_UP_PAGE_SIZE,
  insertMessage,
  listMessages,
  toMessage,
  toPage,
  type MessageRow,
} from "@/lib/db/messages";

const ROOM = "2f1b6a8e-5c1d-4f7e-9a3b-0c2d4e6f8a1b";
const CURSOR = "9c4e2d1a-7b3f-4a5e-8d6c-1f0e2a3b4c5d";

function row(n: number, createdAt = `2026-09-16T10:00:00.00${n}+00:00`): MessageRow {
  return {
    id: `00000000-0000-4000-8000-00000000000${n}`,
    chatroom_id: ROOM,
    author: "ann",
    text: `m${n}`,
    created_at: createdAt,
  };
}

type RpcResult = { data: unknown; error: { code: string; message: string } | null };

/** A client whose `rpc` is the given mock; nothing else is touched. */
function fakeRpcDb(result: RpcResult) {
  const rpc = vi.fn(async () => result);
  return { db: { rpc } as unknown as SupabaseClient, rpc };
}

/** A client that records `from(table).insert(row)` and answers `select().single()` with `result`. */
function fakeInsertDb(result: RpcResult) {
  const inserts: { table: string; row: unknown; columns?: string }[] = [];
  const db = {
    from: (table: string) => ({
      insert: (value: unknown) => ({
        select: (columns: string) => {
          inserts.push({ table, row: value, columns });
          return { single: async () => result };
        },
      }),
    }),
  } as unknown as SupabaseClient;
  return { db, inserts };
}

describe("CATCH_UP_PAGE_SIZE", () => {
  it("is the PRD 6.4 limit of 100", () => {
    expect(CATCH_UP_PAGE_SIZE).toBe(100);
  });
});

describe("toMessage", () => {
  it.each([
    ["2026-09-16T10:00:00.123456+00:00", "2026-09-16T10:00:00.123456Z"],
    ["2026-09-16T10:00:00.45639+00:00", "2026-09-16T10:00:00.456390Z"],
    ["2026-09-16T10:00:00+00:00", "2026-09-16T10:00:00.000000Z"],
    ["2026-09-16T12:00:00+02:00", "2026-09-16T10:00:00.000000Z"],
  ])("normalises %s to %s", (input, expected) => {
    expect(toMessage(row(1, input)).createdAt).toBe(expected);
  });

  it("maps snake_case columns to the Message DTO", () => {
    expect(toMessage(row(1))).toEqual({
      id: "00000000-0000-4000-8000-000000000001",
      chatroomId: ROOM,
      author: "ann",
      text: "m1",
      createdAt: "2026-09-16T10:00:00.001000Z",
    });
  });
});

describe("toPage", () => {
  it("reports hasMore and drops the extra row when limit + 1 rows came back", () => {
    const page = toPage([row(3), row(2), row(1)], 2, true);
    expect(page.hasMore).toBe(true);
    expect(page.messages.map((m) => m.text)).toEqual(["m2", "m3"]);
  });

  it("keeps every row with hasMore false when at most limit rows came back", () => {
    const page = toPage([row(2), row(1)], 2, true);
    expect(page.hasMore).toBe(false);
    expect(page.messages.map((m) => m.text)).toEqual(["m1", "m2"]);
  });

  it("keeps ascending rows in order when newestFirst is false", () => {
    const page = toPage([row(1), row(2), row(3)], 2, false);
    expect(page).toMatchObject({ hasMore: true });
    expect(page.messages.map((m) => m.text)).toEqual(["m1", "m2"]);
  });

  it("returns an empty page for no rows", () => {
    expect(toPage([], 5, true)).toEqual({ messages: [], hasMore: false });
  });
});

describe("listMessages", () => {
  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 1000, Number.MAX_SAFE_INTEGER])(
    "rejects the limit %s before calling the database",
    async (limit) => {
      const { db, rpc } = fakeRpcDb({ data: [], error: null });

      await expect(listMessages(db, ROOM, { mode: "initial" }, limit)).rejects.toThrow(RangeError);
      expect(rpc).not.toHaveBeenCalled();
    },
  );

  it("asks for limit + 1 rows with a null cursor for initial and reverses to ascending", async () => {
    const { db, rpc } = fakeRpcDb({ data: [row(3), row(2), row(1)], error: null });

    const result = await listMessages(db, ROOM, { mode: "initial" }, 2);

    expect(rpc).toHaveBeenCalledWith("list_messages", {
      p_room: ROOM,
      p_mode: "initial",
      p_cursor: null,
      p_limit: 3,
    });
    expect(result).toMatchObject({ kind: "ok", hasMore: true });
    expect(result.kind === "ok" && result.messages.map((m) => m.text)).toEqual(["m2", "m3"]);
  });

  it("passes the cursor for before and reverses to ascending", async () => {
    const { db, rpc } = fakeRpcDb({ data: [row(2), row(1)], error: null });

    const result = await listMessages(db, ROOM, { mode: "before", cursorId: CURSOR }, 20);

    expect(rpc).toHaveBeenCalledWith("list_messages", {
      p_room: ROOM,
      p_mode: "before",
      p_cursor: CURSOR,
      p_limit: 21,
    });
    expect(result).toMatchObject({ kind: "ok", hasMore: false });
    expect(result.kind === "ok" && result.messages.map((m) => m.text)).toEqual(["m1", "m2"]);
  });

  it("keeps after pages ascending as the database returns them", async () => {
    const { db, rpc } = fakeRpcDb({ data: [row(1), row(2), row(3)], error: null });

    const result = await listMessages(db, ROOM, { mode: "after", cursorId: CURSOR }, 2);

    expect(rpc).toHaveBeenCalledWith("list_messages", {
      p_room: ROOM,
      p_mode: "after",
      p_cursor: CURSOR,
      p_limit: 3,
    });
    expect(result).toMatchObject({ kind: "ok", hasMore: true });
    expect(result.kind === "ok" && result.messages.map((m) => m.text)).toEqual(["m1", "m2"]);
  });

  it("treats a null data with no error as an empty page", async () => {
    const { db } = fakeRpcDb({ data: null, error: null });

    await expect(listMessages(db, ROOM, { mode: "initial" }, 2)).resolves.toEqual({
      kind: "ok",
      messages: [],
      hasMore: false,
    });
  });

  it("maps PT404 to room_not_found", async () => {
    const { db } = fakeRpcDb({ data: null, error: { code: "PT404", message: "room not found" } });

    await expect(listMessages(db, ROOM, { mode: "initial" }, 2)).resolves.toEqual({
      kind: "room_not_found",
    });
  });

  it("maps PT400 to cursor_not_found", async () => {
    const { db } = fakeRpcDb({ data: null, error: { code: "PT400", message: "cursor not found in room" } });

    await expect(listMessages(db, ROOM, { mode: "after", cursorId: CURSOR }, 2)).resolves.toEqual({
      kind: "cursor_not_found",
    });
  });

  it("throws any other database error", async () => {
    const { db } = fakeRpcDb({ data: null, error: { code: "PGRST202", message: "not in schema cache" } });

    await expect(listMessages(db, ROOM, { mode: "initial" }, 2)).rejects.toThrow(/PGRST202/);
  });
});

describe("insertMessage", () => {
  const input = { author: "ann", text: "hello" };

  it("inserts into messages and returns the stored Message", async () => {
    const { db, inserts } = fakeInsertDb({ data: row(1), error: null });

    await expect(insertMessage(db, ROOM, input)).resolves.toEqual(toMessage(row(1)));
    expect(inserts).toEqual([
      {
        table: "messages",
        row: { chatroom_id: ROOM, author: "ann", text: "hello" },
        columns: "id, chatroom_id, author, text, created_at",
      },
    ]);
  });

  it("returns null when the room does not exist (foreign key violation)", async () => {
    const { db } = fakeInsertDb({
      data: null,
      error: {
        code: "23503",
        message: 'insert or update on table "messages" violates foreign key constraint "messages_chatroom_id_fkey"',
      },
    });

    await expect(insertMessage(db, ROOM, input)).resolves.toBeNull();
  });

  it("throws any other database error", async () => {
    const { db } = fakeInsertDb({
      data: null,
      error: { code: "23514", message: 'new row for relation "messages" violates check constraint "messages_text_check"' },
    });

    await expect(insertMessage(db, ROOM, input)).rejects.toThrow(/23514/);
  });
});
```

- [ ] **Step 4: Run the unit tests to verify they fail**

Run: `pnpm test src/lib/db/messages.test.ts`
Expected: FAIL. `@/lib/db/messages` does not resolve; 0 tests run.

- [ ] **Step 5: Write the repository**

Create `src/lib/db/messages.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

import type { PostMessageInput } from "@/lib/schemas/message";
import type { Message, MessagePage } from "@/lib/schemas/types";
import { HISTORY_MAX_SIZE } from "@/lib/config/parse";
import { toMessage } from "@/lib/db/rows";
export { toMessage } from "@/lib/db/rows";

/**
 * Newer messages returned per catch-up request (`?after=`), PRD 6.4 and 6.5.
 * Fixed by the PRD, unlike the history sizes in `HISTORY_*` (PRD 6.6).
 */
export const CATCH_UP_PAGE_SIZE = 100;

/** Which page of a room to read (PRD 6.5). Cursors are message ids of that room. */
export type ListMode =
  | { mode: "initial" }
  | { mode: "before"; cursorId: string }
  | { mode: "after"; cursorId: string };

export type ListMessagesResult =
  | ({ kind: "ok" } & MessagePage)
  | { kind: "room_not_found" }
  | { kind: "cursor_not_found" };

/** A `public.messages` row as PostgREST serialises it (`created_at` like "2026-09-16T10:00:00.123456+00:00"). */
export type MessageRow = {
  id: string;
  chatroom_id: string;
  author: string;
  text: string;
  created_at: string;
};

const MESSAGE_COLUMNS = "id, chatroom_id, author, text, created_at";

/**
 * Turns the rows of a `limit + 1` query into a page: at most `limit` messages
 * and `hasMore` when the extra row came back. Rows that arrive newest first
 * (`initial`, `before`) are reversed, so every page is oldest first.
 */
export function toPage(rows: MessageRow[], limit: number, newestFirst: boolean): MessagePage {
  const kept = rows.slice(0, limit).map(toMessage);
  return { messages: newestFirst ? kept.reverse() : kept, hasMore: rows.length > limit };
}

/**
 * One page of a room's messages through `list_messages` (migration
 * 20260916000400). The function raises PT404 for an unknown room and PT400
 * for a cursor that is not a message of that room; both become results here.
 * Any other error is thrown (the route answers 500).
 */
export async function listMessages(
  db: SupabaseClient,
  roomId: string,
  mode: ListMode,
  limit: number,
): Promise<ListMessagesResult> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > HISTORY_MAX_SIZE) {
    throw new RangeError(`limit must be an integer between 1 and ${HISTORY_MAX_SIZE}`);
  }

  const { data, error } = await db.rpc("list_messages", {
    p_room: roomId,
    p_mode: mode.mode,
    p_cursor: mode.mode === "initial" ? null : mode.cursorId,
    p_limit: limit + 1,
  });

  if (error) {
    if (error.code === "PT404") return { kind: "room_not_found" };
    if (error.code === "PT400") return { kind: "cursor_not_found" };
    throw new Error(`list_messages failed: ${error.code} ${error.message}`);
  }

  const rows = (data ?? []) as MessageRow[];
  return { kind: "ok", ...toPage(rows, limit, mode.mode !== "after") };
}

/**
 * Stores a message (PRD 6.5 `POST /api/rooms/:id/messages`). Returns null when
 * the room does not exist: `messages_chatroom_id_fkey` is the table's only
 * foreign key, so SQLSTATE 23503 can mean nothing else. No existence check
 * first: one round trip, and the insert is atomic with the check.
 */
export async function insertMessage(
  db: SupabaseClient,
  roomId: string,
  input: PostMessageInput,
): Promise<Message | null> {
  const { data, error } = await db
    .from("messages")
    .insert({ chatroom_id: roomId, author: input.author, text: input.text })
    .select(MESSAGE_COLUMNS)
    .single();

  if (error) {
    if (error.code === "23503") return null;
    throw new Error(`insert into messages failed: ${error.code} ${error.message}`);
  }

  return toMessage(data as MessageRow);
}
```

- [ ] **Step 6: Run the unit tests to verify they pass**

Run: `pnpm test src/lib/db/messages.test.ts`
Expected: PASS, 1 file, 27 tests (1 constant, 5 toMessage, 4 toPage, 14 listMessages, 3 insertMessage).

- [ ] **Step 7: Let the database tests import `src/`**

In `vitest.db.config.ts`, add the alias so `tests/db` can import the repository (mirrors `vitest.config.ts`):

```ts
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
```

- [ ] **Step 8: Write the repository test against the local API**

Create `tests/db/messages-repository.test.ts`:

```ts
import { type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { insertMessage, listMessages } from "@/lib/db/messages";

import { insertMessageAt, insertMessageSeries, insertRoom } from "./fixtures";
import { connect, createApiClient, resolveSupabaseApi, truncateAll, type Sql } from "./helpers";

let sql: Sql;
let db: SupabaseClient;

beforeAll(() => {
  sql = connect();
  const { apiUrl, serviceRoleKey } = resolveSupabaseApi();
  db = createApiClient(apiUrl, serviceRoleKey);
});

afterAll(async () => {
  await sql.end();
});

beforeEach(async () => {
  await truncateAll(sql);
});

const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const TIE_AT = "2026-09-16T10:00:00.500Z"; // later than the series, which is one ms apart from 10:00:00

describe("listMessages against the local API", () => {
  it("returns the newest page oldest first with hasMore", async () => {
    const roomId = await insertRoom(sql, "room");
    await insertMessageSeries(sql, roomId, 5);

    const result = await listMessages(db, roomId, { mode: "initial" }, 3);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.hasMore).toBe(true);
    expect(result.messages.map((m) => m.text)).toEqual(["m3", "m4", "m5"]);
    expect(result.messages[0]).toMatchObject({ chatroomId: roomId, author: "ann" });
    expect(result.messages[0].createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/);
  });

  it("pages older messages until hasMore is false", async () => {
    const roomId = await insertRoom(sql, "room");
    const series = await insertMessageSeries(sql, roomId, 5);

    const page = await listMessages(db, roomId, { mode: "before", cursorId: series[2].id }, 5);

    expect(page).toMatchObject({ kind: "ok", hasMore: false });
    expect(page.kind === "ok" && page.messages.map((m) => m.text)).toEqual(["m1", "m2"]);
  });

  it("returns newer messages ascending, breaking ties by id", async () => {
    const roomId = await insertRoom(sql, "room");
    await insertMessageSeries(sql, roomId, 2);
    const tied = [
      await insertMessageAt(sql, roomId, "t1", TIE_AT),
      await insertMessageAt(sql, roomId, "t2", TIE_AT),
    ]
      .map((row) => row.id)
      .sort();
    const later = await insertMessageAt(sql, roomId, "later", "2026-09-16T10:00:01Z");

    const result = await listMessages(db, roomId, { mode: "after", cursorId: tied[0] }, 100);

    expect(result).toMatchObject({ kind: "ok", hasMore: false });
    expect(result.kind === "ok" && result.messages.map((m) => m.id)).toEqual([tied[1], later.id]);
  });

  it("reports room_not_found for an unknown room", async () => {
    await expect(listMessages(db, NIL_UUID, { mode: "initial" }, 10)).resolves.toEqual({
      kind: "room_not_found",
    });
  });

  it("reports cursor_not_found for a cursor of another room", async () => {
    const roomId = await insertRoom(sql, "room");
    await insertMessageSeries(sql, roomId, 1);
    const otherId = await insertRoom(sql, "other");
    const [foreign] = await insertMessageSeries(sql, otherId, 1);

    await expect(listMessages(db, roomId, { mode: "after", cursorId: foreign.id }, 10)).resolves.toEqual({
      kind: "cursor_not_found",
    });
  });
});

describe("insertMessage against the local API", () => {
  it("stores the message and returns the DTO", async () => {
    const roomId = await insertRoom(sql, "room");

    const message = await insertMessage(db, roomId, { author: "ann", text: "hello" });

    expect(message).toMatchObject({ chatroomId: roomId, author: "ann", text: "hello" });
    const [row] = await sql<{ id: string; created_at: Date }[]>`
      select id, created_at from public.messages where chatroom_id = ${roomId}::uuid`;
    expect(row.id).toBe(message?.id);
    // Date parsing is used only for this coarse storage-time check; ordering uses precise strings.
    expect(row.created_at.getTime()).toBe(Date.parse(message?.createdAt ?? ""));
  });

  it("returns null for an unknown room and stores nothing", async () => {
    await expect(insertMessage(db, NIL_UUID, { author: "ann", text: "hello" })).resolves.toBeNull();
    expect(await sql`select 1 from public.messages`).toHaveLength(0);
  });

  it("throws on a check violation the schemas should have caught", async () => {
    const roomId = await insertRoom(sql, "room");

    await expect(insertMessage(db, roomId, { author: "", text: "hello" })).rejects.toThrow(/23514/);
  });
});
```

- [ ] **Step 9: Run the repository test**

```bash
pnpm exec vitest list --config vitest.db.config.ts --filesOnly tests/db/messages-repository.test.ts
pnpm test:db tests/db/messages-repository.test.ts
```

Expected: file selection prints only that file; 8 tests pass. If the run fails resolving `@/lib/db/messages`, Step 7's alias is missing.

- [ ] **Step 10: Lint, typecheck, full unit run**

```bash
pnpm lint && pnpm typecheck && pnpm test
```

Expected: all exit 0; `pnpm test` includes all landed chunk 3/4 and configuration tests plus 27 repository tests, with no database access. Report the actual total.

- [ ] **Step 11: Commit**

```bash
git add src/lib/schemas/types.ts src/lib/db/messages.ts src/lib/db/messages.test.ts vitest.db.config.ts tests/db/messages-repository.test.ts
git commit -m "feat(db): add messages repository with tuple-cursor pages"
```

---

### Task 3: Route handlers `GET`/`POST /api/rooms/:id/messages`

**Blocked until chunk 4's error helpers and API test harness are delivered.** See Dependencies rule 3.

**Files:**
- Create: `src/app/api/rooms/[id]/messages/route.ts`
- Test: `tests/api/messages.test.ts`, `tests/api/messages-boundaries.test.ts`

**Interfaces:**
- Consumes: `json`, `notFound`, `fieldIssues`, `validationError` from `@/lib/api/errors` (chunk 4); `getServerConfig()` from `@/lib/config/server` (`historyInitialSize`, `historyPageSize`); `createServiceClient()` from `@/lib/supabase/server`; `postMessageInputSchema` from `@/lib/schemas/message`; `messagesQuerySchema`, `uuidSchema` from `@/lib/schemas/query`; `CATCH_UP_PAGE_SIZE`, `listMessages`, `insertMessage`, `ListMode` from `@/lib/db/messages` (Task 2).
- Produces (HTTP):
  - `GET /api/rooms/:id/messages` → `200 MessagePage` (newest `historyInitialSize`, ascending)
  - `GET /api/rooms/:id/messages?before=<uuid>` → `200 MessagePage` (next `historyPageSize` older)
  - `GET /api/rooms/:id/messages?after=<uuid>` → `200 CatchUpPage` (up to 100 newer; `nextCursor`)
  - `POST /api/rooms/:id/messages` body `PostMessageInput` → `201 { message: Message }`
  - `400 { error: { code: "validation", fields } }` for a malformed `id` (path `id`), malformed cursor (path `before`/`after`), both cursors (path `""`), a cursor that is not a message of the room (path `before`/`after`, message `is not a message in this room`), a non-JSON body (path `""`, message `must be a JSON body`), or invalid fields.
  - `404 { error: { code: "not_found" } }` for an unknown room.
- Exports `runtime = "nodejs"`, `dynamic = "force-dynamic"`, `GET(request: Request, ctx: { params: Promise<{ id: string }> })`, `POST(...)` with the same signature.

- [ ] **Step 1: Confirm chunk 4's error helpers are present and note their names**

```bash
test -f src/lib/api/errors.ts && test -f tests/api/helpers.ts && test -f vitest.api.config.ts
rg -n '^export (async )?function' src/lib/api/errors.ts
pnpm exec vitest list --config vitest.api.config.ts --filesOnly
```

Expected: `fieldIssues(ZodError)` and `validationError(FieldIssue[])` are present, the harness selects API tests, and `package.json` has `test:api`. If a dependency is missing, stop and report it. Use the delivered helpers unchanged.

- [ ] **Step 2: Write the failing route tests**

Create `tests/api/messages.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { GET, POST } from "@/app/api/rooms/[id]/messages/route";
import type { Message } from "@/lib/schemas/types";

import { insertMessageAt, insertMessageSeries, insertRoom } from "../db/fixtures";
import { apiRequest, connect, routeParams, truncateAll, type Sql } from "./helpers";

// The route imports `@/lib/supabase/server` and `@/lib/config/server`, which
// import `server-only`. Outside a React Server bundle that module throws, so
// stub it (as chunk 3's server-client tests do). Hoisted by Vitest.
vi.mock("server-only", () => ({}));

let sql: Sql;

beforeAll(() => {
  // tests/api/setup-env.ts supplies the server environment before imports.
  // Sizes are read lazily by getServerConfig on the first handler call.
  vi.stubEnv("HISTORY_INITIAL_SIZE", "100");
  vi.stubEnv("HISTORY_PAGE_SIZE", "20");
  sql = connect();
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await sql.end();
});

beforeEach(async () => {
  await truncateAll(sql);
});

type FieldError = { path: string; message: string };
type Body = {
  messages?: Message[];
  hasMore?: boolean;
  nextCursor?: string;
  message?: Message;
  error?: { code: string; fields?: FieldError[] };
};
type Result = { status: number; body: Body };

const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const ISO_MICRO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const ASTRAL = "\u{1D4B3}";
const TIE_AT = "2026-09-16T10:00:00.003Z";

async function get(roomId: string, query = ""): Promise<Result> {
  const response = await GET(apiRequest(`/api/rooms/${roomId}/messages${query}`), routeParams(roomId));
  return { status: response.status, body: (await response.json()) as Body };
}

async function postRaw(roomId: string, raw: string): Promise<Result> {
  const response = await POST(
    apiRequest(`/api/rooms/${roomId}/messages`, { method: "POST", body: raw }),
    routeParams(roomId),
  );
  return { status: response.status, body: (await response.json()) as Body };
}

const post = (roomId: string, body: unknown) => postRaw(roomId, JSON.stringify(body));

const texts = (messages: Message[] | undefined) => (messages ?? []).map((m) => m.text);
const ids = (messages: Message[] | undefined) => (messages ?? []).map((m) => m.id);

function validation(fields: FieldError[]): Body {
  return { error: { code: "validation", fields } };
}

describe("GET /api/rooms/:id/messages (initial history)", () => {
  it("returns the newest 100 of 105 messages, oldest first, with hasMore", async () => {
    const roomId = await insertRoom(sql, "room");
    await insertMessageSeries(sql, roomId, 105);

    const { status, body } = await get(roomId);

    expect(status).toBe(200);
    expect(body.messages).toHaveLength(100);
    expect(texts(body.messages)[0]).toBe("m6");
    expect(texts(body.messages)[99]).toBe("m105");
    expect(body.hasMore).toBe(true);
    expect(body).not.toHaveProperty("nextCursor");
  });

  it("returns everything with hasMore false when the room has exactly 100", async () => {
    const roomId = await insertRoom(sql, "room");
    await insertMessageSeries(sql, roomId, 100);

    const { status, body } = await get(roomId);

    expect(status).toBe(200);
    expect(body.messages).toHaveLength(100);
    expect(body.hasMore).toBe(false);
  });

  it("maps rows to the Message DTO with a microsecond UTC timestamp", async () => {
    const roomId = await insertRoom(sql, "room");
    const [row] = await insertMessageSeries(sql, roomId, 1);

    const { body } = await get(roomId);

    expect(body.messages).toEqual([
      {
        id: row.id,
        chatroomId: roomId,
        author: "ann",
        text: "m1",
        createdAt: row.created_at.toISOString().replace(/Z$/, "000Z"),
      },
    ]);
    expect(body.messages?.[0].createdAt).toMatch(ISO_MICRO_UTC);
  });

  it("orders messages with the same created_at by id", async () => {
    const roomId = await insertRoom(sql, "room");
    const tied = [
      await insertMessageAt(sql, roomId, "t1", TIE_AT),
      await insertMessageAt(sql, roomId, "t2", TIE_AT),
      await insertMessageAt(sql, roomId, "t3", TIE_AT),
    ]
      .map((row) => row.id)
      .sort();

    const { body } = await get(roomId);

    expect(ids(body.messages)).toEqual(tied);
  });
});

describe("GET ?before= (older history)", () => {
  it("returns the 5 messages left after a 105-message initial load", async () => {
    const roomId = await insertRoom(sql, "room");
    await insertMessageSeries(sql, roomId, 105);
    const initial = await get(roomId);
    const oldestShown = initial.body.messages?.[0].id ?? "";

    const { status, body } = await get(roomId, `?before=${oldestShown}`);

    expect(status).toBe(200);
    expect(texts(body.messages)).toEqual(["m1", "m2", "m3", "m4", "m5"]);
    expect(body.hasMore).toBe(false);
  });

  it("pages 20 at a time until nothing older remains", async () => {
    const roomId = await insertRoom(sql, "room");
    await insertMessageSeries(sql, roomId, 130);
    const initial = await get(roomId);
    expect(texts(initial.body.messages)[0]).toBe("m31");
    expect(initial.body.hasMore).toBe(true);

    const page1 = await get(roomId, `?before=${initial.body.messages?.[0].id}`);
    expect(texts(page1.body.messages)).toEqual(Array.from({ length: 20 }, (_, i) => `m${11 + i}`));
    expect(page1.body.hasMore).toBe(true);

    const page2 = await get(roomId, `?before=${page1.body.messages?.[0].id}`);
    expect(texts(page2.body.messages)).toEqual(Array.from({ length: 10 }, (_, i) => `m${1 + i}`));
    expect(page2.body.hasMore).toBe(false);

    const page3 = await get(roomId, `?before=${page2.body.messages?.[0].id}`);
    expect(page3.body).toEqual({ messages: [], hasMore: false });
  });

  it("excludes the cursor and splits a tie by id", async () => {
    const roomId = await insertRoom(sql, "room");
    const [older] = await insertMessageSeries(sql, roomId, 1);
    const tied = [
      await insertMessageAt(sql, roomId, "t1", TIE_AT),
      await insertMessageAt(sql, roomId, "t2", TIE_AT),
      await insertMessageAt(sql, roomId, "t3", TIE_AT),
    ]
      .map((row) => row.id)
      .sort();

    const { body } = await get(roomId, `?before=${tied[1]}`);

    expect(ids(body.messages)).toEqual([older.id, tied[0]]);
  });
});

describe("GET ?after= (catch-up)", () => {
  it("returns B and C after A, so a poll after A cannot miss B", async () => {
    const roomId = await insertRoom(sql, "room");
    const [a, b, c] = await insertMessageSeries(sql, roomId, 3);

    const { status, body } = await get(roomId, `?after=${a.id}`);

    expect(status).toBe(200);
    expect(ids(body.messages)).toEqual([b.id, c.id]);
    expect(body.hasMore).toBe(false);
    expect(body.nextCursor).toBe(c.id);
  });

  it("drains a 250-message backlog as 100, 100, 50 with continuation cursors", async () => {
    const roomId = await insertRoom(sql, "room");
    const series = await insertMessageSeries(sql, roomId, 251);
    const bookmark = series[0].id;

    const first = await get(roomId, `?after=${bookmark}`);
    expect(first.body.messages).toHaveLength(100);
    expect(texts(first.body.messages)[0]).toBe("m2");
    expect(first.body.hasMore).toBe(true);
    expect(first.body.nextCursor).toBe(series[100].id);

    const second = await get(roomId, `?after=${first.body.nextCursor}`);
    expect(second.body.messages).toHaveLength(100);
    expect(texts(second.body.messages)[0]).toBe("m102");
    expect(second.body.hasMore).toBe(true);
    expect(second.body.nextCursor).toBe(series[200].id);

    const third = await get(roomId, `?after=${second.body.nextCursor}`);
    expect(third.body.messages).toHaveLength(50);
    expect(texts(third.body.messages)[49]).toBe("m251");
    expect(third.body.hasMore).toBe(false);
    expect(third.body.nextCursor).toBe(series[250].id);
  });

  it("returns an empty page and echoes the cursor after the newest message", async () => {
    const roomId = await insertRoom(sql, "room");
    const series = await insertMessageSeries(sql, roomId, 3);
    const newest = series[2].id;

    const { body } = await get(roomId, `?after=${newest}`);

    expect(body).toEqual({ messages: [], hasMore: false, nextCursor: newest });
  });

  it("continues past a tied message by id", async () => {
    const roomId = await insertRoom(sql, "room");
    const tied = [
      await insertMessageAt(sql, roomId, "t1", TIE_AT),
      await insertMessageAt(sql, roomId, "t2", TIE_AT),
      await insertMessageAt(sql, roomId, "t3", TIE_AT),
    ]
      .map((row) => row.id)
      .sort();
    const later = await insertMessageAt(sql, roomId, "later", "2026-09-16T10:00:01Z");

    const { body } = await get(roomId, `?after=${tied[0]}`);

    expect(ids(body.messages)).toEqual([tied[1], tied[2], later.id]);
  });
});

describe("GET cursor validation", () => {
  it.each(["before", "after"])("rejects a %s cursor from another room with 400 on that field", async (key) => {
    const roomId = await insertRoom(sql, "room");
    await insertMessageSeries(sql, roomId, 1);
    const otherId = await insertRoom(sql, "other");
    const [foreign] = await insertMessageSeries(sql, otherId, 1);

    const { status, body } = await get(roomId, `?${key}=${foreign.id}`);

    expect(status).toBe(400);
    expect(body).toEqual(validation([{ path: key, message: "is not a message in this room" }]));
  });

  it("rejects an unknown cursor", async () => {
    const roomId = await insertRoom(sql, "room");
    await insertMessageSeries(sql, roomId, 1);

    const { status, body } = await get(roomId, `?before=${NIL_UUID}`);

    expect(status).toBe(400);
    expect(body).toEqual(validation([{ path: "before", message: "is not a message in this room" }]));
  });

  it("rejects before and after together", async () => {
    const roomId = await insertRoom(sql, "room");
    const [only] = await insertMessageSeries(sql, roomId, 1);

    const { status, body } = await get(roomId, `?before=${only.id}&after=${only.id}`);

    expect(status).toBe(400);
    expect(body).toEqual(validation([{ path: "", message: "use either before or after, not both" }]));
  });

  it("rejects a malformed cursor", async () => {
    const roomId = await insertRoom(sql, "room");

    const { status, body } = await get(roomId, "?before=abc");

    expect(status).toBe(400);
    expect(body).toEqual(validation([{ path: "before", message: "must be a UUID" }]));
  });
});

describe("room validation", () => {
  it("answers 404 for an unknown room", async () => {
    const { status, body } = await get(NIL_UUID);

    expect(status).toBe(404);
    expect(body).toEqual({ error: { code: "not_found" } });
  });

  it("answers 400 for a malformed room id", async () => {
    const { status, body } = await get("abc");

    expect(status).toBe(400);
    expect(body).toEqual(validation([{ path: "id", message: "must be a UUID" }]));
  });
});

describe("POST /api/rooms/:id/messages", () => {
  it("stores the message, answers 201, and the next catch-up returns it", async () => {
    const roomId = await insertRoom(sql, "room");
    const [first] = await insertMessageSeries(sql, roomId, 1);

    const { status, body } = await post(roomId, { author: "  ann ", text: " hello\nthere " });

    expect(status).toBe(201);
    expect(body.message).toMatchObject({ chatroomId: roomId, author: "ann", text: "hello\nthere" });
    expect(body.message?.createdAt).toMatch(ISO_MICRO_UTC);

    const rows = await sql<{ id: string; author: string; text: string }[]>`
      select id, author, text from public.messages where chatroom_id = ${roomId}::uuid order by created_at`;
    expect([...rows]).toEqual([
      { id: first.id, author: "ann", text: "m1" },
      { id: body.message?.id, author: "ann", text: "hello\nthere" },
    ]);

    const catchUp = await get(roomId, `?after=${first.id}`);
    expect(ids(catchUp.body.messages)).toEqual([body.message?.id]);
  });

  it("answers 404 for an unknown room and stores nothing", async () => {
    const { status, body } = await post(NIL_UUID, { author: "ann", text: "hello" });

    expect(status).toBe(404);
    expect(body).toEqual({ error: { code: "not_found" } });
    expect(await sql`select 1 from public.messages`).toHaveLength(0);
  });

  it("answers 400 for a malformed room id", async () => {
    const { status, body } = await post("abc", { author: "ann", text: "hello" });

    expect(status).toBe(400);
    expect(body).toEqual(validation([{ path: "id", message: "must be a UUID" }]));
  });

  it("answers 400 with the field for text of 3001 code points", async () => {
    const roomId = await insertRoom(sql, "room");

    const { status, body } = await post(roomId, { author: "ann", text: ASTRAL.repeat(3001) });

    expect(status).toBe(400);
    expect(body).toEqual(validation([{ path: "text", message: "must be between 1 and 3000 characters" }]));
  });

  it("answers 400 with the field for an author of 101 code points", async () => {
    const roomId = await insertRoom(sql, "room");

    const { status, body } = await post(roomId, { author: ASTRAL.repeat(101), text: "hello" });

    expect(status).toBe(400);
    expect(body).toEqual(validation([{ path: "author", message: "must be between 1 and 100 characters" }]));
  });

  it("answers 400 for a body that is not JSON", async () => {
    const roomId = await insertRoom(sql, "room");

    const { status, body } = await postRaw(roomId, "{not json");

    expect(status).toBe(400);
    expect(body).toEqual(validation([{ path: "", message: "must be a JSON body" }]));
  });

  it("answers 400 for a JSON body that is not an object", async () => {
    const roomId = await insertRoom(sql, "room");

    const { status, body } = await post(roomId, ["ann", "hello"]);

    expect(status).toBe(400);
    expect(body.error?.code).toBe("validation");
    expect(body.error?.fields).toHaveLength(1);
    expect(body.error?.fields?.[0].path).toBe("");
  });

  it("ignores keys the client must not control", async () => {
    const roomId = await insertRoom(sql, "room");
    const otherId = await insertRoom(sql, "other");

    const { status, body } = await post(roomId, {
      author: "ann",
      text: "hello",
      chatroomId: otherId,
      createdAt: "2000-01-01T00:00:00.000000Z",
    });

    expect(status).toBe(201);
    expect(body.message?.chatroomId).toBe(roomId);
    expect(body.message?.createdAt).not.toBe("2000-01-01T00:00:00.000000Z");
  });
});
```

- [ ] **Step 2b: Add route regressions for the row cap and sub-millisecond continuation**

Create `tests/api/messages-boundaries.test.ts`. It uses the same API harness, but resets the module cache before importing the route so each test observes its own history-size settings. No suites run concurrently.

```ts
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";

import type { MessagePage } from "@/lib/schemas/types";
import { compareCreatedAtId } from "@/lib/time/ordering";

import { insertMessageSeries, insertRoom } from "../db/fixtures";
import { apiRequest, connect, routeParams, truncateAll, type Sql } from "./helpers";

vi.mock("server-only", () => ({}));

let sql: Sql;
beforeAll(() => { sql = connect(); });
afterAll(async () => { await sql.end(); });
beforeEach(async () => {
  vi.resetModules();
  await truncateAll(sql);
});
afterEach(() => { vi.unstubAllEnvs(); });

async function reader(initial: number, page: number) {
  vi.stubEnv("HISTORY_INITIAL_SIZE", String(initial));
  vi.stubEnv("HISTORY_PAGE_SIZE", String(page));
  const { GET } = await import("@/app/api/rooms/[id]/messages/route");
  return async (roomId: string, before?: string): Promise<MessagePage> => {
    const query = before === undefined ? "" : `?before=${before}`;
    const response = await GET(apiRequest(`/api/rooms/${roomId}/messages${query}`), routeParams(roomId));
    expect(response.status).toBe(200);
    return (await response.json()) as MessagePage;
  };
}

it("keeps the sentinel at size 999 for both initial and before pages", async () => {
  const roomId = await insertRoom(sql, "cap-boundary");
  const series = await insertMessageSeries(sql, roomId, 1001);
  const get = await reader(999, 999);

  const initial = await get(roomId);
  expect(initial.messages).toHaveLength(999);
  expect(initial.messages[0].id).toBe(series[2].id);
  expect(initial.hasMore).toBe(true);

  // 1000 older rows match: 999 returned plus the sentinel at the API cap.
  const older = await get(roomId, series[1000].id);
  expect(older.messages).toHaveLength(999);
  expect(older.messages[0].id).toBe(series[1].id);
  expect(older.hasMore).toBe(true);
  const last = await get(roomId, older.messages[0].id);
  expect(last.messages.map((m) => m.id)).toEqual([series[0].id]);
  expect(last.hasMore).toBe(false);
});

it("advances older history when microsecond ordering opposes UUID ordering", async () => {
  const roomId = await insertRoom(sql, "microseconds");
  const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const fixtures = [
    { id: uuid(4), text: "X", at: "2026-09-16T10:00:00.122900Z" },
    { id: uuid(3), text: "A", at: "2026-09-16T10:00:00.123100Z" },
    { id: uuid(1), text: "B", at: "2026-09-16T10:00:00.123200Z" },
    { id: uuid(2), text: "C", at: "2026-09-16T10:00:00.123300Z" },
  ];
  for (const row of fixtures) {
    await sql`insert into public.messages (id, chatroom_id, author, text, created_at)
      values (${row.id}::uuid, ${roomId}::uuid, 'ann', ${row.text}, ${row.at}::timestamptz)`;
  }
  const get = await reader(3, 1); // Valid nondefault sizes also exercise route configuration.
  const initial = await get(roomId);
  expect(initial.hasMore).toBe(true);
  const displayed = [...initial.messages].sort(compareCreatedAtId);
  expect(displayed.map((m) => m.text)).toEqual(["A", "B", "C"]);
  expect(displayed.map((m) => m.createdAt)).toEqual(fixtures.slice(1).map((m) => m.at));

  // Capture the SQL boundary before merging, independently of display state.
  const olderCursor = initial.messages[0].id;
  expect(displayed[0].id).toBe(olderCursor);
  const older = await get(roomId, olderCursor);
  expect(older.messages.map((m) => m.text)).toEqual(["X"]);
  expect(older.hasMore).toBe(false);
  expect([...older.messages, ...displayed].sort(compareCreatedAtId).map((m) => m.text))
    .toEqual(["X", "A", "B", "C"]);
});
```

Run these with the ordinary route tests in Step 3 (red before the route exists) and Step 5 (green after it exists). This exercises real API row limiting and mapped timestamps; do not replace it with mocked RPC rows or millisecond-only fixtures. Feed reducer tests in chunks 8/9 must additionally preserve the separate older cursor under live arrivals.

- [ ] **Step 3: Run the route tests to verify they fail**

```bash
pnpm exec vitest list --config vitest.api.config.ts --filesOnly tests/api/messages.test.ts tests/api/messages-boundaries.test.ts
pnpm test:api tests/api/messages.test.ts tests/api/messages-boundaries.test.ts
```

Expected: file selection prints the two messages API files; the run fails because `@/app/api/rooms/[id]/messages/route` does not resolve; 0 tests run.

- [ ] **Step 4: Write the route handler**

Create `src/app/api/rooms/[id]/messages/route.ts` (use chunk 4's real helper names from Step 1 if they differ):

```ts
import { z } from "zod";

import { fieldIssues, json, notFound, validationError } from "@/lib/api/errors";
import { getServerConfig } from "@/lib/config/server";
import {
  CATCH_UP_PAGE_SIZE,
  insertMessage,
  listMessages,
  type ListMode,
} from "@/lib/db/messages";
import { postMessageInputSchema } from "@/lib/schemas/message";
import { messagesQuerySchema, uuidSchema } from "@/lib/schemas/query";
import { createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

// Wrapping the segment in an object gives the issue the path "id".
const paramsSchema = z.object({ id: uuidSchema });

/**
 * GET /api/rooms/:id/messages              newest HISTORY_INITIAL_SIZE, oldest first
 * GET /api/rooms/:id/messages?before=<id>  next HISTORY_PAGE_SIZE older than the cursor
 * GET /api/rooms/:id/messages?after=<id>   up to CATCH_UP_PAGE_SIZE newer, with nextCursor
 * (PRD 6.5). 400 for a bad id, query or cursor; 404 for an unknown room.
 */
export async function GET(request: Request, { params }: Context): Promise<Response> {
  const routeParams = paramsSchema.safeParse(await params);
  if (!routeParams.success) return validationError(fieldIssues(routeParams.error));

  const query = messagesQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!query.success) return validationError(fieldIssues(query.error));

  const { historyInitialSize, historyPageSize } = getServerConfig();
  const { before, after } = query.data;
  const [mode, limit]: [ListMode, number] =
    before !== undefined
      ? [{ mode: "before", cursorId: before }, historyPageSize]
      : after !== undefined
        ? [{ mode: "after", cursorId: after }, CATCH_UP_PAGE_SIZE]
        : [{ mode: "initial" }, historyInitialSize];

  const result = await listMessages(createServiceClient(), routeParams.data.id, mode, limit);
  if (result.kind === "room_not_found") return notFound();
  if (result.kind === "cursor_not_found") {
    return validationError([{ path: mode.mode, message: "is not a message in this room" }]);
  }

  const { messages, hasMore } = result;
  if (mode.mode === "after") {
    // The client's next synchronization bookmark (PRD 6.4): the last row, or
    // the cursor it sent when nothing is newer yet.
    const nextCursor = messages.at(-1)?.id ?? mode.cursorId;
    return json({ messages, hasMore, nextCursor }, 200);
  }
  return json({ messages, hasMore }, 200);
}

/**
 * POST /api/rooms/:id/messages with { author, text } (PRD 6.5). Answers 201
 * with the stored message, 400 with field errors, 404 for an unknown room.
 */
export async function POST(request: Request, { params }: Context): Promise<Response> {
  const routeParams = paramsSchema.safeParse(await params);
  if (!routeParams.success) return validationError(fieldIssues(routeParams.error));

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return validationError([{ path: "", message: "must be a JSON body" }]);
  }
  const input = postMessageInputSchema.safeParse(body);
  if (!input.success) return validationError(fieldIssues(input.error));

  const message = await insertMessage(createServiceClient(), routeParams.data.id, input.data);
  if (message === null) return notFound();
  return json({ message }, 201);
}
```

- [ ] **Step 5: Run the route tests to verify they pass**

```bash
pnpm test:api tests/api/messages.test.ts tests/api/messages-boundaries.test.ts
```

Expected: 28 tests pass across two files (26 ordinary route cases plus 2 cap/precision regressions).

If a validation-body assertion fails, check that this route maps Zod errors through `fieldIssues` before calling `validationError`. Keep the documented field-array response contract; do not weaken assertions or change chunk 4 helpers to accommodate a bad call.

- [ ] **Step 6: Lint, typecheck, build**

```bash
pnpm lint && pnpm typecheck && pnpm build
```

Expected: all exit 0. `next typegen` (inside `typecheck`) accepts the `{ params: Promise<{ id: string }> }` context type; `next build` compiles the route on the Node.js runtime with no `server-only` boundary error (the route is server code). If `next build` fails in files this chunk did not touch, report it and continue; do not fix other chunks' code here.

- [ ] **Step 7: Commit**

```bash
git add 'src/app/api/rooms/[id]/messages/route.ts' tests/api/messages.test.ts tests/api/messages-boundaries.test.ts
git commit -m "feat(api): add GET and POST /api/rooms/:id/messages"
```

---

### Task 4: Browser client `api.messages`

**Blocked until chunk 4's `src/lib/api/client.ts` is on the branch.** See "Dependencies" rule 4.

**Files:**
- Modify: `src/lib/api/client.ts`
- Test: `src/lib/api/client.messages.test.ts`

**Interfaces:**
- Consumes: `createApi`, `FetchLike`, `ApiRequestError`, `ApiValidationError`, `failWith` and imported `ApiErrorBody` from chunk 4; shared Message/page/input types.
- Produces (in `@/lib/api/client`):
  - `MessagesApi` type; `createMessagesApi(fetchImpl: FetchLike)` factory, used inside `createApi`.
  - `api.messages.list(roomId: string, params?: { before?: string }): Promise<MessagePage>`
  - `api.messages.listAfter(roomId: string, after: string): Promise<CatchUpPage>`
  - `api.messages.post(roomId: string, input: PostMessageInput): Promise<Message>`
  - Errors use existing `failWith`: validation → `ApiValidationError(fields)`; 404 and other failures → `ApiRequestError` with `.status` and optional `.code`. No automatic write retries.

- [ ] **Step 1: Confirm chunk 4's client is present and read it**

```bash
test -f src/lib/api/client.ts && rg -n '^export|fetchImpl|failWith' src/lib/api/client.ts
```

Expected: the file exports `createApi`, `api`, `FetchLike`, `ApiRequestError` and `ApiValidationError`, and contains `failWith`. Read its actual signatures. If absent, stop and report the missing dependency; do not create a substitute client.

- [ ] **Step 2: Write the failing tests**

Create `src/lib/api/client.messages.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api as defaultApi, createApi, ApiRequestError, ApiValidationError } from "@/lib/api/client";

const ROOM = "2f1b6a8e-5c1d-4f7e-9a3b-0c2d4e6f8a1b";
const CURSOR = "9c4e2d1a-7b3f-4a5e-8d6c-1f0e2a3b4c5d";

const message = {
  id: "00000000-0000-4000-8000-000000000001",
  chatroomId: ROOM,
  author: "ann",
  text: "hello",
  createdAt: "2026-09-16T10:00:00.001000Z",
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>();
let api: ReturnType<typeof createApi>;

beforeEach(() => {
  fetchMock.mockReset();
  api = createApi(fetchMock);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("injected calls must not use global fetch"); }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function requested(): { url: string; init: RequestInit | undefined } {
  const [input, init] = fetchMock.mock.calls[0];
  return { url: String(input), init };
}

describe("api.messages.list", () => {
  it("GETs the initial history", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { messages: [message], hasMore: true }));

    await expect(api.messages.list(ROOM)).resolves.toEqual({ messages: [message], hasMore: true });

    const { url, init } = requested();
    expect(url).toBe(`/api/rooms/${ROOM}/messages`);
    expect(init?.method ?? "GET").toBe("GET");
  });

  it("the exported singleton uses global fetch", async () => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue(jsonResponse(200, { messages: [], hasMore: false }));
    await expect(defaultApi.messages.list(ROOM)).resolves.toEqual({ messages: [], hasMore: false });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("GETs an older page with the before cursor", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { messages: [], hasMore: false }));

    await api.messages.list(ROOM, { before: CURSOR });

    expect(requested().url).toBe(`/api/rooms/${ROOM}/messages?before=${CURSOR}`);
  });

  it("throws ApiRequestError with status 404 when the room is gone", async () => {
    fetchMock.mockResolvedValue(jsonResponse(404, { error: { code: "not_found" } }));

    await expect(api.messages.list(ROOM)).rejects.toMatchObject({ name: "ApiRequestError", status: 404 });
  });
});

describe("api.messages.listAfter", () => {
  it("GETs the catch-up page and returns nextCursor", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { messages: [message], hasMore: false, nextCursor: message.id }),
    );

    await expect(api.messages.listAfter(ROOM, CURSOR)).resolves.toEqual({
      messages: [message],
      hasMore: false,
      nextCursor: message.id,
    });
    expect(requested().url).toBe(`/api/rooms/${ROOM}/messages?after=${CURSOR}`);
  });

  it("throws ApiRequestError for a server failure", async () => {
    fetchMock.mockResolvedValue(new Response("Internal Server Error", { status: 500 }));

    const failure = api.messages.listAfter(ROOM, CURSOR);
    await expect(failure).rejects.toBeInstanceOf(ApiRequestError);
    await expect(failure).rejects.toMatchObject({ status: 500 });
  });
});

describe("api.messages.post", () => {
  it("POSTs JSON and returns the stored message", async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, { message }));

    await expect(api.messages.post(ROOM, { author: "ann", text: "hello" })).resolves.toEqual(message);

    const { url, init } = requested();
    expect(url).toBe(`/api/rooms/${ROOM}/messages`);
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(JSON.stringify({ author: "ann", text: "hello" }));
    expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
  });

  it("maps a 400 validation body to ApiValidationError with its fields", async () => {
    const fields = [{ path: "text", message: "must be between 1 and 3000 characters" }];
    fetchMock.mockResolvedValue(jsonResponse(400, { error: { code: "validation", fields } }));

    const failure = api.messages.post(ROOM, { author: "ann", text: "" });

    await expect(failure).rejects.toBeInstanceOf(ApiValidationError);
    await expect(failure).rejects.toMatchObject({ fields });
  });

  it("throws ApiRequestError with status 404 for an unknown room", async () => {
    fetchMock.mockResolvedValue(jsonResponse(404, { error: { code: "not_found" } }));

    await expect(api.messages.post(ROOM, { author: "ann", text: "hello" })).rejects.toMatchObject({
      name: "ApiRequestError", status: 404,
    });
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm test src/lib/api/client.messages.test.ts`
Expected: FAIL because `createApi()` does not yet expose `messages`; the 9 cases cannot pass.

- [ ] **Step 4: Add the messages client**

In `src/lib/api/client.ts`, add the imports it lacks:

```ts
import type { PostMessageInput } from "@/lib/schemas/message";
import type { CatchUpPage, Message, MessagePage } from "@/lib/schemas/types";
```

Add the factory before `createApi`. Reuse the existing `failWith` and imported error union; no new error class or `ApiErrorBody` declaration is needed:

```ts
export type MessagesApi = {
  list(roomId: string, params?: { before?: string }): Promise<MessagePage>;
  listAfter(roomId: string, after: string): Promise<CatchUpPage>;
  post(roomId: string, input: PostMessageInput): Promise<Message>;
};

function messagesUrl(roomId: string, query?: Record<string, string>): string {
  const base = `/api/rooms/${encodeURIComponent(roomId)}/messages`;
  return query ? `${base}?${new URLSearchParams(query).toString()}` : base;
}

function createMessagesApi(fetchImpl: FetchLike): MessagesApi {
  async function request<T>(url: string, init?: { method: "POST"; body: string }): Promise<T> {
    const response = await fetchImpl(url, {
      method: init?.method ?? "GET",
      headers: init
        ? { accept: "application/json", "content-type": "application/json" }
        : { accept: "application/json" },
      body: init?.body,
      cache: "no-store",
    });
    if (!response.ok) return failWith(response);
    return (await response.json()) as T;
  }

  return {
    list(roomId, params) {
      return request<MessagePage>(
        messagesUrl(roomId, params?.before === undefined ? undefined : { before: params.before }),
      );
    },
    listAfter(roomId, after) {
      return request<CatchUpPage>(messagesUrl(roomId, { after }));
    },
    async post(roomId, input) {
      const { message } = await request<{ message: Message }>(messagesUrl(roomId), {
        method: "POST", body: JSON.stringify(input),
      });
      return message;
    },
  };
}
```

Replace only the return statement inside the existing `createApi` factory:

```ts
  return { rooms: createRoomsApi(fetchImpl), messages: createMessagesApi(fetchImpl) };
```

`Api = ReturnType<typeof createApi>` and `api: Api = createApi()` stay intact. Existing room calls keep their transport and error behavior.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm test src/lib/api/client.messages.test.ts`
Expected: PASS, 1 file, 9 tests.

- [ ] **Step 6: Lint, typecheck, full unit run**

```bash
pnpm lint && pnpm typecheck && pnpm test
```

Expected: all exit 0; chunk 4's own client tests still pass alongside the 9 new ones.

- [ ] **Step 7: Commit**

```bash
git add src/lib/api/client.ts src/lib/api/client.messages.test.ts
git commit -m "feat(api): add api.messages client for history, catch-up and posting"
```

---

### Task 5: README and final verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document the endpoints**

In `README.md`, insert this section immediately before the line `## Tests` (after chunk 3's "## Shared domain layer" and any chunk 4 section):

```markdown
## Messages API

Route handlers in `src/app/api/rooms/[id]/messages/route.ts` (PRD section 6.5). Responses are
JSON. A message is `{ id, chatroomId, author, text, createdAt }` with `createdAt` as an ISO-8601
UTC string with exactly six fractional digits (microseconds). Every page is oldest first.
Sort and merge with the browser-safe `compareCreatedAtId` helper; use
`Date` only for display. Realtime rows use the same `toMessage` mapper as HTTP. History-size
configuration accepts 1..999, leaving a sentinel under the required PostgREST row cap of at
least 1000. Defaults are 100/20; catch-up remains 100.

| Request                                          | Response                                                                                                          |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `GET /api/rooms/:id/messages`                    | `{ messages, hasMore }`: the newest `HISTORY_INITIAL_SIZE` (100)                                                  |
| `GET /api/rooms/:id/messages?before=<id>`        | `{ messages, hasMore }`: the next `HISTORY_PAGE_SIZE` (20) strictly older than the cursor                         |
| `GET /api/rooms/:id/messages?after=<id>`         | `{ messages, hasMore, nextCursor }`: up to 100 strictly newer; `nextCursor` is the last id, or the cursor if empty |
| `POST /api/rooms/:id/messages` `{ author, text }` | `201 { message }`                                                                                                 |

Cursors compare `(created_at, id)` tuples inside the `list_messages` database function, so
messages with the same timestamp paginate without gaps or duplicates. Errors:
`400 { error: { code: "validation", fields: [{ path, message }] } }` for a malformed id, a
malformed cursor, both cursors at once, a cursor that is not a message of that room, a non-JSON
body, or invalid fields; `404 { error: { code: "not_found" } }` for an unknown room. Browser code
calls these through `api.messages` (`list`, `listAfter`, `post`) in `src/lib/api/client.ts`.
```

Update any earlier README statement that Room or Message DTOs truncate timestamps: both now use six fractional UTC digits. Room creation and viewport merging use the same shared mapper/comparator.

In the "## Database" section's schema summary list, append one bullet after the `create_room_with_first_message` bullet:

```markdown
- `list_messages(p_room, p_mode, p_cursor, p_limit)` returns one history page (`initial`, `before`
  or `after` a cursor, comparing `(created_at, id)`). It raises `PT404` for an unknown room and
  `PT400` for a cursor outside the room; PostgREST maps those to HTTP 404 and 400. Only
  `service_role` may execute it.
```

- [ ] **Step 2: Full verification**

```bash
pnpm db:reset
pnpm test:db
pnpm test:api
pnpm test
pnpm lint
pnpm typecheck
pnpm build
git status --short
```

Expected:
- `db:reset` applies four migrations. `pnpm test:db` includes all existing files plus `list-messages`, `list-messages-rpc`, and `messages-repository`; `pnpm test:api` includes chunk 4's harness/rooms suites and messages. Every selected test passes; run the suites sequentially and report actual file/test counts, including the new boundary/precision regressions.
- `pnpm test` passes with no database access, including 27 repository and 9 client tests, configuration boundary tests, and shared precision tests.
- lint, typecheck and build exit 0.
- `git status --short` shows only ` M README.md`.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: describe the messages API and list_messages"
```

---

## Self-review notes

- **Spec coverage (chunk 5 "Scope" and "Interfaces produced").**
  - `list_messages` SQL function in a new migration with real tuple comparison: Task 1.
  - `lib/db/messages.ts` with `ListMode`, `listMessages` (ascending pages, `hasMore` via `limit + 1`), `insertMessage`: Task 2. `after` follows PRD v4 (100 max, `nextCursor`) instead of the spec's unlimited variant (reconciliation 4).
  - `app/api/rooms/[id]/messages/route.ts` GET (initial, before, after) and POST with 201/400/404: Task 3.
  - `lib/api/client.ts` messages part: Task 4 (`list`/`listAfter`/`post`, reconciliation 9).
- **Spec acceptance.**
  - 105 messages → initial 100 ascending with `hasMore: true`; `before=<oldest>` → 5 with `hasMore: false`: Task 3 tests "returns the newest 100 of 105" and "returns the 5 messages left".
  - Identical `created_at` paginates without duplicates or gaps across `before` and `after`, ordered by id: Task 1 walks and partition test; Task 3 tie tests.
  - `after=<newest>` → `[]`: Task 3 "returns an empty page and echoes the cursor". `after=<id from another room>` → 400 per PRD v4 (reconciliation 5), Task 3 cursor validation.
  - POST unknown room → 404; 3001-code-point text → 400 on `text`: Task 3.
- **PRD §8 integration items covered here.** Post, page older, poll newer with `created_at` ties; 250-message backlog as 100/100/50 with cursors and `hasMore`; A/B/C retrieves B after A; anonymous function execution fails (Task 1 privileges, RPC test). Concurrent room creation belongs to chunk 4; catching up messages committed between history load and subscription confirmation is a client behaviour (chunks 8, 11) that `?after=` supports.
- **Approved review regressions.** Tasks 1b/2 bound config and repository sizes and consume chunk 4's full-precision UTC mapping/comparison for rooms and messages. Task 3 covers the 999+1 API boundary and adversarial sub-millisecond history progress; Task 4 tests injected transport and the default singleton; Task 5 runs both integration suites sequentially.
- **Placeholder scan.** Every code step contains the code; the only conditional instructions are the dependency checks the user asked for (rules 2 to 5), with explicit module checks and a stop/report instruction; missing shared dependencies are never replaced locally.
- **Type consistency.** `ListMode`, `ListMessagesResult`, `MessageRow`, `toMessage`, `toPage`, `listMessages`, `insertMessage`, `CATCH_UP_PAGE_SIZE` are used with the same names and signatures in Tasks 2 and 3. `MessagePage`/`CatchUpPage` come from `@/lib/schemas/types` in Tasks 2, 3 and 4. `resolveSupabaseApi`/`createApiClient` (Task 1) are used by Tasks 1 and 2; Task 3 reuses chunk 4's API harness; `insertRoom`/`insertMessageAt`/`insertMessageSeries`/`DbMessageRow` (Task 1) by Tasks 1, 2 and 3. Error codes `PT404`/`PT400`/`22023`/`23503` agree between the migration, the repository and every test.
- **Deliberately out of scope.** Changing the error response helpers or rooms client behavior (chunk 4); realtime, `syncCursor` bookkeeping and the feed reducer (chunks 8, 11); generated Supabase database types (rows are typed by hand as `MessageRow`).
