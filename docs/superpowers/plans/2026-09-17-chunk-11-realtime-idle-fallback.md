# Chunk 11: Realtime with Idle Fallback Implementation Plan

**Review feedback:** [2026-09-17-chunk-11-realtime-idle-fallback-feedback.md](2026-09-17-chunk-11-realtime-idle-fallback-feedback.md)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver new messages to an open room over Supabase Realtime, with the attempt-and-fallback behaviour of PRD 6.4: try realtime when a room opens, fall back to polling when it is refused or drops, leave realtime after three idle minutes, and try again when the visitor sends a message.

**Architecture:** The reducer (chunk 8) and the store (chunk 9) already run the whole connection lifecycle against an injected `SubscribeToRoom` adapter; until now the hook injected a stand-in that always refuses. This chunk writes the real adapter, `subscribeToRoom`, over one `postgres_changes` channel per attempt, makes it the hook's default, and adds `attachActivityTracking`, which `RoomPanel` attaches to its root so activity inside the panel postpones the idle timeout. No reducer, store or hook logic changes. The polling e2e scenarios keep running in polling mode by refusing the websocket in the browser; six new e2e scenarios run against the real Realtime server. Readiness requires both the channel join and the server’s Postgres subscription acknowledgement. MessageList reports user scrolling separately from its own automatic positioning.

**Tech Stack:** TypeScript 5 (`strict`), Next.js 16.3.5 App Router, React 19.2.8, `@supabase/supabase-js` 2.116.0 (`@supabase/realtime-js` 2.116.0), zod 4, Vitest 5 with jsdom 30 and Testing Library, `@playwright/test` 1.63 on chunk 9's harness (Chromium only), pnpm 10, Node 22.

**Spec:** `docs/superpowers/specs/2026-09-16-room-feed-design.md` (reviewed revision of 2026-09-17; its companion `2026-09-16-room-feed-design-feedback.md` records the accepted findings F-001–F-005). This chunk implements §8 and the chunk 11 parts of §7 and §9; §5 and §6 describe the reducer and store it plugs into. Read together with `docs/superpowers/specs/2026-09-17-room-panel-design.md` §3 decision 4, §4 "Other rules" and §8 (the e2e harness rules). Parent: `docs/superpowers/specs/2026-09-16-map-chat-implementation-chunks.md` §0 and "Chunk 11". PRD (`docs/PRD.md`): §6.4 (all), §6.1 (anon key only), §7 (Free plan limits), §8 (manual smoke). Executors read room-feed design §6, §7 and §8 before Task 1; this plan argues from the spec and does not restate it.

## Global Constraints

Copied from the chunks document §0 and the specs where they apply to this chunk:

- Language: TypeScript, `strict: true`, no `any` in committed code.
- Package manager: pnpm (`packageManager: pnpm@10.9.0`). Node 22 LTS.
- Framework: Next.js 16, App Router. `AGENTS.md`: this Next.js has breaking changes; read the relevant guide under `node_modules/next/dist/docs/` before writing Next-specific code. This plan writes no Next-specific code.
- Data: `@supabase/supabase-js@2.x`. The browser holds only the anon key and uses it only for Realtime subscriptions, through the memoised `getBrowserClient()`. All writes go through route handlers. This chunk adds no dependency and changes no migration: `public.messages` is already in the `supabase_realtime` publication (`supabase/migrations/20260916000200_create_messages.sql`).
- Supbuddy manages the local stack. Never edit `/etc/resolver/` files or a `Caddyfile`; start the dev server with `pnpm dev` (`supbuddy run -- next dev`); do not run a bare `supabase start`.
- Realtime contract, reconciled with room-feed design §8 and approved F-001: channel name `room:<id>`; `postgres_changes` with `event: 'INSERT'`, `schema: 'public'`, `table: 'messages'`, `filter: 'chatroom_id=eq.<id>'`. `SUBSCRIBED` records the channel join; `onSubscribed()` fires once both that join and a matching `system` event with `extension: "postgres_changes"`, `status: "ok"` have arrived; `CHANNEL_ERROR`, `TIMED_OUT` → `onFailed(status)`; `CLOSED` → `onFailed('CLOSED')` unless `unsubscribe()` was called. A matching Postgres `system` error or the 20-second setup deadline also fails the attempt. The first failure is terminal for the attempt: later SDK callbacks are suppressed, the channel is removed with `client.removeChannel(channel)`, and `onFailed` is reported once. Intentional removal never reports a failure. A row that fails the row schema is dropped and logged; it does not fail the channel.
- Activity events, reconciled with §8 and approved F-002: `pointerdown`, `pointermove`, `keydown`, `wheel`, `scroll` (capture) and `touchstart`, all passive. The root excludes the MessageList scroll target; MessageList reports only reader-originated scrolling via `onUserScroll`. Automatic positioning never restarts idle. Document visibility belongs to `useRoomFeed`, not to activity tracking.
- Sizes: polling 30000 ms, idle 180000 ms, both from `getClientConfig()`. No test overrides them through the environment.
- No offline handling, no retry backoff, no automatic re-subscribe on activity other than sending, no automatic catch-up on return from a hidden tab (room-feed design §10).
- `src/lib/feed/reducer.ts`, `src/lib/feed/types.ts`, `src/lib/feed/store.ts` and `src/lib/supabase/browser.ts` are **not modified**.
- Tests: Vitest, TDD (failing test first). Unit tests colocated as `*.test.ts(x)`; component files opt in with `// @vitest-environment jsdom` on the first line. Target one path with `pnpm test <path>` **without** `--`. No unit test may open a websocket or create a real Supabase client.
- End-to-end: chunk 9's harness with its rules unchanged: Chromium, explicit 1280 × 720 viewport, real dev server and local Supabase, data through the real API, `page.clock` for timing, no database reset. Never run `pnpm test:api` or `pnpm test:db` while `pnpm test:e2e` runs (they truncate tables). Selectors are roles and visible text, with one exception this chunk uses: the panel root's `data-connection` attribute, which room-panel design §3 decision 4 put there "for tests and the chunk 11 smoke".
- Lint: `pnpm lint` must pass with zero errors and zero warnings after every task. Typecheck: `pnpm typecheck` (`next typegen && tsc --noEmit`) must exit 0.
- Commits: conventional commits, one commit per task. This repository has no GitButler workspace, so the steps use plain `git`; if GitButler is active when you execute, use the `commit` skill with the same messages.

## Prerequisites (verified on 2026-09-17)

- `main` is at `e1b7f90` (merge of `chunk-09-room-panel`). Chunks 8 and 9 are merged. **Chunk 10 is not merged**: on 2026-09-17 it is being executed on branch `chunk-10-new-room` (worktree `wp-worktrees/chunk-10-new-room`, one documentation commit so far). This chunk does not depend on it. If chunk 10 lands first, which is likely, Task 6 Step 5 applies; if it lands later, the hand-off note at the end of this plan applies to its executor. Never start a dev server on a port another worktree's session is using (chunk 10's prototype runs use `-p 3100`); pick a free one.
- Baseline on `main`: `pnpm test` → **36 files, 695 tests**; `pnpm test:e2e` → **18 passed**. This plan calls them **B-files**, **B-tests**, **B-e2e**. If chunk 10 landed first, your baseline is higher; every "Expected" count below is then "baseline + the stated increase".
- Present on `main`, with the names this plan uses:
  - `src/lib/feed/realtime.ts`: the types `RealtimeHandle`, `RealtimeHandlers`, `SubscribeToRoom` and the stand-in `pollingOnlySubscribe`. No `subscribeToRoom` yet.
  - `src/lib/feed/store.ts`: `createFeedStore`, `FeedDeps`, `FeedTimers`, `FeedStore`. It already gives every `subscribe` effect an attempt token, cleans up a handle exactly once, turns a throwing adapter into `channelFailed`, runs the idle timeout and implements `activity()`. **Chunk 11 needs no store change.**
  - `src/lib/feed/useRoomFeed.ts`: `resolveDeps` with `subscribe: deps.subscribe ?? pollingOnlySubscribe`.
  - `src/lib/feed/test-helpers.ts`: `ROOM`, `id`, `msg`, `page`, `catchUp`, `fakeMessages`, `fakeRealtime`, `manualTimers`, `TEST_CONFIG`.
  - `src/lib/supabase/browser.ts`: `getBrowserClient()`; `src/lib/db/rows.ts`: `toMessage(row: unknown): Message`, which throws `RowShapeError` on a bad row and accepts both `Z` and `+00:00` timestamps.
  - `src/components/room/RoomPanel.tsx`: the root `<div data-connection={feed.connection} …>`; `RoomPanel.test.tsx` with `setup`, `openPolling`, `openWithBacklog`, `settle`.
  - `tests/e2e/helpers.ts`: `openRoom`, `openPollingRoom`, `pollNow`, `expectNoCatchUp`, `createRoom`, `postMessage`, `rows`, `fillCompose`, and the private `observeCatchUps`, `probeOf`, `waitForCatchUpIdle`.
- **SDK facts this plan relies on**, read from `node_modules/.pnpm/@supabase+realtime-js@2.116.0/node_modules/@supabase/realtime-js/src/`:
  - `RealtimeClient.channel(topic)` returns the **existing** channel when one with topic `realtime:<topic>` is still registered (`RealtimeClient.ts`, `channel()`), and `RealtimeChannel.subscribe()` does nothing, with no status callback, unless that channel is closed (`if (this.channelAdapter.isClosed())`). A channel stays registered from `removeChannel()` until the server acknowledges the leave.
  - `removeChannel(channel)` is `await channel.unsubscribe()` then `teardown()`; leaving fires the subscribe callback with `CLOSED`.
  - When the last channel is removed the socket is **not** closed at once: `_schedulePendingDisconnect()` waits `disconnectOnEmptyChannelsAfterMs`, which defaults to 2 × the 25 s heartbeat = 50 s. `connect()` is skipped while the socket is disconnecting.
- **Original prototype (before approved F-001/F-002 corrections; historical evidence only).** On 2026-09-17 the code of this plan was prototyped in a scratch worktree of `main` at `e1b7f90`. Results: `pnpm test` **38 files / 732 tests**; `pnpm lint` and `pnpm typecheck` clean; `pnpm build` route list exactly `/`, `/_not-found`, `/api/health`, `/api/rooms`, `/api/rooms/[id]`, `/api/rooms/[id]/messages`; `pnpm exec playwright test --repeat-each 5` **110 passed** (22 tests × 5) in Chromium against `next dev -p 3100 -H 127.0.0.1` and the local Supabase stack with its real Realtime server. With the default adapter swapped and the harness unchanged, exactly the 7 `openPollingRoom` scenarios failed; with the websocket refused they passed. The original mutation runs of Task 3 and Task 7 (then scenarios 1–4) failed the tests named in that revision. A websocket probe showed `phx_join`, then `phx_leave` at the idle timeout, and the socket closing between 49 s and 51 s later. The `pnpm dev`/Supbuddy start-up path and the two-browser manual smoke were not exercised. These historical results do not validate the revised code or new tests below. Re-run all prescribed checks during execution; investigate differing counts instead of weakening tests.

### Readiness compatibility verified during the approved revision

`docker ps --format '{{.Names}} {{.Image}}'` identified the map-chat container as
`supabase_realtime_sb-map-chat-f9e13085`, image `public.ecr.aws/supabase/realtime:v2.124.2`.
That version does **not** implement `config.postgres_changes_options.wait`; do not enable the
SDK option and assume the server honors it. Its [versioned channel source](https://github.com/supabase/realtime/blob/v2.124.2/lib/realtime_web/channels/realtime_channel.ex)
emits a `system` event for `extension: "postgres_changes"` after subscription setup, with
`status: "ok"` on success and `"error"` on failure. A read-only anon-key probe on 2026-09-17
observed `SUBSCRIBED`, then `{ extension: "postgres_changes", status: "ok", message:
"Subscribed to PostgreSQL" }`; its channel was removed afterward. No messages were written.
Task 1 uses this existing handshake and a 20-second attempt deadline. No server upgrade is
required. The deadline bounds setup independently of the 180-second user-idle timeout.
Deployment to a different server version must repeat the handshake check; never silently
fall back to treating the channel join alone as ready.

## Before you start: worktree and documents

Execute this plan in its own worktree, following the sibling convention in use:

```bash
cd /Users/calin/dev/other/wp
git log --oneline -1 main        # e1b7f90 or later
git worktree add -b chunk-11-realtime /Users/calin/dev/other/wp-worktrees/chunk-11-realtime main
cd /Users/calin/dev/other/wp-worktrees/chunk-11-realtime
```

This plan is not committed on `main` at writing time. Bring it into the worktree and commit it first. The script commits nothing if the file was committed on `main` in the meantime.

```bash
chunk_docs=(
  docs/superpowers/plans/2026-09-17-chunk-11-realtime-idle-fallback.md
  docs/superpowers/plans/2026-09-17-chunk-11-realtime-idle-fallback-feedback.md
  docs/superpowers/specs/2026-09-16-room-feed-design.md
  docs/superpowers/specs/2026-09-17-room-panel-design.md
)
for chunk_doc in "${chunk_docs[@]}"; do
  test -f "/Users/calin/dev/other/wp/$chunk_doc" || exit 1
  mkdir -p "$(dirname "$chunk_doc")" || exit 1
  cp "/Users/calin/dev/other/wp/$chunk_doc" "$chunk_doc" || exit 1
done
git add -- "${chunk_docs[@]}"
if ! git diff --cached --quiet -- "${chunk_docs[@]}"; then
  git commit --only -m "docs(feed): add the chunk 11 plan" -- "${chunk_docs[@]}"
fi
git ls-files --error-unmatch -- "${chunk_docs[@]}" docs/superpowers/specs/2026-09-16-room-feed-design.md
```

Expected: all four revision documents are tracked. Carry the revised specs with the plan so the readiness and user-scroll contracts cannot drift.

```bash
pnpm install
pnpm db:env          # writes .env.local from the running stack (needed by the e2e tasks)
```

Verify the names this plan consumes and record your baseline:

```bash
grep -c "export type RealtimeHandle\|export type RealtimeHandlers\|export type SubscribeToRoom\|export const pollingOnlySubscribe" src/lib/feed/realtime.ts
grep -c "subscribe: deps.subscribe ?? pollingOnlySubscribe" src/lib/feed/useRoomFeed.ts
grep -c "export function \(msg\|fakeMessages\|fakeRealtime\|manualTimers\)\|export const \(ROOM\|id\|page\|TEST_CONFIG\) " src/lib/feed/test-helpers.ts
grep -c "export function toMessage" src/lib/db/rows.ts
grep -c "export function getBrowserClient" src/lib/supabase/browser.ts
grep -c "<div data-connection={feed.connection}" src/components/room/RoomPanel.tsx
grep -c "^async function waitForCatchUpIdle\|^export async function openPollingRoom\|^const probeOf\|^async function observeCatchUps" tests/e2e/helpers.ts
pnpm test 2>&1 | grep -E "Test Files|Tests "
```

Expected, in order: `4`, `1`, `8`, `1`, `1`, `1`, `4`, then `36 passed` / `695 passed` (or your higher chunk 10 baseline). If a count differs, open that file and read the real name or signature; carry the difference through every later task before writing code (room-feed design §2 makes this the plan's first obligation).

Every path below is relative to this worktree.

## Spec reconciliation and design decisions

The spec wins on everything not listed here. These are the points where the plan pins down something the spec leaves open, or departs from its wording.

1. **The store work of room-feed design §9 ("`store.test.ts` additions (chunk 11)") is tests only.** Chunk 9's store already interprets `subscribe`, `unsubscribe`, `startIdleTimer` and `stopIdleTimer` and already has tests for a late drop, a failed confirmation catch-up and `activity()`. Task 3 adds the missing §9 cases. They pass the moment they are written, so the task proves them with two mutations of the store instead of a red run.
2. **A second attempt on a topic that is still registered is refused, not reused** (`TOPIC_BUSY`). The spec does not mention it. Without the guard, re-subscribing to a room whose previous channel is still waiting for its leave acknowledgement gets the old channel back, `subscribe()` silently does nothing, and the store stays in `subscribing` for good (see "SDK facts"). With the guard the attempt fails at once, the store keeps or enters polling, and the next send tries again. The channel name stays `room:<id>` as the spec and PRD require; a unique name per attempt would avoid the collision but break that contract. The guard leaves the old channel alone: its own attempt is already removing it.
3. **The websocket closes about 50 s after the room leaves its channel, not at the idle timeout.** That is the SDK's deferred disconnect. This plan keeps it: setting `disconnectOnEmptyChannelsAfterMs: 0` would close the socket at once, but a room switch would then call `connect()` while the socket is still disconnecting, which the SDK skips, and the join would time out after 10 s. `browser.ts` is therefore untouched. Room-feed design §9's smoke line "after the idle timeout the websocket closes" becomes "the channel leaves (`phx_leave`) and a poll fires at once; the websocket closes about 50 s later". Task 8 records this in `KNOWN_LIMITATIONS.md`.
4. **`pollingOnlySubscribe` stays exported** as a test and fixture utility (the store tests use it). Its failure reason changes from `"realtime not implemented"` to `"realtime refused"`, because the old text stops being true. Nothing asserts the reason.
5. **`src/lib/feed/activity.test.ts` is added**, although room-feed design §2 lists no test file for `activity.ts`.
6. **The chunks document's chunk 11 section is older than the room-feed spec** and names `attachActivityTracking(el, onActivity, onHidden)`, a `visibilitychange` listener in activity tracking, and a `subscribeFailed` action. The reviewed spec wins: `attachActivityTracking(el, { onActivity, ignoreScroll? })`, visibility owned by `useRoomFeed` (already implemented in chunk 9), and the action `channelFailed`. Task 8 corrects that section.
7. **Polling e2e scenarios refuse the websocket in the browser** with `page.routeWebSocket` (Playwright ≥ 1.48; 1.63 is installed), closing every `/realtime/v1/websocket` connection before it reaches the server. To the client that is a refused connection, so these scenarios now cover the refusal path of PRD 6.4 with the real adapter instead of a stand-in. No product switch, query parameter or environment variable turns realtime off.
8. **Unit tests never reach Supabase.** With `subscribeToRoom` as the default, `MapShell.test.tsx` (the only unit test that renders the panel without injected `feedDeps`) would create a real client and try a websocket. Task 6 mocks the default adapter there with a spy, and the same spy proves the default wiring.
9. **`manualTimers()` gains `idleStarts()`**, a counter of idle-timer (re)starts, so `RoomPanel.test.tsx` can observe activity without fake timers. The change is additive.
10. **No hidden-tab e2e scenario.** Room-panel design §8 keeps hidden-tab behaviour in Vitest; the store and hook tests cover it.
11. **Activity is attached once per panel mount**, to the root `div` that already carries `data-connection`, in an effect keyed on `feed.activity` (stable for the room's bridge). `pointermove` reaches `store.activity()` unthrottled: it only clears and sets one timeout, and room-feed design §1 decision 6 accepts that cost.

12. **Postgres readiness is distinct from channel join (approved F-001).** Register the `system` listener before subscribing. Require both join and matching Postgres readiness, in either order, and confirm once. A Postgres error at any point or a 20-second setup deadline fails the attempt and removes the channel. Ignore unrelated/malformed system events. All terminal paths cancel the deadline. Inserts can merge before readiness, but cannot stand in for confirmation or advance the bookmark; the confirmation catch-up covers the complete setup interval.
13. **Scroll ownership (approved F-002).** `attachActivityTracking` accepts an optional `ignoreScroll(target)` predicate. The panel excludes only its MessageList element, identified by `MessageListHandle.ownsScrollTarget`. The list's existing `ownScrollTop` check owns that element: its `onScroll` calls optional `onUserScroll` only for a reader scroll. The panel passes `feed.activity`. Other descendant scrolls (including the textarea) remain captured. Do not use `isTrusted`: browser-generated events from programmatic scrolls are trusted too.

## File structure

| Path | Responsibility | Task |
| --- | --- | --- |
| `src/lib/feed/realtime.ts` (modify), `realtime.test.ts` (create) | `subscribeToRoom`, `TOPIC_BUSY`; fake-client tests | 1 |
| `src/lib/feed/activity.ts`, `activity.test.ts` (create) | `attachActivityTracking` | 2 |
| `src/lib/feed/store.test.ts` (modify) | The §9 chunk 11 store cases | 3 |
| `src/lib/feed/test-helpers.ts` (modify) | `manualTimers().idleStarts` | 4 |
| `src/components/room/RoomPanel.tsx`, `RoomPanel.test.tsx` (modify) | Attach activity tracking; delegate list scroll ownership | 4 |
| `src/components/room/MessageList.tsx`, `MessageList.test.tsx` (modify) | Report reader scrolling and expose the owned scroll target | 4 |
| `tests/e2e/helpers.ts` (modify) | `refuseRealtime`, `connectionOf`; `openPollingRoom` refuses realtime | 5 |
| `src/lib/feed/useRoomFeed.ts`, `useRoomFeed.test.tsx` (modify) | `subscribeToRoom` becomes the default adapter | 6 |
| `src/components/map/MapShell.test.tsx` (modify) | Spy on the default adapter; no websocket in unit tests | 6 |
| `tests/e2e/helpers.ts` (modify), `tests/e2e/realtime.spec.ts` (create) | `openLiveRoom`, `goIdle`, `settledCatchUps`; scenarios 1–6 | 7 |
| `README.md`, `docs/KNOWN_LIMITATIONS.md`, `docs/superpowers/specs/2026-09-16-map-chat-implementation-chunks.md` (modify) | Documentation | 8 |

Dependency order: 1 → 6; 2 → 4; 5 → 6 → 7 → 8. Tasks 1, 2, 3 and 5 are independent of each other. **Task 5 must land before Task 6**: once the default adapter is real, the unprepared polling scenarios fail.

---

### Task 1: The realtime adapter `subscribeToRoom`

**Files:**
- Modify: `src/lib/feed/realtime.ts` (whole file, 31 lines today)
- Create: `src/lib/feed/realtime.test.ts`

**Interfaces:**
- Consumes: `toMessage(row: unknown): Message` from `@/lib/db/rows` (throws on a bad row); `getBrowserClient(): SupabaseClient` from `@/lib/supabase/browser`; `ROOM`, `id(n)`, `msg(n)`, `fakeMessages`, `page`, `catchUp`, `TEST_CONFIG` from `@/lib/feed/test-helpers`; `createFeedStore` from `@/lib/feed/store`. From `SupabaseClient`: `channel(name)`, `getChannels()`, `removeChannel(channel): Promise<…>`; from the channel: `topic`, `.on("postgres_changes", filter, callback)`, `.on("system", {}, callback)`, `.subscribe((status, error?) => void)`.
- Produces: `export const subscribeToRoom: SubscribeToRoom`, `export const POSTGRES_READY_TIMEOUT_MS = 20_000`, and `export const TOPIC_BUSY: string` in `@/lib/feed/realtime`. The existing exports `RealtimeHandle`, `RealtimeHandlers`, `SubscribeToRoom`, `pollingOnlySubscribe` keep their names and types.

- [ ] **Step 1: Write the failing test**

Create `src/lib/feed/realtime.test.ts`. The fake client behaves like the SDK in the two ways that matter: a channel stays registered until it is removed, and removing it reports `CLOSED` to the channel's own status callback.

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POSTGRES_READY_TIMEOUT_MS, TOPIC_BUSY, subscribeToRoom, type RealtimeHandlers } from "@/lib/feed/realtime";
import { createFeedStore } from "@/lib/feed/store";
import { ROOM, TEST_CONFIG, catchUp, fakeMessages, id, msg, page } from "@/lib/feed/test-helpers";

const { getBrowserClient } = vi.hoisted(() => ({ getBrowserClient: vi.fn() }));
vi.mock("@/lib/supabase/browser", () => ({ getBrowserClient }));

type StatusCallback = (status: string, error?: Error) => void;
type InsertCallback = (payload: { new: unknown }) => void;

type FakeChannel = {
  topic: string;
  on: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
  /** What the adapter registered, for the test to call as the SDK would. */
  status: StatusCallback;
  insert: InsertCallback;
  system(payload: unknown): void;
};

/**
 * The slice of `SupabaseClient` the adapter uses. Like the SDK, it keeps a
 * channel registered until it is removed, and removal reports CLOSED to the
 * channel's status callback before it resolves.
 */
function fakeClient() {
  const registered: FakeChannel[] = [];
  const channel = vi.fn((name: string) => {
    const created: FakeChannel = {
      topic: `realtime:${name}`,
      on: vi.fn((type: string, _filter: unknown, callback: unknown) => {
        if (type === "system") created.system = callback as (payload: unknown) => void;
        else created.insert = callback as InsertCallback;
        return created;
      }),
      subscribe: vi.fn((callback: StatusCallback) => {
        created.status = callback;
        return created;
      }),
      status: () => {},
      insert: () => {},
      system: () => {},
    };
    registered.push(created);
    return created;
  });
  const removeChannel = vi.fn(async (removed: FakeChannel) => {
    removed.status("CLOSED");
    registered.splice(registered.indexOf(removed), 1);
    return "ok" as const;
  });
  const client = { channel, removeChannel, getChannels: () => registered };
  return { client: client as unknown as SupabaseClient, channel, removeChannel, registered };
}

function fakeHandlers() {
  return { onSubscribed: vi.fn(), onFailed: vi.fn(), onInsert: vi.fn() } satisfies RealtimeHandlers;
}

/** The row Postgres Changes delivers for `msg(n)`: snake_case, as stored. */
function row(n: number) {
  const message = msg(n);
  return {
    id: message.id,
    chatroom_id: message.chatroomId,
    author: message.author,
    text: message.text,
    created_at: message.createdAt,
  };
}

function setup() {
  const fake = fakeClient();
  const handlers = fakeHandlers();
  const handle = subscribeToRoom(ROOM, handlers, fake.client);
  return { ...fake, handlers, handle, channel: fake.registered[0] };
}

const postgresReady = (channel: FakeChannel) => channel.system({
  extension: "postgres_changes", status: "ok", channel: `room:${ROOM}`,
});
const confirm = (channel: FakeChannel) => {
  channel.status("SUBSCRIBED");
  postgresReady(channel);
};

beforeEach(() => vi.useFakeTimers());

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  getBrowserClient.mockReset();
});

describe("subscribeToRoom", () => {
  it("joins room:<id> for INSERTs on the room's messages", () => {
    const fake = fakeClient();

    subscribeToRoom(ROOM, fakeHandlers(), fake.client);

    expect(fake.channel).toHaveBeenCalledTimes(1);
    expect(fake.channel).toHaveBeenCalledWith(`room:${ROOM}`);
    const [created] = fake.registered;
    expect(created.on).toHaveBeenCalledWith(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "messages", filter: `chatroom_id=eq.${ROOM}` },
      expect.any(Function),
    );
    expect(created.on).toHaveBeenCalledWith("system", {}, expect.any(Function));
    expect(created.subscribe).toHaveBeenCalledTimes(1);
  });

  it("uses the browser client when none is passed", () => {
    const fake = fakeClient();
    getBrowserClient.mockReturnValue(fake.client);

    subscribeToRoom(ROOM, fakeHandlers());

    expect(getBrowserClient).toHaveBeenCalledTimes(1);
    expect(fake.channel).toHaveBeenCalledWith(`room:${ROOM}`);
  });

  it("waits for Postgres readiness after SUBSCRIBED, then confirms once", () => {
    const { channel, handlers, removeChannel } = setup();

    channel.status("SUBSCRIBED");

    expect(handlers.onSubscribed).not.toHaveBeenCalled();
    postgresReady(channel);
    postgresReady(channel);
    channel.status("SUBSCRIBED");
    expect(handlers.onSubscribed).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(handlers.onFailed).not.toHaveBeenCalled();
    expect(removeChannel).not.toHaveBeenCalled();
  });

  it.each([
    ["CHANNEL_ERROR", new Error("too_many_joins"), "CHANNEL_ERROR: too_many_joins"],
    ["CHANNEL_ERROR", undefined, "CHANNEL_ERROR"],
    ["TIMED_OUT", undefined, "TIMED_OUT"],
    ["CLOSED", undefined, "CLOSED"],
  ])("reports %s as a failure and removes the channel (%#)", (status, error, reason) => {
    const { channel, handlers, removeChannel } = setup();

    channel.status(status, error);

    expect(handlers.onFailed).toHaveBeenCalledTimes(1);
    expect(handlers.onFailed).toHaveBeenCalledWith(reason);
    expect(removeChannel).toHaveBeenCalledTimes(1);
    expect(removeChannel).toHaveBeenCalledWith(channel);
  });

  it("reports a drop after SUBSCRIBED as a failure", () => {
    const { channel, handlers, removeChannel } = setup();

    confirm(channel);
    channel.status("CHANNEL_ERROR", new Error("socket closed"));

    expect(handlers.onFailed).toHaveBeenCalledWith("CHANNEL_ERROR: socket closed");
    expect(removeChannel).toHaveBeenCalledTimes(1);
  });

  it("is silent after the first failure: no second failure, success or insert", () => {
    const { channel, handlers, handle, removeChannel } = setup();

    channel.status("TIMED_OUT"); // removal reports CLOSED through the fake, as the SDK does
    channel.status("CHANNEL_ERROR", new Error("again"));
    confirm(channel);
    channel.insert({ new: row(3) });
    handle.unsubscribe();

    expect(handlers.onFailed).toHaveBeenCalledTimes(1);
    expect(handlers.onSubscribed).not.toHaveBeenCalled();
    expect(handlers.onInsert).not.toHaveBeenCalled();
    expect(removeChannel).toHaveBeenCalledTimes(1);
  });

  it("maps an inserted row to a Message", () => {
    const { channel, handlers } = setup();
    channel.status("SUBSCRIBED");

    channel.insert({ new: row(3) });

    expect(handlers.onInsert).toHaveBeenCalledTimes(1);
    expect(handlers.onInsert).toHaveBeenCalledWith(msg(3));
  });

  it("keeps microseconds from the +00:00 form Postgres Changes sends", () => {
    const { channel, handlers } = setup();

    channel.insert({ new: { ...row(3), created_at: "2026-09-16T10:00:00.000003+00:00" } });

    expect(handlers.onInsert).toHaveBeenCalledWith(msg(3));
  });

  it("drops and logs a malformed row without failing the channel", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { channel, handlers, removeChannel } = setup();
    channel.status("SUBSCRIBED");

    channel.insert({ new: { ...row(3), chatroom_id: undefined } });
    channel.insert({ new: row(4) });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(handlers.onFailed).not.toHaveBeenCalled();
    expect(removeChannel).not.toHaveBeenCalled();
    expect(handlers.onInsert).toHaveBeenCalledTimes(1);
    expect(handlers.onInsert).toHaveBeenCalledWith(msg(4));
  });

  it("unsubscribes silently: the CLOSED of its own removal is not a failure", () => {
    const { channel, handlers, handle, removeChannel } = setup();
    channel.status("SUBSCRIBED");

    handle.unsubscribe();
    channel.insert({ new: row(3) });
    channel.status("CHANNEL_ERROR");
    handle.unsubscribe();

    expect(removeChannel).toHaveBeenCalledTimes(1);
    expect(removeChannel).toHaveBeenCalledWith(channel);
    expect(handlers.onFailed).not.toHaveBeenCalled();
    expect(handlers.onInsert).not.toHaveBeenCalled();
  });

  it("survives a removal that rejects", async () => {
    const { channel, handlers, removeChannel } = setup();
    removeChannel.mockRejectedValueOnce(new Error("socket gone"));

    channel.status("TIMED_OUT");
    await Promise.resolve();

    expect(handlers.onFailed).toHaveBeenCalledTimes(1);
  });

  it("refuses while the room's previous channel is still registered, and leaves it alone", () => {
    const fake = fakeClient();
    subscribeToRoom(ROOM, fakeHandlers(), fake.client); // still leaving, as far as the SDK knows
    const handlers = fakeHandlers();

    const handle = subscribeToRoom(ROOM, handlers, fake.client);
    handle.unsubscribe();

    expect(handlers.onFailed).toHaveBeenCalledTimes(1);
    expect(handlers.onFailed).toHaveBeenCalledWith(TOPIC_BUSY);
    expect(fake.channel).toHaveBeenCalledTimes(1);
    expect(fake.removeChannel).not.toHaveBeenCalled();
  });

  it("joins another room while one is open", () => {
    const fake = fakeClient();
    subscribeToRoom(ROOM, fakeHandlers(), fake.client);
    const handlers = fakeHandlers();

    subscribeToRoom(id(9), handlers, fake.client);

    expect(handlers.onFailed).not.toHaveBeenCalled();
    expect(fake.channel).toHaveBeenLastCalledWith(`room:${id(9)}`);
  });
  it("accepts readiness before the channel callback without confirming early", () => {
    const { channel, handlers } = setup();
    postgresReady(channel);
    expect(handlers.onSubscribed).not.toHaveBeenCalled();
    channel.status("SUBSCRIBED");
    expect(handlers.onSubscribed).toHaveBeenCalledTimes(1);
  });

  it("ignores unrelated, wrong-channel and malformed system events", () => {
    const { channel, handlers } = setup();
    channel.status("SUBSCRIBED");
    channel.system(null);
    channel.system({ extension: "system", status: "ok", channel: `room:${ROOM}` });
    channel.system({ extension: "postgres_changes", status: "ok", channel: "another-room" });
    channel.system({ extension: "postgres_changes", channel: `room:${ROOM}` });
    expect(handlers.onSubscribed).not.toHaveBeenCalled();
    expect(handlers.onFailed).not.toHaveBeenCalled();
    postgresReady(channel);
    expect(handlers.onSubscribed).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])("bounds missing readiness, joined=%s", (joined) => {
    const { channel, handlers, removeChannel } = setup();
    if (joined) channel.status("SUBSCRIBED");
    vi.advanceTimersByTime(POSTGRES_READY_TIMEOUT_MS);
    expect(handlers.onFailed).toHaveBeenCalledExactlyOnceWith("POSTGRES_READY_TIMEOUT");
    confirm(channel);
    expect(handlers.onSubscribed).not.toHaveBeenCalled();
    expect(removeChannel).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([false, true])("fails on a Postgres error, already ready=%s", (ready) => {
    const { channel, handlers, removeChannel } = setup();
    if (ready) confirm(channel);
    channel.system({ extension: "postgres_changes", status: "error", channel: `room:${ROOM}`, message: "unavailable" });
    expect(handlers.onFailed).toHaveBeenCalledExactlyOnceWith("POSTGRES_CHANGES_ERROR: unavailable");
    expect(removeChannel).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels the deadline and ignores readiness after disposal", () => {
    const { channel, handlers, handle } = setup();
    channel.status("SUBSCRIBED");
    handle.unsubscribe();
    expect(vi.getTimerCount()).toBe(0);
    confirm(channel);
    vi.advanceTimersByTime(POSTGRES_READY_TIMEOUT_MS);
    expect(handlers.onSubscribed).not.toHaveBeenCalled();
    expect(handlers.onFailed).not.toHaveBeenCalled();
  });

  it("catches an insert between channel join and Postgres readiness through the real store", async () => {
    const fake = fakeClient();
    const messages = fakeMessages();
    const store = createFeedStore(ROOM, {
      messages: messages.api, config: TEST_CONFIG,
      subscribe: (roomId, handlers) => subscribeToRoom(roomId, handlers, fake.client),
    });
    store.start({ hidden: false });
    messages.list[0].resolve(page([msg(1), msg(2)]));
    await vi.advanceTimersByTimeAsync(0);
    const [channel] = fake.registered;
    channel.status("SUBSCRIBED");
    expect(store.getState().channel).toBe("subscribing");
    expect(messages.api.listAfter).not.toHaveBeenCalled();
    // Message 3 commits now; no insert callback arrives before replication is ready.
    postgresReady(channel);
    expect(messages.api.listAfter).toHaveBeenCalledExactlyOnceWith(ROOM, id(2));
    messages.listAfter[0].resolve(catchUp([msg(3)], id(3)));
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getState().messages.map((message) => message.id)).toEqual([id(1), id(2), id(3)]);
    expect(store.getState()).toMatchObject({ channel: "subscribed", polling: false });
    store.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["error", "deadline"])("enters polling through the store on readiness %s", async (failure) => {
    const fake = fakeClient();
    const messages = fakeMessages();
    const store = createFeedStore(ROOM, {
      messages: messages.api, config: TEST_CONFIG,
      subscribe: (roomId, handlers) => subscribeToRoom(roomId, handlers, fake.client),
    });
    store.start({ hidden: false });
    messages.list[0].resolve(page([msg(1), msg(2)]));
    await vi.advanceTimersByTimeAsync(0);
    const [channel] = fake.registered;
    channel.status("SUBSCRIBED");
    if (failure === "error") {
      channel.system({ extension: "postgres_changes", status: "error", channel: `room:${ROOM}` });
    } else {
      await vi.advanceTimersByTimeAsync(POSTGRES_READY_TIMEOUT_MS);
    }
    expect(store.getState()).toMatchObject({ channel: "none", polling: true });
    expect(messages.api.listAfter).toHaveBeenCalledExactlyOnceWith(ROOM, id(2));
    expect(fake.removeChannel).toHaveBeenCalledTimes(1);
    store.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/lib/feed/realtime.test.ts`
Expected: FAIL. Every test fails because `subscribeToRoom` is `undefined` ("subscribeToRoom is not a function"); `TOPIC_BUSY` is `undefined` too.

- [ ] **Step 3: Write the implementation**

Replace the whole of `src/lib/feed/realtime.ts` with:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { toMessage } from "@/lib/db/rows";
import type { Message } from "@/lib/schemas/types";
import { getBrowserClient } from "@/lib/supabase/browser";

/** The realtime adapter contract (room-feed design §8). */
export type RealtimeHandle = { unsubscribe(): void };

export type RealtimeHandlers = {
  onSubscribed(): void;
  /** May fire after `onSubscribed` when the channel later drops. At most once per attempt. */
  onFailed(reason: string): void;
  onInsert(message: Message): void;
};

export type SubscribeToRoom = (
  roomId: string,
  handlers: RealtimeHandlers,
  client?: SupabaseClient,
) => RealtimeHandle;

/** The reason reported when the previous channel of the same room has not finished leaving. */
export const TOPIC_BUSY = "previous channel is still closing";
export const POSTGRES_READY_TIMEOUT_MS = 20_000;

const postgresStatus = z.object({
  extension: z.literal("postgres_changes"),
  status: z.enum(["ok", "error"]),
  channel: z.string(),
  message: z.string().optional(),
});

/**
 * One subscription attempt on channel `room:<id>`: INSERTs on `public.messages`
 * of that room (PRD 6.4). The first failure is terminal: the channel is removed
 * so the SDK cannot rejoin behind the feed's polling, and nothing is reported
 * afterwards. `unsubscribe()` ends the attempt the same way, silently.
 */
export const subscribeToRoom: SubscribeToRoom = (roomId, handlers, client = getBrowserClient()) => {
  const name = `room:${roomId}`;

  // The SDK hands back an existing channel of the same topic, and `subscribe()` on
  // one that is still leaving does nothing, without any status. Refuse instead.
  if (client.getChannels().some((existing) => existing.topic === `realtime:${name}`)) {
    handlers.onFailed(TOPIC_BUSY);
    return { unsubscribe: () => {} };
  }

  let ended = false; // failed or unsubscribed: every SDK callback is ignored from here
  const channel = client.channel(name);
  let joined = false;
  let postgresReady = false;
  let confirmed = false;
  const deadline = setTimeout(() => fail("POSTGRES_READY_TIMEOUT"), POSTGRES_READY_TIMEOUT_MS);

  function end() {
    ended = true; // before removal: leaving makes the SDK report CLOSED
    clearTimeout(deadline);
    client.removeChannel(channel).catch(() => {});
  }

  function fail(reason: string) {
    if (ended) return;
    end();
    handlers.onFailed(reason);
  }

  function confirmIfReady() {
    if (ended || confirmed || !joined || !postgresReady) return;
    confirmed = true;
    clearTimeout(deadline);
    handlers.onSubscribed();
  }

  try {
    channel
      .on("system", {}, (payload: unknown) => {
        if (ended) return;
        const result = postgresStatus.safeParse(payload);
        if (!result.success || result.data.channel !== name) return;
        if (result.data.status === "error") {
          fail(`POSTGRES_CHANGES_ERROR${result.data.message ? `: ${result.data.message}` : ""}`);
          return;
        }
        postgresReady = true;
        confirmIfReady();
      })
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `chatroom_id=eq.${roomId}` },
        (payload) => {
          if (ended) return;
          let message: Message;
          try {
            message = toMessage(payload.new);
          } catch (error) {
            console.warn(`Realtime ${name}: dropped a row.`, error);
            return;
          }
          handlers.onInsert(message);
        },
      )
      .subscribe((status, error) => {
        if (ended) return;
        if (status === "SUBSCRIBED") {
          joined = true;
          confirmIfReady();
          return;
        }
        // CHANNEL_ERROR, TIMED_OUT, or a CLOSED this adapter did not ask for.
        fail(error ? `${status}: ${error.message}` : status);
      });
  } catch (error) {
    end(); // synchronous SDK setup errors must not leave the deadline/channel behind
    throw error; // the store translates a throwing adapter into channelFailed
  }

  return {
    unsubscribe() {
      if (!ended) end();
    },
  };
};

/**
 * An adapter that refuses realtime on the next macrotask, so a room runs in
 * polling mode end to end. For tests and fixtures; the hook's default is
 * `subscribeToRoom`.
 */
export const pollingOnlySubscribe: SubscribeToRoom = (_roomId, handlers) => {
  const timer = setTimeout(() => handlers.onFailed("realtime refused"), 0);
  return { unsubscribe: () => clearTimeout(timer) };
};
```

Notes for the implementer:
- `end()` sets `ended` **before** `removeChannel`, because leaving makes the SDK call the status callback with `CLOSED`. The test "unsubscribes silently" fails if the order is reversed.
- A synchronous `onFailed` before the handle is returned (the `TOPIC_BUSY` path) is allowed: the store cleans up a handle that arrives after its attempt failed (room-feed design §6, tested in chunk 9).
- The hook still imports `pollingOnlySubscribe` after this task. Task 6 changes that.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test src/lib/feed/realtime.test.ts`
Expected: PASS, `26 passed` (16 original cases plus 10 readiness cases).

Run: `pnpm test && pnpm lint && pnpm typecheck`
Expected: B-files + 1 files, B-tests + 26 tests (`37` / `721`), lint and typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/feed/realtime.ts src/lib/feed/realtime.test.ts
git commit -m "feat(feed): add the Supabase realtime adapter subscribeToRoom"
```

---

### Task 2: Activity tracking

**Files:**
- Create: `src/lib/feed/activity.ts`
- Create: `src/lib/feed/activity.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `export function attachActivityTracking(el: HTMLElement, handlers: { onActivity(): void; ignoreScroll?(target: EventTarget | null): boolean }): () => void` in `@/lib/feed/activity`. The return value detaches every listener.

- [ ] **Step 1: Write the failing test**

Create `src/lib/feed/activity.test.ts`:

```ts
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { attachActivityTracking } from "@/lib/feed/activity";

/** A panel-like root with a scrollable list and a field inside it. */
function mount() {
  const root = document.createElement("div");
  const list = document.createElement("div");
  const field = document.createElement("textarea");
  root.append(list, field);
  document.body.append(root);
  return { root, list, field };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("attachActivityTracking", () => {
  it.each(["pointerdown", "pointermove", "keydown", "wheel", "touchstart"])(
    "reports %s from a descendant",
    (type) => {
      const { root, field } = mount();
      const onActivity = vi.fn();
      attachActivityTracking(root, { onActivity });

      field.dispatchEvent(new Event(type, { bubbles: true }));

      expect(onActivity).toHaveBeenCalledTimes(1);
    },
  );

  it("reports a descendant's scroll, which does not bubble", () => {
    const { root, list } = mount();
    const onActivity = vi.fn();
    attachActivityTracking(root, { onActivity });

    list.dispatchEvent(new Event("scroll")); // bubbles: false, as in a browser

    expect(onActivity).toHaveBeenCalledTimes(1);
  });

  it("ignores events outside the element and events that are not activity", () => {
    const { root, field } = mount();
    const onActivity = vi.fn();
    attachActivityTracking(root, { onActivity });

    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    field.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));

    expect(onActivity).not.toHaveBeenCalled();
  });

  it("delegates an owned scroll target without ignoring other activity", () => {
    const { root, list, field } = mount();
    const onActivity = vi.fn();
    attachActivityTracking(root, { onActivity, ignoreScroll: (target) => target === list });
    list.dispatchEvent(new Event("scroll"));
    expect(onActivity).not.toHaveBeenCalled();
    field.dispatchEvent(new Event("scroll"));
    list.dispatchEvent(new Event("wheel", { bubbles: true }));
    expect(onActivity).toHaveBeenCalledTimes(2);
  });

  it("registers every listener as passive", () => {
    const { root } = mount();
    const add = vi.spyOn(root, "addEventListener");

    attachActivityTracking(root, { onActivity: () => {} });

    expect(add).toHaveBeenCalledTimes(6);
    for (const [, , options] of add.mock.calls) expect(options).toMatchObject({ passive: true });
  });

  it("stops reporting after detach, scroll included", () => {
    const { root, list, field } = mount();
    const onActivity = vi.fn();
    const detach = attachActivityTracking(root, { onActivity });

    detach();
    field.dispatchEvent(new Event("keydown", { bubbles: true }));
    list.dispatchEvent(new Event("scroll"));

    expect(onActivity).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/lib/feed/activity.test.ts`
Expected: FAIL at import: `Failed to resolve import "@/lib/feed/activity"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/feed/activity.ts`:

```ts
/** What counts as the visitor using the room (PRD 6.4). `scroll` does not bubble, so it is captured. */
const ACTIVITY_EVENTS = ["pointerdown", "pointermove", "keydown", "wheel", "scroll", "touchstart"] as const;

const optionsFor = (type: (typeof ACTIVITY_EVENTS)[number]) => ({ passive: true, capture: type === "scroll" });

/**
 * Calls `onActivity` for pointer, keyboard, wheel, scroll and touch events
 * inside `el` (room-feed design §8). Returns the detach function. Document
 * visibility is not tracked here: `useRoomFeed` owns it.
 */
export function attachActivityTracking(
  el: HTMLElement,
  handlers: { onActivity(): void; ignoreScroll?(target: EventTarget | null): boolean },
): () => void {
  const listener = (event: Event) => {
    if (event.type === "scroll" && handlers.ignoreScroll?.(event.target)) return;
    handlers.onActivity();
  };
  for (const type of ACTIVITY_EVENTS) el.addEventListener(type, listener, optionsFor(type));
  return () => {
    for (const type of ACTIVITY_EVENTS) el.removeEventListener(type, listener, optionsFor(type));
  };
}
```

`removeEventListener` matches a listener by type, callback and the `capture` flag, so the scroll listener must be removed with `capture: true`. The test "stops reporting after detach, scroll included" fails if the options are dropped on removal.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test src/lib/feed/activity.test.ts`
Expected: PASS, `10 passed`.

Run: `pnpm lint && pnpm typecheck`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/feed/activity.ts src/lib/feed/activity.test.ts
git commit -m "feat(feed): add activity tracking for the room panel"
```

---

### Task 3: Store tests for realtime with idle fallback

Room-feed design §9 lists the chunk 11 store cases. Chunk 9 already covers two of them ("restarts the idle timer on activity only while one runs" and "confirms, merges inserts and falls back to polling when the channel later drops"). This task adds the rest. The store already implements the behaviour, so these tests pass when written; Step 3 proves with two mutations that they can fail.

**Files:**
- Modify: `src/lib/feed/store.test.ts` (insert one `describe` block before `describe("visibility", () => {`)

**Interfaces:**
- Consumes: the file's own helpers `setup`, `opened`, `polling`, `flush`, `POLL`, `IDLE`, and `ROOM`, `catchUp`, `id`, `msg` from `@/lib/feed/test-helpers`. `fakeRealtime().attempts[n]` is `{ handlers: RealtimeHandlers; unsubscribe: Mock }`, one entry per `subscribe` call.
- Produces: nothing for later tasks.

- [ ] **Step 1: Add the tests**

In `src/lib/feed/store.test.ts`, insert this block immediately before the line `describe("visibility", () => {`:

```ts
describe("realtime with idle fallback", () => {
  /** As `opened`, then the join is confirmed and its catch-up is answered empty. */
  async function live() {
    const ctx = await opened();
    ctx.realtime.attempts[0].handlers.onSubscribed();
    ctx.messages.listAfter[0].resolve(catchUp([], id(2)));
    await flush();
    return ctx;
  }

  it("runs only the idle timer while live: no poll ever fires", async () => {
    const { store, messages } = await live();

    expect(store.getState()).toMatchObject({ channel: "subscribed", polling: false });
    expect(vi.getTimerCount()).toBe(1); // the idle timeout
    await vi.advanceTimersByTimeAsync(IDLE - 1);
    expect(messages.api.listAfter).toHaveBeenCalledTimes(1); // only the confirmation catch-up
  });

  it("unsubscribes when idle and polls at once, then every interval", async () => {
    const { store, messages, realtime } = await live();

    await vi.advanceTimersByTimeAsync(IDLE);

    expect(realtime.attempts[0].unsubscribe).toHaveBeenCalledTimes(1);
    expect(store.getState()).toMatchObject({ channel: "none", polling: true });
    expect(messages.api.listAfter).toHaveBeenCalledTimes(2); // at once, not a tick later
    expect(messages.api.listAfter).toHaveBeenLastCalledWith(ROOM, id(2));
    expect(realtime.attempts).toHaveLength(1); // idle never re-subscribes

    messages.listAfter[1].resolve(catchUp([msg(3)], id(3)));
    await vi.advanceTimersByTimeAsync(POLL);
    expect(messages.api.listAfter).toHaveBeenCalledTimes(3);
    expect(messages.api.listAfter).toHaveBeenLastCalledWith(ROOM, id(3));
  });

  it("counts a sent message as activity", async () => {
    const { store, messages } = await live();
    await vi.advanceTimersByTimeAsync(IDLE - 1);

    const sending = store.send({ author: "ann", text: "hi" });
    messages.post[0].resolve(msg(3));
    await sending;

    await vi.advanceTimersByTimeAsync(IDLE - 1);
    expect(store.getState().channel).toBe("subscribed");
    await vi.advanceTimersByTimeAsync(1);
    expect(store.getState()).toMatchObject({ channel: "none", polling: true });
  });

  it("tries realtime again on a send while polling, and keeps polling until confirmed", async () => {
    const { store, messages, realtime } = await polling();

    const sending = store.send({ author: "ann", text: "hi" });
    messages.post[0].resolve(msg(3));
    await sending;

    expect(realtime.attempts).toHaveLength(2);
    expect(store.getState()).toMatchObject({ channel: "subscribing", polling: true });
    await vi.advanceTimersByTimeAsync(POLL);
    expect(messages.api.listAfter).toHaveBeenCalledTimes(2); // the interval still runs
    messages.listAfter[1].resolve(catchUp([msg(3)], id(3)));
    await flush();

    realtime.attempts[1].handlers.onSubscribed();

    expect(store.getState()).toMatchObject({ channel: "subscribed", polling: false });
    expect(vi.getTimerCount()).toBe(1); // the idle timeout; the poll interval is cleared
    expect(messages.api.listAfter).toHaveBeenCalledTimes(3); // the confirmation catch-up
    expect(messages.api.listAfter).toHaveBeenLastCalledWith(ROOM, id(3));
    messages.listAfter[2].resolve(catchUp([], id(3)));
    await vi.advanceTimersByTimeAsync(POLL * 2);
    expect(messages.api.listAfter).toHaveBeenCalledTimes(3); // polling has stopped
    expect(store.getState().messages.map((m) => m.id)).toEqual([id(1), id(2), id(3)]);
  });

  it("stays in polling when the attempt after a send is refused", async () => {
    const { store, messages, realtime } = await polling();
    const sending = store.send({ author: "ann", text: "hi" });
    messages.post[0].resolve(msg(3));
    await sending;

    realtime.attempts[1].handlers.onFailed("too_many_connections");

    expect(realtime.attempts[1].unsubscribe).toHaveBeenCalledTimes(1);
    expect(store.getState()).toMatchObject({ channel: "none", polling: true });
    expect(vi.getTimerCount()).toBe(1); // the same interval, not a second one
    expect(messages.api.listAfter).toHaveBeenCalledTimes(1); // no extra immediate poll
  });

  it("leaves realtime for polling at once when the tab is hidden", async () => {
    const { store, messages, realtime } = await live();

    store.setHidden(true);

    expect(realtime.attempts[0].unsubscribe).toHaveBeenCalledTimes(1);
    expect(store.getState()).toMatchObject({ channel: "none", polling: true, hidden: true });
    expect(messages.api.listAfter).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(1); // the poll interval; the idle timeout is gone
  });
});

```

- [ ] **Step 2: Run the tests**

Run: `pnpm test src/lib/feed/store.test.ts`
Expected: PASS, `46 passed` (40 before, 6 new). These tests describe behaviour chunk 9 already built, so there is no red run here; Step 3 is the proof that they bite. If any of the six fails, **stop**: the store differs from room-feed design §6, which is a finding to report, not a test to adjust.

- [ ] **Step 3: Mutation check, then restore**

Mutation A, the idle timer never starts. In `src/lib/feed/store.ts`, inside `function run(effect…)`, change

```ts
      case "startIdleTimer":
        return startIdleTimer();
```

to `case "startIdleTimer": return;` and run `pnpm test src/lib/feed/store.test.ts`.
Expected: FAIL, including "runs only the idle timer while live: no poll ever fires", "unsubscribes when idle and polls at once, then every interval" and "counts a sent message as activity".

Restore the file (`git checkout -- src/lib/feed/store.ts`).

Mutation B, the poll interval is never cleared. In the same function change

```ts
      case "stopPolling":
        return stopPolling();
```

to `case "stopPolling": return;` and run the same command.
Expected: FAIL, including "tries realtime again on a send while polling, and keeps polling until confirmed" (timer count 2 instead of 1).

Restore and confirm:

```bash
git checkout -- src/lib/feed/store.ts
git status --short src/lib/feed/store.ts      # prints nothing
pnpm test src/lib/feed/store.test.ts          # 46 passed
```

- [ ] **Step 4: Lint and typecheck**

Run: `pnpm lint && pnpm typecheck`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/feed/store.test.ts
git commit -m "test(feed): cover realtime confirmation, idle fallback and rejoin on send in the store"
```

---

### Task 4: The room panel reports activity

**Files:**
- Modify: `src/components/room/MessageList.tsx` (props, handle and onScroll)
- Modify: `src/components/room/MessageList.test.tsx` (three scroll-ownership cases)
- Modify: `src/lib/feed/test-helpers.ts` (`manualTimers`, at the end of the file)
- Modify: `src/components/room/RoomPanel.tsx` (imports; the body of `RoomPanel` after `listRef`; the root `div`)
- Modify: `src/components/room/RoomPanel.test.tsx` (import line 2; `setup`'s return; one helper; one `describe`)

**Interfaces:**
- Consumes: `attachActivityTracking(el: HTMLElement, handlers: { onActivity(): void; ignoreScroll?(target: EventTarget | null): boolean }): () => void` from `@/lib/feed/activity` (Task 2); `RoomFeed.activity(): void` from `useRoomFeed` (stable for the room's bridge; restarts the idle timer only while the channel is subscribed, visible, and a timer runs).
- Produces: `MessageListProps.onUserScroll?(): void`, `MessageListHandle.ownsScrollTarget(target: EventTarget | null): boolean`; the panel uses these to exclude automatic list scrolling while reporting reader scrolling exactly once. `manualTimers()` returns `{ timers, tick, idleStarts }`, where `idleStarts(): number` counts calls of the fake `setTimeout`. The store uses `setTimeout` only for the idle timer, so this is the number of idle-timer starts and restarts.

- [ ] **Step 1: Write failing MessageList ownership tests**

Append this block to `src/components/room/MessageList.test.tsx`; it uses that file's existing
`setup`, fake layout, `many`, and `fireEvent` helpers:

```tsx
describe("MessageList user-scroll activity", () => {
  it("identifies only its own scroll element", () => {
    const { ref, list } = setup({ messages: many(1, 10) });
    expect(ref.current!.ownsScrollTarget(list)).toBe(true);
    expect(ref.current!.ownsScrollTarget(document.body)).toBe(false);
    expect(ref.current!.ownsScrollTarget(null)).toBe(false);
  });

  it("reports reader scrolling", () => {
    const onUserScroll = vi.fn();
    const { userScrollTo } = setup({ messages: many(1, 10), onUserScroll });
    userScrollTo(100); // differs from the initial automatic bottom position
    expect(onUserScroll).toHaveBeenCalledTimes(1);
  });

  it("excludes initial positioning, incoming follow and anchor correction", () => {
    const onUserScroll = vi.fn();
    const { list, update, userScrollTo } = setup({ messages: many(6, 15), onUserScroll });
    fireEvent.scroll(list); // initial automatic positioning
    update({ messages: many(6, 16) });
    fireEvent.scroll(list); // automatic following of an incoming row
    expect(onUserScroll).not.toHaveBeenCalled();
    userScrollTo(100);
    expect(onUserScroll).toHaveBeenCalledTimes(1);
    update({ messages: many(1, 16) });
    fireEvent.scroll(list); // automatic anchor correction after prepend
    expect(onUserScroll).toHaveBeenCalledTimes(1);
  });
});
```

Run: `pnpm test src/components/room/MessageList.test.tsx`.
Expected: the ownership method is missing and the reader-scroll callback is not called.
The automatic-scroll exclusion case fails at its reader-scroll assertion before the fix.

- [ ] **Step 2: Expose the existing user-scroll distinction**

In `src/components/room/MessageList.tsx`, add to `MessageListProps`:

```ts
  /** Reader scrolling only; automatic following/anchoring must not count as activity. */
  onUserScroll?(): void;
```

Add to `MessageListHandle`:

```ts
  /** The panel delegates this target's activity classification to MessageList. */
  ownsScrollTarget(target: EventTarget | null): boolean;
```

Include `onUserScroll` in the function's destructured props:

```tsx
export function MessageList({ messages, hasOlder, loading, onLoadOlder, onUserScroll, ref }: MessageListProps) {
```

Add this method to the object returned by `useImperativeHandle`, before `scrollToBottom`:

```ts
      ownsScrollTarget: (target) => listRef.current !== null && target === listRef.current,
```

Replace the end of the existing `onScroll` handler (after `measure()`) with:

```ts
    // Only reader scrolling counts as activity or hides the pill.
    if (!own) {
      onUserScroll?.();
      if (nearBottom.current) setPill(false);
    }
```

Keep `ownScrollTop` tracking and all positioning behavior unchanged. Run
`pnpm test src/components/room/MessageList.test.tsx`; expected: its baseline plus **3** tests,
all passing. This is an optional prop, so standalone fixtures remain valid.

- [ ] **Step 3: Let `manualTimers` count idle-timer starts**

In `src/lib/feed/test-helpers.ts` replace the whole `manualTimers` function with:

```ts
/** Timers the test fires by hand, for component tests that keep real timers for user-event. */
export function manualTimers() {
  const intervals = new Map<number, () => void>();
  let nextId = 1;
  let idleStarts = 0;
  const timers = {
    setInterval: (callback: () => void) => {
      intervals.set(nextId, callback);
      return nextId++;
    },
    clearInterval: (handle: number) => void intervals.delete(handle),
    // The idle timer never fires in these tests; they count how often it is (re)started.
    setTimeout: () => {
      idleStarts += 1;
      return 0;
    },
    clearTimeout: () => {},
  } as unknown as FeedTimers;
  return {
    timers,
    tick: () => [...intervals.values()].forEach((callback) => callback()),
    idleStarts: () => idleStarts,
  };
}
```

- [ ] **Step 4: Write the failing tests**

In `src/components/room/RoomPanel.test.tsx`:

(a) Add `fireEvent` to the Testing Library import on line 2:

```ts
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
```

(b) In `setup`'s returned object, after the `tick` line, add:

```ts
    idleStarts: clock.idleStarts,
```

(c) Immediately before the comment `/** As \`openPolling\`, then a poll answers with message 3 and says more rows exist. */`, add:

```ts
/** History [1, 2] loaded, realtime confirmed, the confirmation catch-up answered empty. */
async function openLive() {
  const ctx = setup();
  ctx.messages.list[0].resolve(page([msg(1), msg(2)], true));
  await settle();
  act(() => ctx.realtime.attempts[0].handlers.onSubscribed());
  ctx.messages.listAfter[0].resolve(catchUp([], id(2)));
  await settle();
  return ctx;
}

```

(d) Immediately before `describe("RoomPanel fetch errors", () => {`, add:

```ts
describe("RoomPanel realtime", () => {
  it("reports the realtime connection and shows a live insert", async () => {
    const { root, realtime } = await openLive();
    expect(root()).toHaveAttribute("data-connection", "realtime");

    act(() => realtime.attempts[0].handlers.onInsert(msg(3)));

    expect(within(screen.getByRole("log")).getByText("message 3")).toBeInTheDocument();
  });

  it("counts pointer, keyboard and scroll events inside the panel as activity", async () => {
    const { root, text, idleStarts } = await openLive();
    expect(idleStarts()).toBe(1); // started by the confirmation

    fireEvent.pointerMove(root());
    expect(idleStarts()).toBe(2);
    fireEvent.keyDown(text());
    expect(idleStarts()).toBe(3);
    fireEvent.scroll(screen.getByRole("log")); // delegated to onUserScroll, counted exactly once
    expect(idleStarts()).toBe(4);
    fireEvent.scroll(text()); // other descendant scrolls still use root capture
    expect(idleStarts()).toBe(5);

    fireEvent.pointerDown(document.body); // outside the panel
    expect(idleStarts()).toBe(5);
  });

  it("does not start an idle timer from activity while polling", async () => {
    const { root, idleStarts } = await openPolling();

    fireEvent.pointerMove(root());

    expect(idleStarts()).toBe(0);
  });

  it("detaches activity tracking on unmount", async () => {
    const { root, unmount } = await openLive();
    const remove = vi.spyOn(root(), "removeEventListener");

    unmount();

    expect(remove.mock.calls.map(([type]) => type).sort()).toEqual(
      ["keydown", "pointerdown", "pointermove", "scroll", "touchstart", "wheel"],
    );
  });
});

```

- [ ] **Step 5: Run the tests to verify they fail**

Run: `pnpm test src/components/room/RoomPanel.test.tsx`
Expected: `2 failed | 20 passed`. The failures are "counts pointer, keyboard and scroll events inside the panel as activity" (`expected 1 to be 2`) and "detaches activity tracking on unmount" (`expected [] to deeply equal […]`). The other two new tests pass already: the first describes chunk 9's panel with a confirming adapter, the third guards against a panel that would start timers on its own.

- [ ] **Step 6: Attach activity tracking in the panel**

In `src/components/room/RoomPanel.tsx`:

(a) Add the import, in alphabetical position after the `@/lib/api/client` import:

```ts
import { attachActivityTracking } from "@/lib/feed/activity";
```

(b) After the line `const listRef = useRef<MessageListHandle>(null);` add:

```tsx

  // Activity inside the panel keeps realtime alive (PRD 6.4). `feed.activity` is stable per room.
  const rootRef = useRef<HTMLDivElement>(null);
  const { activity } = feed;
  useEffect(() => {
    if (rootRef.current === null) return;
    return attachActivityTracking(rootRef.current, {
      onActivity: activity,
      ignoreScroll: (target) => listRef.current?.ownsScrollTarget(target) ?? false,
    });
  }, [activity]);
```

(c) Give the root element the ref. Replace

```tsx
    <div data-connection={feed.connection} className="flex min-h-0 w-full flex-col">
```

with

```tsx
    <div ref={rootRef} data-connection={feed.connection} className="flex min-h-0 w-full flex-col">
```

(d) Pass the list's reader-scroll callback on the existing `MessageList` element:

```tsx
        onUserScroll={activity}
```

The root capture listener ignores that exact scroll target; the list's own `onScroll` then
reports only reader scrolling. It must not be reported by both listeners. Other descendant
scrolls still go through the root. `useEffect` and `useRef` are already imported in this file.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm test src/components/room/RoomPanel.test.tsx`
Expected: PASS, `22 passed`.

Run: `pnpm test && pnpm lint && pnpm typecheck`
Expected: all pass; lint and typecheck clean.

- [ ] **Step 8: Commit**

```bash
git add src/lib/feed/test-helpers.ts src/components/room/RoomPanel.tsx src/components/room/RoomPanel.test.tsx src/components/room/MessageList.tsx src/components/room/MessageList.test.tsx
git commit -m "feat(room): count activity inside the room panel towards the realtime idle timeout"
```

---

### Task 5: Polling e2e scenarios refuse the websocket

The seven scenarios that use `openPollingRoom` assume a room that polls. Today that holds because the hook's default adapter refuses realtime. After Task 6 it must hold because the browser refuses the websocket. This task prepares the harness first, while the stand-in is still the default, so the suite stays green at every commit.

**Files:**
- Modify: `tests/e2e/helpers.ts` (`waitForCatchUpIdle`, `openPollingRoom`, two new exports)

**Interfaces:**
- Consumes: the file's private `observeCatchUps(page, roomId)`, `probeOf(page)`; the panel root's `data-connection` attribute.
- Produces, exported from `tests/e2e/helpers.ts`:
  - `refuseRealtime(page: Page): Promise<void>`: call before navigation; closes every websocket whose URL matches `/realtime/v1/websocket`.
  - `connectionOf(page: Page): Locator`: the element carrying `data-connection`.
  - `waitForCatchUpIdle(page: Page, minimum: number): Promise<void>`: now exported, otherwise unchanged.
  - `openPollingRoom(page, room)`: unchanged signature; now refuses realtime and waits for `data-connection="polling"`.

- [ ] **Step 1: Which dev server will answer?**

The e2e suite reuses a running dev server. It must be **this worktree's**. Check before every e2e run in this plan:

```bash
curl -sk -o /dev/null -w "%{http_code}\n" https://map-chat.map-chat.test/api/health
```

- `200`: a server is running. Find its directory: `lsof -a -d cwd -p "$(lsof -t -iTCP:3000 -sTCP:LISTEN | head -1)" | tail -1`. If the last column is not this worktree, ask the user to stop that server (do not kill it yourself), then let Playwright start `pnpm dev` from here.
- anything else: Playwright starts `pnpm dev` from this worktree by itself.
- If the Supbuddy mapping cannot be used from a worktree, use chunk 9's documented alternative on a **free** port (check with `lsof -nP -iTCP:3111 -sTCP:LISTEN`; port 3100 may belong to the chunk 10 session): `pnpm exec next dev -p 3111 -H 127.0.0.1` in a second terminal of this worktree, and prefix every e2e command with `E2E_BASE_URL=http://127.0.0.1:3111`. Stop only the server you started, by its PID, never with a pattern such as `pkill -f "next dev"`. Do not edit resolver files or a `Caddyfile`.

The local Supabase stack must be running (`curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:55021/realtime/v1/api/ping` prints `200`; read the port from `NEXT_PUBLIC_SUPABASE_URL` in `.env.local` if it differs). If it is not, ask the user to start it from Supbuddy.

- [ ] **Step 2: Edit the helpers**

In `tests/e2e/helpers.ts` replace

```ts
async function waitForCatchUpIdle(page: Page, minimum: number) {
```

with

```ts
/** At least `minimum` catch-up requests have started, and every started one has settled. */
export async function waitForCatchUpIdle(page: Page, minimum: number) {
```

Then replace

```ts
/** Opens and settles the startup catch-up, then freezes time before scenario writes. */
export async function openPollingRoom(page: Page, room: Room): Promise<Locator> {
  await observeCatchUps(page, room.id);
  await page.clock.install();
  const log = await openRoom(page, room);
  await waitForCatchUpIdle(page, 1);
```

with

```ts
/**
 * Closes every Realtime websocket before it reaches the server, which is what a
 * refused connection looks like to the client (PRD 6.4): the room falls back to polling.
 */
export async function refuseRealtime(page: Page): Promise<void> {
  await page.routeWebSocket(/\/realtime\/v1\/websocket/, (ws) => ws.close());
}

/** The panel root's `data-connection`: "connecting", "realtime" or "polling". */
export const connectionOf = (page: Page) => page.locator("[data-connection]");

/** Opens with realtime refused and settles the startup catch-up, then freezes time before scenario writes. */
export async function openPollingRoom(page: Page, room: Room): Promise<Locator> {
  await refuseRealtime(page);
  await observeCatchUps(page, room.id);
  await page.clock.install();
  const log = await openRoom(page, room);
  await expect(connectionOf(page)).toHaveAttribute("data-connection", "polling");
  await waitForCatchUpIdle(page, 1);
```

The rest of `openPollingRoom` is unchanged.

- [ ] **Step 3: Run the suite**

Run: `pnpm test:e2e`
Expected: B-e2e passed (`18 passed`), none flaky. At this commit the refusal is not yet exercised (the stand-in adapter opens no websocket); Task 6 Step 6 is where it starts to matter.

Run: `pnpm lint && pnpm typecheck`
Expected: clean (both cover `tests/e2e/**`).

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/helpers.ts
git commit -m "test(e2e): refuse the realtime websocket in the polling scenarios"
```

---

### Task 6: Realtime becomes the default adapter

**Files:**
- Modify: `src/lib/feed/useRoomFeed.ts` (one import, one line in `resolveDeps`)
- Modify: `src/lib/feed/useRoomFeed.test.tsx` (imports; a module mock; `afterEach`; one test)
- Modify: `src/components/map/MapShell.test.tsx` (a module mock; one test)
- Conditionally modify: `src/components/map/MapShell.newRoom.test.tsx`, `src/components/map/MapShell.pins.test.tsx`, `tests/e2e/new-room.spec.ts` (only if chunk 10 has been merged; Step 5)

**Interfaces:**
- Consumes: `subscribeToRoom: SubscribeToRoom` from `@/lib/feed/realtime` (Task 1); `refuseRealtime(page)` from `tests/e2e/helpers.ts` (Task 5).
- Produces: `useRoomFeed(roomId, { deps })` uses `subscribeToRoom` whenever `deps.subscribe` is absent. Nothing else in the hook changes (room-feed design §7, last bullet).

- [ ] **Step 1: Write the failing hook test**

In `src/lib/feed/useRoomFeed.test.tsx`:

(a) Add the type import, in alphabetical position before the `@/lib/feed/store` import:

```ts
import type { RealtimeHandlers } from "@/lib/feed/realtime";
```

(b) Immediately before `const OTHER_ROOM =`, add:

```ts
// The default adapter, replaced by a spy: no test here may reach the Supabase client.
const subscribeToRoom = vi.hoisted(() => vi.fn());

vi.mock("@/lib/feed/realtime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/feed/realtime")>()),
  subscribeToRoom,
}));

```

(c) In the file's `afterEach`, add `subscribeToRoom.mockReset();` as the first statement:

```ts
afterEach(() => {
  subscribeToRoom.mockReset();
  setVisibility("visible");
  vi.useRealTimers();
});
```

(d) Immediately before `it("polls instead of subscribing when mounted in a hidden tab", async () => {`, add:

```ts
  it("subscribes through subscribeToRoom when no adapter is injected", async () => {
    const unsubscribe = vi.fn();
    subscribeToRoom.mockReturnValue({ unsubscribe });
    const { deps, messages } = fakeDeps();
    const { result, unmount } = renderHook(() =>
      useRoomFeed(ROOM, { deps: { messages: deps.messages, config: deps.config } }),
    );
    messages.list[0].resolve(page([msg(1)]));
    await settle();

    expect(subscribeToRoom).toHaveBeenCalledTimes(1);
    const [roomId, handlers] = subscribeToRoom.mock.calls[0] as [string, RealtimeHandlers];
    expect(roomId).toBe(ROOM);

    act(() => handlers.onSubscribed());
    expect(result.current.connection).toBe("realtime");

    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

```

- [ ] **Step 2: Write the failing shell test**

In `src/components/map/MapShell.test.tsx`:

(a) Immediately before `vi.mock("@/lib/api/client", async (importOriginal) => ({`, add:

```ts
// No unit test opens a websocket: the default realtime adapter is a spy that never answers.
const subscribeToRoom = vi.hoisted(() => vi.fn(() => ({ unsubscribe: () => {} })));

vi.mock("@/lib/feed/realtime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/feed/realtime")>()),
  subscribeToRoom,
}));

```

(b) Immediately after the test `it("shows the seed of a freshly created room without a history request", …)`, add:

```ts
  it("asks for realtime through the default adapter once a room is open", () => {
    const seed: Message = {
      id: "00000000-0000-4000-8000-0000000000f1",
      chatroomId: roomA.id,
      author: "ana",
      text: "first message here",
      createdAt: "2026-09-16T15:00:00.000000Z",
    };
    renderShell(pinsWith({ rooms: [roomA] }), { kind: "room", room: roomA, seed });

    expect(subscribeToRoom).toHaveBeenCalledTimes(1);
    expect(subscribeToRoom).toHaveBeenCalledWith(roomA.id, expect.anything());
  });
```

The file's `afterEach` calls `vi.clearAllMocks()`, which clears the spy's calls and keeps its implementation.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm test src/lib/feed/useRoomFeed.test.tsx src/components/map/MapShell.test.tsx`
Expected: `2 failed`, both with `expected "vi.fn()" to be called 1 times, but got 0 times`: the hook still uses the stand-in.

- [ ] **Step 4: Swap the default**

In `src/lib/feed/useRoomFeed.ts` replace

```ts
import { pollingOnlySubscribe } from "@/lib/feed/realtime";
```

with

```ts
import { subscribeToRoom } from "@/lib/feed/realtime";
```

and in `resolveDeps` replace

```ts
    subscribe: deps.subscribe ?? pollingOnlySubscribe,
```

with

```ts
    subscribe: deps.subscribe ?? subscribeToRoom,
```

Run: `pnpm test src/lib/feed/useRoomFeed.test.tsx src/components/map/MapShell.test.tsx`
Expected: PASS (`29 passed` on the chunk 9 baseline).

- [ ] **Step 5: Only if chunk 10 is merged: keep its tests in polling mode**

```bash
ls src/components/map/MapShell.newRoom.test.tsx src/components/map/MapShell.pins.test.tsx tests/e2e/new-room.spec.ts 2>/dev/null
```

If this prints nothing, skip to Step 6. Otherwise chunk 10's plan (its hand-off note on chunk 11) says these files rely on the hook's default adapter refusing realtime:

- In each listed `MapShell.*.test.tsx` that renders `MapShell` and does not already mock `@/lib/feed/realtime`, add this block next to its other `vi.mock` calls, so the panel keeps polling exactly as before and no websocket is opened:

```ts
// Realtime is refused, as before chunk 11: these tests describe a polling room.
vi.mock("@/lib/feed/realtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/feed/realtime")>();
  return { ...actual, subscribeToRoom: actual.pollingOnlySubscribe };
});
```

- In `tests/e2e/new-room.spec.ts`, every test that installs the clock and then counts or waits for catch-up requests (chunk 10's scenario 1 does: it expects one catch-up after creation and one more after `page.clock.fastForward(POLL_INTERVAL_MS)`) must refuse realtime first. Import `refuseRealtime` from `./helpers` and add `await refuseRealtime(page);` immediately before that test's `await page.clock.install();`. Tests that never advance the clock need no change: a live room shows the same rows.

Run the touched unit files with `pnpm test <path>`; expected: their counts are unchanged from your baseline.

- [ ] **Step 6: Run everything**

Run: `pnpm test && pnpm lint && pnpm typecheck`
Expected: B-files + 2 files, B-tests + 51 tests (`38` / `746`) when Tasks 1–4 are done; lint and typecheck clean.

Run: `pnpm build`
Expected: succeeds; the route list is exactly `/`, `/_not-found`, `/api/health`, `/api/rooms`, `/api/rooms/[id]`, `/api/rooms/[id]/messages` (plus chunk 10's, if merged), with no `/e2e/…` line. Importing the adapter into the hook must not create a Supabase client at module load or during server rendering; `getBrowserClient()` is only called inside `subscribeToRoom`.

Check the dev server as in Task 5 Step 1 (restart it if it was started before this task's edit and does not hot-reload), then run: `pnpm test:e2e`
Expected: B-e2e passed (`18 passed`), none flaky. This run is the proof of Task 5: the polling scenarios now go through the real adapter, a closed websocket, `CHANNEL_ERROR` and the fallback. If the seven `openPollingRoom` scenarios time out in `waitForCatchUpIdle` or on `data-connection="polling"`, `refuseRealtime` is not in effect: check that it runs before `page.goto` and that the URL pattern matches the websocket URL in the browser's Network tab.

- [ ] **Step 7: Commit**

```bash
git add src/lib/feed/useRoomFeed.ts src/lib/feed/useRoomFeed.test.tsx src/components/map/MapShell.test.tsx
# plus any chunk 10 file changed in Step 5
git commit -m "feat(feed): subscribe to Supabase Realtime by default"
```

---

### Task 7: Realtime e2e scenarios

Room-panel design §8 ends with "chunk 11 reuses the harness for its realtime scenarios". These six run against the real Realtime server of the local stack. The clock is installed and paused, so a poll or the idle timeout can only fire when a test advances the clock; the websocket transport is real, while SDK heartbeat and timeout timers follow the clock. A row that appears while the clock is paused, with no new catch-up request, can only have come over the websocket.

**Files:**
- Modify: `tests/e2e/helpers.ts` (four new exports, placed before `pollNow`)
- Create: `tests/e2e/realtime.spec.ts`

**Interfaces:**
- Consumes from `tests/e2e/helpers.ts`: `connectionOf`, `waitForCatchUpIdle`, `openPollingRoom` (Task 5); `openRoom`, `createRoom`, `postMessage`, `fillCompose`, `rows`, `pollNow`, and the private `observeCatchUps`, `probeOf`.
- Produces, exported from `tests/e2e/helpers.ts`:
  - `REALTIME_IDLE_TIMEOUT_MS = 180_000`
  - `openLiveRoom(page: Page, room: Room): Promise<Locator>`
  - `settledCatchUps(page: Page): Promise<number>`
  - `goIdle(page: Page): Promise<void>`

- [ ] **Step 1: Add the helpers**

In `tests/e2e/helpers.ts`, immediately before the comment `/** One deliberate tick; wait for real JSON consumption before checking the rendered result. */`, add:

```ts
export const REALTIME_IDLE_TIMEOUT_MS = 180_000;

/**
 * Opens with realtime allowed: waits for the confirmed channel and settles its
 * catch-up, then freezes time, so no poll or idle timeout fires unless a test
 * advances the clock. The websocket transport stays real; SDK heartbeat and timeout timers follow the controlled clock.
 */
export async function openLiveRoom(page: Page, room: Room): Promise<Locator> {
  await observeCatchUps(page, room.id);
  await page.clock.install();
  const log = await openRoom(page, room);
  await expect(connectionOf(page)).toHaveAttribute("data-connection", "realtime");
  await waitForCatchUpIdle(page, 1); // the confirmation catch-up
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  await page.clock.runFor(32);
  return log;
}

/** Catch-up requests started so far; all of them have settled. */
export async function settledCatchUps(page: Page): Promise<number> {
  const probe = await probeOf(page);
  expect(probe.started).toBe(probe.settled);
  return probe.started;
}

/** The idle timeout fires: the room leaves realtime and polls at once. */
export async function goIdle(page: Page): Promise<void> {
  const before = await settledCatchUps(page);
  await page.clock.fastForward(REALTIME_IDLE_TIMEOUT_MS);
  await expect(connectionOf(page)).toHaveAttribute("data-connection", "polling");
  await waitForCatchUpIdle(page, before + 1);
  await page.clock.runFor(32);
}

```

- [ ] **Step 2: Write the scenarios**

Create `tests/e2e/realtime.spec.ts`:

```ts
import { expect, test, type Locator } from "@playwright/test";

import {
  connectionOf,
  createRoom,
  fillCompose,
  goIdle,
  openLiveRoom,
  openPollingRoom,
  pollNow,
  postMessage,
  rows,
  roomWithMessages,
  scrollTopOf,
  settledCatchUps,
  waitForCatchUpIdle,
} from "./helpers";

const row = (log: Locator, text: string) =>
  rows(log).filter({ has: log.page().getByText(text, { exact: true }) });

test("1. a message from someone else arrives over the websocket, without a request", async ({ page, request }) => {
  const { room } = await createRoom(request);
  const log = await openLiveRoom(page, room);
  const before = await settledCatchUps(page);

  await postMessage(request, room.id, { author: "bob", text: "live from bob" });

  // The clock is paused: no poll can run, so only the websocket can deliver this row.
  await expect(row(log, "live from bob")).toHaveCount(1);
  expect(await settledCatchUps(page)).toBe(before);
  await expect(connectionOf(page)).toHaveAttribute("data-connection", "realtime");
});

test("2. an own message sent while live appears once", async ({ page, request }) => {
  const { room } = await createRoom(request);
  const log = await openLiveRoom(page, room);

  await fillCompose(page, "ann", "sent while live");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByLabel("Message")).toHaveValue("");
  // A later live row proves the echo of the own insert had its chance to arrive.
  await postMessage(request, room.id, { author: "bob", text: "after the send" });
  await expect(row(log, "after the send")).toHaveCount(1);

  await expect(row(log, "sent while live")).toHaveCount(1);
  await expect(rows(log)).toHaveCount(3);
});

test("3. idle leaves realtime and polls at once; a send rejoins", async ({ page, request }) => {
  const { room } = await createRoom(request);
  const log = await openLiveRoom(page, room);

  await goIdle(page); // asserts "polling" and one immediate catch-up

  // Polling delivers now, and only on a tick: the clock is paused, so nothing can fetch this row yet.
  await postMessage(request, room.id, { author: "bob", text: "while idle" });
  await page.clock.runFor(32);
  await expect(row(log, "while idle")).toHaveCount(0);
  await pollNow(page);
  await expect(row(log, "while idle")).toHaveCount(1);
  await expect(connectionOf(page)).toHaveAttribute("data-connection", "polling"); // polling never rejoins by itself

  const beforeSend = await settledCatchUps(page);
  await fillCompose(page, "ann", "back again");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(connectionOf(page)).toHaveAttribute("data-connection", "realtime");
  await expect(row(log, "back again")).toHaveCount(1);

  // Live again: settle the confirmation catch-up, then a row arrives with no request.
  await waitForCatchUpIdle(page, beforeSend + 1);
  const before = await settledCatchUps(page);
  await postMessage(request, room.id, { author: "bob", text: "live again" });
  await expect(row(log, "live again")).toHaveCount(1);
  expect(await settledCatchUps(page)).toBe(before);
});

test("4. a refused websocket means polling from the start", async ({ page, request }) => {
  const { room } = await createRoom(request);

  const log = await openPollingRoom(page, room); // refuses realtime; asserts "polling"

  await postMessage(request, room.id, { author: "bob", text: "by poll" });
  await pollNow(page);
  await expect(row(log, "by poll")).toHaveCount(1);
});

test("5. incoming automatic scrolling cannot postpone user idle", async ({ page, request }) => {
  const room = await roomWithMessages(request, 30);
  const log = await openLiveRoom(page, room);
  expect(await log.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  let previousTop = await scrollTopOf(log);
  for (let n = 1; n <= 2; n += 1) {
    await page.clock.fastForward(60_000);
    await postMessage(request, room.id, { author: "bob", text: `automatic follow ${n}` });
    await expect(row(log, `automatic follow ${n}`)).toHaveCount(1);
    await page.clock.runFor(32); // deliver positioning/scroll frames under the paused clock
    const top = await scrollTopOf(log);
    expect(top).toBeGreaterThan(previousTop); // this is actual automatic scrolling
    previousTop = top;
  }
  const before = await settledCatchUps(page);
  await page.clock.fastForward(60_000); // 180 seconds without user input, despite incoming rows
  await expect(connectionOf(page)).toHaveAttribute("data-connection", "polling");
  await waitForCatchUpIdle(page, before + 1);
});

test("6. reader scrolling postpones idle, then inactivity still leaves", async ({ page, request }) => {
  const room = await roomWithMessages(request, 30);
  const log = await openLiveRoom(page, room);
  await page.clock.fastForward(120_000);
  const previousTop = await scrollTopOf(log);
  await log.hover();
  await page.mouse.wheel(0, -250); // real browser input, not assigning scrollTop
  await page.clock.runFor(64);
  await expect.poll(() => scrollTopOf(log)).toBeLessThan(previousTop);
  await page.clock.fastForward(60_000); // past the original deadline
  await expect(connectionOf(page)).toHaveAttribute("data-connection", "realtime");
  await goIdle(page); // no more input: the restarted timeout still expires
});

```

- [ ] **Step 3: Run the scenarios**

Check the dev server as in Task 5 Step 1, then run: `pnpm exec playwright test tests/e2e/realtime.spec.ts`
Expected: `6 passed`.

If scenario 1 times out waiting for `data-connection="realtime"`: open the app by hand and look at the browser console and the websocket in the Network tab. A `CHANNEL_ERROR` right after `phx_join` usually means the local stack's Realtime container is unhealthy (`docker ps | grep realtime`) or `public.messages` is missing from the `supabase_realtime` publication (run `pnpm db:migrate`). Do not reset the database.

- [ ] **Step 4: Mutation check, then restore**

Make the adapter swallow every insert. In `src/lib/feed/realtime.ts` change the line `handlers.onInsert(message);` to `void message;`, wait for the dev server to recompile, and run `pnpm exec playwright test tests/e2e/realtime.spec.ts`.
Expected: `4 failed`, `2 passed`: scenarios 1, 2, 3 and 5 fail on a missing row; scenarios 4 (polling only) and 6 (reader activity with existing history) pass.

Restore and confirm:

```bash
git checkout -- src/lib/feed/realtime.ts
git status --short src/lib/feed/realtime.ts          # prints nothing
pnpm exec playwright test tests/e2e/realtime.spec.ts  # 6 passed
```

(The opposite mutation was observed while prototyping: with `refuseRealtime` removed from `openPollingRoom`, exactly the seven polling scenarios of `room-panel.spec.ts` fail. You do not need to repeat it.)

Before the full run, verify F-002's regression is meaningful: temporarily call `onUserScroll?.()`
for every MessageList scroll, including `own` events. Scenario 5 must fail by remaining in
realtime at the original user-idle deadline. Restore `MessageList.tsx` from its Task 4 commit
and rerun scenarios 5 and 6; both must pass. Keep the existing root exclusion in place for this
mutation so it specifically tests the list's classification.

- [ ] **Step 5: Run the whole suite, repeated**

Run: `pnpm exec playwright test --repeat-each 3`
Expected: `72 passed` (B-e2e + 6 = 24 tests × 3), none flaky.

Run: `pnpm lint && pnpm typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add tests/e2e/helpers.ts tests/e2e/realtime.spec.ts
git commit -m "test(e2e): cover live delivery, idle fallback and rejoin on send over real Realtime"
```

---

### Task 8: Documentation, manual smoke and final verification

**Files:**
- Modify: `README.md` ("Room feed", "Room panel", "End-to-end tests")
- Modify: `docs/KNOWN_LIMITATIONS.md` ("Accepted limitations" table)
- Modify: `docs/superpowers/specs/2026-09-16-map-chat-implementation-chunks.md` ("Chunk 11", Scope)

**Interfaces:**
- Consumes: everything above. Produces: documentation only.

- [ ] **Step 1: README, "Room feed"**

Replace the sentence

```
framework-free store that runs its effects, and a React hook over that store. The realtime
adapter arrives with chunk 11; until then every room polls.
```

with

```
framework-free store that runs its effects, and a React hook over that store. The store talks
to Supabase Realtime through an injected adapter; the hook's default is `subscribeToRoom`.
```

Replace the table row for `@/lib/feed/realtime` with these two rows:

```
| `@/lib/feed/realtime`   | `subscribeToRoom(roomId, handlers, client?)`, the Supabase Realtime adapter; `SubscribeToRoom`, `RealtimeHandlers`, `RealtimeHandle`, `TOPIC_BUSY`, `POSTGRES_READY_TIMEOUT_MS`; `pollingOnlySubscribe`, an adapter for tests and fixtures that refuses realtime |
| `@/lib/feed/activity`   | `attachActivityTracking(el, { onActivity, ignoreScroll? })` returning the detach function              |
```

After the paragraph that ends "it also tracks `document.visibilityState`.", add:

```
`subscribeToRoom` makes one attempt on channel `room:<id>`: `postgres_changes` INSERTs on
`public.messages` filtered by `chatroom_id`, through the anon-key browser client. The SDK channel join and a
matching Postgres `system` readiness event together confirm the attempt. A Postgres error or
20-second readiness deadline fails it. `CHANNEL_ERROR`, `TIMED_OUT` and a `CLOSED` it did not ask for fail it,
once: the adapter removes the channel, so the SDK cannot rejoin behind the feed's polling, and
stays silent afterwards. Rows go through `toMessage`; a malformed row is logged and dropped.
The SDK reuses a channel by topic and ignores `subscribe()` on one that is still leaving, so an
attempt made while the room's previous channel is still registered fails with `TOPIC_BUSY`
instead of hanging. The lifecycle around the adapter is the reducer's (PRD 6.4): open → try
realtime; refused or dropped → poll at once and every 30 s; 180 s without activity →
unsubscribe and poll; a sent message while polling → try realtime again; a hidden tab never
holds a channel.
```

- [ ] **Step 2: README, "Room panel" and "End-to-end tests"**

In "Room panel", replace

```
The panel root has `data-connection` (`connecting`, `polling`, `realtime`) for tests; nothing
visible.
```

with

```
The panel root has `data-connection` (`connecting`, `polling`, `realtime`) for tests; nothing
visible. The same element reports activity (`pointerdown`, `pointermove`, `keydown`, `wheel`,
`scroll`, `touchstart`) to the feed, which postpones the realtime idle timeout; a sent message
counts too. MessageList classifies its own scroll events: automatic following and anchor
correction are excluded, while reader scrolling is reported once.
```

In "End-to-end tests", replace the sentence "It proves what jsdom cannot: layout, scrolling and the full HTTP path with polling." with "It proves what jsdom cannot: layout, scrolling, the full HTTP path with polling, and live delivery over the local stack's Realtime server." and add this bullet after the "Polling scenarios settle startup…" bullet:

```
- Polling scenarios call `refuseRealtime(page)`, which closes the `/realtime/v1/websocket`
  connection in the browser: the real adapter sees a refused connection and the room polls.
  Realtime scenarios (`tests/e2e/realtime.spec.ts`) use `openLiveRoom`, which waits for
  `data-connection="realtime"` and then pauses the clock. A row that appears while the clock is
  paused, with no new catch-up request, came over the websocket. `goIdle` fast-forwards the
  180 s idle timeout.
```

- [ ] **Step 3: Known limitations**

In `docs/KNOWN_LIMITATIONS.md`, append two rows to the "Accepted limitations" table:

```
| The websocket outlives the idle timeout by about 50 seconds | At the idle timeout the room leaves its channel and polls at once, but supabase-js closes the socket only after its deferred disconnect (twice the 25 s heartbeat). Connection counts against the Realtime quota fall that much later. | Accepted. Closing at once makes a quick re-subscribe skip `connect()` while the socket is still disconnecting, and the join then times out. |
| A re-subscribe can find the room's previous channel still leaving | supabase-js reuses a channel by topic and ignores `subscribe()` until the leave is acknowledged. The attempt is refused (`TOPIC_BUSY`) and the room polls until the next sent message tries again. Seen only when the same room is left and rejoined within the leave round trip. | Accepted for the POC. |
```

- [ ] **Step 4: Chunks document**

In `docs/superpowers/specs/2026-09-16-map-chat-implementation-chunks.md`, "Chunk 11", replace the two Scope bullets that start with `` - `lib/feed/activity.ts`: `` and `` - `useRoomFeed`: `` with:

```
- `lib/feed/activity.ts`: `attachActivityTracking(el, { onActivity })` for pointer, keyboard,
  wheel, scroll and touch inside the panel, with `ignoreScroll(target)` delegating the list
  element to `MessageList.onUserScroll`. Automatic positioning is excluded. Document visibility is owned by `useRoomFeed`
  since chunk 9 (room-feed design §7), not by activity tracking.
- `useRoomFeed`: `subscribeToRoom` replaces the stand-in as the default adapter; the store
  already interprets `subscribe`/`unsubscribe` and the idle timer (chunk 9). `RoomPanel`
  calls `attachActivityTracking` on its root.
```

In the first Scope bullet, replace `` `SUBSCRIBED` → `subscribed` `` with
`` channel `SUBSCRIBED` plus matching Postgres `system` readiness → `subscribed` ``;
replace `` `subscribeFailed(reason)` `` with `` `channelFailed(reason)` `` and
"`CLOSED`-before-subscribed" with "an unrequested `CLOSED`, Postgres readiness error, or
20-second readiness deadline". In "Acceptance", replace
`` `subscribeFailed` → polling starts immediately `` with `` `channelFailed` → polling starts immediately ``.

- [ ] **Step 5: Final verification**

```bash
pnpm test 2>&1 | grep -E "Test Files|Tests "
pnpm lint && pnpm typecheck
pnpm build
git status --short
```

Expected: `38 passed` files and `746 passed` tests on the chunk 9 baseline (B-files + 2, B-tests + 51); lint and typecheck clean; the build's route list has no `/e2e/…` line; `git status` shows only the three documentation files of this task.

Check the dev server as in Task 5 Step 1, then: `pnpm test:e2e`
Expected: `24 passed` (B-e2e + 6), none flaky. Do not run `pnpm db:reset`: the created rooms stay, as chunk 9's README explains.

- [ ] **Step 6: Commit**

```bash
git add README.md docs/KNOWN_LIMITATIONS.md docs/superpowers/specs/2026-09-16-map-chat-implementation-chunks.md
git commit -m "docs(feed): document the realtime adapter, activity tracking and the realtime e2e scenarios"
```

- [ ] **Step 7: Manual smoke (PRD §8): for the user, in a real browser**

An agentic executor cannot do this step. Report it as **not run** and hand these instructions to the user; do not claim it passed.

1. Optional, to avoid waiting three minutes: stop the dev server and start it with a short idle timeout, `NEXT_PUBLIC_REALTIME_IDLE_TIMEOUT_MS=20000 pnpm dev` (the value is inlined at server start; a process variable wins over `.env.local`).
2. Open `https://map-chat.map-chat.test` in two browser windows and open the same room in both. In window A open DevTools → Network → filter "WS" (Chrome: "Socket") and select the `websocket` request under `/realtime/v1/`.
3. Send a message from window B. **Expect:** it appears in window A without a reload and without a new `/messages?after=` request; the Messages tab of the websocket shows a `postgres_changes` frame.
4. Leave window A untouched (no pointer, keys or scrolling inside the panel) for the idle timeout. **Expect:** a `phx_leave` frame on the websocket and, at the same moment, one `GET /api/rooms/<id>/messages?after=…`; then one such request every 30 s. About 50 s after the `phx_leave` the websocket itself closes (decision 3).
5. While window A is polling, move the pointer over the panel. **Expect:** nothing changes; activity alone does not rejoin.
6. Send a message from window A. **Expect:** a new websocket (or a new `phx_join` on the old one if it has not closed yet), one `?after=` catch-up, and the 30 s requests stop.
7. Repeat step 3 while moving the pointer inside window A's panel every minute or so past the idle timeout. **Expect:** no `phx_leave`: activity postpones the timeout.
8. Hide window A's tab (switch to another tab). **Expect:** `phx_leave` at once and polling; coming back does not rejoin until a message is sent.

---

## Hand-off notes for later chunks

- **Chunk 10 (new chatroom flow), if it is executed after this chunk.** Its plan assumes the hook's default adapter refuses realtime. Its executor must apply Task 6 Step 5 of this plan to chunk 10's own files: mock `@/lib/feed/realtime` in `MapShell.newRoom.test.tsx` (and any other new unit test that renders `MapShell` without `feedDeps`), and call `refuseRealtime(page)` before `page.clock.install()` in the e2e scenario that counts catch-up requests. A seeded room needs nothing else: it subscribes from the seed's bookmark without a history request (room-feed design §1 decision 3).
- **Chunk 12 (shareable URL and polish).** A room that answers 404 drops its channel through the reducer's terminal rule; nothing in the adapter is room-gone aware. If chunk 12 adds a visible connection indicator, `feed.connection` already distinguishes `connecting`, `realtime` and `polling`.
- **Chunk 13 (deploy).** The manual smoke of Step 7 is repeated against the deployed URL. On hosted Supabase, check that `public.messages` is in the `supabase_realtime` publication (the migration adds it) and that Realtime is enabled for the project.

## Out of scope

Offline detection, retry backoff, automatic re-subscribe on activity other than sending, automatic catch-up on return from a hidden tab, cancelling in-flight requests (room-feed design §10); a visible connection indicator; Broadcast-from-database instead of Postgres Changes (PRD 6.4 names it as the later upgrade path); any change to the reducer, the store, `getBrowserClient()` or the database; closing the websocket at the idle timeout instead of after the SDK's deferred disconnect; presence or typing indicators.
