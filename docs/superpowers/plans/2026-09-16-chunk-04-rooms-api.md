# Chunk 4: Rooms API Implementation Plan

**Review feedback:** [2026-09-16-chunk-04-rooms-api-feedback.md](2026-09-16-chunk-04-rooms-api-feedback.md)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create rooms (with their first message), list rooms inside a map viewport, and fetch one room, through three Next.js route handlers, plus the shared JSON error helpers, the row-to-DTO mappers, the rooms repository and the browser-side typed client for these calls.

**Architecture:** Route handlers under `src/app/api/rooms/` validate input with the chunk 3 zod schemas, call a repository (`src/lib/db/rooms.ts`) over the service-role Supabase client, and answer with the JSON shapes from the chunk spec §0.2 and PRD v4 §6.5. The repository rounds coordinates, calls the `create_room_with_first_message` RPC inside `insertWithUniqueName`, and classifies PostgREST unique violations by the constraint name inside the error message. Rows are parsed at the boundary with zod (`src/lib/db/rows.ts`) so schema drift fails loudly. `src/lib/api/client.ts` wraps `fetch` for the UI and maps error bodies to typed errors. Route handlers are integration-tested by calling the exported `GET`/`POST` functions with `new Request(...)` against the local Supabase stack.

**Tech Stack:** TypeScript 5 (strict), Next.js 16.3.5 App Router route handlers (Node.js runtime), zod 4.6, @supabase/supabase-js 2.116, Vitest 5, pnpm 10, Node 22, local Supabase stack managed by Supbuddy.

**Spec:** `docs/superpowers/specs/2026-09-16-map-chat-implementation-chunks.md`, "Chunk 4 — Rooms API" (plus §0 Global constraints, §0.1 layout, §0.2 DTOs and `ApiError`). PRD: `docs/PRD.md` §4 (input rules, map behavior), §6.3 (naming, 503), §6.5 (API, 409), §8 (integration tests). Chunk 3 handoff: `docs/superpowers/plans/2026-09-16-chunk-03-shared-domain-layer.md`, "Viewport handoff to chunks 4 and 6".

## Global Constraints

Copied from the spec §0 where they apply to this chunk, adjusted to the repository (see "Spec reconciliation"):

- Language: TypeScript, `strict: true`, no `any` in committed code.
- Package manager: pnpm (`packageManager: pnpm@10.9.0`). Node 22 LTS. No new dependencies in this chunk.
- Framework: Next.js 16, App Router, "route handlers on the Node.js runtime (never Edge). In Next 15+ route handler `params` is a `Promise` and must be awaited." Confirmed in `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md`.
- Data: `@supabase/supabase-js@2.x`. "Browser holds only the anon key. All writes go through route handlers using the service-role key."
- Validation: zod 4.x. "One schema module shared by client and server" (chunk 3's `src/lib/schemas/*`).
- Character counting: `[...s].length` in JS, `char_length()` in Postgres. Limits: author 1..100, text 1..3000, after `trim()`.
- Coordinates: lat in [-90, 90], lng in [-180, 180], "rounded to 6 decimals server-side before insert (`Math.round(x * 1e6) / 1e6`)" via chunk 3's `roundCoord`.
- Sizes: "bbox result cap 500". Rooms are returned in `created_at desc, id desc` order with a `truncated` flag (PRD v4 §4).
- Room naming (PRD §6.3): retry up to 5 times on a name collision, then one nanoid-suffixed attempt; if that also collides, the route returns 503 with a retryable error and nothing is left behind.
- Conflicts (PRD §6.3, §6.5): tell `chatrooms_name_key` (retry) from `chatrooms_lat_lng_key` (409 with the existing room) by constraint name, never by SQLSTATE alone.
- API error body (spec §0.2): `{ error: { code: 'validation'; fields: { path; message }[] } }` 400, `{ error: { code: 'not_found' } }` 404, `{ error: { code: 'conflict'; room: Room } }` 409.
- Tests: Vitest, TDD (failing test first). Unit tests colocated as `*.test.ts`; `pnpm test` stays database-free. Route-handler integration tests need the local stack.
- One commit per task, conventional commit messages.

## Chunk 3 status (read first)

Chunk 3 was still in progress when this plan was drafted, so the plan was written to allow
Tasks 1–4 to run ahead of it. On 2026-09-16 at 22:47 chunk 3 finished and was merged into
`main` (`021a72a Merge branch 'chunk-03-shared-domain-layer'`), so **nothing in this plan is
blocked**: run Tasks 1–7 in order. Verified on `main`:

| Chunk 3 deliverable | Verified | Needed by |
| --- | --- | --- |
| `src/lib/schemas/{common,message,room,query,types}.ts` | present; `pnpm test` = 133 passing | Tasks 1, 2, 3, 5, 6, 7 |
| `src/lib/names/generate.ts`: `insertWithUniqueName`, `NameCollision`, `InsertWithUniqueNameOptions = { maxRetries?; generateName?; suffix? }` | present (`150ade8`) | Tasks 5, 6, 7 |
| `src/lib/supabase/server.ts`: `createServiceClient(): SupabaseClient` (`server-only`) | present (`01aa506`) | Tasks 6, 7 |
| `nanoid`, `unique-names-generator`, `@supabase/supabase-js` in `package.json` | present | all |

If a later change makes one of these disappear, stop at the first task that imports it and
report which module is missing rather than re-implementing it here.

**Branching.** Work on a branch created from `main` in its own worktree:

```bash
cd /Users/calin/dev/other/wp
git worktree add ../wp-worktrees/chunk-04-rooms-api -b chunk-04-rooms-api main
cd ../wp-worktrees/chunk-04-rooms-api
pnpm install
pnpm test
```

Expected: `pnpm test` reports 8 files, 133 tests passing. Every command below runs from this
worktree root.

## Prerequisites (verified on 2026-09-16)

- `main` is at `021a72a`. Chunks 1, 2 and 3 are complete: config accessors, `supabase/migrations/2026091600{0100,0200,0300}_*.sql`, `tests/db/**` with `vitest.db.config.ts` (`pnpm test:db`), `@supabase/supabase-js ^2.116.0` and `postgres ^3.4.9` installed.
- The local Supabase stack is running under Supbuddy (`supabase status -o env` exits 0 and prints `API_URL`, `ANON_KEY`, `SERVICE_ROLE_KEY`, `DB_URL`). `supabase/config.toml` is tracked with `project_id = "sb-map-chat-f9e13085"`, so the CLI finds the stack from any worktree.
- Probed against that stack with the service-role key:
  - `POST /rest/v1/rpc/create_room_with_first_message` returns `{"room": {"id", "lat", "lng", "name", "created_at"}, "message": {"id", "text", "author", "created_at", "chatroom_id"}}`; `created_at` is `"2026-09-16T19:31:44.091331+00:00"` (microseconds, `+00:00`).
  - A duplicate name answers HTTP 409 with `{"code":"23505","details":"Key (name)=(probe) already exists.","hint":null,"message":"duplicate key value violates unique constraint \"chatrooms_name_key\""}`. There is no `constraint_name` field; the name is only in `message` (database plan F-002).
  - Bulk insert of an array body into `/rest/v1/chatrooms` works in one request; rows inserted together share one `created_at`, so ordering falls to `id desc`.
  - Range filters `lat=gte.&lat=lte.&lng=gte.&lng=lte.` with `order=created_at.desc,id.desc&limit=N` work; `id=eq.not-a-uuid` answers `22P02`, which is why the route validates the id first.
  - `Date.parse("2026-09-16T19:31:44.091331+00:00")` is valid in Node 22 and `toISOString()` gives `2026-09-16T19:31:44.091Z`.
- Type probe: with the untyped `SupabaseClient`, the chain `.from("chatrooms").select(...).gte().lte().order().limit()`, `.eq().maybeSingle()`, `.rpc(name, args)` and `.insert([...])` all type-check under `pnpm exec tsc --noEmit`; `data` is untyped, so every row is parsed with zod before use.
- zod 4.6.5: a non-object body gives one issue at path `[]` with message `Invalid input: expected object, received string` (or `null`, `array`, `number`). `issue.path` is `PropertyKey[]`, so it is joined with `map(String)`.
- Target one test file with `pnpm test <path>` (unit) or `pnpm test:api <path>` (route handlers), **without** `--`.

## Spec reconciliation

1. **`src/` layout and config accessors.** As in chunk 3: every path is under `src/`, imports use `@/`, and configuration comes from `getServerConfig()` through `createServiceClient()`.
2. **`GET /api/rooms` returns `{ rooms, truncated }`**, not the spec's `{ rooms }`. PRD v4 §4 and the chunk 3 handoff require the `truncated` flag and the `created_at desc, id desc` order. `findRoomsInBbox` therefore returns `{ rooms: Room[]; truncated: boolean }` and `api.rooms.list` the same object. It fetches `limit + 1` rows and reports `truncated` when more than `limit` matched.
3. **Database function name.** The spec calls it `create_chatroom_with_message`; the repository has `create_room_with_first_message(p_lat, p_lng, p_name, p_author, p_text)` returning `{"room", "message"}`. This plan uses the real one.
4. **503 error body (addition).** PRD §6.3 requires a 503 when even the suffixed name collides. `ApiErrorBody` gains `{ error: { code: 'unavailable'; message: string } }` with a `retry-after: 1` header. The client surfaces it as `ApiRequestError` with `code === "unavailable"`.
5. **Validation helper signature.** `validationError(fields: FieldIssue[])` takes the already-mapped list, with `fieldIssues(zodError)` doing the mapping, so a malformed JSON body can report `{ path: "", message: "must be a JSON body" }` without a zod error. Query-string issues are prefixed with the parameter name (`bbox`, `bbox.minLng`, `id`) so the client can attribute them.
6. **Repository extras.** Besides the spec's three functions, `lib/db/rooms.ts` exports `findRoomByCoords` (the 409 lookup), `classifyRoomConflict` (the README's HTTP contract), `ROOMS_BBOX_LIMIT`, `RepositoryError`, and `createRoom` takes an optional `{ generateName, suffix }` so tests can force name collisions deterministically.
7. **Shared full-precision timestamps.** `src/lib/db/rows.ts` exports `toRoom`, `toMessage`, `roomRowSchema`, and `messageRowSchema`. Task 2 also creates browser-safe `src/lib/time/ordering.ts`: `normalizeCreatedAt` produces UTC strings with exactly six fractional digits, and `compareCreatedAtId` compares canonical timestamp/UUID tuples without converting them to `Date`. The DTO spec gives an example, not a millisecond precision limit. Both row mappers preserve PostgreSQL microseconds. Chunk 5 reuses these helpers; chunk 6 reverses the comparator when merging viewport boxes before applying the cap; chunks 8/9 use it for message ordering; chunk 11 maps Realtime `payload.new` with the same `toMessage`. `Date` is reserved for display formatting, not ordering. This resolves the shared contract tracked by this review F-001 and chunk 5 review F-004. If chunk 5 has already introduced equivalent helpers, reuse them and their tests rather than replacing them with another implementation.
8. **Test layout.** The spec's `tests/integration/**` + `vitest.integration.config.ts` became `tests/db/**` + `vitest.db.config.ts` in chunk 2. This chunk adds `tests/api/**` + `vitest.api.config.ts` + `pnpm test:api`, kept separate because these tests import route modules through the `@` alias and need the server environment variables populated. Both suites truncate the same local tables and must not run concurrently.
9. **`server-only` in tests.** Route modules import `@/lib/supabase/server`, which imports `server-only`; outside a React Server build it throws. The route unit test mocks `@/lib/supabase/server` entirely; the API integration tests `vi.mock("server-only", () => ({}))` (same technique as chunk 3's client tests).
10. **Route context typing.** Handlers type `params` explicitly as `{ params: Promise<{ id: string }> }` (documented in the Next.js route file convention) instead of the generated `RouteContext<'/api/rooms/[id]'>`, so test files type-check before `next typegen` has run.
11. **Commits.** Plain `git`, as chunk 3 ruled (no GitButler workspace in the repository). If the user has switched to GitButler, use the `commit` skill with the same messages.

## File structure

| Path | Responsibility | Task |
| --- | --- | --- |
| `src/lib/api/errors.ts` | `ApiErrorBody`, `FieldIssue`, `fieldIssues`, `json`, `validationError`, `notFound`, `conflict`, `serviceUnavailable` | 1 |
| `src/lib/api/errors.test.ts` | Status codes, bodies, headers, issue mapping | 1 |
| `src/lib/time/ordering.ts`, `src/lib/time/ordering.test.ts` | Canonical UTC microseconds, tuple comparator, precision regressions | 2 |
| `src/lib/db/rows.ts` | `roomRowSchema`, `messageRowSchema`, `toRoom`, `toMessage`, `parseRow`, `RowShapeError` | 2 |
| `src/lib/db/rows.test.ts` | Mapping, timestamp normalisation, shape errors | 2 |
| `src/lib/api/client.ts` | `createApi`, `api`, `Api`, `RoomsApi`, `CreateRoomOutcome`, `ApiValidationError`, `ApiRequestError` | 3 |
| `src/lib/api/client.test.ts` | URL building, bodies, error mapping with a fake `fetch` | 3 |
| `vitest.api.config.ts` | Route-handler test config (`tests/api/**`, `@` alias, setup file, sequential) | 4 |
| `tests/api/setup-env.ts` | Fills `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` from `supabase status -o env` | 4 |
| `tests/api/helpers.ts` | `serviceClient()`, `apiRequest()`, `routeParams()`, re-exports `connect`, `truncateAll` | 4 |
| `tests/api/harness.test.ts` | Proves the harness reaches the stack | 4 |
| `package.json`, `README.md` | `test:api` script and its row | 4 |
| `src/lib/db/rooms.ts` | `ROOMS_BBOX_LIMIT`, `classifyRoomConflict`, `RepositoryError`, `findRoomsInBbox`, `findRoomById`, `findRoomByCoords`, `createRoom`, `CreateRoomResult`, `CreateRoomOptions` | 5 |
| `src/lib/db/rooms.test.ts` | Classifier and `createRoom` flows with a fake client | 5 |
| `src/app/api/rooms/route.ts` | `GET` (bbox list), `POST` (create) | 6 |
| `src/app/api/rooms/[id]/route.ts` | `GET` (one room) | 6 |
| `src/app/api/rooms/route.test.ts` | Status mapping with the repository mocked | 6 |
| `tests/api/rooms.test.ts` | End-to-end handler tests against the local stack | 7 |
| `README.md` | "Rooms API" section | 7 |

Dependency order: `errors` → `client`; `rows` → `rooms` → routes; harness → `tests/api/rooms.test.ts`. No barrel files.

---

### Task 1: JSON response and error helpers

**Files:**
- Create: `src/lib/api/errors.ts`
- Test: `src/lib/api/errors.test.ts`

**Interfaces:**
- Consumes: `z.ZodError` (zod), `Room` from `@/lib/schemas/types`.
- Produces (used by Tasks 3, 6 and by chunk 5's messages route):
  - `type FieldIssue = { path: string; message: string }` — `path` is dot-joined, `""` for the whole input.
  - `type ApiErrorBody` — the union of the four error bodies (`validation` 400, `not_found` 404, `conflict` 409, `unavailable` 503).
  - `fieldIssues(error: z.ZodError): FieldIssue[]`
  - `json<T>(data: T, status = 200): Response` — `Response.json`.
  - `validationError(fields: FieldIssue[]): Response` — 400.
  - `notFound(): Response` — 404.
  - `conflict(room: Room): Response` — 409.
  - `serviceUnavailable(message: string): Response` — 503 with header `retry-after: 1`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/api/errors.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  conflict,
  fieldIssues,
  json,
  notFound,
  serviceUnavailable,
  validationError,
} from "@/lib/api/errors";
import type { Room } from "@/lib/schemas/types";

const room: Room = {
  id: "0f6c1d1e-6c2c-4d7e-9a8b-1f2e3d4c5b6a",
  name: "brave-crimson-otter",
  lat: 47.497913,
  lng: 19.040236,
  createdAt: "2026-09-16T15:00:00.123000Z",
};

describe("json", () => {
  it("serialises the body with the given status and a JSON content type", async () => {
    const response = json({ ok: true }, 201);

    expect(response.status).toBe(201);
    expect(response.headers.get("content-type")).toMatch(/^application\/json/);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("defaults to status 200", () => {
    expect(json({ ok: true }).status).toBe(200);
  });
});

describe("fieldIssues", () => {
  it("maps zod issues to dot-joined paths in schema order", () => {
    const schema = z.object({
      author: z.string(),
      nested: z.object({ items: z.array(z.number()) }),
    });
    const result = schema.safeParse({ nested: { items: [1, "x"] } });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(fieldIssues(result.error)).toEqual([
      { path: "author", message: expect.any(String) },
      { path: "nested.items.1", message: expect.any(String) },
    ]);
  });

  it("uses an empty path for an issue on the whole input", () => {
    const result = z.object({ a: z.string() }).safeParse(null);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(fieldIssues(result.error)).toEqual([{ path: "", message: expect.any(String) }]);
  });
});

describe("error responses", () => {
  it("validationError answers 400 with the field list", async () => {
    const fields = [{ path: "author", message: "is required" }];
    const response = validationError(fields);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { code: "validation", fields },
    });
  });

  it("notFound answers 404", async () => {
    const response = notFound();

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: { code: "not_found" } });
  });

  it("conflict answers 409 with the existing room", async () => {
    const response = conflict(room);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: { code: "conflict", room } });
  });

  it("serviceUnavailable answers 503 with a retry hint", async () => {
    const response = serviceUnavailable("Could not find a free room name, please try again");

    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("1");
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "unavailable",
        message: "Could not find a free room name, please try again",
      },
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/lib/api/errors.test.ts`
Expected: FAIL. `@/lib/api/errors` does not resolve; 0 tests run.

- [ ] **Step 3: Write the implementation**

Create `src/lib/api/errors.ts`:

```ts
import type { z } from "zod";

import type { Room } from "@/lib/schemas/types";

/** One validation problem. `path` is dot-joined; "" means the whole input. */
export type FieldIssue = { path: string; message: string };

/**
 * Error bodies of the JSON API (chunk spec §0.2; PRD 6.3 for `unavailable`).
 * The client (`@/lib/api/client`) maps these to typed errors by `code`.
 */
export type ApiErrorBody =
  | { error: { code: "validation"; fields: FieldIssue[] } }
  | { error: { code: "not_found" } }
  | { error: { code: "conflict"; room: Room } }
  | { error: { code: "unavailable"; message: string } };

/** zod issues as `{ path, message }`, in the order zod reports them. */
export function fieldIssues(error: z.ZodError): FieldIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join("."),
    message: issue.message,
  }));
}

/** A JSON response with `status` (default 200). */
export function json<T>(data: T, status = 200): Response {
  return Response.json(data, { status });
}

/** 400: the request body or query string failed validation (PRD 6.5). */
export function validationError(fields: FieldIssue[]): Response {
  return json<ApiErrorBody>({ error: { code: "validation", fields } }, 400);
}

/** 404: no room (or, in chunk 5, no cursor message) with that id. */
export function notFound(): Response {
  return json<ApiErrorBody>({ error: { code: "not_found" } }, 404);
}

/** 409: a room already exists at the rounded coordinates; the body carries it (PRD 6.5). */
export function conflict(room: Room): Response {
  return json<ApiErrorBody>({ error: { code: "conflict", room } }, 409);
}

/** 503: a retryable failure, such as exhausting room-name attempts (PRD 6.3). */
export function serviceUnavailable(message: string): Response {
  return Response.json({ error: { code: "unavailable", message } } satisfies ApiErrorBody, {
    status: 503,
    headers: { "retry-after": "1" },
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/lib/api/errors.test.ts`
Expected: PASS, 1 file, 8 tests.

- [ ] **Step 5: Lint and typecheck**

Run: `pnpm lint && pnpm typecheck`
Expected: both exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/lib/api/errors.ts src/lib/api/errors.test.ts
git commit -m "feat(api): add JSON response and error body helpers"
```

---

### Task 2: Database row to DTO mappers

**Files:**
- Create: `src/lib/time/ordering.ts`, `src/lib/db/rows.ts`
- Test: `src/lib/time/ordering.test.ts`, `src/lib/db/rows.test.ts`
- Modify: `src/lib/schemas/types.ts` (timestamp documentation only)

**Interfaces:**
- Consumes: `Room`, `Message` from `@/lib/schemas/types`.
- Produces (used by Task 5 and by chunk 5's messages repository):
  - `roomRowSchema`: zod schema for a `chatrooms` row (`id, name, lat, lng, created_at`) whose output is a `Room`.
  - `messageRowSchema`: zod schema for a `messages` row (`id, chatroom_id, author, text, created_at`) whose output is a `Message`.
  - `class RowShapeError extends Error` — `name === "RowShapeError"`, message `Unexpected <source> row: <path> <message>; ...`.
  - `parseRow<T>(schema: z.ZodType<T>, row: unknown, source: string): T` — throws `RowShapeError`.
  - `toRoom(row: unknown): Room`, `toMessage(row: unknown): Message`.
  - `normalizeCreatedAt(value: string): string` from `@/lib/time/ordering`: UTC with exactly six fractional digits, preserving microseconds; throws `RangeError` for invalid/unsupported timestamps.
  - `compareCreatedAtId(a: { createdAt: string; id: string }, b: { createdAt: string; id: string }): number`: ascending tuple order for canonical timestamps and lowercase UUIDs; invert for descending.
  - `createdAt` is canonical UTC microsecond precision, e.g. `2026-09-16T19:31:44.091331Z`. Both modules are browser-safe and import no service clients or `server-only`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/time/ordering.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { compareCreatedAtId, normalizeCreatedAt } from "@/lib/time/ordering";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const item = (n: number, fraction: string) => ({
  id: id(n), createdAt: normalizeCreatedAt(`2026-09-16T10:00:00.${fraction}+00:00`),
});

describe("normalizeCreatedAt", () => {
  it.each([
    ["2026-09-16T10:00:00.123456+00:00", "2026-09-16T10:00:00.123456Z"],
    ["2026-09-16T10:00:00.45639+00:00", "2026-09-16T10:00:00.456390Z"],
    ["2026-09-16T10:00:00.1Z", "2026-09-16T10:00:00.100000Z"],
    ["2026-09-16T10:00:00Z", "2026-09-16T10:00:00.000000Z"],
    ["2026-09-16T12:00:00.123456+02:00", "2026-09-16T10:00:00.123456Z"],
    ["2026-09-16T23:30:00.000001-02:00", "2026-09-17T01:30:00.000001Z"],
    ["2026-09-16T00:30:00.999999+02:00", "2026-09-15T22:30:00.999999Z"],
    ["2026-09-16T10:00:00.123456Z", "2026-09-16T10:00:00.123456Z"],
  ])("normalizes %s without losing precision", (input, expected) => {
    expect(normalizeCreatedAt(input)).toBe(expected);
  });

  it.each([
    "yesterday", "2026-02-30T10:00:00Z", "2026-09-16T10:00:00",
    "2026-09-16T10:00:00.1234567Z", "2026-09-16T25:00:00Z",
    "2026-09-16T10:00:00+25:00", "2026-09-16", "infinity",
  ])("rejects invalid or unsupported timestamp %s", (input) => {
    expect(() => normalizeCreatedAt(input)).toThrow(RangeError);
  });
});

describe("compareCreatedAtId", () => {
  it("preserves microseconds before applying the UUID tie-breaker", () => {
    const older = item(2, "123100");
    const newer = item(1, "123900");
    expect([newer, older].sort(compareCreatedAtId)).toEqual([older, newer]);
  });

  it("orders exact timestamp ties by UUID and returns zero for equal tuples", () => {
    const a = item(1, "123100");
    const b = item(2, "123100");
    expect(compareCreatedAtId(a, b)).toBeLessThan(0);
    expect(compareCreatedAtId(b, a)).toBeGreaterThan(0);
    expect(compareCreatedAtId(a, { ...a })).toBe(0);
  });

  it("selects the newer boundary room when merging two boxes under the 500 cap", () => {
    const newer = item(1, "123900");
    const older = item(2, "123100");
    const aboveBoundary = Array.from({ length: 499 }, (_, i) => item(i + 3, "124000"));
    const boxes = [[...aboveBoundary, older], [newer]];
    const merged = [...new Map(boxes.flat().map((room) => [room.id, room])).values()]
      .sort((a, b) => compareCreatedAtId(b, a)).slice(0, 500);
    expect(merged).toHaveLength(500);
    expect(merged[499]).toEqual(newer);
    expect(merged).not.toContainEqual(older);
  });

  it("advances older-history continuation with opposing UUID and microsecond order", () => {
    // X exists before the initial A/B/C page. A, B and C share one millisecond.
    const x = item(4, "122000");
    const a = item(3, "123100");
    const b = item(1, "123200");
    const c = item(2, "123300");
    const displayed = [c, a, b].sort(compareCreatedAtId);
    expect(displayed[0]).toEqual(a);
    // Model SQL's before=<A> page size 1 using the known database order.
    const databaseOrder = [x, a, b, c];
    const boundary = databaseOrder.findIndex((row) => row.id === displayed[0].id);
    const before = databaseOrder.slice(0, boundary).slice(-1);
    const merged = [...new Map([...displayed, ...before].map((row) => [row.id, row])).values()]
      .sort(compareCreatedAtId);
    expect(before).toEqual([x]);
    expect(merged[0]).toEqual(x);
  });
});
```

Create `src/lib/db/rows.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { messageRowSchema, parseRow, roomRowSchema, RowShapeError, toMessage, toRoom } from "@/lib/db/rows";

const roomRow = {
  id: "62c68de5-4ca1-40d0-b9e1-df45c251ae3f",
  name: "brave-crimson-otter",
  lat: 47.497913,
  lng: 19.040236,
  created_at: "2026-09-16T19:31:44.091331+00:00",
};

const messageRow = {
  id: "263debd5-7a6a-44d3-b9d0-7271248715bd",
  chatroom_id: "62c68de5-4ca1-40d0-b9e1-df45c251ae3f",
  author: "ann",
  text: "hello\n  world",
  created_at: "2026-09-16T19:31:44.091331+00:00",
};

describe("toRoom", () => {
  it("maps a chatrooms row to the Room DTO with a microsecond UTC timestamp", () => {
    expect(toRoom(roomRow)).toEqual({
      id: "62c68de5-4ca1-40d0-b9e1-df45c251ae3f",
      name: "brave-crimson-otter",
      lat: 47.497913,
      lng: 19.040236,
      createdAt: "2026-09-16T19:31:44.091331Z",
    });
  });

  it("drops columns the DTO does not have", () => {
    expect(toRoom({ ...roomRow, extra: 1 })).not.toHaveProperty("extra");
  });

  it("converts an offset timestamp to UTC", () => {
    expect(toRoom({ ...roomRow, created_at: "2026-09-16T17:00:00+02:00" }).createdAt).toBe(
      "2026-09-16T15:00:00.000000Z",
    );
  });

  it.each([
    { label: "a missing column", row: { ...roomRow, name: undefined } },
    { label: "a non-numeric coordinate", row: { ...roomRow, lat: "47.5" } },
    { label: "a malformed id", row: { ...roomRow, id: "not-a-uuid" } },
    { label: "an unparsable timestamp", row: { ...roomRow, created_at: "yesterday" } },
    { label: "a non-object", row: "row" },
  ])("throws RowShapeError for $label", ({ row }) => {
    expect(() => toRoom(row)).toThrow(RowShapeError);
    expect(() => toRoom(row)).toThrow(/^Unexpected chatrooms row: /);
  });
});

describe("toMessage", () => {
  it("maps a messages row to the Message DTO, keeping inner whitespace", () => {
    expect(toMessage(messageRow)).toEqual({
      id: "263debd5-7a6a-44d3-b9d0-7271248715bd",
      chatroomId: "62c68de5-4ca1-40d0-b9e1-df45c251ae3f",
      author: "ann",
      text: "hello\n  world",
      createdAt: "2026-09-16T19:31:44.091331Z",
    });
  });

  it("names the messages table in its shape error", () => {
    expect(() => toMessage({ ...messageRow, chatroom_id: 7 })).toThrow(
      /^Unexpected messages row: chatroom_id /,
    );
  });
});

describe("parseRow", () => {
  it("returns the parsed value on success", () => {
    expect(parseRow(z.object({ n: z.number() }), { n: 1 }, "probe")).toEqual({ n: 1 });
  });

  it("lists every issue with its path, using <row> for the whole input", () => {
    expect(() => parseRow(z.object({ n: z.number() }), null, "probe")).toThrow(
      "Unexpected probe row: <row> Invalid input: expected object, received null",
    );
  });

  it("composes: the RPC result schema reuses both row schemas", () => {
    const schema = z.object({ room: roomRowSchema, message: messageRowSchema });

    expect(parseRow(schema, { room: roomRow, message: messageRow }, "rpc")).toEqual({
      room: toRoom(roomRow),
      message: toMessage(messageRow),
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/lib/time/ordering.test.ts src/lib/db/rows.test.ts`
Expected: FAIL: the ordering and row-mapper modules do not resolve.

- [ ] **Step 3: Write the implementation**

Create `src/lib/time/ordering.ts`:

```ts
import { z } from "zod";

const timestamp = z.iso.datetime({ offset: true });
const PARTS = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/;

/** Canonical UTC, six fractional digits. Fractions never pass through Date. */
export function normalizeCreatedAt(value: string): string {
  const parts = PARTS.exec(value);
  if (!parts || !timestamp.safeParse(value).success) {
    throw new RangeError("Expected an ISO timestamp with at most six fractional digits");
  }
  const wholeSecond = new Date(`${parts[1]}${parts[3]}`).toISOString();
  if (wholeSecond.length !== 24) throw new RangeError("UTC year must have four digits");
  return `${wholeSecond.slice(0, 19)}.${(parts[2] ?? "").padEnd(6, "0")}Z`;
}

/** Ascending SQL tuple order; inputs use canonical timestamps and lowercase UUIDs. */
export function compareCreatedAtId(
  a: { createdAt: string; id: string },
  b: { createdAt: string; id: string },
): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id === b.id ? 0 : a.id < b.id ? -1 : 1;
}
```

In `src/lib/schemas/types.ts`, replace the timestamp documentation sentence with:

```ts
// createdAt is canonical ISO-8601 UTC with exactly six fractional digits, e.g.
// "2026-09-16T15:00:00.123456Z". Use compareCreatedAtId for ordering; Date for display only.
```

Create `src/lib/db/rows.ts`:

```ts
import { z } from "zod";

import type { Message, Room } from "@/lib/schemas/types";

import { normalizeCreatedAt } from "@/lib/time/ordering";

/** Shared by HTTP and Realtime: preserve microseconds in canonical UTC form. */
const isoUtc = z.string().transform((value, ctx) => {
  try {
    return normalizeCreatedAt(value);
  } catch {
    ctx.addIssue({ code: "custom", message: `not a timestamp: ${JSON.stringify(value)}` });
    return z.NEVER;
  }
});

/** A `public.chatrooms` row (columns `id,name,lat,lng,created_at`) → `Room`. */
export const roomRowSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    lat: z.number(),
    lng: z.number(),
    created_at: isoUtc,
  })
  .transform(
    (row): Room => ({
      id: row.id,
      name: row.name,
      lat: row.lat,
      lng: row.lng,
      createdAt: row.created_at,
    }),
  );

/** A `public.messages` row (columns `id,chatroom_id,author,text,created_at`) → `Message`. */
export const messageRowSchema = z
  .object({
    id: z.uuid(),
    chatroom_id: z.uuid(),
    author: z.string(),
    text: z.string(),
    created_at: isoUtc,
  })
  .transform(
    (row): Message => ({
      id: row.id,
      chatroomId: row.chatroom_id,
      author: row.author,
      text: row.text,
      createdAt: row.created_at,
    }),
  );

/** The database answered with a shape this code does not expect (schema drift). */
export class RowShapeError extends Error {
  constructor(source: string, error: z.ZodError) {
    const issues = error.issues
      .map((issue) => `${issue.path.map(String).join(".") || "<row>"} ${issue.message}`)
      .join("; ");
    super(`Unexpected ${source} row: ${issues}`);
    this.name = "RowShapeError";
  }
}

/** Parses one row (or RPC result) with `schema`; `source` names it in the error. */
export function parseRow<T>(schema: z.ZodType<T>, row: unknown, source: string): T {
  const result = schema.safeParse(row);
  if (!result.success) throw new RowShapeError(source, result.error);
  return result.data;
}

export function toRoom(row: unknown): Room {
  return parseRow(roomRowSchema, row, "chatrooms");
}

export function toMessage(row: unknown): Message {
  return parseRow(messageRowSchema, row, "messages");
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/lib/time/ordering.test.ts src/lib/db/rows.test.ts`
Expected: PASS, 2 files, 33 tests (20 ordering + 13 mapper). The comparator regression models the merge and cursor boundary; chunk 5 must also exercise actual SQL older-page continuation, and chunk 6 must exercise its actual two-box adapter.

If `parseRow(z.object(...), ...)` fails to type-check against `z.ZodType<T>`, change the parameter type to `z.ZodType<T, unknown>` (zod 4's `ZodType<Output, Input>`); the tests and callers stay the same.

- [ ] **Step 5: Lint and typecheck**

Run: `pnpm lint && pnpm typecheck`
Expected: both exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/lib/time/ordering.ts src/lib/time/ordering.test.ts src/lib/db/rows.ts src/lib/db/rows.test.ts src/lib/schemas/types.ts
git commit -m "feat(db): add zod row parsers mapping chatrooms and messages to DTOs"
```

---

### Task 3: Typed browser client for the rooms endpoints

**Files:**
- Create: `src/lib/api/client.ts`
- Test: `src/lib/api/client.test.ts`

**Interfaces:**
- Consumes: `FieldIssue` from `@/lib/api/errors`; zod for error-envelope and payload validation; `Bbox` from `@/lib/schemas/query`; `CreateRoomInput` from `@/lib/schemas/room`; `Room`, `Message` from `@/lib/schemas/types`.
- Produces (used by chunks 6, 9, 10; extended by chunk 5):
  - `class ApiValidationError extends Error { readonly fields: FieldIssue[] }` — `name === "ApiValidationError"`.
  - `class ApiRequestError extends Error { readonly status: number; readonly code: string | undefined }` — any other non-2xx answer; `code` is the body's `error.code` when the body has a valid error envelope. Malformed variant fields fall back to this error with the HTTP status; non-string messages are ignored.
  - `type CreateRoomOutcome = { status: "created"; room: Room; message: Message } | { status: "conflict"; room: Room }`
  - `type RoomsApi = { list(bbox: Bbox): Promise<{ rooms: Room[]; truncated: boolean }>; get(id: string): Promise<Room | null>; create(input: CreateRoomInput): Promise<CreateRoomOutcome> }`
  - `type FetchLike = (input: string, init?: RequestInit) => Promise<Response>`
  - `createApi(fetchImpl?: FetchLike): { rooms: RoomsApi }` — default wraps the global `fetch`.
  - `type Api = ReturnType<typeof createApi>`; `const api: Api = createApi()`.
  - **Chunk 5 extension point:** add `messages: createMessagesApi(fetchImpl)` as a sibling key inside `createApi`'s returned object and export the `MessagesApi` type; do not change the rooms code.
  - HTTP mapping: `list` → `GET /api/rooms?bbox=minLng,minLat,maxLng,maxLat`; `get` → `GET /api/rooms/<id>` (404 → `null`); `create` → `POST /api/rooms` JSON body (201 → `created`, 409 with `conflict` body → `conflict`). 400 with a `validation` body → `ApiValidationError`; everything else non-2xx → `ApiRequestError`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/api/client.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

import { ApiRequestError, ApiValidationError, createApi, type FetchLike } from "@/lib/api/client";
import type { Message, Room } from "@/lib/schemas/types";

const room: Room = {
  id: "0f6c1d1e-6c2c-4d7e-9a8b-1f2e3d4c5b6a",
  name: "brave-crimson-otter",
  lat: 47.497913,
  lng: 19.040236,
  createdAt: "2026-09-16T15:00:00.123000Z",
};

const message: Message = {
  id: "263debd5-7a6a-44d3-b9d0-7271248715bd",
  chatroomId: room.id,
  author: "ann",
  text: "hello",
  createdAt: "2026-09-16T15:00:00.123000Z",
};

const bbox = { minLng: -1, minLat: -2, maxLng: 3, maxLat: 4 };

/** A fetch that answers every call with `status` and `body` (JSON unless a string). */
function answering(status: number, body: unknown) {
  const fetchImpl = vi.fn<FetchLike>(async () =>
    typeof body === "string"
      ? new Response(body, { status, headers: { "content-type": "text/plain" } })
      : Response.json(body, { status }),
  );
  return { api: createApi(fetchImpl), fetchImpl };
}

function requested(fetchImpl: ReturnType<typeof vi.fn<FetchLike>>) {
  const [input, init] = fetchImpl.mock.calls[0];
  return { url: new URL(input, "http://test"), init };
}

describe("api.rooms.list", () => {
  it("requests /api/rooms with the bbox query and returns rooms and truncated", async () => {
    const { api, fetchImpl } = answering(200, { rooms: [room], truncated: false });

    await expect(api.rooms.list(bbox)).resolves.toEqual({ rooms: [room], truncated: false });

    const { url, init } = requested(fetchImpl);
    expect(url.pathname).toBe("/api/rooms");
    expect(url.searchParams.get("bbox")).toBe("-1,-2,3,4");
    expect(init?.method ?? "GET").toBe("GET");
    expect(new Headers(init?.headers).get("accept")).toBe("application/json");
  });

  it("throws ApiValidationError with the fields on a 400 validation body", async () => {
    const fields = [{ path: "bbox", message: "is required" }];
    const { api } = answering(400, { error: { code: "validation", fields } });

    const error = await api.rooms.list(bbox).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiValidationError);
    expect((error as ApiValidationError).fields).toEqual(fields);
    expect((error as ApiValidationError).message).toBe("bbox is required");
  });

  it.each([
    undefined, null, {}, [{ path: 1, message: "bad" }], [{ path: "author" }],
  ])("maps malformed validation fields %j to ApiRequestError", async (fields) => {
    const { api } = answering(400, { error: { code: "validation", fields } });
    const error = await api.rooms.list(bbox).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({ status: 400, code: "validation" });
  });

  it("throws ApiRequestError with the status on a non-JSON failure", async () => {
    const { api } = answering(502, "Bad Gateway");

    const error = await api.rooms.list(bbox).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({ status: 502, code: undefined });
  });
});

describe("api.rooms.get", () => {
  it("requests /api/rooms/<id> and returns the room", async () => {
    const { api, fetchImpl } = answering(200, { room });

    await expect(api.rooms.get(room.id)).resolves.toEqual(room);
    expect(requested(fetchImpl).url.pathname).toBe(`/api/rooms/${room.id}`);
  });

  it("URL-encodes the id", async () => {
    const { api, fetchImpl } = answering(200, { room });

    await api.rooms.get("a/b c");

    expect(requested(fetchImpl).url.pathname).toBe("/api/rooms/a%2Fb%20c");
  });

  it("returns null on 404", async () => {
    const { api } = answering(404, { error: { code: "not_found" } });

    await expect(api.rooms.get(room.id)).resolves.toBeNull();
  });

  it("throws ApiRequestError on other failures", async () => {
    const { api } = answering(500, { error: { code: "internal" } });

    await expect(api.rooms.get(room.id)).rejects.toMatchObject({ status: 500, code: "internal" });
  });
});

describe("api.rooms.create", () => {
  const input = { lat: 47.497913, lng: 19.040236, author: "ann", text: "hello" };

  it("posts the input as JSON and returns the created room and message", async () => {
    const { api, fetchImpl } = answering(201, { room, message });

    await expect(api.rooms.create(input)).resolves.toEqual({ status: "created", room, message });

    const { url, init } = requested(fetchImpl);
    expect(url.pathname).toBe("/api/rooms");
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
    expect(JSON.parse(String(init?.body))).toEqual(input);
  });

  it("returns the existing room on a 409 conflict body", async () => {
    const { api } = answering(409, { error: { code: "conflict", room } });

    await expect(api.rooms.create(input)).resolves.toEqual({ status: "conflict", room });
  });

  it("throws ApiValidationError on a 400 validation body", async () => {
    const fields = [{ path: "author", message: "must be between 1 and 100 characters" }];
    const { api } = answering(400, { error: { code: "validation", fields } });

    const error = await api.rooms.create(input).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiValidationError);
    expect((error as ApiValidationError).fields).toEqual(fields);
  });

  it("throws ApiRequestError carrying the code and message on 503", async () => {
    const { api } = answering(503, {
      error: { code: "unavailable", message: "Could not find a free room name, please try again" },
    });

    await expect(api.rooms.create(input)).rejects.toMatchObject({
      name: "ApiRequestError",
      status: 503,
      code: "unavailable",
      message: "Could not find a free room name, please try again",
    });
  });

  it.each([
    undefined, null, {}, { ...room, lat: "wrong" }, { ...room, createdAt: "wrong" },
  ])("rejects malformed conflict room %j as ApiRequestError", async (invalidRoom) => {
    const { api } = answering(409, { error: { code: "conflict", room: invalidRoom } });
    const error = await api.rooms.create(input).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({ status: 409, code: "conflict" });
  });

  it("ignores a non-string error message", async () => {
    const { api } = answering(503, { error: { code: "unavailable", message: { unsafe: true } } });
    await expect(api.rooms.create(input)).rejects.toMatchObject({
      name: "ApiRequestError", status: 503, code: "unavailable",
      message: "Request failed with status 503",
    });
  });

  it("treats a 409 without a conflict body as a request error", async () => {
    const { api } = answering(409, "conflict");

    await expect(api.rooms.create(input)).rejects.toMatchObject({ status: 409 });
  });
});

describe("createApi", () => {
  it("uses the global fetch by default", () => {
    expect(createApi().rooms).toMatchObject({
      list: expect.any(Function),
      get: expect.any(Function),
      create: expect.any(Function),
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/lib/api/client.test.ts`
Expected: FAIL. `@/lib/api/client` does not resolve; 0 tests run.

- [ ] **Step 3: Write the implementation**

Create `src/lib/api/client.ts`:

```ts
import { z } from "zod";

import type { FieldIssue } from "@/lib/api/errors";
import type { Bbox } from "@/lib/schemas/query";
import type { CreateRoomInput } from "@/lib/schemas/room";
import type { Message, Room } from "@/lib/schemas/types";

/** The server rejected the input; `fields` follow the `validation` error body. */
export class ApiValidationError extends Error {
  readonly fields: FieldIssue[];

  constructor(fields: FieldIssue[]) {
    super(
      fields.map((f) => (f.path ? `${f.path} ${f.message}` : f.message)).join("; ") ||
        "Invalid input",
    );
    this.name = "ApiValidationError";
    this.fields = fields;
  }
}

/** Any other failed request. `code` is the error body's code when there was one. */
export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string | undefined;

  constructor(status: number, code?: string, message?: string) {
    super(message ?? `Request failed with status ${status}`);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
  }
}

export type CreateRoomOutcome =
  | { status: "created"; room: Room; message: Message }
  | { status: "conflict"; room: Room };

export type RoomsApi = {
  /** Rooms inside one non-crossing viewport box (PRD 6.5), capped and flagged. */
  list(bbox: Bbox): Promise<{ rooms: Room[]; truncated: boolean }>;
  /** One room, or null when the id is unknown. */
  get(id: string): Promise<Room | null>;
  /** Creates a room with its first message, or reports the room already at that spot. */
  create(input: CreateRoomInput): Promise<CreateRoomOutcome>;
};

/** The subset of `fetch` this client needs; tests pass a fake. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const JSON_HEADERS = { accept: "application/json" };

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

// Validate the envelope separately: a code alone does not prove its payload.
const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    fields: z.unknown().optional(),
    room: z.unknown().optional(),
    message: z.unknown().optional(),
  }),
});
const fieldIssuesSchema = z.array(z.object({ path: z.string(), message: z.string() }));
const conflictRoomSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  createdAt: z.iso.datetime({ precision: 6 }),
});

/** Turns a failed response into the matching typed error. Never returns. */
async function failWith(response: Response): Promise<never> {
  const parsed = errorEnvelopeSchema.safeParse(await readJson(response));
  if (!parsed.success) throw new ApiRequestError(response.status);
  const error = parsed.data.error;
  if (response.status === 400 && error.code === "validation") {
    const fields = fieldIssuesSchema.safeParse(error.fields);
    if (fields.success) throw new ApiValidationError(fields.data);
  }
  const message = typeof error.message === "string" ? error.message : undefined;
  throw new ApiRequestError(response.status, error.code, message);
}

function createRoomsApi(fetchImpl: FetchLike): RoomsApi {
  return {
    async list(bbox) {
      const query = new URLSearchParams({
        bbox: `${bbox.minLng},${bbox.minLat},${bbox.maxLng},${bbox.maxLat}`,
      });
      const response = await fetchImpl(`/api/rooms?${query}`, { headers: JSON_HEADERS });
      if (!response.ok) return failWith(response);
      // Our own server: the body follows the route contract.
      return (await response.json()) as { rooms: Room[]; truncated: boolean };
    },

    async get(id) {
      const response = await fetchImpl(`/api/rooms/${encodeURIComponent(id)}`, {
        headers: JSON_HEADERS,
      });
      if (response.status === 404) return null;
      if (!response.ok) return failWith(response);
      const { room } = (await response.json()) as { room: Room };
      return room;
    },

    async create(input) {
      const response = await fetchImpl("/api/rooms", {
        method: "POST",
        headers: { ...JSON_HEADERS, "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      if (response.status === 409) {
        const parsed = errorEnvelopeSchema.safeParse(await readJson(response));
        if (parsed.success && parsed.data.error.code === "conflict") {
          const room = conflictRoomSchema.safeParse(parsed.data.error.room);
          if (room.success) return { status: "conflict", room: room.data };
        }
        throw new ApiRequestError(409, parsed.success ? parsed.data.error.code : undefined);
      }
      if (!response.ok) return failWith(response);
      const { room, message } = (await response.json()) as { room: Room; message: Message };
      return { status: "created", room, message };
    },
  };
}

/**
 * Typed wrappers over the JSON API for client components. Chunk 5 adds a
 * `messages` sibling to the returned object. Wrapping `fetch` in an arrow
 * keeps its `this` binding in browsers.
 */
export function createApi(fetchImpl: FetchLike = (input, init) => fetch(input, init)) {
  return { rooms: createRoomsApi(fetchImpl) };
}

export type Api = ReturnType<typeof createApi>;

export const api: Api = createApi();
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/lib/api/client.test.ts`
Expected: PASS, 1 file, 24 tests.

- [ ] **Step 5: Lint and typecheck**

Run: `pnpm lint && pnpm typecheck`
Expected: both exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/lib/api/client.ts src/lib/api/client.test.ts
git commit -m "feat(api): add typed fetch client for the rooms endpoints"
```

---

### Task 4: Route-handler test harness (`pnpm test:api`)

**Files:**
- Create: `vitest.api.config.ts`, `tests/api/setup-env.ts`, `tests/api/helpers.ts`
- Test: `tests/api/harness.test.ts`
- Modify: `package.json` (scripts), `README.md` (Scripts table)

**Interfaces:**
- Consumes: `connect`, `truncateAll`, `Sql` from `tests/db/helpers.ts` (postgres.js, `DB_URL` from `supabase status`); `createClient` from `@supabase/supabase-js`.
- Produces (used by Task 7 and chunk 5's `tests/api/messages.test.ts`):
  - `pnpm test:api [file]` — runs `tests/api/**/*.test.ts` sequentially with the `@` alias and `tests/api/setup-env.ts` as a setup file.
  - `tests/api/setup-env.ts` — before each test file, fills `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` from `supabase status -o env` (`API_URL`, `ANON_KEY`, `SERVICE_ROLE_KEY`) unless the shell already set them, so `getServerConfig()` inside the handlers finds the local stack.
  - `serviceClient(): SupabaseClient` — a service-role client for seeding rows directly.
  - `apiRequest(path: string, init?: { method?: "GET" | "POST"; body?: unknown }): Request` — `http://localhost<path>`; an object body is JSON-encoded with `content-type: application/json`, a string body is sent verbatim (for malformed-JSON cases).
  - `routeParams(id: string): { params: Promise<{ id: string }> }` — the second handler argument.
  - Re-exports `connect`, `truncateAll`, `Sql`.

- [ ] **Step 1: Add the Vitest config and the script**

Create `vitest.api.config.ts`:

```ts
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// Route-handler tests. They import the handlers through the `@` alias, call
// them with `new Request(...)`, and need the local Supabase stack (service-role
// client, real tables). Kept out of `pnpm test` (src/** only) and
// `pnpm test:db` (tests/db/** only). Run with: pnpm test:api
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/api/**/*.test.ts"],
    setupFiles: ["tests/api/setup-env.ts"],
    // Files share one database and truncate between tests: never in parallel.
    fileParallelism: false,
    testTimeout: 15_000,
    hookTimeout: 60_000,
  },
});
```

In `package.json`, add after the `"test:db"` script line:

```json
    "test:api": "vitest run --config vitest.api.config.ts"
```

(Keep a trailing comma on the `test:db` line; `test:api` becomes the last script.)

- [ ] **Step 2: Write the environment setup file**

Create `tests/api/setup-env.ts`:

```ts
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
```

- [ ] **Step 3: Write the helpers**

Create `tests/api/helpers.ts`:

```ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { connect, truncateAll, type Sql } from "../db/helpers";

export { connect, truncateAll, type Sql };

/** A service-role client for seeding rows directly, bypassing the handlers under test. */
export function serviceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("tests/api/setup-env.ts did not populate the environment");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/**
 * A Request for a handler under test. `path` starts with "/api/". An object
 * `body` is sent as JSON; a string `body` is sent verbatim (malformed cases).
 */
export function apiRequest(
  path: string,
  init: { method?: "GET" | "POST"; body?: unknown } = {},
): Request {
  const hasBody = init.body !== undefined;
  return new Request(`http://localhost${path}`, {
    method: init.method ?? "GET",
    headers: hasBody
      ? { accept: "application/json", "content-type": "application/json" }
      : { accept: "application/json" },
    body: !hasBody ? undefined : typeof init.body === "string" ? init.body : JSON.stringify(init.body),
  });
}

/** The second argument of a `[id]` route handler (Next 15+: `params` is a Promise). */
export function routeParams(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}
```

- [ ] **Step 4: Write the harness test**

Create `tests/api/harness.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { apiRequest, connect, routeParams, serviceClient, truncateAll } from "./helpers";

describe("api test harness", () => {
  it("populates the server configuration from the local stack", () => {
    expect(process.env.NEXT_PUBLIC_SUPABASE_URL).toMatch(/^https?:\/\//);
    expect(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY).toBeTruthy();
    expect(process.env.SUPABASE_SERVICE_ROLE_KEY).toBeTruthy();
  });

  it("reaches the database through the service-role client", async () => {
    const { data, error } = await serviceClient().from("chatrooms").select("id").limit(1);

    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
  });

  it("shares the truncation helper with the database tests", async () => {
    const sql = connect();
    try {
      await truncateAll(sql);
      const [row] = await sql<{ count: number }[]>`select count(*)::int as count from public.chatrooms`;
      expect(row.count).toBe(0);
    } finally {
      await sql.end();
    }
  });

  it("builds handler requests and params", async () => {
    const post = apiRequest("/api/rooms", { method: "POST", body: { a: 1 } });
    expect(post.method).toBe("POST");
    expect(new URL(post.url).pathname).toBe("/api/rooms");
    expect(post.headers.get("content-type")).toBe("application/json");
    await expect(post.json()).resolves.toEqual({ a: 1 });

    const raw = apiRequest("/api/rooms", { method: "POST", body: "{not json" });
    await expect(raw.text()).resolves.toBe("{not json");

    const get = apiRequest("/api/rooms?bbox=-1,-2,3,4");
    expect(get.method).toBe("GET");
    expect(new URL(get.url).searchParams.get("bbox")).toBe("-1,-2,3,4");

    await expect(routeParams("x").params).resolves.toEqual({ id: "x" });
  });
});
```

- [ ] **Step 5: Run the harness test**

Run: `pnpm test:api tests/api/harness.test.ts`
Expected: PASS, 1 file, 4 tests. If it fails with "Could not run `supabase status`", the stack is not running: start it through Supbuddy (MCP `start_supabase`), not with `supabase start`.

- [ ] **Step 6: Document the script**

In `README.md`, in the "Scripts" table, add this row after the `pnpm test:watch` row:

```markdown
| `pnpm test:api`   | Route-handler tests in `tests/api/` (needs the stack)  |
```

- [ ] **Step 7: Lint and typecheck**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: all exit 0; `pnpm test` still runs only `src/**` (the harness file is not included).

- [ ] **Step 8: Commit**

```bash
git add vitest.api.config.ts tests/api/setup-env.ts tests/api/helpers.ts tests/api/harness.test.ts package.json README.md
git commit -m "test(api): add route-handler test harness against the local stack"
```

---

### Task 5: Rooms repository

**Files:**
- Create: `src/lib/db/rooms.ts`
- Test: `src/lib/db/rooms.test.ts`

**Interfaces:**
- Consumes: `SupabaseClient` type; `insertWithUniqueName`, `NameCollision`, `InsertWithUniqueNameOptions` from `@/lib/names/generate`; `roomRowSchema`, `messageRowSchema`, `toRoom`, `parseRow` from `@/lib/db/rows`; `roundCoord`, `CreateRoomInput` from `@/lib/schemas/room`; `Bbox` from `@/lib/schemas/query`.
- Produces (used by Task 6 and by chunk 12's `/room/[id]` page):
  - `ROOMS_BBOX_LIMIT = 500`
  - `type RoomConflict = "name" | "coordinates"`
  - `classifyRoomConflict(error: { code?: string; message: string } | null | undefined): RoomConflict | undefined` — `23505` plus the exact quoted constraint name in `message`.
  - `class RepositoryError extends Error { readonly code: string | undefined }` — wraps a PostgREST error; `message` is `<operation>: <postgrest message>`.
  - `findRoomsInBbox(db, bbox, limit = ROOMS_BBOX_LIMIT): Promise<{ rooms: Room[]; truncated: boolean }>` — inclusive bounds, `created_at desc, id desc`, fetches `limit + 1`.
  - `findRoomById(db, id: string): Promise<Room | null>`
  - `findRoomByCoords(db, lat: number, lng: number): Promise<Room | null>`
  - `type CreateRoomResult = { kind: "created"; room: Room; message: Message } | { kind: "exists"; room: Room }`
  - `type CreateRoomOptions = Pick<InsertWithUniqueNameOptions, "generateName" | "suffix">`
  - `createRoom(db, input: CreateRoomInput, opts?: CreateRoomOptions): Promise<CreateRoomResult>` — rounds coordinates, calls the RPC inside `insertWithUniqueName`; name collision → retry (`NameCollision` rethrown by the helper after the suffixed attempt, for the route's 503); coordinate collision → `findRoomByCoords` → `exists`; other PostgREST errors → `RepositoryError`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/db/rooms.test.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import {
  classifyRoomConflict,
  createRoom,
  RepositoryError,
  ROOMS_BBOX_LIMIT,
} from "@/lib/db/rooms";
import { NameCollision } from "@/lib/names/generate";

const roomRow = {
  id: "62c68de5-4ca1-40d0-b9e1-df45c251ae3f",
  name: "brave-crimson-otter",
  lat: 10.123456,
  lng: 20,
  created_at: "2026-09-16T19:31:44.091331+00:00",
};

const messageRow = {
  id: "263debd5-7a6a-44d3-b9d0-7271248715bd",
  chatroom_id: roomRow.id,
  author: "ann",
  text: "hello",
  created_at: "2026-09-16T19:31:44.091331+00:00",
};

const nameTaken = {
  code: "23505",
  details: "Key (name)=(x) already exists.",
  hint: null,
  message: 'duplicate key value violates unique constraint "chatrooms_name_key"',
};

const spotTaken = {
  code: "23505",
  details: "Key (lat, lng)=(10.123456, 20) already exists.",
  hint: null,
  message: 'duplicate key value violates unique constraint "chatrooms_lat_lng_key"',
};

type RpcAnswer = { data: unknown; error: null } | { data: null; error: typeof nameTaken };
type RpcCall = (fn: string, args: { p_name: string }) => Promise<RpcAnswer>;

/**
 * A fake client: `rpc` answers from the queue in order (the last answer
 * repeats), `from().select().eq().eq().maybeSingle()` answers `byCoords`.
 */
function fakeDb(rpcAnswers: RpcAnswer[], byCoords: unknown = null) {
  let call = 0;
  const rpc = vi.fn<RpcCall>(async () => rpcAnswers[Math.min(call++, rpcAnswers.length - 1)]);
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => ({ data: byCoords, error: null }),
  };
  const from = vi.fn(() => chain);
  return { db: { rpc, from } as unknown as SupabaseClient, rpc, from };
}

const input = { lat: 10.1234564, lng: 20.0000004, author: "ann", text: "hello" };

/** Names "name-1", "name-2", ... in call order. */
function counter(): () => string {
  let n = 0;
  return () => `name-${++n}`;
}

describe("classifyRoomConflict", () => {
  it("recognises the name constraint", () => {
    expect(classifyRoomConflict(nameTaken)).toBe("name");
  });

  it("recognises the coordinate constraint", () => {
    expect(classifyRoomConflict(spotTaken)).toBe("coordinates");
  });

  it("ignores other SQLSTATEs even with a matching message", () => {
    expect(classifyRoomConflict({ ...nameTaken, code: "23514" })).toBeUndefined();
  });

  it("ignores other unique constraints and unexpected message formats", () => {
    expect(
      classifyRoomConflict({
        code: "23505",
        message: 'duplicate key value violates unique constraint "messages_pkey"',
      }),
    ).toBeUndefined();
    expect(
      classifyRoomConflict({ code: "23505", message: "chatrooms_name_key already exists" }),
    ).toBeUndefined();
  });

  it("ignores null and undefined", () => {
    expect(classifyRoomConflict(null)).toBeUndefined();
    expect(classifyRoomConflict(undefined)).toBeUndefined();
  });
});

describe("createRoom", () => {
  it("rounds the coordinates and returns the created room and message", async () => {
    const { db, rpc } = fakeDb([{ data: { room: roomRow, message: messageRow }, error: null }]);

    const result = await createRoom(db, input, { generateName: counter() });

    expect(result).toEqual({
      kind: "created",
      room: {
        id: roomRow.id,
        name: "brave-crimson-otter",
        lat: 10.123456,
        lng: 20,
        createdAt: "2026-09-16T19:31:44.091331Z",
      },
      message: {
        id: messageRow.id,
        chatroomId: roomRow.id,
        author: "ann",
        text: "hello",
        createdAt: "2026-09-16T19:31:44.091331Z",
      },
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("create_room_with_first_message", {
      p_lat: 10.123456,
      p_lng: 20,
      p_name: "name-1",
      p_author: "ann",
      p_text: "hello",
    });
  });

  it("retries with a new name after a name collision", async () => {
    const { db, rpc } = fakeDb([
      { data: null, error: nameTaken },
      { data: null, error: nameTaken },
      { data: { room: roomRow, message: messageRow }, error: null },
    ]);

    const result = await createRoom(db, input, { generateName: counter() });

    expect(result.kind).toBe("created");
    expect(rpc.mock.calls.map(([, args]) => args.p_name)).toEqual([
      "name-1",
      "name-2",
      "name-3",
    ]);
  });

  it("gives up with NameCollision after 1 + 5 + 1 attempts", async () => {
    const { db, rpc, from } = fakeDb([{ data: null, error: nameTaken }]);

    await expect(
      createRoom(db, input, { generateName: counter(), suffix: () => "x7k2" }),
    ).rejects.toBeInstanceOf(NameCollision);
    expect(rpc).toHaveBeenCalledTimes(7);
    expect(rpc.mock.calls[6][1].p_name).toBe("name-7-x7k2");
    expect(from).not.toHaveBeenCalled();
  });

  it("returns the existing room on a coordinate collision, without a name retry", async () => {
    const existing = { ...roomRow, id: "0f6c1d1e-6c2c-4d7e-9a8b-1f2e3d4c5b6a", name: "first" };
    const { db, rpc } = fakeDb([{ data: null, error: spotTaken }], existing);

    const result = await createRoom(db, input, { generateName: counter() });

    expect(result).toEqual({
      kind: "exists",
      room: {
        id: existing.id,
        name: "first",
        lat: 10.123456,
        lng: 20,
        createdAt: "2026-09-16T19:31:44.091331Z",
      },
    });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("fails when the coordinate conflict names a room that cannot be found", async () => {
    const { db } = fakeDb([{ data: null, error: spotTaken }], null);

    await expect(createRoom(db, input, { generateName: counter() })).rejects.toThrow(
      RepositoryError,
    );
  });

  it("wraps other PostgREST errors without retrying", async () => {
    const failure = { ...nameTaken, code: "42501", message: "permission denied for function" };
    const { db, rpc } = fakeDb([{ data: null, error: failure }]);

    const error = await createRoom(db, input, { generateName: counter() }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RepositoryError);
    expect(error).toMatchObject({ code: "42501", message: "createRoom: permission denied for function" });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("rejects an RPC result of the wrong shape", async () => {
    const { db } = fakeDb([{ data: { room: roomRow }, error: null }]);

    await expect(createRoom(db, input, { generateName: counter() })).rejects.toThrow(
      /^Unexpected create_room_with_first_message row: message /,
    );
  });
});

describe("ROOMS_BBOX_LIMIT", () => {
  it("is the PRD's 500-pin cap", () => {
    expect(ROOMS_BBOX_LIMIT).toBe(500);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/lib/db/rooms.test.ts`
Expected: FAIL. `@/lib/db/rooms` does not resolve; 0 tests run.

- [ ] **Step 3: Write the implementation**

Create `src/lib/db/rooms.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { messageRowSchema, parseRow, roomRowSchema, toRoom } from "@/lib/db/rows";
import {
  insertWithUniqueName,
  type InsertWithUniqueNameOptions,
  NameCollision,
} from "@/lib/names/generate";
import type { Bbox } from "@/lib/schemas/query";
import { type CreateRoomInput, roundCoord } from "@/lib/schemas/room";
import type { Message, Room } from "@/lib/schemas/types";

/** Most rooms one viewport query returns (PRD 4, "Map behavior"). */
export const ROOMS_BBOX_LIMIT = 500;

const ROOM_COLUMNS = "id,name,lat,lng,created_at";

const createRoomResultSchema = z.object({ room: roomRowSchema, message: messageRowSchema });

/** The shape of a PostgREST error as supabase-js reports it. */
type PostgrestErrorLike = { code?: string; message: string };

export type RoomConflict = "name" | "coordinates";

/**
 * Tells the two unique violations of `create_room_with_first_message` apart
 * (PRD 6.3). PostgREST exposes no constraint field, only Postgres's message,
 * so the exact quoted constraint name is extracted from it (README, "Database").
 * Anything else is not a room conflict.
 */
export function classifyRoomConflict(
  error: PostgrestErrorLike | null | undefined,
): RoomConflict | undefined {
  if (error?.code !== "23505") return undefined;
  const constraint = /^duplicate key value violates unique constraint "([^"]+)"$/.exec(
    error.message,
  )?.[1];
  if (constraint === "chatrooms_name_key") return "name";
  if (constraint === "chatrooms_lat_lng_key") return "coordinates";
  return undefined;
}

/** A PostgREST call failed for a reason the caller does not handle (→ 500). */
export class RepositoryError extends Error {
  readonly code: string | undefined;

  constructor(operation: string, error: PostgrestErrorLike) {
    super(`${operation}: ${error.message}`);
    this.name = "RepositoryError";
    this.code = error.code;
  }
}

/** Internal: `(lat, lng)` is taken. Converted to `{ kind: "exists" }` before leaving. */
class CoordinateConflict extends Error {
  constructor() {
    super("A room already exists at these coordinates");
    this.name = "CoordinateConflict";
  }
}

/**
 * Rooms inside one non-crossing box, bounds inclusive, newest first
 * (`created_at desc, id desc`). Reads `limit + 1` rows so `truncated` says
 * whether the box holds more than `limit` rooms (PRD 4). The map splits a
 * viewport that crosses the antimeridian into two boxes (chunk 3 handoff).
 */
export async function findRoomsInBbox(
  db: SupabaseClient,
  bbox: Bbox,
  limit = ROOMS_BBOX_LIMIT,
): Promise<{ rooms: Room[]; truncated: boolean }> {
  const { data, error } = await db
    .from("chatrooms")
    .select(ROOM_COLUMNS)
    .gte("lat", bbox.minLat)
    .lte("lat", bbox.maxLat)
    .gte("lng", bbox.minLng)
    .lte("lng", bbox.maxLng)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);
  if (error) throw new RepositoryError("findRoomsInBbox", error);
  const rooms = (data as unknown[]).map(toRoom);
  return { rooms: rooms.slice(0, limit), truncated: rooms.length > limit };
}

/** One room by id, or null. `id` must already be a valid UUID (the route checks). */
export async function findRoomById(db: SupabaseClient, id: string): Promise<Room | null> {
  const { data, error } = await db
    .from("chatrooms")
    .select(ROOM_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new RepositoryError("findRoomById", error);
  return data === null ? null : toRoom(data);
}

/** The room at exactly these (already rounded) coordinates, or null. */
export async function findRoomByCoords(
  db: SupabaseClient,
  lat: number,
  lng: number,
): Promise<Room | null> {
  const { data, error } = await db
    .from("chatrooms")
    .select(ROOM_COLUMNS)
    .eq("lat", lat)
    .eq("lng", lng)
    .maybeSingle();
  if (error) throw new RepositoryError("findRoomByCoords", error);
  return data === null ? null : toRoom(data);
}

export type CreateRoomResult =
  | { kind: "created"; room: Room; message: Message }
  | { kind: "exists"; room: Room };

/** Test hooks for deterministic names; production callers pass nothing. */
export type CreateRoomOptions = Pick<InsertWithUniqueNameOptions, "generateName" | "suffix">;

/**
 * Creates a room and its first message atomically (PRD 6.3). Coordinates are
 * rounded to 6 decimals first. A name collision retries with a new name
 * (5 times, then once with a suffix; a final NameCollision propagates for the
 * route's 503). A coordinate collision returns the room already there
 * (`exists`, the route's 409). Any other PostgREST error is a RepositoryError.
 */
export async function createRoom(
  db: SupabaseClient,
  input: CreateRoomInput,
  opts: CreateRoomOptions = {},
): Promise<CreateRoomResult> {
  const lat = roundCoord(input.lat);
  const lng = roundCoord(input.lng);

  try {
    return await insertWithUniqueName(async (name): Promise<CreateRoomResult> => {
      const { data, error } = await db.rpc("create_room_with_first_message", {
        p_lat: lat,
        p_lng: lng,
        p_name: name,
        p_author: input.author,
        p_text: input.text,
      });
      if (error) {
        const conflict = classifyRoomConflict(error);
        if (conflict === "name") throw new NameCollision();
        if (conflict === "coordinates") throw new CoordinateConflict();
        throw new RepositoryError("createRoom", error);
      }
      const { room, message } = parseRow(
        createRoomResultSchema,
        data,
        "create_room_with_first_message",
      );
      return { kind: "created", room, message };
    }, opts);
  } catch (error) {
    if (!(error instanceof CoordinateConflict)) throw error;
    const room = await findRoomByCoords(db, lat, lng);
    if (room === null) {
      throw new RepositoryError("createRoom", {
        message: `coordinate conflict reported but no room found at (${lat}, ${lng})`,
      });
    }
    return { kind: "exists", room };
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/lib/db/rooms.test.ts`
Expected: PASS, 1 file, 13 tests.

- [ ] **Step 5: Lint and typecheck**

Run: `pnpm lint && pnpm typecheck`
Expected: both exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/lib/db/rooms.ts src/lib/db/rooms.test.ts
git commit -m "feat(db): add rooms repository with bbox listing and atomic creation"
```

---

### Task 6: Route handlers

**Files:**
- Create: `src/app/api/rooms/route.ts`, `src/app/api/rooms/[id]/route.ts`
- Test: `src/app/api/rooms/route.test.ts`

**Interfaces:**
- Consumes: `bboxSchema`, `uuidSchema` from `@/lib/schemas/query`; `createRoomInputSchema` from `@/lib/schemas/room`; `createServiceClient` from `@/lib/supabase/server`; `createRoom`, `findRoomsInBbox`, `findRoomById` from `@/lib/db/rooms`; `NameCollision` from `@/lib/names/generate`; the Task 1 helpers.
- Produces (HTTP contract, used by Task 3's client and chunks 6, 10, 12):
  - `GET /api/rooms?bbox=minLng,minLat,maxLng,maxLat` → 200 `{ rooms: Room[]; truncated: boolean }` | 400 (`fields[].path` is `bbox` or `bbox.<corner>`).
  - `POST /api/rooms` body `CreateRoomInput` → 201 `{ room: Room; message: Message }` | 400 (`path` `""` for a non-JSON or non-object body, else the field) | 409 `{ error: { code: "conflict", room } }` | 503 `{ error: { code: "unavailable", message } }`.
  - `GET /api/rooms/:id` → 200 `{ room: Room }` | 400 (`path` `"id"`) | 404 `{ error: { code: "not_found" } }`.
  - Handler exports: `GET(request: Request)`, `POST(request: Request)` in `route.ts`; `GET(request: Request, { params }: { params: Promise<{ id: string }> })` in `[id]/route.ts`. All declare `export const runtime = "nodejs"`.

- [ ] **Step 1: Write the failing test**

Create `src/app/api/rooms/route.test.ts` (the directory is new; `mkdir -p src/app/api/rooms`):

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

import { NameCollision } from "@/lib/names/generate";
import type { Message, Room } from "@/lib/schemas/types";

const { createRoom, findRoomsInBbox } = vi.hoisted(() => ({
  createRoom: vi.fn(),
  findRoomsInBbox: vi.fn(),
}));

vi.mock("@/lib/db/rooms", () => ({ createRoom, findRoomsInBbox }));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: () => ({ kind: "fake-client" }) }));

import { GET, POST } from "@/app/api/rooms/route";

const room: Room = {
  id: "0f6c1d1e-6c2c-4d7e-9a8b-1f2e3d4c5b6a",
  name: "brave-crimson-otter",
  lat: 47.497913,
  lng: 19.040236,
  createdAt: "2026-09-16T15:00:00.123000Z",
};

const message: Message = {
  id: "263debd5-7a6a-44d3-b9d0-7271248715bd",
  chatroomId: room.id,
  author: "ann",
  text: "hello",
  createdAt: "2026-09-16T15:00:00.123000Z",
};

function post(body: string): Promise<Response> {
  return POST(
    new Request("http://localhost/api/rooms", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    }),
  );
}

function get(query: string): Promise<Response> {
  return GET(new Request(`http://localhost/api/rooms${query}`));
}

beforeEach(() => {
  createRoom.mockReset();
  findRoomsInBbox.mockReset();
});

describe("POST /api/rooms", () => {
  it("answers 201 with the room and message, passing the trimmed input", async () => {
    createRoom.mockResolvedValue({ kind: "created", room, message });

    const response = await post(
      JSON.stringify({ lat: 47.497913, lng: 19.040236, author: " ann ", text: "hello\n" }),
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ room, message });
    expect(createRoom).toHaveBeenCalledWith(
      { kind: "fake-client" },
      { lat: 47.497913, lng: 19.040236, author: "ann", text: "hello" },
    );
  });

  it("answers 409 with the existing room", async () => {
    createRoom.mockResolvedValue({ kind: "exists", room });

    const response = await post(
      JSON.stringify({ lat: 47.497913, lng: 19.040236, author: "ann", text: "hello" }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: { code: "conflict", room } });
  });

  it("answers 503 when no free room name could be found", async () => {
    createRoom.mockRejectedValue(new NameCollision());

    const response = await post(
      JSON.stringify({ lat: 47.497913, lng: 19.040236, author: "ann", text: "hello" }),
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("1");
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "unavailable",
        message: "Could not find a free room name, please try again",
      },
    });
  });

  it("lets other errors propagate", async () => {
    createRoom.mockRejectedValue(new Error("database down"));

    await expect(
      post(JSON.stringify({ lat: 47.497913, lng: 19.040236, author: "ann", text: "hello" })),
    ).rejects.toThrow("database down");
  });

  it("answers 400 for a body that is not JSON", async () => {
    const response = await post("{not json");

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { code: "validation", fields: [{ path: "", message: "must be a JSON body" }] },
    });
    expect(createRoom).not.toHaveBeenCalled();
  });

  it("answers 400 for a JSON body that is not an object", async () => {
    const response = await post("42");

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("validation");
    expect(body.error.fields).toHaveLength(1);
    expect(body.error.fields[0].path).toBe("");
  });

  it("answers 400 with field paths for invalid fields", async () => {
    const response = await post(
      JSON.stringify({ lat: 91, lng: 19.040236, author: "𝔘".repeat(101), text: "" }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "validation",
        fields: [
          { path: "lat", message: "must be between -90 and 90" },
          { path: "author", message: "must be between 1 and 100 characters" },
          { path: "text", message: "must be between 1 and 3000 characters" },
        ],
      },
    });
    expect(createRoom).not.toHaveBeenCalled();
  });
});

describe("GET /api/rooms", () => {
  it("answers 200 with the rooms in the parsed bbox", async () => {
    findRoomsInBbox.mockResolvedValue({ rooms: [room], truncated: false });

    const response = await get("?bbox=-1,-2,3,4");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ rooms: [room], truncated: false });
    expect(findRoomsInBbox).toHaveBeenCalledWith(
      { kind: "fake-client" },
      { minLng: -1, minLat: -2, maxLng: 3, maxLat: 4 },
    );
  });

  it("answers 400 when bbox is missing", async () => {
    const response = await get("");

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { code: "validation", fields: [{ path: "bbox", message: "is required" }] },
    });
    expect(findRoomsInBbox).not.toHaveBeenCalled();
  });

  it("answers 400 with corner paths when a corner is out of range", async () => {
    const response = await get("?bbox=-1,-2,3,91");

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "validation",
        fields: [{ path: "bbox.maxLat", message: "must be between -90 and 90" }],
      },
    });
  });

  it("answers 400 for a box whose minimum exceeds its maximum", async () => {
    const response = await get("?bbox=3,4,-1,-2");

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "validation",
        fields: [{ path: "bbox", message: "minimum must not be greater than maximum" }],
      },
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/app/api/rooms/route.test.ts`
Expected: FAIL. `@/app/api/rooms/route` does not resolve; 0 tests run.

- [ ] **Step 3: Write the collection route**

Create `src/app/api/rooms/route.ts`:

```ts
import {
  conflict,
  fieldIssues,
  json,
  serviceUnavailable,
  validationError,
  type FieldIssue,
} from "@/lib/api/errors";
import { createRoom, findRoomsInBbox } from "@/lib/db/rooms";
import { NameCollision } from "@/lib/names/generate";
import { bboxSchema } from "@/lib/schemas/query";
import { createRoomInputSchema } from "@/lib/schemas/room";
import { createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/** Prefixes query-string issues with the parameter name: "bbox", "bbox.minLng". */
function underParam(param: string, issues: FieldIssue[]): FieldIssue[] {
  return issues.map((issue) => ({
    path: issue.path === "" ? param : `${param}.${issue.path}`,
    message: issue.message,
  }));
}

/**
 * GET /api/rooms?bbox=minLng,minLat,maxLng,maxLat (PRD 6.5)
 * 200 { rooms, truncated } for one non-crossing box; 400 on a bad bbox.
 */
export async function GET(request: Request): Promise<Response> {
  const bbox = bboxSchema.safeParse(new URL(request.url).searchParams.get("bbox"));
  if (!bbox.success) return validationError(underParam("bbox", fieldIssues(bbox.error)));

  return json(await findRoomsInBbox(createServiceClient(), bbox.data));
}

/**
 * POST /api/rooms { lat, lng, author, text } (PRD 6.3, 6.5, Flow A)
 * 201 { room, message }; 400 on invalid input; 409 with the room already at
 * that spot; 503 when no free room name could be found (retryable).
 */
export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return validationError([{ path: "", message: "must be a JSON body" }]);
  }

  const input = createRoomInputSchema.safeParse(body);
  if (!input.success) return validationError(fieldIssues(input.error));

  try {
    const result = await createRoom(createServiceClient(), input.data);
    if (result.kind === "exists") return conflict(result.room);
    return json({ room: result.room, message: result.message }, 201);
  } catch (error) {
    if (error instanceof NameCollision) {
      return serviceUnavailable("Could not find a free room name, please try again");
    }
    throw error;
  }
}
```

- [ ] **Step 4: Write the single-room route**

Create `src/app/api/rooms/[id]/route.ts` (quote the path in the shell: `mkdir -p 'src/app/api/rooms/[id]'`):

```ts
import { fieldIssues, json, notFound, validationError } from "@/lib/api/errors";
import { findRoomById } from "@/lib/db/rooms";
import { uuidSchema } from "@/lib/schemas/query";
import { createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * GET /api/rooms/:id (PRD 6.5): the room behind a shared `/room/<id>` URL.
 * 200 { room }; 400 when the id is not a UUID; 404 when no room has it.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const id = uuidSchema.safeParse((await params).id);
  if (!id.success) {
    return validationError(
      fieldIssues(id.error).map((issue) => ({ path: "id", message: issue.message })),
    );
  }

  const room = await findRoomById(createServiceClient(), id.data);
  return room === null ? notFound() : json({ room });
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test src/app/api/rooms/route.test.ts`
Expected: PASS, 1 file, 11 tests.

- [ ] **Step 6: Lint, typecheck and full unit run**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: all exit 0. `pnpm typecheck` runs `next typegen`, which now lists `/api/rooms` and `/api/rooms/[id]` in `.next/types/routes.d.ts`, and `tsc` accepts the explicit `params` type. `pnpm test`: 14 files, 222 tests (133 from chunks 1–3 + 8 errors + 20 ordering + 13 rows + 24 client + 13 rooms + 11 route).

- [ ] **Step 7: Commit**

```bash
git add src/app/api/rooms/route.ts 'src/app/api/rooms/[id]/route.ts' src/app/api/rooms/route.test.ts
git commit -m "feat(api): add rooms route handlers (bbox list, create, get by id)"
```

---

### Task 7: Route-handler integration tests and README

**Files:**
- Test: `tests/api/rooms.test.ts`
- Modify: `README.md` (new "Rooms API" section before `## Tests`)

**Interfaces:**
- Consumes: the handlers from Task 6, `createRoom` from Task 5, `NameCollision`, the Task 4 harness.
- Produces: the spec's chunk 4 acceptance evidence against the real database, plus PRD §8's concurrent-creation check.

- [ ] **Step 1: Write the integration tests**

Create `tests/api/rooms.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { GET as getRoom } from "@/app/api/rooms/[id]/route";
import { GET as listRooms, POST as postRoom } from "@/app/api/rooms/route";
import { createRoom } from "@/lib/db/rooms";
import { NameCollision } from "@/lib/names/generate";
import type { Message, Room } from "@/lib/schemas/types";

import { apiRequest, connect, routeParams, serviceClient, truncateAll, type Sql } from "./helpers";

// The route modules import `server-only` through `@/lib/supabase/server`; it
// throws outside a React Server build. Hoisted by Vitest above the imports.
vi.mock("server-only", () => ({}));

const ROOM_NAME = /^[a-z]+-[a-z]+-[a-z]+(-[a-z0-9]{4})?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const NIL_UUID = "00000000-0000-4000-8000-000000000000";

// One code point, two UTF-16 units: proves code-point counting end to end.
const ASTRAL = "\u{1D518}";

const spot = { lat: 47.497913, lng: 19.040236 };

interface Created {
  room: Room;
  message: Message;
}

interface ApiErr {
  error: { code: string; fields?: { path: string; message: string }[]; room?: Room };
}

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

async function post(body: unknown): Promise<{ status: number; body: unknown }> {
  const response = await postRoom(apiRequest("/api/rooms", { method: "POST", body }));
  return { status: response.status, body: await response.json() };
}

async function list(bbox: string | null): Promise<{ status: number; body: unknown }> {
  const query = bbox === null ? "" : `?bbox=${encodeURIComponent(bbox)}`;
  const response = await listRooms(apiRequest(`/api/rooms${query}`));
  return { status: response.status, body: await response.json() };
}

async function get(id: string): Promise<{ status: number; body: unknown }> {
  const response = await getRoom(apiRequest(`/api/rooms/${id}`), routeParams(id));
  return { status: response.status, body: await response.json() };
}

async function counts(): Promise<{ rooms: number; messages: number }> {
  const [rooms] = await sql<{ count: number }[]>`select count(*)::int as count from public.chatrooms`;
  const [messages] = await sql<{ count: number }[]>`select count(*)::int as count from public.messages`;
  return { rooms: rooms.count, messages: messages.count };
}

async function seedRooms(rows: { name: string; lat: number; lng: number }[]): Promise<void> {
  const { error } = await serviceClient().from("chatrooms").insert(rows);
  if (error) throw new Error(`seed failed: ${error.message}`);
}

describe("POST /api/rooms", () => {
  it("creates the room and its first message, trimming the text fields", async () => {
    const { status, body } = await post({ ...spot, author: " ann ", text: "hello\n" });

    expect(status).toBe(201);
    const { room, message } = body as Created;
    expect(room).toMatchObject({ lat: spot.lat, lng: spot.lng });
    expect(room.id).toMatch(UUID);
    expect(room.name).toMatch(ROOM_NAME);
    expect(room.createdAt).toMatch(ISO_UTC);
    expect(message).toMatchObject({ chatroomId: room.id, author: "ann", text: "hello" });
    expect(message.id).toMatch(UUID);
    expect(message.createdAt).toMatch(ISO_UTC);
    await expect(counts()).resolves.toEqual({ rooms: 1, messages: 1 });
  });

  it("rounds coordinates to 6 decimals before insert", async () => {
    const { status, body } = await post({ lat: 10.1234564, lng: 20.0000004, author: "ann", text: "hi" });

    expect(status).toBe(201);
    expect((body as Created).room).toMatchObject({ lat: 10.123456, lng: 20 });
  });

  it("answers 409 with the existing room for the same rounded spot, posting nothing", async () => {
    const first = await post({ lat: 10.1234564, lng: 20.0000004, author: "ann", text: "first" });
    expect(first.status).toBe(201);

    const second = await post({ lat: 10.1234561, lng: 20.0000001, author: "bob", text: "second" });

    expect(second.status).toBe(409);
    expect((second.body as ApiErr).error).toEqual({
      code: "conflict",
      room: (first.body as Created).room,
    });
    await expect(counts()).resolves.toEqual({ rooms: 1, messages: 1 });
  });

  it("leaves one room and only the winner's message under concurrent creation (PRD 8)", async () => {
    const [a, b] = await Promise.all([
      post({ ...spot, author: "a", text: "from a" }),
      post({ ...spot, author: "b", text: "from b" }),
    ]);

    expect([a.status, b.status].sort()).toEqual([201, 409]);
    const winner = (a.status === 201 ? a : b).body as Created;
    const loser = (a.status === 409 ? a : b).body as ApiErr;
    expect(loser.error.room).toEqual(winner.room);
    await expect(counts()).resolves.toEqual({ rooms: 1, messages: 1 });

    const [stored] = await sql<{ author: string }[]>`select author from public.messages`;
    expect(stored.author).toBe(winner.message.author);
  });

  it("counts display-name length in code points", async () => {
    const tooLong = await post({ ...spot, author: ASTRAL.repeat(101), text: "hi" });
    expect(tooLong.status).toBe(400);
    expect((tooLong.body as ApiErr).error.fields?.[0].path).toBe("author");

    const justRight = await post({ ...spot, author: ASTRAL.repeat(100), text: "hi" });
    expect(justRight.status).toBe(201);
    expect((justRight.body as Created).message.author).toBe(ASTRAL.repeat(100));
  });

  it("rejects a body that is not JSON or not an object", async () => {
    const notJson = await post("{not json");
    expect(notJson.status).toBe(400);
    expect((notJson.body as ApiErr).error.fields).toEqual([
      { path: "", message: "must be a JSON body" },
    ]);

    const notObject = await post("42");
    expect(notObject.status).toBe(400);
    expect((notObject.body as ApiErr).error.fields?.[0].path).toBe("");
    await expect(counts()).resolves.toEqual({ rooms: 0, messages: 0 });
  });
});

describe("createRoom name collisions (repository, real database)", () => {
  const input = { ...spot, author: "ann", text: "hi" };

  it("retries with a new name when the generated name is taken", async () => {
    await seedRooms([{ name: "taken-name", lat: 1, lng: 1 }]);
    const names = ["taken-name", "free-name"];
    let i = 0;

    const result = await createRoom(serviceClient(), input, {
      generateName: () => names[Math.min(i++, names.length - 1)],
    });

    expect(result.kind).toBe("created");
    if (result.kind !== "created") return;
    expect(result.room.name).toBe("free-name");
    expect(result.message.text).toBe("hi");
    await expect(counts()).resolves.toEqual({ rooms: 2, messages: 1 });
  });

  it("gives up with NameCollision after the suffixed attempt, leaving nothing behind", async () => {
    await seedRooms([
      { name: "taken-name", lat: 1, lng: 1 },
      { name: "taken-name-zzzz", lat: 2, lng: 2 },
    ]);

    await expect(
      createRoom(serviceClient(), input, { generateName: () => "taken-name", suffix: () => "zzzz" }),
    ).rejects.toBeInstanceOf(NameCollision);
    await expect(counts()).resolves.toEqual({ rooms: 2, messages: 0 });
  });
});

describe("GET /api/rooms?bbox", () => {
  it("returns only rooms inside the box, boundaries included", async () => {
    await seedRooms([
      { name: "inside", lat: 0, lng: 0 },
      { name: "on-the-edge", lat: 1, lng: 2 },
      { name: "just-north", lat: 1.000001, lng: 0 },
      { name: "just-west", lat: 0, lng: -2.000001 },
      { name: "far-away", lat: 50, lng: 50 },
    ]);

    const { status, body } = await list("-2,-1,2,1");

    expect(status).toBe(200);
    const { rooms, truncated } = body as { rooms: Room[]; truncated: boolean };
    expect(rooms.map((r) => r.name).sort()).toEqual(["inside", "on-the-edge"]);
    expect(truncated).toBe(false);
  });

  it("orders by created_at desc, then id desc", async () => {
    await seedRooms([{ name: "older", lat: 0, lng: 0 }]);
    await seedRooms([
      { name: "batch-a", lat: 0, lng: 1 },
      { name: "batch-b", lat: 0, lng: 2 },
      { name: "batch-c", lat: 0, lng: 3 },
    ]);

    const { body } = await list("-1,-1,4,1");
    const rooms = (body as { rooms: Room[] }).rooms;

    expect(rooms).toHaveLength(4);
    expect(rooms[3].name).toBe("older");
    const batch = rooms.slice(0, 3);
    expect(new Set(batch.map((r) => r.createdAt)).size).toBe(1);
    expect(batch.map((r) => r.id)).toEqual([...batch.map((r) => r.id)].sort().reverse());
  });

  it("caps the result at 500 rooms and reports truncation", async () => {
    await seedRooms(
      Array.from({ length: 501 }, (_, i) => ({ name: `cap-${i}`, lat: 10 + i * 0.000001, lng: 10 })),
    );

    const capped = await list("9,9,11,11");
    expect(capped.status).toBe(200);
    expect((capped.body as { rooms: Room[] }).rooms).toHaveLength(500);
    expect((capped.body as { truncated: boolean }).truncated).toBe(true);

    const { error } = await serviceClient().from("chatrooms").delete().eq("name", "cap-0");
    expect(error).toBeNull();

    const exact = await list("9,9,11,11");
    expect((exact.body as { rooms: Room[] }).rooms).toHaveLength(500);
    expect((exact.body as { truncated: boolean }).truncated).toBe(false);
  });

  it("rejects a missing or malformed bbox with the bbox path", async () => {
    const missing = await list(null);
    expect(missing.status).toBe(400);
    expect((missing.body as ApiErr).error.fields).toEqual([{ path: "bbox", message: "is required" }]);

    const reversed = await list("3,4,-1,-2");
    expect(reversed.status).toBe(400);
    expect((reversed.body as ApiErr).error.fields?.[0].path).toBe("bbox");

    const threeParts = await list("1,2,3");
    expect(threeParts.status).toBe(400);
    expect((threeParts.body as ApiErr).error.fields?.[0].path).toBe("bbox");
  });
});

describe("GET /api/rooms/:id", () => {
  it("returns the room", async () => {
    const created = (await post({ ...spot, author: "ann", text: "hi" })).body as Created;

    const { status, body } = await get(created.room.id);

    expect(status).toBe(200);
    expect(body).toEqual({ room: created.room });
  });

  it("answers 404 for an unknown id", async () => {
    const { status, body } = await get(NIL_UUID);

    expect(status).toBe(404);
    expect(body).toEqual({ error: { code: "not_found" } });
  });

  it("answers 400 for a malformed id", async () => {
    const { status, body } = await get("not-a-uuid");

    expect(status).toBe(400);
    expect((body as ApiErr).error.fields).toEqual([{ path: "id", message: "must be a UUID" }]);
  });
});
```

- [ ] **Step 2: Run the integration tests**

Run: `pnpm test:api tests/api/rooms.test.ts`
Expected: PASS, 1 file, 15 tests. Then `pnpm test:api` (both files): 2 files, 19 tests.

If the concurrent-creation test reports two 201s, the database function or its unique constraint has changed; check `supabase/migrations/20260916000100_create_chatrooms.sql` still declares `chatrooms_lat_lng_key`.

- [ ] **Step 3: Document the API in the README**

In `README.md`, insert this section immediately before the line `## Tests`:

```markdown
## Rooms API

Route handlers under `src/app/api/rooms/` (PRD section 6.5). They validate with the shared
zod schemas, use the service-role client, and answer JSON. Error bodies are
`{ "error": { "code": ... } }` with `code` one of `validation` (400, with `fields[]` of
`{ path, message }`), `not_found` (404), `conflict` (409, with the existing `room`) or
`unavailable` (503, retryable).

| Method and path                                   | Success                                  |
| ------------------------------------------------- | ---------------------------------------- |
| `GET /api/rooms?bbox=minLng,minLat,maxLng,maxLat` | `200 { rooms, truncated }`, newest first, at most 500 rooms in one non-crossing box |
| `POST /api/rooms` `{ lat, lng, author, text }`    | `201 { room, message }`; `409` if a room already exists at the rounded spot |
| `GET /api/rooms/:id`                              | `200 { room }`                           |

Room and message `createdAt` values are UTC with six fractional digits. Shared
`compareCreatedAtId` preserves chronological order; `Date` is for display formatting only.
Coordinates are rounded to 6 decimals before insert. Room names come from
`insertWithUniqueName` (`@/lib/names/generate`); if every attempt collides, the route answers
503 and nothing is stored. Client components call these through `api.rooms` in
`@/lib/api/client`, which turns error bodies into `ApiValidationError` / `ApiRequestError`.

`pnpm test:api` runs `tests/api/` against the local stack: it calls the handler functions
directly, seeds rows with the service-role key, and truncates `chatrooms` and `messages`
between tests, like `pnpm test:db`. Do not run the two suites at the same time.
```

- [ ] **Step 4: Full verification**

```bash
pnpm test
pnpm test:api
pnpm test:db
pnpm lint
pnpm typecheck
git status --short
```

Expected:
- `pnpm test`: 14 files, 222 tests pass, no database access.
- `pnpm test:api`: 2 files, 19 tests pass. `pnpm test:db`: still passes (its tables are truncated by both suites; run them one after the other).
- `pnpm lint` and `pnpm typecheck` exit 0.
- `git status --short` shows exactly ` M README.md` and `?? tests/api/rooms.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add tests/api/rooms.test.ts README.md
git commit -m "test(api): cover the rooms route handlers against the local stack; document the API"
```

---

## Self-review notes

- **Spec coverage (chunk 4 "Scope" and "Interfaces produced").**
  - `lib/api/errors.ts` with `validationError`, `notFound`, `conflict`, `json`: Task 1 (plus `serviceUnavailable` for PRD 6.3's 503).
  - `lib/db/rooms.ts` with `findRoomsInBbox`, `findRoomById`, `CreateRoomResult`, `createRoom` (rounds, RPC inside `insertWithUniqueName`, `chatrooms_lat_lng_key` → lookup by coords → `exists`): Task 5.
  - `app/api/rooms/route.ts` (GET, POST) and `app/api/rooms/[id]/route.ts` (GET): Task 6.
  - `lib/api/client.ts` rooms part with `api.rooms.list/get/create`, `ApiValidationError`: Task 3.
- **Spec acceptance.**
  - POST creates room + message; name matches `/^[a-z]+-[a-z]+-[a-z]+(-[a-z0-9]{4})?$/`: Task 7.
  - Second POST with the same rounded coords (`10.1234564` vs `10.1234561`) → 409 with the first room: Task 7.
  - Author of 101 code points → 400 with `fields[0].path === 'author'`: Tasks 6 and 7.
  - GET bbox returns only rooms inside; 501 inserted → 500 returned: Task 7.
  - GET unknown id → 404; malformed uuid → 400: Task 7.
- **PRD additions.** `{ rooms, truncated }` with `created_at desc, id desc` (PRD v4 §4): Tasks 5, 7. Concurrent creation leaves one room and the winner's message (PRD §8): Task 7. 503 with nothing left behind (PRD §6.3): Tasks 5, 6, 7.
- **Chunk 3 handoff.** The single-box `bboxSchema` is unchanged. Chunk 6 merges and deduplicates per-box results, sorts descending with `compareCreatedAtId(b, a)` using preserved microseconds, then caps the combined result at 500. Task 2 covers adversarial UUIDs at that cap boundary; chunk 6 must test the actual adapter. Chunk 5 review F-004 tracks the same precision defect for message continuation; reuse Task 2's helpers and keep an actual SQL pagination regression there.
- **Type consistency.** `FieldIssue`, `ApiErrorBody`, `validationError(fields)` (Task 1) define the response contract; Task 3 validates unknown error envelopes and payloads before exposing typed outcomes. Task 6 uses the response helpers. `toRoom`/`toMessage`/`parseRow`/`roomRowSchema`/`messageRowSchema` (Task 2) are what Task 5 imports. `CreateRoomResult` uses `kind`, `CreateRoomOutcome` (client) uses `status`, as the spec writes them. `createApi`/`FetchLike` names match between client and its test. `apiRequest`/`routeParams`/`serviceClient` (Task 4) are what Task 7 imports. The 503 message string is identical in Tasks 3, 6 and 7.
- **Historical verification before the approved review changes.** These counts describe the earlier draft, not the revised timestamp/error-validation snippets. Every TypeScript block in Tasks 1–6 was extracted verbatim from this plan into the `main` checkout on 2026-09-16 and run: `pnpm test` 13 files / 191 tests, `pnpm lint`, `pnpm typecheck` all green; `pnpm test:api tests/api/harness.test.ts` 4 tests green against the running stack. Task 7's file was run the same way: `pnpm test:api` 2 files / 19 tests green (concurrent creation, 501-room cap and name-collision retries included), and `pnpm test:db` (52 tests) still passed afterwards. The probe files were then deleted; nothing from this chunk is committed yet, so the executor still does every step, including watching each test fail first.
- **Deliberately out of scope.** Messages endpoints and `api.messages` (chunk 5), viewport splitting and pin merging (chunk 6), the `/room/[id]` page (chunk 12), a 500 JSON body for unexpected errors (Next's default 500 is accepted for the POC; the client maps it to `ApiRequestError`).
