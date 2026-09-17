# Chunk 9: Room Panel (Polling Mode) Implementation Plan

**Review feedback:** [2026-09-17-chunk-09-room-panel-feedback.md](2026-09-17-chunk-09-room-panel-feedback.md)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open a room from its pin and use it end to end over HTTP polling (history, "Load older", backlog, compose, local time), with the feed store and hook that run chunk 8's reducer, the seed path for a freshly created room, every in-panel error surface, and the project's first Playwright suite.

**Architecture:** `createFeedStore` interprets the effects of chunk 8's pure `feedReducer` against injected dependencies (messages API, realtime adapter, timers); `useRoomFeed` is a thin `useSyncExternalStore` bridge that creates a fresh store per committed effect and disposes it on cleanup. `RoomPanel` composes the hook, `PanelFrame`, `MessageList` and the footer (fetch alert, backlog notice, `ComposeForm`). Every scroll rule is a pure function in `listScroll.ts`; `MessageList` only measures the DOM, asks those functions and applies the answer, so the rules are unit-tested without layout and proven in Chromium by Playwright.

**Tech Stack:** TypeScript 5 (`strict`), Next.js 16.3.5 App Router, React 19.2.8, Tailwind CSS 4, shadcn/ui (style `base-nova`, this chunk adds `alert`), `react-icons`, Leaflet 1.9.4 + react-leaflet 5, Vitest 5 with jsdom 30 and Testing Library, `@playwright/test` (new, Chromium only), pnpm 10, Node 22.

**Spec:** `docs/superpowers/specs/2026-09-17-room-panel-design.md` (approved revision of 2026-09-17; its companion `2026-09-17-room-panel-design-feedback.md` records the accepted findings F-001–F-004). Read together with `docs/superpowers/specs/2026-09-16-room-feed-design.md` §6, §7, §9 (store and hook contract, acceptance cases F-001–F-005) and `docs/superpowers/specs/2026-09-16-map-shell-design.md` §6–§8 (selection, pins, panel frame). Parent: `docs/superpowers/specs/2026-09-16-map-chat-implementation-chunks.md` §0 and "Chunk 9". PRD (`docs/PRD.md`): §3 Flow B, §4 (Message display, History, Compose behavior), §6.4 (polling state only), §6.7, §8. Executors read the room-panel spec and the room-feed design before Task 1; this plan argues from them and does not restate them.

## Global Constraints

Copied from the chunks document §0 and the three specs where they apply to this chunk:

- Language: TypeScript, `strict: true`, no `any` in committed code.
- Package manager: pnpm (`packageManager: pnpm@10.9.0`). Node 22 LTS.
- Framework: Next.js 16, App Router. `AGENTS.md`: this Next.js has breaking changes; read the relevant guide under `node_modules/next/dist/docs/` before writing Next-specific code (this plan touches only `pageExtensions`, guide `01-app/03-api-reference/05-config/01-next-config-js/pageExtensions.md`).
- UI: React 19, Tailwind, shadcn/ui components wherever one fits; icons from `react-icons`.
- Supbuddy manages the local stack. Never edit `/etc/resolver/` files or a `Caddyfile`; start the dev server with `pnpm dev` (`supbuddy run -- next dev`); do not run a bare `supabase start`.
- Data contracts: `Message = { id; chatroomId; author; text; createdAt }`, `createdAt` canonical ISO-8601 UTC with six fractional digits. Ordering is always `compareCreatedAtId`; `Date` is for display only.
- One fetch at a time: "Load older" and "Load more messages" are disabled while `feed.loading !== null`; a spinner shows only on the button whose own operation runs. The reducer is unchanged by this chunk.
- Copy, verbatim: `This room no longer exists.` · `Couldn't load this room. Close it and open it again.` · `Loading messages…` · `Couldn't load older messages. Try again.` · `Couldn't check for new messages. Retrying automatically.` · `Couldn't check for new messages. Use Load more messages to retry.` · `More messages are available` · `Load more messages` · `Load older` · `New messages` · `Send`. `FeedNotReadyError`: `code: 'feed_not_ready'`, message `Wait for the room to load, or reopen it if loading failed.`
- Scroll: near-bottom threshold 32 px (`NEAR_BOTTOM_PX`). Additions are detected by comparing full id sets, never endpoints or loading flags. Position is preserved by a visible row's viewport offset, never by a scroll-height difference (100 px above plus 100 px below adjusts by 100 px).
- Layout: at 1280 × 720 CSS pixels the header and all footer controls fit inside the panel slot with at least 96 px of message viewport, also with fetch alert, backlog notice and a compose error together; the page never gets a scrollbar. The room panel's textarea is fixed at 64 px (`field-sizing-fixed`, `resize-none`, `overflow-y-auto`); all 3000 code points stay editable and submittable.
- Time: fixed `en-GB` locale, `hourCycle: "h23"`; `17:03` today, `16 Sep 17:03` another day this year, `16 Sep 2025 17:03` another year; day and year compared in the target zone.
- The panel root carries `data-connection={feed.connection}`; no visible connection indicator. `feed.activity` is not wired (chunk 11).
- Tests: Vitest, TDD (failing test first). Unit tests colocated as `*.test.ts(x)`; component files opt in with `// @vitest-environment jsdom` on the first line. Target one path with `pnpm test <path>` **without** `--`.
- End-to-end: `@playwright/test`, project `chromium` only, `tests/e2e/**`, script `"test:e2e": "playwright test"`, not part of `pnpm test`. Viewport `1280 × 720` explicit. `baseURL = process.env.E2E_BASE_URL ?? "https://map-chat.map-chat.test"`, `ignoreHTTPSErrors: true`, `webServer.reuseExistingServer: true`. Poll timing through `openPollingRoom`: install the clock before navigation, settle startup catch-up, then pause it before scenario writes; advance with `page.clock.fastForward(30_000)` and observe request completion; no `NEXT_PUBLIC_POLL_INTERVAL_MS` override. HTTP-scenario data only through the real API; focused geometry fixtures use synthetic props without mocking HTTP. API rooms at 6-decimal coordinates randomized within lat `[40, 50]`, lng `[0, 10]`; no DB reset, no service-role key, no shared rooms. Selectors: roles and visible text only, no test ids. Never run `pnpm test:api` or `pnpm test:db` while `pnpm test:e2e` runs (they truncate tables).
- Lint: `pnpm lint` must pass with zero errors and zero warnings after every task. Typecheck: `pnpm typecheck` (`next typegen && tsc --noEmit`) must exit 0.
- Commits: conventional commits, one commit per task. This repository has no GitButler workspace (`but status` reports "No GitButler project found"), so the steps use plain `git`; if GitButler is active when you execute, use the `commit` skill with the same messages.

## Prerequisites (verified on 2026-09-17)

- `main` is at `f8577a3` (merge of `chunk-08-feed-reducer`). Chunks 1–8 are merged. Baseline on `main`: `pnpm test` reports **30 files, 542 tests** passing; `pnpm lint` and `pnpm typecheck` are clean.
- Present on `main` with the names the specs use: `MessagesApi`, `ApiRequestError`, `ApiValidationError`, `api` (`src/lib/api/client.ts`); `FeedState`, `FeedAction`, `FeedEffect`, `FeedError`, `Connection`, `FetchOp` (`src/lib/feed/types.ts`); `initialFeedState`, `feedReducer`, `connectionOf`, `mergeMessages` (`src/lib/feed/reducer.ts`); `ComposeForm`, `ComposeFormProps` and `SUBMIT_FAILED_MESSAGE` (`src/components/compose/`); `useDisplayName`, `DISPLAY_NAME_KEY` (`src/lib/storage/`); `PanelFrame` (`src/components/panel/PanelFrame.tsx`); `getClientConfig` (`src/lib/config/client.ts`). Task 1 re-checks them.
- The reducer returns the **same state object** for an ignored action; the store uses that to skip notifications.
- `src/components/ui/` has `button`, `card`, `input`, `label`, `textarea`. There is no `alert`; Task 8 adds it with the project's shadcn CLI. `cn` (the `cn` package) merges conflicting Tailwind classes, so `field-sizing-fixed` passed as `className` replaces the textarea's default `field-sizing-content`.
- `PanelFrame`'s footer is shadcn's `CardFooter`, a **row** flexbox (`flex items-center`). Footer content must be wrapped in one `flex w-full flex-col` element.
- `vitest.config.ts` includes only `src/**/*.test.{ts,tsx}`, so `tests/e2e/**` never runs under `pnpm test`. `tsconfig.json` includes `**/*.ts`, so `playwright.config.ts` and `tests/e2e/**` are type-checked by `pnpm typecheck` once `@playwright/test` is installed.
- The local Supabase stack answers on `http://127.0.0.1:55021`. The Supbuddy mapping `https://map-chat.map-chat.test` points at the dev server on port 3000 of the project's loopback IP and answers 502 while no dev server runs.
- **Historical prototype, before the accepted plan-review revisions:** the original plan's code was prototyped end to end on 2026-09-17 in a scratch copy of `main`: all unit tests (36 files, 695 tests), `pnpm lint`, `pnpm typecheck`, `pnpm build`, and all 18 Playwright tests (three consecutive runs, Chromium, `@playwright/test` 1.62.0, against `next dev` and the local stack) passed. The scratch server was started with `pnpm exec next dev -p 3100 -H 127.0.0.1` and `E2E_BASE_URL`; the `pnpm dev`/Supbuddy start-up path was **not** exercised and is verified in Task 11. The revised clock helpers, polling assertions, cap-independent corner fixture and mutation checks below have not been exercised by that prototype; their expected results are execution requirements, not verified outcomes. Type the code as written; where your run disagrees with an "Expected" line, stop and investigate rather than adjust the test.

## Before you start: worktree and documents

Execute this plan in its own worktree, following the sibling convention in use:

```bash
cd /Users/calin/dev/other/wp
git worktree add -b chunk-09-room-panel /Users/calin/dev/other/wp-worktrees/chunk-09-room-panel main
cd /Users/calin/dev/other/wp-worktrees/chunk-09-room-panel
```

The spec set of this chunk is not committed on `main` at writing time: the room-panel design, its feedback companion and this plan are untracked, and three tracked specs carry uncommitted revisions that this chunk depends on (the `loadNewer(): Promise<void>` contract in the room-feed design, the seed note in the map-shell design, the chunk 9 section of the chunks document). Bring exactly these files into the worktree and commit them first. The script copies the named files from the main checkout over the worktree's copies and commits only them; if they were committed on `main` in the meantime it commits nothing.

```bash
chunk_docs=(
  docs/superpowers/plans/2026-09-17-chunk-09-room-panel.md
  docs/superpowers/specs/2026-09-17-room-panel-design.md
  docs/superpowers/specs/2026-09-17-room-panel-design-feedback.md
  docs/superpowers/specs/2026-09-16-room-feed-design.md
  docs/superpowers/specs/2026-09-16-map-shell-design.md
  docs/superpowers/specs/2026-09-16-map-chat-implementation-chunks.md
)
for chunk_doc in "${chunk_docs[@]}"; do
  test -f "/Users/calin/dev/other/wp/$chunk_doc" || exit 1
  mkdir -p "$(dirname "$chunk_doc")" || exit 1
  cp "/Users/calin/dev/other/wp/$chunk_doc" "$chunk_doc" || exit 1
done
git add -- "${chunk_docs[@]}"
if ! git diff --cached --quiet -- "${chunk_docs[@]}"; then
  git commit --only -m "docs(room): add the room panel design, its review and the chunk 9 plan" -- "${chunk_docs[@]}"
fi
git ls-files --error-unmatch -- "${chunk_docs[@]}"
grep -c "loadNewer(): Promise<void>" docs/superpowers/specs/2026-09-16-room-feed-design.md
```

Expected: all six files are tracked; the last command prints `2` (store and hook contract). If this plan has a review companion (`2026-09-17-chunk-09-room-panel-feedback.md`) when you execute, add it to the list.

```bash
pnpm install
pnpm db:env          # writes .env.local from the running stack (needed by the e2e tasks)
pnpm test && pnpm lint && pnpm typecheck
```

Expected: `pnpm test` reports 30 files / 542 tests passing (record the numbers if other chunks merged first); lint and typecheck are clean. Every path below is relative to this worktree.

## Spec reconciliation and design decisions

The specs win on everything not listed here. These are the points where the plan pins down something they leave open, or departs from their wording. Items 1 and 2 correct statements in the specs that turned out to be false in the prototype.

1. **Month labels are fixed English abbreviations.** The spec's table shows `16 Sep 17:03` and says the string is assembled from `formatToParts` with a short month. With current ICU data `en-GB` abbreviates September as **"Sept"** (checked on Node 22.23 and Chromium). `formatMessageTime` therefore asks for a **numeric** month part and maps it through its own `Jan`…`Dec` table. Day, year, hour and minute still come from `formatToParts` in the target zone. The `locale` option is kept in the signature.
2. **Leaflet does not turn Enter on a marker into `click`.** Map-shell design §7 and the room-panel design §8 ("Opening a room") rely on "Leaflet markers are keyboard focusable and Enter triggers click". Leaflet 1.9.4 gives markers `tabindex="0"` and `role="button"` but only handles Enter for popups (`Popup.js` `_onKeyPress`); a plain marker ignores the keyboard. The prototype's `openRoom` helper failed for exactly this reason. Task 10 adds a `keydown` handler (Enter and Space) to `RoomPins`, which is outside the spec's file list, and corrects the sentence in map-shell design §7. It is a real accessibility defect of chunk 6, and the e2e harness depends on the fix.
3. **`src/lib/feed/realtime.ts` is created now**, with only the adapter types (`RealtimeHandle`, `RealtimeHandlers`, `SubscribeToRoom`, verbatim from room-feed design §8) and the stand-in adapter `pollingOnlySubscribe`. The store and hook need the types; chunk 11 adds `subscribeToRoom` to the same file and swaps the hook's default. The stand-in's handle clears its pending timer instead of being a pure no-op, so an unmounted panel leaves no stray timer.
4. **Store details.** Listeners are notified only when the reducer returned a new state object; `dispose()` does not notify (the hook detaches first); `dispatch` and every action method are no-ops before `start` and after `dispose`. Timers default to the globals **looked up at call time**, so Vitest's fake timers apply. The manual-load completion is implemented by tagging the queued `newerRequested` action with its `resolve`: the `fetchNewer` effect produced by *that* reduction carries it; with no such effect the promise resolves at once. No reducer change, no inference from loading flags.
5. **The hook uses `useLayoutEffect`** for store setup. The spec requires that "a seeded room never shows the spinner row after commit"; a layout effect publishes the seeded snapshot before the first paint. React 19 does not warn for layout effects during server rendering. A `roomId` change swaps the bridge with the documented set-state-during-render pattern.
6. **`listScroll.ts` exports more than the spec's two functions**: `decideScroll` (the §5.1 priority table), `decideResize`, `hasIncoming`, `pickAnchor`, `anchorAdjustment`. Decision 7 of the spec says scroll decisions are pure functions; these are them.
7. **Browser scroll anchoring is turned off** on the list (`[overflow-anchor:none]`). The spec asks to "coordinate with browser scroll anchoring so the displacement is applied once"; owning every correction is the simplest way. The list tells its own `scrollTop` writes from the reader's scrolling by remembering the value it wrote, so its correction never hides a freshly shown pill.
8. **Hold release.** `finish()` marks the hold and forces one commit of the list (`setHoldTick`). The layout effect of that commit, or of an earlier one that already carried the rows, reconciles under the hold and then releases it. Because the store publishes before the completion promise resolves, any commit after `finish()` renders the request's final snapshot.
9. **Rows are `<article>` elements** and the time is a `<time>` element, so Playwright addresses rows with `getByRole("article")` and times with `getByRole("time")` and the "roles and visible text only" rule holds. `data-message-id` exists for the list's own measuring, not for tests.
10. **`MessageList` takes `ref` as a prop** (React 19), not `forwardRef`.
11. **`PanelSlot`** (`src/components/panel/PanelSlot.tsx`) is extracted from `MapShell` so the e2e fixtures render the real slot and its geometry cannot drift from the page's.
12. **Fixture bootstrapping uses a dev-only page extension.** `next.config.ts` lists `dev.tsx` in `pageExtensions` unless `NODE_ENV === "production"`. `src/app/e2e/**/page.dev.tsx` is a route of `next dev` and is invisible to `next build` (verified: the production route list has no `/e2e` entry). This satisfies "must not add a production route" with no extra dependency and the same Playwright project.
13. **The layout fixture's fake feed is scripted by cursor, not by call count**, because Strict Mode creates two stores in development and a counter would desynchronize them.
14. **Scenario 8 sends a tall own message** (40 lines). With a one-line C, interior rows land *below* the reader's visible row and the ±2 px assertion passes even with anchoring removed (checked by mutation in the prototype). A C taller than the list lets the reader be scrolled up while C is still the first visible row, so the inserted rows displace it and the assertion is meaningful.
15. **The `FeedNotReadyError` panel test injects the error through `messages.post`.** The store rethrows a POST rejection unchanged, so the panel's adapter receives exactly what the store's own readiness rejection produces, without a render race.
16. **Store tests include hand-driven "confirming adapter" cases** needed by F-003 and F-004 (`fakeRealtime()` lets a test call `onSubscribed`). Chunk 11 still owns its own additions listed in room-feed design §9.
17. **`webServer.url` is `${baseURL}/api/health`**, which answers 200 only when the app and the Supabase stack are both up.
18. **README** gains "Room panel" and "End-to-end tests" sections and the "Room feed" section is completed, as earlier chunks documented theirs.
19. **Accepted plan review (2026-09-17, F-001–F-004).** Polling tests use a paused clock and a test-owned observer of real fetch/JSON completion; the startup catch-up settles before scenario writes. An additional API message proves post-send catch-up committed, and a room-specific fetch counter proves no backlog request starts. The region check measures the real MapView's reported bounds using a dev-only fixture with 501 newer synthetic rooms and omitted corner pins. No reset is part of execution. These supersede the original harness details in room-panel design §8 without changing product behavior or its API-only HTTP scenarios.

## File structure

| Path | Responsibility | Task |
| --- | --- | --- |
| `src/lib/feed/realtime.ts` | Adapter types; `pollingOnlySubscribe` stand-in | 1 |
| `src/lib/feed/test-helpers.ts` | `msg`, `page`, `catchUp`, `deferred`, `fakeMessages`, `fakeRealtime`, `TEST_CONFIG`; `manualTimers` (Task 8) | 1, 8 |
| `src/lib/feed/store.ts`, `store.test.ts` | `createFeedStore`, `FeedDeps`, `FeedStore`, `FeedTimers`, `FeedNotReadyError` | 1 |
| `src/lib/feed/useRoomFeed.ts`, `useRoomFeed.test.tsx` | `useRoomFeed`, `RoomFeed`, `RoomFeedOptions` | 2 |
| `src/lib/time/format.ts`, `format.test.ts` | `formatMessageTime` | 3 |
| `src/components/room/listScroll.ts`, `listScroll.test.ts` | Pure scroll decisions | 4 |
| `src/components/room/MessageItem.tsx`, `LoadOlderButton.tsx` | One row; first element of the list | 5 |
| `src/components/room/MessageList.tsx`, `MessageList.test.tsx` | Scroll container, pill, handle | 5 |
| `src/lib/page/selection.ts`, `selection.test.ts` (modify) | `seed` on the room selection; `roomCreated` carries `message` | 6 |
| `src/components/compose/ComposeForm.tsx`, `ComposeForm.test.tsx` (modify) | `textareaClassName` | 7 |
| `src/components/ui/alert.tsx` | shadcn `alert` (generated) | 8 |
| `src/components/room/BacklogNotice.tsx` | Backlog text and button | 8 |
| `src/components/room/RoomPanel.tsx`, `RoomPanel.test.tsx` | The panel | 8 |
| `src/components/panel/PanelSlot.tsx` | The floating panel slot | 9 |
| `src/components/map/MapShell.tsx`, `MapShell.test.tsx` (modify) | Renders `RoomPanel` | 9 |
| `src/components/map/RoomPins.tsx`, `RoomPins.test.tsx` (modify); map-shell design §7 | Keyboard activation of pins | 10 |
| `package.json`, `.gitignore`, `playwright.config.ts`, `tests/e2e/helpers.ts`, `tests/e2e/harness.spec.ts`; `next.config.ts`, `src/app/e2e/roomRegion.ts`, `src/app/e2e/map-region/{page.dev.tsx,MapRegionFixture.tsx}` | Playwright harness and cap-independent bounds fixture | 11 |
| `tests/e2e/room-panel.spec.ts` | Scenarios 1–8 and 10 (real HTTP) | 12 |
| `src/app/e2e/fixtureMessages.ts`, `src/app/e2e/message-list/page.dev.tsx`, `src/app/e2e/room-panel-layout/page.dev.tsx`, `tests/e2e/room-panel.spec.ts` (modify) | Dev-only fixtures; scenario 9 and the notices half of scenario 10 | 13 |
| `README.md` (modify) | Room feed, Room panel, End-to-end tests, Scripts | 14 |

Dependency order: 1 → 2 → 8 → 9; 3 and 4 → 5 → 8; 6 → 9; 7 → 8; 10 → 11 → 12 → 13 → 14. Tasks 3, 4, 6, 7 and 10 are independent of each other and of 1–2.

---

### Task 1: Feed store

**Files:**
- Create: `src/lib/feed/realtime.ts`, `src/lib/feed/test-helpers.ts`, `src/lib/feed/store.ts`
- Test: `src/lib/feed/store.test.ts`

**Interfaces:**
- Consumes: `feedReducer(state, action): [FeedState, FeedEffect[]]`, `initialFeedState(roomId)` from `@/lib/feed/reducer`; `FeedAction`, `FeedEffect`, `FeedState`, `FetchOp` from `@/lib/feed/types`; `MessagesApi` (`list(roomId, params?)`, `listAfter(roomId, after)`, `post(roomId, input)`) and `ApiRequestError` (`.status`) from `@/lib/api/client`; `PostMessageInput` from `@/lib/schemas/message`; `Message`, `MessagePage`, `CatchUpPage` from `@/lib/schemas/types`.
- Produces:
  - `@/lib/feed/realtime`: `type RealtimeHandle = { unsubscribe(): void }`; `type RealtimeHandlers = { onSubscribed(): void; onFailed(reason: string): void; onInsert(message: Message): void }`; `type SubscribeToRoom = (roomId: string, handlers: RealtimeHandlers, client?: SupabaseClient) => RealtimeHandle`; `const pollingOnlySubscribe: SubscribeToRoom`.
  - `@/lib/feed/store`: `type FeedTimers`; `type FeedDeps = { messages: MessagesApi; subscribe: SubscribeToRoom; config: { pollIntervalMs: number; realtimeIdleTimeoutMs: number }; timers?: FeedTimers }`; `type FeedStore = { start(opts: { hidden: boolean }): void; getState(): FeedState; subscribe(listener: () => void): () => void; dispatch(action: FeedAction): void; loadOlder(): void; loadNewer(): Promise<void>; send(input: PostMessageInput): Promise<Message>; activity(): void; setHidden(hidden: boolean): void; dismissError(): void; dispose(): void }`; `class FeedNotReadyError extends Error { readonly code = "feed_not_ready" }`; `createFeedStore(roomId: string, deps: FeedDeps, seed?: Message): FeedStore`.
  - `@/lib/feed/test-helpers` (test-only): `ROOM`, `id(n)`, `msg(n, overrides?)`, `page(messages, hasMore?)`, `catchUp(messages, nextCursor, hasMore?)`, `deferred<T>()`, `fakeMessages()` → `{ api, list, listAfter, post }` (arrays of pending calls with `resolve`/`reject`), `fakeRealtime()` → `{ subscribe, attempts }` (each attempt has `handlers` and an `unsubscribe` mock), `TEST_CONFIG`.

- [ ] **Step 1: Verify the exports this chunk builds on**

```bash
grep -c "export type MessagesApi\|export class ApiRequestError\|export class ApiValidationError\|export const api" src/lib/api/client.ts
grep -c "export function \(initialFeedState\|feedReducer\|connectionOf\|mergeMessages\)" src/lib/feed/reducer.ts
grep -c "export type \(FeedState\|FeedAction\|FeedEffect\|FeedError\|Connection\|FetchOp\) " src/lib/feed/types.ts
grep -c "export function ComposeForm\|export type ComposeFormProps" src/components/compose/ComposeForm.tsx
grep -c "export function useDisplayName" src/lib/storage/useDisplayName.ts
grep -c "export function PanelFrame\|export type PanelFrameProps" src/components/panel/PanelFrame.tsx
grep -c "export function getClientConfig" src/lib/config/client.ts
grep -c "export const SUBMIT_FAILED_MESSAGE" src/components/compose/fieldErrors.ts
grep -c "export const DISPLAY_NAME_KEY" src/lib/storage/displayName.ts
```

Expected, in order: `4`, `4`, `6`, `2`, `1`, `2`, `1`, `1`, `1`. If a count differs, open that file, read the real name or signature, and carry the drift through every later task before writing code (the spec's §2 makes this the plan's first obligation).

- [ ] **Step 2: Create the adapter types and the stand-in adapter**

Create `src/lib/feed/realtime.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Message } from "@/lib/schemas/types";

/**
 * The realtime adapter contract (room-feed design §8). Chunk 9 ships the types
 * and a stand-in adapter; chunk 11 adds `subscribeToRoom` here and makes it the default.
 */
export type RealtimeHandle = { unsubscribe(): void };

export type RealtimeHandlers = {
  onSubscribed(): void;
  /** May fire after `onSubscribed` when the channel later drops. */
  onFailed(reason: string): void;
  onInsert(message: Message): void;
};

export type SubscribeToRoom = (
  roomId: string,
  handlers: RealtimeHandlers,
  client?: SupabaseClient,
) => RealtimeHandle;

/**
 * Chunk 9's default adapter: realtime is refused on the next macrotask, so
 * every room runs in polling mode end to end (room-feed design §7).
 */
export const pollingOnlySubscribe: SubscribeToRoom = (_roomId, handlers) => {
  const timer = setTimeout(() => handlers.onFailed("realtime not implemented"), 0);
  return { unsubscribe: () => clearTimeout(timer) };
};
```

- [ ] **Step 3: Create the shared feed test helpers**

Create `src/lib/feed/test-helpers.ts` (the repository already keeps such a file at `src/lib/schemas/test-helpers.ts`). It is imported only by tests.

```ts
import { vi } from "vitest";

import type { MessagesApi } from "@/lib/api/client";
import type { RealtimeHandlers, SubscribeToRoom } from "@/lib/feed/realtime";
import type { PostMessageInput } from "@/lib/schemas/message";
import type { CatchUpPage, Message, MessagePage } from "@/lib/schemas/types";

export const ROOM = "11111111-1111-4111-8111-111111111111";
export const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** Message `n`, created `n` microseconds into the same second, so ids and times sort alike. */
export function msg(n: number, overrides: Partial<Message> = {}): Message {
  return {
    id: id(n),
    chatroomId: ROOM,
    author: `author-${n}`,
    text: `message ${n}`,
    createdAt: `2026-09-16T10:00:00.${String(n).padStart(6, "0")}Z`,
    ...overrides,
  };
}

export const page = (messages: Message[], hasMore = false): MessagePage => ({ messages, hasMore });

export function catchUp(messages: Message[], nextCursor: string, hasMore = false): CatchUpPage {
  return { messages, hasMore, nextCursor };
}

export type Deferred<T> = {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
};

export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

type Call<A, T> = Deferred<T> & { args: A };

/** A `MessagesApi` whose every call stays pending until the test settles it. */
export function fakeMessages() {
  const list: Call<{ before?: string }, MessagePage>[] = [];
  const listAfter: Call<{ after: string }, CatchUpPage>[] = [];
  const post: Call<{ input: PostMessageInput }, Message>[] = [];
  const api: MessagesApi = {
    list: vi.fn((_roomId: string, params?: { before?: string }) => {
      const call = { ...deferred<MessagePage>(), args: { before: params?.before } };
      list.push(call);
      return call.promise;
    }),
    listAfter: vi.fn((_roomId: string, after: string) => {
      const call = { ...deferred<CatchUpPage>(), args: { after } };
      listAfter.push(call);
      return call.promise;
    }),
    post: vi.fn((_roomId: string, input: PostMessageInput) => {
      const call = { ...deferred<Message>(), args: { input } };
      post.push(call);
      return call.promise;
    }),
  };
  return { api, list, listAfter, post };
}

/** A realtime adapter the test drives by hand: one entry per `subscribe` call. */
export function fakeRealtime() {
  const attempts: { handlers: RealtimeHandlers; unsubscribe: ReturnType<typeof vi.fn> }[] = [];
  const subscribe: SubscribeToRoom = (_roomId, handlers) => {
    const unsubscribe = vi.fn();
    attempts.push({ handlers, unsubscribe });
    return { unsubscribe };
  };
  return { subscribe, attempts };
}

export const TEST_CONFIG = { pollIntervalMs: 30_000, realtimeIdleTimeoutMs: 180_000 };
```

- [ ] **Step 4: Write the failing store tests**

Create `src/lib/feed/store.test.ts`. `flush()` advances fake time by 0 ms, which lets settled promises run their callbacks; it also fires 0 ms timers, which is how the stand-in adapter's refusal arrives in the first polling test.

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiRequestError } from "@/lib/api/client";
import { pollingOnlySubscribe, type SubscribeToRoom } from "@/lib/feed/realtime";
import { FeedNotReadyError, createFeedStore, type FeedDeps } from "@/lib/feed/store";
import {
  ROOM,
  TEST_CONFIG,
  catchUp,
  fakeMessages,
  fakeRealtime,
  id,
  msg,
  page,
} from "@/lib/feed/test-helpers";
import type { Message } from "@/lib/schemas/types";

const POLL = TEST_CONFIG.pollIntervalMs;
const IDLE = TEST_CONFIG.realtimeIdleTimeoutMs;

/** Lets settled promises run their callbacks. Fires no timer later than "now". */
const flush = () => vi.advanceTimersByTimeAsync(0);

function setup(opts: { subscribe?: SubscribeToRoom; seed?: Message } = {}) {
  const messages = fakeMessages();
  const realtime = fakeRealtime();
  const deps: FeedDeps = {
    messages: messages.api,
    subscribe: opts.subscribe ?? realtime.subscribe,
    config: TEST_CONFIG,
  };
  const store = createFeedStore(ROOM, deps, opts.seed);
  const listener = vi.fn();
  store.subscribe(listener);
  return { store, messages, realtime, listener };
}

/** A started, visible store whose history [1, 2] has loaded; the join is still pending. */
async function opened(opts: { subscribe?: SubscribeToRoom } = {}) {
  const ctx = setup(opts);
  ctx.store.start({ hidden: false });
  ctx.messages.list[0].resolve(page([msg(1), msg(2)], true));
  await flush();
  return ctx;
}

/** As `opened`, then the join is refused: polling, with the immediate catch-up answered empty. */
async function polling() {
  const ctx = await opened();
  ctx.realtime.attempts[0].handlers.onFailed("refused");
  ctx.messages.listAfter[0].resolve(catchUp([], id(2)));
  await flush();
  return ctx;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("construction and start", () => {
  it("is inert until start: no requests, no subscription, no timers", () => {
    const { store, messages, realtime } = setup();

    expect(store.getState().status).toBe("opening");
    expect(messages.api.list).not.toHaveBeenCalled();
    expect(realtime.attempts).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ignores actions before start", async () => {
    const { store, messages, listener } = setup();

    store.loadOlder();
    store.setHidden(true);
    store.dispatch({ type: "pollTick" });
    await store.loadNewer();

    expect(store.getState().hidden).toBe(false);
    expect(messages.api.list).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
  });

  it("fetches initial history once, however often start is called", () => {
    const { store, messages } = setup();

    store.start({ hidden: false });
    store.start({ hidden: false });

    expect(messages.api.list).toHaveBeenCalledTimes(1);
    expect(messages.api.list).toHaveBeenCalledWith(ROOM);
    expect(store.getState().inflight).toBe("initial");
  });

  it("opens from a seed without a history request and tries realtime", () => {
    const { store, messages, realtime } = setup({ seed: msg(7) });

    store.start({ hidden: false });

    expect(store.getState()).toMatchObject({ status: "open", messages: [msg(7)], syncCursor: id(7) });
    expect(messages.api.list).not.toHaveBeenCalled();
    expect(realtime.attempts).toHaveLength(1);
  });

  it("notifies once per accepted action and not for an ignored one", async () => {
    const { store, listener } = await opened();
    listener.mockClear();

    store.dispatch({ type: "subscribed" });
    expect(listener).toHaveBeenCalledTimes(1);

    store.dispatch({ type: "subscribed" }); // already subscribed: same state object
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("polling with the stand-in adapter", () => {
  it("loads history, is refused, then polls at once and every interval", async () => {
    // `opened` flushes with a 0 ms advance, which also lets the stand-in refuse the join.
    const { store, messages } = await opened({ subscribe: pollingOnlySubscribe });

    expect(store.getState()).toMatchObject({ channel: "none", polling: true, inflight: "newer" });
    expect(messages.api.listAfter).toHaveBeenCalledTimes(1);
    expect(messages.api.listAfter).toHaveBeenLastCalledWith(ROOM, id(2));

    messages.listAfter[0].resolve(catchUp([msg(3)], id(3)));
    await flush();
    expect(store.getState().messages.map((m) => m.id)).toEqual([id(1), id(2), id(3)]);

    await vi.advanceTimersByTimeAsync(POLL);
    expect(messages.api.listAfter).toHaveBeenCalledTimes(2);
    expect(messages.api.listAfter).toHaveBeenLastCalledWith(ROOM, id(3));
  });

  it("does not start a second catch-up while one is in flight", async () => {
    const { messages } = await polling();

    await vi.advanceTimersByTimeAsync(POLL);
    expect(messages.api.listAfter).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(POLL * 2); // still unanswered
    expect(messages.api.listAfter).toHaveBeenCalledTimes(2);
  });

  it("pauses ticks during a backlog until loadNewer drains it", async () => {
    const { store, messages } = await polling();
    await vi.advanceTimersByTimeAsync(POLL);
    messages.listAfter[1].resolve(catchUp([msg(3)], id(3), true));
    await flush();
    expect(store.getState().backlog).toBe(true);

    await vi.advanceTimersByTimeAsync(POLL * 2);
    expect(messages.api.listAfter).toHaveBeenCalledTimes(2);

    const done = store.loadNewer();
    expect(messages.api.listAfter).toHaveBeenLastCalledWith(ROOM, id(3));
    messages.listAfter[2].resolve(catchUp([msg(4)], id(4)));
    await done;
    expect(store.getState()).toMatchObject({ backlog: false, syncCursor: id(4) });

    await vi.advanceTimersByTimeAsync(POLL);
    expect(messages.api.listAfter).toHaveBeenCalledTimes(4);
  });

  it("pages older history from the page's first id, not the oldest displayed row", async () => {
    const { store, messages } = await polling();
    store.dispatch({ type: "received", message: msg(0) }); // displayed, but not from a page

    store.loadOlder();

    expect(messages.api.list).toHaveBeenLastCalledWith(ROOM, { before: id(1) });
  });

  it("reports a failed fetch and marks a 404 as room gone", async () => {
    const { store, messages } = await polling();
    store.loadOlder();
    messages.list[1].reject(new ApiRequestError(404, "not_found", "Room not found"));
    await flush();

    expect(store.getState().error).toEqual({ op: "older", message: "Room not found", notFound: true });
    expect(vi.getTimerCount()).toBe(0); // the reducer stopped polling
  });

  it("turns a synchronous throw from the API into fetchFailed", async () => {
    const { store, messages } = setup();
    vi.mocked(messages.api.list).mockImplementationOnce(() => {
      throw new Error("boom");
    });

    store.start({ hidden: false });
    await flush();

    expect(store.getState().error).toEqual({ op: "initial", message: "boom", notFound: false });
  });
});

describe("manual loadNewer completion", () => {
  it("resolves only after its own response is published", async () => {
    const { store, messages } = await polling();
    const seen: number[] = [];
    let settled = false;

    const done = store.loadNewer().then(() => {
      settled = true;
      seen.push(store.getState().messages.length);
    });
    store.dispatch({ type: "received", message: msg(9) }); // unrelated arrival
    await flush();
    expect(settled).toBe(false);

    messages.listAfter[1].resolve(catchUp([msg(3)], id(3)));
    await done;
    expect(seen).toEqual([4]); // 1, 2, 9 and the fetched 3
  });

  it("resolves after a failure is published and never rejects", async () => {
    const { store, messages } = await polling();

    const done = store.loadNewer();
    messages.listAfter[1].reject(new Error("offline"));
    await expect(done).resolves.toBeUndefined();

    expect(store.getState().error).toMatchObject({ op: "newer", message: "offline" });
  });

  it("resolves at once when ignored, without joining the fetch in flight", async () => {
    const { store, messages } = await polling();
    store.loadOlder();
    let settled = false;

    void store.loadNewer().then(() => {
      settled = true;
    });
    await flush();

    expect(settled).toBe(true);
    expect(store.getState().inflight).toBe("older");
    expect(messages.api.listAfter).toHaveBeenCalledTimes(1);
  });

  it("is not settled by a later automatic fetch", async () => {
    const { store, messages } = await polling();
    await vi.advanceTimersByTimeAsync(POLL); // tick fetch in flight: listAfter[1]
    let settled = false;
    void store.loadNewer().then(() => {
      settled = true;
    });
    await flush();
    expect(settled).toBe(true); // ignored, because the tick's fetch is running

    settled = false;
    messages.listAfter[1].resolve(catchUp([], id(2)));
    await flush();
    const mine = store.loadNewer().then(() => {
      settled = true;
    });
    await flush();
    expect(settled).toBe(false);
    messages.listAfter[2].resolve(catchUp([], id(2)));
    await mine;
  });

  it("resolves on disposal without publishing the late response", async () => {
    const { store, messages, listener } = await polling();
    const done = store.loadNewer();
    const before = store.getState().messages;
    listener.mockClear();

    store.dispose();
    await done;
    messages.listAfter[1].resolve(catchUp([msg(3)], id(3)));
    await flush();

    expect(store.getState().messages).toBe(before);
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("channel attempts", () => {
  it("cleans up a handle whose attempt failed before subscribe returned", async () => {
    const unsubscribe = vi.fn();
    const subscribe: SubscribeToRoom = (_roomId, handlers) => {
      handlers.onFailed("refused synchronously");
      handlers.onSubscribed(); // late success from a dead attempt
      return { unsubscribe };
    };
    const { store } = await opened({ subscribe });

    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(store.getState()).toMatchObject({ channel: "none", polling: true });
  });

  it("treats a throwing adapter as a failed attempt", async () => {
    const { store } = await opened({
      subscribe: () => {
        throw new Error("no websocket");
      },
    });

    expect(store.getState()).toMatchObject({ channel: "none", polling: true });
  });

  it("ignores success, inserts and repeated failures after the first failure", async () => {
    const { store, realtime, messages } = await opened();
    const { handlers, unsubscribe } = realtime.attempts[0];

    handlers.onFailed("CHANNEL_ERROR");
    handlers.onFailed("CLOSED");
    handlers.onSubscribed();
    handlers.onInsert(msg(5));

    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(store.getState()).toMatchObject({ channel: "none", polling: true });
    expect(store.getState().messages).toHaveLength(2);
    expect(messages.api.listAfter).toHaveBeenCalledTimes(1);
  });

  it("confirms, merges inserts and falls back to polling when the channel later drops", async () => {
    const { store, realtime, messages } = await opened();
    const { handlers, unsubscribe } = realtime.attempts[0];

    handlers.onSubscribed();
    handlers.onInsert(msg(3));
    expect(store.getState()).toMatchObject({ channel: "subscribed", polling: false });
    expect(store.getState().messages).toHaveLength(3);
    messages.listAfter[0].resolve(catchUp([msg(3)], id(3)));
    await flush();

    handlers.onFailed("CLOSED");
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(store.getState()).toMatchObject({ channel: "none", polling: true });
    expect(realtime.attempts).toHaveLength(1); // nothing re-subscribes by itself
  });

  it("recovers from a failed confirmation catch-up on the next tick only", async () => {
    const { store, realtime, messages } = await opened();
    realtime.attempts[0].handlers.onSubscribed();

    messages.listAfter[0].reject(new Error("offline"));
    await flush();
    expect(store.getState()).toMatchObject({ channel: "none", polling: true, syncCursor: id(2) });
    expect(realtime.attempts[0].unsubscribe).toHaveBeenCalledTimes(1);
    expect(messages.api.listAfter).toHaveBeenCalledTimes(1); // no immediate retry loop

    await vi.advanceTimersByTimeAsync(POLL);
    expect(messages.api.listAfter).toHaveBeenLastCalledWith(ROOM, id(2));
    messages.listAfter[1].resolve(catchUp([msg(3)], id(3)));
    await flush();
    expect(store.getState()).toMatchObject({ error: null, syncCursor: id(3) });
  });

  it("runs the catch-up owed by a confirmation even when the older page fails", async () => {
    const { store, realtime, messages } = await opened();
    store.loadOlder();
    realtime.attempts[0].handlers.onSubscribed(); // catch-up is owed: older is in flight

    messages.list[1].reject(new Error("offline"));
    await flush();

    expect(messages.api.listAfter).toHaveBeenCalledTimes(1);
    messages.listAfter[0].resolve(catchUp([], id(2)));
    await flush();
    expect(store.getState().error).toMatchObject({ op: "older" }); // still visible
  });

  it("keeps the backlog button as the retry after a failed backlog fetch", async () => {
    const { store, messages } = await polling();
    await vi.advanceTimersByTimeAsync(POLL);
    messages.listAfter[1].resolve(catchUp([msg(3)], id(3), true));
    await flush();

    const done = store.loadNewer();
    messages.listAfter[2].reject(new Error("offline"));
    await done;

    expect(store.getState()).toMatchObject({ backlog: true, syncCursor: id(3) });
    await vi.advanceTimersByTimeAsync(POLL * 2);
    expect(messages.api.listAfter).toHaveBeenCalledTimes(3); // ticks stay paused
  });

  it("restarts the idle timer on activity only while one runs", async () => {
    const { store, realtime } = await opened();
    store.activity(); // subscribing: no timer yet
    expect(vi.getTimerCount()).toBe(0);

    realtime.attempts[0].handlers.onSubscribed();
    await vi.advanceTimersByTimeAsync(IDLE - 1);
    store.activity();
    await vi.advanceTimersByTimeAsync(IDLE - 1);
    expect(store.getState().channel).toBe("subscribed");

    await vi.advanceTimersByTimeAsync(1);
    expect(store.getState()).toMatchObject({ channel: "none", polling: true });
  });
});

describe("visibility", () => {
  it.each([["unseeded", undefined], ["seeded", msg(7)]] as const)(
    "polls instead of subscribing when started hidden (%s)",
    async (_name, seed) => {
      const { store, messages, realtime } = setup({ seed });

      store.start({ hidden: true });
      if (!seed) {
        messages.list[0].resolve(page([msg(7)]));
        await flush();
      }

      expect(realtime.attempts).toHaveLength(0);
      expect(store.getState()).toMatchObject({ polling: true, channel: "none", hidden: true });
      expect(messages.api.listAfter).toHaveBeenCalledTimes(1);
    },
  );

  it("records hiding during the initial fetch and then selects polling", async () => {
    const { store, messages, realtime } = setup();
    store.start({ hidden: false });

    store.setHidden(true);
    messages.list[0].resolve(page([msg(1)]));
    await flush();

    expect(realtime.attempts).toHaveLength(0);
    expect(store.getState().polling).toBe(true);
  });

  it("cancels a pending join when hidden, and a late confirmation cannot revive it", async () => {
    const { store, realtime } = await opened();
    const { handlers, unsubscribe } = realtime.attempts[0];

    store.setHidden(true);
    handlers.onSubscribed();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(store.getState()).toMatchObject({ channel: "none", polling: true });
  });

  it("starts no second interval when hidden twice, and does nothing on becoming visible", async () => {
    const { store, messages, realtime } = await polling();

    store.setHidden(true);
    store.setHidden(true);
    store.setHidden(false);

    expect(vi.getTimerCount()).toBe(1);
    expect(messages.api.listAfter).toHaveBeenCalledTimes(1);
    expect(realtime.attempts).toHaveLength(1);
  });

  it("cancels a re-subscription when hidden, and a visible send may subscribe again", async () => {
    const { store, messages, realtime } = await polling();
    void store.send({ author: "ann", text: "one" });
    messages.post[0].resolve(msg(3));
    await flush();
    expect(realtime.attempts).toHaveLength(2);

    store.setHidden(true);
    expect(realtime.attempts[1].unsubscribe).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1); // the same poll interval, not a second one

    store.setHidden(false);
    expect(realtime.attempts).toHaveLength(2);
    void store.send({ author: "ann", text: "two" });
    messages.post[1].resolve(msg(4));
    await flush();
    expect(realtime.attempts).toHaveLength(3);
  });

  it("merges a send that finishes while hidden without rejoining", async () => {
    const { store, messages, realtime } = await polling();
    const sending = store.send({ author: "ann", text: "hi" });

    store.setHidden(true);
    messages.post[0].resolve(msg(3));
    await sending;

    expect(store.getState().messages.map((m) => m.id)).toContain(id(3));
    expect(realtime.attempts).toHaveLength(1);
  });
});

describe("send", () => {
  it("rejects without posting before start, while loading, after a failed load and after disposal", async () => {
    const { store, messages } = setup();
    const input = { author: "ann", text: "hi" };

    await expect(store.send(input)).rejects.toBeInstanceOf(FeedNotReadyError);
    store.start({ hidden: false });
    await expect(store.send(input)).rejects.toMatchObject({ code: "feed_not_ready" });

    messages.list[0].reject(new Error("offline"));
    await flush();
    await expect(store.send(input)).rejects.toBeInstanceOf(FeedNotReadyError);
    store.dismissError();
    await expect(store.send(input)).rejects.toBeInstanceOf(FeedNotReadyError);

    store.dispose();
    await expect(store.send(input)).rejects.toBeInstanceOf(FeedNotReadyError);
    expect(messages.api.post).not.toHaveBeenCalled();
  });

  it("rejects without posting once the room is gone", async () => {
    const { store, messages } = await polling();
    store.loadOlder();
    messages.list[1].reject(new ApiRequestError(404, "not_found"));
    await flush();

    await expect(store.send({ author: "ann", text: "hi" })).rejects.toBeInstanceOf(FeedNotReadyError);
    expect(messages.api.post).not.toHaveBeenCalled();
  });

  it("appends the posted message once; the next poll does not duplicate it", async () => {
    const { store, messages } = await polling();

    const sending = store.send({ author: "ann", text: "hi" });
    expect(messages.api.post).toHaveBeenCalledWith(ROOM, { author: "ann", text: "hi" });
    messages.post[0].resolve(msg(3));
    await expect(sending).resolves.toEqual(msg(3));
    expect(store.getState().syncCursor).toBe(id(2)); // a POST never moves the bookmark

    await vi.advanceTimersByTimeAsync(POLL);
    messages.listAfter[1].resolve(catchUp([msg(3)], id(3)));
    await flush();
    expect(store.getState().messages.map((m) => m.id)).toEqual([id(1), id(2), id(3)]);
  });

  it("rethrows a failed POST unchanged and dispatches nothing", async () => {
    const { store, messages, listener } = await polling();
    listener.mockClear();
    const failure = new ApiRequestError(500);

    const sending = store.send({ author: "ann", text: "hi" });
    messages.post[0].reject(failure);

    await expect(sending).rejects.toBe(failure);
    expect(listener).not.toHaveBeenCalled();
  });

  it("settles a POST that outlives the store without touching its state", async () => {
    const { store, messages } = await polling();
    const sending = store.send({ author: "ann", text: "hi" });

    store.dispose();
    const closed = store.getState();
    messages.post[0].resolve(msg(3));

    await expect(sending).resolves.toEqual(msg(3));
    expect(store.getState()).toBe(closed);
  });
});

describe("dispose", () => {
  it("releases the channel and every timer, is idempotent, and cannot restart", async () => {
    const { store, realtime, messages } = await opened();
    realtime.attempts[0].handlers.onSubscribed();
    expect(vi.getTimerCount()).toBe(1); // idle timer

    store.dispose();
    store.dispose();
    store.start({ hidden: false });

    expect(realtime.attempts[0].unsubscribe).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(store.getState().status).toBe("closed");
    expect(messages.api.list).toHaveBeenCalledTimes(1);
  });

  it("ignores a response that resolves afterwards and does not notify", async () => {
    const { store, messages, listener } = setup();
    store.start({ hidden: false });
    listener.mockClear();

    store.dispose();
    const closed = store.getState();
    messages.list[0].resolve(page([msg(1)]));
    await flush();

    expect(store.getState()).toBe(closed);
    expect(listener).not.toHaveBeenCalled();
  });

  it("cleans up a handle returned after a synchronous callback disposed the store", () => {
    const unsubscribe = vi.fn();
    const ctx = setup({
      seed: msg(1),
      subscribe: () => {
        ctx.store.dispose();
        return { unsubscribe };
      },
    });

    ctx.store.start({ hidden: false });

    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(ctx.store.getState().status).toBe("closed");
  });

  it("reduces reentrant actions iteratively, after the current effects", async () => {
    const seen: string[] = [];
    const subscribe: SubscribeToRoom = (_roomId, handlers) => {
      handlers.onSubscribed(); // synchronous, before the handle exists
      seen.push(ctx.store.getState().channel);
      return { unsubscribe: vi.fn() };
    };
    const ctx = setup({ seed: msg(1), subscribe });

    ctx.store.start({ hidden: false });

    expect(seen).toEqual(["subscribing"]); // queued, not reduced inside the effect
    expect(ctx.store.getState().channel).toBe("subscribed");
  });
});
```

- [ ] **Step 5: Run the tests to verify they fail**

Run: `pnpm test src/lib/feed/store.test.ts`
Expected: FAIL. The file cannot be loaded: `Failed to resolve import "@/lib/feed/store"` (or "Cannot find module").

- [ ] **Step 6: Implement the store**

Create `src/lib/feed/store.ts`:

```ts
import { ApiRequestError, type MessagesApi } from "@/lib/api/client";
import type { RealtimeHandle, SubscribeToRoom } from "@/lib/feed/realtime";
import { feedReducer, initialFeedState } from "@/lib/feed/reducer";
import type { FeedAction, FeedEffect, FeedState, FetchOp } from "@/lib/feed/types";
import type { PostMessageInput } from "@/lib/schemas/message";
import type { Message } from "@/lib/schemas/types";

export type FeedTimers = {
  setTimeout: typeof globalThis.setTimeout;
  clearTimeout: typeof globalThis.clearTimeout;
  setInterval: typeof globalThis.setInterval;
  clearInterval: typeof globalThis.clearInterval;
};

export type FeedDeps = {
  /** `api.messages` (chunk 5). */
  messages: MessagesApi;
  /** Chunk 11's adapter; chunk 9's hook defaults to a stub that always fails. */
  subscribe: SubscribeToRoom;
  config: { pollIntervalMs: number; realtimeIdleTimeoutMs: number };
  /** Defaults to the globals, looked up at call time so fake timers apply. */
  timers?: FeedTimers;
};

export type FeedStore = {
  /** Once, after the owning effect has committed. Repeated calls do nothing. */
  start(opts: { hidden: boolean }): void;
  getState(): FeedState;
  /** `useSyncExternalStore` contract: returns the detach function. */
  subscribe(listener: () => void): () => void;
  dispatch(action: FeedAction): void;
  loadOlder(): void;
  /** Resolves once the fetch this call started is reduced and published; at once when ignored. */
  loadNewer(): Promise<void>;
  send(input: PostMessageInput): Promise<Message>;
  /** Restarts the idle timer while one is running. Never dispatches. */
  activity(): void;
  setHidden(hidden: boolean): void;
  dismissError(): void;
  dispose(): void;
};

/** `send` was called while the room cannot accept a message. Nothing was posted. */
export class FeedNotReadyError extends Error {
  readonly code = "feed_not_ready";

  constructor() {
    super("Wait for the room to load, or reopen it if loading failed.");
    this.name = "FeedNotReadyError";
  }
}

/** One `subscribe` effect. `live` gates its callbacks; `released` means its handle is cleaned up. */
type Attempt = { live: boolean; released: boolean; handle: RealtimeHandle | null };

/** A queued action; `settled` is the completion of the manual `loadNewer()` that queued it. */
type Queued = { action: FeedAction; settled?: () => void };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Runs `feedReducer` and interprets its effects against injected dependencies
 * (room-feed design §6). Framework-free. Construction is inert: nothing is
 * fetched, subscribed or scheduled until `start`.
 */
export function createFeedStore(roomId: string, deps: FeedDeps, seed?: Message): FeedStore {
  let state = initialFeedState(roomId);
  let started = false;
  let disposed = false;
  let draining = false;
  const queue: Queued[] = [];
  const listeners = new Set<() => void>();
  const completions = new Set<() => void>();
  let attempt: Attempt | null = null;
  let pollTimer: ReturnType<FeedTimers["setInterval"]> | undefined;
  let idleTimer: ReturnType<FeedTimers["setTimeout"]> | undefined;

  const timers = (): FeedTimers => deps.timers ?? globalThis;

  function notify() {
    for (const listener of [...listeners]) listener();
  }

  /** Queues the action; the outermost call drains iteratively, so reentrant actions never recurse. */
  function enqueue(entry: Queued) {
    if (!started || disposed) {
      entry.settled?.();
      return;
    }
    queue.push(entry);
    if (draining) return;
    draining = true;
    try {
      for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
        reduce(next);
      }
    } finally {
      draining = false;
    }
  }

  function reduce({ action, settled }: Queued) {
    const [next, effects] = feedReducer(state, action);
    if (next !== state) {
      state = next;
      notify();
    }
    let completion = settled;
    for (const effect of effects) {
      if (disposed) break;
      if (effect.type === "fetchNewer") {
        runFetchNewer(effect.after, completion);
        completion = undefined;
      } else {
        run(effect);
      }
    }
    // A manual request that started no fetch (ignored, or disposed meanwhile) is complete.
    completion?.();
  }

  function dispatch(action: FeedAction) {
    enqueue({ action });
  }

  function run(effect: Exclude<FeedEffect, { type: "fetchNewer" }>) {
    switch (effect.type) {
      case "fetchInitial":
        return runFetch("initial", () => deps.messages.list(roomId), (page) => ({
          type: "historyLoaded",
          page,
        }));
      case "fetchOlder":
        return runFetch(
          "older",
          () => deps.messages.list(roomId, { before: effect.before }),
          (page) => ({ type: "olderLoaded", page }),
        );
      case "subscribe":
        return openChannel();
      case "unsubscribe":
        return releaseChannel();
      case "startPolling":
        stopPolling();
        pollTimer = timers().setInterval(() => dispatch({ type: "pollTick" }), deps.config.pollIntervalMs);
        return;
      case "stopPolling":
        return stopPolling();
      case "startIdleTimer":
        return startIdleTimer();
      case "stopIdleTimer":
        return stopIdleTimer();
    }
  }

  function runFetch<T>(
    op: FetchOp,
    request: () => Promise<T>,
    loaded: (page: T) => FeedAction,
    settled?: () => void,
  ) {
    if (settled) completions.add(settled);
    const finish = () => {
      if (settled && completions.delete(settled)) settled();
    };
    let pending: Promise<T>;
    try {
      pending = request();
    } catch (error) {
      pending = Promise.reject(error);
    }
    pending.then(
      (page) => {
        // `dispatch` is a no-op once disposed: late results never reach the state.
        dispatch(loaded(page));
        finish();
      },
      (error: unknown) => {
        dispatch({
          type: "fetchFailed",
          op,
          message: errorMessage(error),
          notFound: error instanceof ApiRequestError && error.status === 404,
        });
        finish();
      },
    );
  }

  function runFetchNewer(after: string, settled?: () => void) {
    runFetch(
      "newer",
      () => deps.messages.listAfter(roomId, after),
      (page) => ({ type: "newerLoaded", page }),
      settled,
    );
  }

  function openChannel() {
    releaseChannel(); // never two live attempts
    const mine: Attempt = { live: true, released: false, handle: null };
    attempt = mine;
    const alive = () => mine.live && !disposed;
    const fail = (reason: string) => {
      if (!alive()) return;
      mine.live = false; // the first failure is terminal for this attempt
      dispatch({ type: "channelFailed", reason });
    };
    let handle: RealtimeHandle;
    try {
      handle = deps.subscribe(roomId, {
        onSubscribed: () => {
          if (alive()) dispatch({ type: "subscribed" });
        },
        onFailed: fail,
        onInsert: (message) => {
          if (alive()) dispatch({ type: "received", message });
        },
      });
    } catch (error) {
      fail(errorMessage(error));
      return;
    }
    // The attempt may already be released (hidden, disposed) by a synchronous callback.
    if (mine.released) handle.unsubscribe();
    else mine.handle = handle;
  }

  /** Invalidates the attempt first, then cleans up its handle. Safe to repeat. */
  function releaseChannel() {
    const current = attempt;
    attempt = null;
    if (current === null) return;
    current.live = false;
    current.released = true;
    const handle = current.handle;
    current.handle = null;
    handle?.unsubscribe();
  }

  function stopPolling() {
    if (pollTimer === undefined) return;
    timers().clearInterval(pollTimer);
    pollTimer = undefined;
  }

  function startIdleTimer() {
    stopIdleTimer();
    idleTimer = timers().setTimeout(() => {
      idleTimer = undefined;
      dispatch({ type: "idle" });
    }, deps.config.realtimeIdleTimeoutMs);
  }

  function stopIdleTimer() {
    if (idleTimer === undefined) return;
    timers().clearTimeout(idleTimer);
    idleTimer = undefined;
  }

  return {
    start({ hidden }) {
      if (started || disposed) return;
      started = true;
      dispatch({ type: "opened", hidden, seed });
    },
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispatch,
    loadOlder: () => dispatch({ type: "olderRequested" }),
    loadNewer: () =>
      new Promise<void>((resolve) => enqueue({ action: { type: "newerRequested" }, settled: resolve })),
    async send(input) {
      if (!started || disposed || state.status !== "open" || state.error?.notFound) {
        throw new FeedNotReadyError();
      }
      const message = await deps.messages.post(roomId, input);
      dispatch({ type: "received", message });
      dispatch({ type: "sent" });
      return message;
    },
    activity() {
      if (idleTimer === undefined || state.channel !== "subscribed" || state.hidden) return;
      startIdleTimer();
    },
    setHidden: (hidden) => dispatch({ type: "visibilityChanged", hidden }),
    dismissError: () => dispatch({ type: "errorDismissed" }),
    dispose() {
      if (disposed) return;
      disposed = true; // from here every callback and public action is inert
      for (const dropped of queue.splice(0)) dropped.settled?.();
      [state] = feedReducer(state, { type: "closed" });
      releaseChannel();
      stopPolling();
      stopIdleTimer();
      for (const settled of [...completions]) settled();
      completions.clear();
      listeners.clear();
    },
  };
}
```

Points that are easy to get wrong:
- `timers()` is called at each use. Capturing `globalThis.setInterval` at construction would bypass Vitest's fake timers installed later.
- `openChannel` reads `mine.released` **after** `deps.subscribe` returns: a synchronous `onFailed`, a hidden tab or a `dispose()` inside the adapter call may already have released the attempt, and the handle it returns must still be cleaned up exactly once.
- A promise callback can never run inside the drain loop, so in `runFetch` the `dispatch(...)` has reduced and notified before `finish()` resolves the manual completion.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm test src/lib/feed/store.test.ts`
Expected: PASS, 40 tests.

- [ ] **Step 8: Run the whole suite, lint and typecheck**

Run: `pnpm test && pnpm lint && pnpm typecheck`
Expected: 31 files / 582 tests passing; lint and typecheck clean.

- [ ] **Step 9: Commit**

```bash
git add src/lib/feed/realtime.ts src/lib/feed/test-helpers.ts src/lib/feed/store.ts src/lib/feed/store.test.ts
git commit -m "feat(feed): add the feed store that runs the reducer's effects"
```

---

### Task 2: `useRoomFeed` hook

**Files:**
- Create: `src/lib/feed/useRoomFeed.ts`
- Test: `src/lib/feed/useRoomFeed.test.tsx`

**Interfaces:**
- Consumes: `createFeedStore`, `FeedDeps`, `FeedStore`, `FeedNotReadyError` from `@/lib/feed/store` (Task 1); `pollingOnlySubscribe` from `@/lib/feed/realtime`; `connectionOf`, `initialFeedState` from `@/lib/feed/reducer`; `api` from `@/lib/api/client`; `getClientConfig()` from `@/lib/config/client` (returns `{ pollIntervalMs, realtimeIdleTimeoutMs, … }`); the test helpers of Task 1.
- Produces: `type RoomFeed = { ready: boolean; messages: Message[]; hasOlder: boolean; backlog: boolean; loading: FeedState["inflight"]; connection: Connection; error: FeedError | null; loadOlder(): void; loadNewer(): Promise<void>; send(input: PostMessageInput): Promise<Message>; activity(): void; dismissError(): void }`; `type RoomFeedOptions = { seed?: Message; deps?: Partial<FeedDeps> }`; `useRoomFeed(roomId: string, opts?: RoomFeedOptions): RoomFeed`. The five callbacks are stable for a room identity.

- [ ] **Step 1: Write the failing hook tests**

Create `src/lib/feed/useRoomFeed.test.tsx`:

```tsx
// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FeedNotReadyError, type FeedDeps } from "@/lib/feed/store";
import {
  ROOM,
  TEST_CONFIG,
  catchUp,
  fakeMessages,
  fakeRealtime,
  id,
  msg,
  page,
} from "@/lib/feed/test-helpers";
import { useRoomFeed, type RoomFeed, type RoomFeedOptions } from "@/lib/feed/useRoomFeed";

const OTHER_ROOM = "22222222-2222-4222-8222-222222222222";

function fakeDeps() {
  const messages = fakeMessages();
  const realtime = fakeRealtime();
  const deps: FeedDeps = { messages: messages.api, subscribe: realtime.subscribe, config: TEST_CONFIG };
  return { deps, messages, realtime };
}

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
}

/** Lets settled promises run inside `act`, so React commits the resulting snapshots. */
const settle = () => act(async () => {});

afterEach(() => {
  setVisibility("visible");
  vi.useRealTimers();
});

describe("useRoomFeed", () => {
  it("opens the room after commit and exposes the store's state", async () => {
    const { deps, messages } = fakeDeps();
    const { result } = renderHook(() => useRoomFeed(ROOM, { deps }));

    expect(result.current).toMatchObject({ ready: false, loading: "initial", messages: [] });
    expect(messages.api.list).toHaveBeenCalledTimes(1);

    messages.list[0].resolve(page([msg(1), msg(2)], true));
    await settle();

    expect(result.current).toMatchObject({
      ready: true,
      hasOlder: true,
      loading: null,
      connection: "connecting",
      backlog: false,
      error: null,
    });
    expect(result.current.messages.map((m) => m.id)).toEqual([id(1), id(2)]);
  });

  it("reaches the store through stable callbacks", async () => {
    const { deps, messages } = fakeDeps();
    const { result } = renderHook(() => useRoomFeed(ROOM, { deps }));
    const first = result.current;
    messages.list[0].resolve(page([msg(1)], true));
    await settle();

    act(() => result.current.loadOlder());

    expect(messages.api.list).toHaveBeenLastCalledWith(ROOM, { before: id(1) });
    expect(result.current.loading).toBe("older");
    expect(result.current.loadOlder).toBe(first.loadOlder);
    expect(result.current.send).toBe(first.send);
  });

  it("is ready at once from a seed, with no history request", () => {
    const { deps, messages } = fakeDeps();
    const { result } = renderHook(() => useRoomFeed(ROOM, { deps, seed: msg(7) }));

    expect(result.current.ready).toBe(true);
    expect(result.current.messages).toEqual([msg(7)]);
    expect(messages.api.list).not.toHaveBeenCalled();
  });

  it("captures seed and deps once per room; later values do nothing", () => {
    const first = fakeDeps();
    const second = fakeDeps();
    const { result, rerender } = renderHook((opts: RoomFeedOptions) => useRoomFeed(ROOM, opts), {
      initialProps: { deps: first.deps, seed: msg(7) },
    });

    rerender({ deps: second.deps, seed: msg(8) });

    expect(result.current.messages).toEqual([msg(7)]);
    expect(second.realtime.attempts).toHaveLength(0);
  });

  it("disposes the store on unmount: late responses are ignored and callbacks go inert", async () => {
    const { deps, messages } = fakeDeps();
    const { result, unmount } = renderHook(() => useRoomFeed(ROOM, { deps }));
    const feed = result.current;

    unmount();
    messages.list[0].resolve(page([msg(1)]));
    await settle();

    expect(result.current.messages).toEqual([]);
    await expect(feed.send({ author: "ann", text: "hi" })).rejects.toBeInstanceOf(FeedNotReadyError);
    await expect(feed.loadNewer()).resolves.toBeUndefined();
    expect(messages.api.post).not.toHaveBeenCalled();
  });

  it("delegates loadNewer's completion and settles it when the room is replaced", async () => {
    const { deps, messages, realtime } = fakeDeps();
    const { result, rerender } = renderHook((roomId: string) => useRoomFeed(roomId, { deps }), {
      initialProps: ROOM,
    });
    messages.list[0].resolve(page([msg(1)]));
    await settle();
    act(() => realtime.attempts[0].handlers.onFailed("refused"));
    messages.listAfter[0].resolve(catchUp([], id(1)));
    await settle();

    let settled = false;
    let completion!: Promise<void>;
    act(() => {
      completion = result.current.loadNewer().then(() => {
        settled = true;
      });
    });
    await settle();
    expect(settled).toBe(false); // waits for listAfter[1]

    rerender(OTHER_ROOM);
    await completion;
    messages.listAfter[1].resolve(catchUp([msg(2)], id(2)));
    await settle();
    expect(result.current.messages).toEqual([]); // the new room is untouched by the old response
  });

  it("switches to a fresh opening snapshot when roomId changes", async () => {
    const { deps, messages } = fakeDeps();
    const { result, rerender } = renderHook((roomId: string) => useRoomFeed(roomId, { deps }), {
      initialProps: ROOM,
    });
    messages.list[0].resolve(page([msg(1)]));
    await settle();

    rerender(OTHER_ROOM);

    expect(result.current).toMatchObject({ ready: false, messages: [], loading: "initial" });
    expect(messages.api.list).toHaveBeenLastCalledWith(OTHER_ROOM);
  });

  it("leaves exactly one live store after Strict Mode's setup, cleanup, setup", async () => {
    vi.useFakeTimers();
    const { deps, messages, realtime } = fakeDeps();
    const { result } = renderHook(() => useRoomFeed(ROOM, { deps }), { wrapper: StrictMode });
    expect(messages.api.list).toHaveBeenCalledTimes(2);

    messages.list[0].resolve(page([msg(9)])); // the disposed first store
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(result.current.messages).toEqual([]);

    messages.list[1].resolve(page([msg(1)]));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(result.current.messages).toEqual([msg(1)]);
    expect(result.current.ready).toBe(true);
    expect(realtime.attempts).toHaveLength(1);

    act(() => realtime.attempts[0].handlers.onFailed("refused"));
    expect(vi.getTimerCount()).toBe(1); // one poll interval, none left over from the first store
  });

  it("polls instead of subscribing when mounted in a hidden tab", async () => {
    setVisibility("hidden");
    const { deps, messages, realtime } = fakeDeps();
    const { result } = renderHook(() => useRoomFeed(ROOM, { deps }));
    messages.list[0].resolve(page([msg(1)]));
    await settle();

    expect(realtime.attempts).toHaveLength(0);
    expect(result.current.connection).toBe("polling");
  });

  it("tracks visibility changes and stops tracking on unmount", async () => {
    const { deps, messages, realtime } = fakeDeps();
    const { result, unmount } = renderHook(() => useRoomFeed(ROOM, { deps }));
    messages.list[0].resolve(page([msg(1)]));
    await settle();

    setVisibility("hidden");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(realtime.attempts[0].unsubscribe).toHaveBeenCalledTimes(1);
    expect(result.current.connection).toBe("polling");

    const remove = vi.spyOn(document, "removeEventListener");
    unmount();
    expect(remove).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
  });

  it("renders on the server and hydrates without work or mismatch", async () => {
    const { deps, messages, realtime } = fakeDeps();
    const seen: RoomFeed[] = [];
    function Probe() {
      const feed = useRoomFeed(ROOM, { deps, seed: msg(7) });
      seen.push(feed);
      return <p>{feed.ready ? `ready:${feed.messages.length}` : "opening"}</p>;
    }

    const html = renderToString(<Probe />);
    expect(html).toContain("opening");
    expect(seen[0]).toMatchObject({ ready: false, messages: [] }); // the seed waits for commit
    expect(messages.api.list).not.toHaveBeenCalled();
    expect(realtime.attempts).toHaveLength(0);

    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.appendChild(container);
    const onRecoverableError = vi.fn();
    const root = await act(async () => hydrateRoot(container, <Probe />, { onRecoverableError }));
    try {
      expect(container.textContent).toBe("ready:1");
      expect(onRecoverableError).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test src/lib/feed/useRoomFeed.test.tsx`
Expected: FAIL with `Failed to resolve import "@/lib/feed/useRoomFeed"`.

- [ ] **Step 3: Implement the hook**

Create `src/lib/feed/useRoomFeed.ts`:

```ts
import { useLayoutEffect, useMemo, useState, useSyncExternalStore } from "react";

import { api } from "@/lib/api/client";
import { getClientConfig } from "@/lib/config/client";
import { pollingOnlySubscribe } from "@/lib/feed/realtime";
import { connectionOf, initialFeedState } from "@/lib/feed/reducer";
import { FeedNotReadyError, createFeedStore, type FeedDeps, type FeedStore } from "@/lib/feed/store";
import type { Connection, FeedError, FeedState } from "@/lib/feed/types";
import type { PostMessageInput } from "@/lib/schemas/message";
import type { Message } from "@/lib/schemas/types";

export type RoomFeed = {
  /** A started, live store with an open room and no room-gone error. */
  ready: boolean;
  messages: Message[];
  hasOlder: boolean;
  backlog: boolean;
  loading: FeedState["inflight"];
  connection: Connection;
  error: FeedError | null;
  loadOlder(): void;
  loadNewer(): Promise<void>;
  send(input: PostMessageInput): Promise<Message>;
  activity(): void;
  dismissError(): void;
};

export type RoomFeedOptions = { seed?: Message; deps?: Partial<FeedDeps> };

/** What rendering reads: the feed state, and whether a live store stands behind it. */
type Snapshot = { state: FeedState; live: boolean };

type Bridge = ReturnType<typeof createBridge>;

/**
 * The render-side half of the hook (room-feed design §7): an inert snapshot
 * holder with stable callbacks. Creating it fetches nothing and reads no
 * browser global, so abandoned renders and server rendering are free. A store
 * is attached by the committed effect and detached by its cleanup.
 */
function createBridge(roomId: string, options: RoomFeedOptions) {
  const opening: Snapshot = { state: initialFeedState(roomId), live: false };
  let snapshot = opening;
  let store: FeedStore | null = null;
  const listeners = new Set<() => void>();

  function publish(next: Snapshot) {
    snapshot = next;
    for (const listener of [...listeners]) listener();
  }

  return {
    roomId,
    options, // captured once per room identity; later prop changes do nothing
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    getServerSnapshot: () => opening,
    /** Connects a fresh store; the returned function disconnects it and publishes `live: false`. */
    attach(next: FeedStore) {
      store = next;
      const detach = next.subscribe(() => publish({ state: next.getState(), live: true }));
      return () => {
        detach();
        if (store === next) store = null;
        publish({ state: snapshot.state, live: false });
      };
    },
    loadOlder: () => store?.loadOlder(),
    loadNewer: () => store?.loadNewer() ?? Promise.resolve(),
    send: (input: PostMessageInput) => store?.send(input) ?? Promise.reject(new FeedNotReadyError()),
    activity: () => store?.activity(),
    dismissError: () => store?.dismissError(),
  };
}

/** Browser defaults, resolved inside the effect so rendering never touches them. */
function resolveDeps(deps: Partial<FeedDeps> = {}): FeedDeps {
  return {
    messages: deps.messages ?? api.messages,
    subscribe: deps.subscribe ?? pollingOnlySubscribe,
    config: deps.config ?? getClientConfig(),
    timers: deps.timers,
  };
}

/**
 * The open room as React state (room-feed design §7). Each committed effect
 * setup creates and starts a fresh store and tracks document visibility;
 * cleanup disposes it for good, so Strict Mode's replay and a `roomId` change
 * never reuse a disposed store.
 */
export function useRoomFeed(roomId: string, opts?: RoomFeedOptions): RoomFeed {
  const [held, setHeld] = useState(() => createBridge(roomId, opts ?? {}));
  let bridge: Bridge = held;
  if (held.roomId !== roomId) {
    // Another room: switch to a fresh inert bridge in this same render.
    bridge = createBridge(roomId, opts ?? {});
    setHeld(bridge);
  }

  const snapshot = useSyncExternalStore(bridge.subscribe, bridge.getSnapshot, bridge.getServerSnapshot);

  // A layout effect, so a seeded room is ready before the first paint.
  useLayoutEffect(() => {
    const store = createFeedStore(bridge.roomId, resolveDeps(bridge.options.deps), bridge.options.seed);
    const detach = bridge.attach(store);
    const onVisibilityChange = () => store.setHidden(document.visibilityState === "hidden");
    document.addEventListener("visibilitychange", onVisibilityChange);
    store.start({ hidden: document.visibilityState === "hidden" });
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      detach();
      store.dispose();
    };
  }, [bridge]);

  return useMemo(() => {
    const { state, live } = snapshot;
    return {
      ready: live && state.status === "open" && !state.error?.notFound,
      messages: state.messages,
      hasOlder: state.hasOlder,
      backlog: state.backlog,
      loading: state.inflight,
      connection: connectionOf(state),
      error: state.error,
      loadOlder: bridge.loadOlder,
      loadNewer: bridge.loadNewer,
      send: bridge.send,
      activity: bridge.activity,
      dismissError: bridge.dismissError,
    };
  }, [snapshot, bridge]);
}
```

Notes:
- Nothing in render touches `document`, `api`, `getClientConfig()` or a timer. `resolveDeps` runs inside the effect, so a test that injects all three of `messages`, `subscribe` and `config` never reads the environment.
- `getSnapshot` returns the same object until `publish` replaces it, which `useSyncExternalStore` requires.
- Do not replace the conditional `setHeld` with a `useEffect`: the new room must show its opening snapshot in the same render, and old-room callbacks must never reach the new bridge.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test src/lib/feed/useRoomFeed.test.tsx`
Expected: PASS, 11 tests, and no "not wrapped in act(...)" warning in the output.

- [ ] **Step 5: Run the whole suite, lint and typecheck**

Run: `pnpm test && pnpm lint && pnpm typecheck`
Expected: 32 files / 593 tests passing; lint (including the `react-hooks` rules) and typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/feed/useRoomFeed.ts src/lib/feed/useRoomFeed.test.tsx
git commit -m "feat(feed): add useRoomFeed over a render-safe snapshot bridge"
```

---

### Task 3: `formatMessageTime`

**Files:**
- Create: `src/lib/time/format.ts`
- Test: `src/lib/time/format.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `type FormatMessageTimeOptions = { now?: Date; timeZone?: string; locale?: string }`; `formatMessageTime(iso: string, opts?: FormatMessageTimeOptions): string`.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/time/format.test.ts`. Every case passes `now` and `timeZone`, so the results do not depend on the machine's clock or zone.

```ts
import { describe, expect, it } from "vitest";

import { formatMessageTime } from "@/lib/time/format";

const BUCHAREST = "Europe/Bucharest"; // UTC+3 in September, UTC+2 in January
const now = new Date("2026-09-16T20:00:00Z");

describe("formatMessageTime", () => {
  it("shows only the time for a message from today in the target zone", () => {
    expect(formatMessageTime("2026-09-16T15:00:00.000000Z", { now, timeZone: BUCHAREST })).toBe("18:00");
  });

  it("uses a 24-hour clock with leading zeros", () => {
    expect(formatMessageTime("2026-09-16T00:05:00.000000Z", { now, timeZone: "UTC" })).toBe("00:05");
  });

  it("adds day and month for another day of the same year", () => {
    expect(formatMessageTime("2026-09-15T14:03:00.000000Z", { now, timeZone: BUCHAREST })).toBe(
      "15 Sep 17:03",
    );
  });

  it("adds the year for a message from another year", () => {
    expect(formatMessageTime("2025-09-16T14:03:00.000000Z", { now, timeZone: BUCHAREST })).toBe(
      "16 Sep 2025 17:03",
    );
  });

  it("judges 'today' in the target zone, not in UTC", () => {
    // 21:30 UTC on the 15th is 00:30 on the 16th in Bucharest: the same local day as `now`.
    expect(formatMessageTime("2026-09-15T21:30:00.000000Z", { now, timeZone: BUCHAREST })).toBe("00:30");
    // The same instant seen from UTC is yesterday.
    expect(formatMessageTime("2026-09-15T21:30:00.000000Z", { now, timeZone: "UTC" })).toBe("15 Sep 21:30");
  });

  it("judges the year in the target zone", () => {
    const newYear = new Date("2026-01-01T10:00:00Z");
    // 22:30 UTC on 31 Dec is 00:30 on 1 Jan in Bucharest.
    expect(formatMessageTime("2025-12-31T22:30:00.000000Z", { now: newYear, timeZone: BUCHAREST })).toBe(
      "00:30",
    );
  });

  it("parses six fractional digits", () => {
    expect(formatMessageTime("2026-09-16T15:00:00.123456Z", { now, timeZone: BUCHAREST })).toBe("18:00");
  });

  it("uses fixed three-letter months, whatever the ICU data says", () => {
    const labels = Array.from({ length: 12 }, (_, month) =>
      formatMessageTime(new Date(Date.UTC(2025, month, 10, 12)).toISOString(), { now, timeZone: "UTC" })
        .split(" ")[1],
    );
    expect(labels).toEqual(["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]);
  });

  it("defaults to the current time and the runtime zone", () => {
    const justNow = new Date().toISOString();
    expect(formatMessageTime(justNow)).toMatch(/^\d{2}:\d{2}$/);
  });

  it("returns an empty string for an unparseable timestamp", () => {
    expect(formatMessageTime("not a date")).toBe("");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test src/lib/time/format.test.ts`
Expected: FAIL with `Failed to resolve import "@/lib/time/format"`.

- [ ] **Step 3: Implement the formatter**

Create `src/lib/time/format.ts`:

```ts
export type FormatMessageTimeOptions = {
  /** The moment "today" is judged from. Default: the current time. */
  now?: Date;
  /** IANA zone. Default: the runtime's zone. */
  timeZone?: string;
  /** Default `en-GB`. The UI is English-only; a fixed locale keeps output deterministic. */
  locale?: string;
};

/**
 * Month labels are our own. `en-GB` abbreviates September as "Sept" in current
 * ICU data and may change again; the panel shows "16 Sep".
 */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type DateParts = { day: string; month: string; year: string; hour: string; minute: string };

function partsOf(format: Intl.DateTimeFormat, date: Date): DateParts {
  const parts: Record<string, string> = {};
  for (const { type, value } of format.formatToParts(date)) parts[type] = value;
  return {
    day: parts.day,
    month: parts.month,
    year: parts.year,
    hour: parts.hour,
    minute: parts.minute,
  };
}

/**
 * A message's local time for display (room-panel design §6): `17:03` today,
 * `16 Sep 17:03` on another day of this year, `16 Sep 2025 17:03` in another
 * year. Days and years are compared in the target zone, never in UTC. `Date`
 * drops the microseconds of `createdAt`, which is fine for display; ordering
 * uses `compareCreatedAtId`. An unparseable input gives "".
 */
export function formatMessageTime(iso: string, opts: FormatMessageTimeOptions = {}): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const format = new Intl.DateTimeFormat(opts.locale ?? "en-GB", {
    timeZone: opts.timeZone,
    day: "numeric",
    month: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const at = partsOf(format, date);
  const now = partsOf(format, opts.now ?? new Date());
  const time = `${at.hour}:${at.minute}`;
  const dayAndMonth = `${at.day} ${MONTHS[Number(at.month) - 1]}`;
  if (at.year !== now.year) return `${dayAndMonth} ${at.year} ${time}`;
  if (at.month !== now.month || at.day !== now.day) return `${dayAndMonth} ${time}`;
  return time;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test src/lib/time/format.test.ts`
Expected: PASS, 10 tests. If the month test fails with `Sept`, the implementation is using `month: "short"`; it must use `month: "numeric"` and the `MONTHS` table (reconciliation item 1).

- [ ] **Step 5: Lint, typecheck and commit**

Run: `pnpm lint && pnpm typecheck`
Expected: clean.

```bash
git add src/lib/time/format.ts src/lib/time/format.test.ts
git commit -m "feat(time): format message times in the local zone"
```

---

### Task 4: Pure scroll decisions

**Files:**
- Create: `src/components/room/listScroll.ts`
- Test: `src/components/room/listScroll.test.ts`

**Interfaces:**
- Consumes: `Message` from `@/lib/schemas/types`.
- Produces: `type ScrollMetrics = { scrollTop: number; scrollHeight: number; clientHeight: number }`; `NEAR_BOTTOM_PX = 32`; `isNearBottom(m: ScrollMetrics, threshold?: number): boolean`; `type ListChange = { initial: boolean; before: string[]; within: string[]; after: string[] }`; `classifyChange(prev: readonly Message[], next: readonly Message[]): ListChange`; `hasIncoming(change: ListChange): boolean`; `type ScrollDecision = { scroll: "bottom" | "anchor"; pill: "show" | "clear" | "keep" }`; `decideScroll(input: { change: ListChange; bottomRequested: boolean; holding: boolean; wasNearBottom: boolean }): ScrollDecision`; `decideResize(input: { holding: boolean; wasNearBottom: boolean }): "bottom" | "anchor"`; `type RowBox = { id: string; top: number; bottom: number }`; `type Anchor = { id: string; offset: number }`; `pickAnchor(rows: Iterable<RowBox>, viewportHeight: number): Anchor | null`; `anchorAdjustment(anchor: Anchor, currentOffset: number): number`.

- [ ] **Step 1: Write the failing tests**

Create `src/components/room/listScroll.test.ts` (Node environment; no DOM):

```ts
import { describe, expect, it } from "vitest";

import {
  NEAR_BOTTOM_PX,
  anchorAdjustment,
  classifyChange,
  decideResize,
  decideScroll,
  hasIncoming,
  isNearBottom,
  pickAnchor,
  type ListChange,
} from "@/components/room/listScroll";
import type { Message } from "@/lib/schemas/types";

/** One message per letter; letters sort like the feed's chronological order. */
function rows(letters: string): Message[] {
  return [...letters].map((letter) => ({
    id: letter,
    chatroomId: "room",
    author: "ann",
    text: letter,
    createdAt: "2026-09-16T10:00:00.000000Z",
  }));
}

const NONE: ListChange = { initial: false, before: [], within: [], after: [] };

describe("isNearBottom", () => {
  const at = (distance: number) => ({ scrollHeight: 1000, clientHeight: 200, scrollTop: 800 - distance });

  it("is true up to 32 px from the bottom and false at 33 px", () => {
    expect(NEAR_BOTTOM_PX).toBe(32);
    expect(isNearBottom(at(0))).toBe(true);
    expect(isNearBottom(at(32))).toBe(true);
    expect(isNearBottom(at(33))).toBe(false);
  });

  it("is true with all-zero metrics (no layout yet)", () => {
    expect(isNearBottom({ scrollTop: 0, scrollHeight: 0, clientHeight: 0 })).toBe(true);
  });

  it("accepts another threshold", () => {
    expect(isNearBottom(at(5), 4)).toBe(false);
  });
});

describe("classifyChange", () => {
  it.each<[string, string, string, Partial<ListChange>]>([
    ["empty to empty", "", "", {}],
    ["first nonempty snapshot is initial, with no additions", "", "AB", { initial: true }],
    ["same ids in a new array", "AB", "AB", {}],
    ["prepend", "CD", "ABCD", { before: ["A", "B"] }],
    ["append", "AB", "ABCD", { after: ["C", "D"] }],
    ["interior insert", "AC", "ABC", { within: ["B"] }],
    ["before and after", "BC", "ABCD", { before: ["A"], after: ["D"] }],
    ["before and within", "BD", "ABCD", { before: ["A"], within: ["C"] }],
    ["within and after", "AC", "ABCD", { within: ["B"], after: ["D"] }],
    ["before, within and after", "BD", "ABCDE", { before: ["A"], within: ["C"], after: ["E"] }],
    ["around a single previous row", "B", "ABC", { before: ["A"], after: ["C"] }],
  ])("%s", (_name, prev, next, expected) => {
    expect(classifyChange(rows(prev), rows(next))).toEqual({ ...NONE, ...expected });
  });

  it("counts within and after as incoming, but not before", () => {
    expect(hasIncoming({ ...NONE, within: ["B"] })).toBe(true);
    expect(hasIncoming({ ...NONE, after: ["D"] })).toBe(true);
    expect(hasIncoming({ ...NONE, before: ["A"] })).toBe(false);
    expect(hasIncoming({ ...NONE, initial: true })).toBe(false);
  });
});

describe("decideScroll", () => {
  const base = { change: NONE, bottomRequested: false, holding: false, wasNearBottom: false };
  const incoming: ListChange = { ...NONE, after: ["D"] };
  const interior: ListChange = { ...NONE, within: ["B"] };
  const mixed: ListChange = { ...NONE, before: ["A"], after: ["D"] };

  it.each<[string, Partial<typeof base>, ReturnType<typeof decideScroll>]>([
    ["an explicit request wins, even during a hold", { change: incoming, bottomRequested: true, holding: true }, { scroll: "bottom", pill: "clear" }],
    ["initial history goes to the bottom", { change: { ...NONE, initial: true } }, { scroll: "bottom", pill: "clear" }],
    ["a hold keeps the position and shows the pill, even near the bottom", { change: incoming, holding: true, wasNearBottom: true }, { scroll: "anchor", pill: "show" }],
    ["a hold covers interior inserts", { change: interior, holding: true }, { scroll: "anchor", pill: "show" }],
    ["incoming near the bottom follows", { change: incoming, wasNearBottom: true }, { scroll: "bottom", pill: "clear" }],
    ["interior incoming near the bottom follows", { change: interior, wasNearBottom: true }, { scroll: "bottom", pill: "clear" }],
    ["incoming while scrolled up shows the pill", { change: incoming }, { scroll: "anchor", pill: "show" }],
    ["interior incoming while scrolled up shows the pill", { change: interior }, { scroll: "anchor", pill: "show" }],
    ["mixed additions while scrolled up keep the anchor and show the pill", { change: mixed }, { scroll: "anchor", pill: "show" }],
    ["only older rows keep the anchor and leave the pill alone", { change: { ...NONE, before: ["A"] }, wasNearBottom: true }, { scroll: "anchor", pill: "keep" }],
    ["no added ids change nothing, hold or not", { holding: true }, { scroll: "anchor", pill: "keep" }],
  ])("%s", (_name, input, expected) => {
    expect(decideScroll({ ...base, ...input })).toEqual(expected);
  });
});

describe("decideResize", () => {
  it("keeps following the bottom only outside a hold", () => {
    expect(decideResize({ wasNearBottom: true, holding: false })).toBe("bottom");
    expect(decideResize({ wasNearBottom: true, holding: true })).toBe("anchor");
    expect(decideResize({ wasNearBottom: false, holding: false })).toBe("anchor");
  });
});

describe("pickAnchor and anchorAdjustment", () => {
  const boxes = [
    { id: "A", top: -120, bottom: -60 },
    { id: "B", top: -60, bottom: 0 }, // ends exactly at the top edge: not visible
    { id: "C", top: 0, bottom: 60 },
  ];

  it("picks the first row with any part inside the viewport", () => {
    expect(pickAnchor(boxes, 200)).toEqual({ id: "C", offset: 0 });
    expect(pickAnchor([{ id: "A", top: -20, bottom: 40 }, ...boxes], 200)).toEqual({ id: "A", offset: -20 });
  });

  it("returns null when no row is visible", () => {
    expect(pickAnchor([], 200)).toBeNull();
    expect(pickAnchor([{ id: "A", top: 200, bottom: 260 }], 200)).toBeNull();
  });

  it("stops measuring at the first visible row", () => {
    let measured = 0;
    function* lazy() {
      for (const box of boxes) {
        measured += 1;
        yield box;
      }
      throw new Error("measured past the anchor");
    }
    expect(pickAnchor(lazy(), 200)).toEqual({ id: "C", offset: 0 });
    expect(measured).toBe(3);
  });

  it("compensates only for displacement above the anchor", () => {
    // 100 px added above moved the row from 40 to 140; rows added below moved nothing.
    expect(anchorAdjustment({ id: "C", offset: 40 }, 140)).toBe(100);
    expect(anchorAdjustment({ id: "C", offset: -10 }, -10)).toBe(0);
    expect(anchorAdjustment({ id: "C", offset: 40 }, 0)).toBe(-40); // "Load older" disappeared above
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test src/components/room/listScroll.test.ts`
Expected: FAIL with `Failed to resolve import "@/components/room/listScroll"`.

- [ ] **Step 3: Implement the decisions**

Create `src/components/room/listScroll.ts`:

```ts
import type { Message } from "@/lib/schemas/types";

/**
 * Pure scroll decisions of the message list (room-panel design §5). jsdom has
 * no layout, so the rules live here as functions; `MessageList` only measures
 * the DOM, asks these functions, and applies the answer.
 */

export type ScrollMetrics = { scrollTop: number; scrollHeight: number; clientHeight: number };

export const NEAR_BOTTOM_PX = 32;

/** `scrollHeight - scrollTop - clientHeight <= threshold` */
export function isNearBottom(m: ScrollMetrics, threshold: number = NEAR_BOTTOM_PX): boolean {
  return m.scrollHeight - m.scrollTop - m.clientHeight <= threshold;
}

export type ListChange = {
  /** The first nonempty snapshot. Its rows are history, not additions. */
  initial: boolean;
  /** Newly added ids before the previous first row. */
  before: string[];
  /** Newly added ids between previous rows. */
  within: string[];
  /** Newly added ids after the previous last row. */
  after: string[];
};

/**
 * Compares two committed snapshots by their full id sets. Only unseen ids
 * count; a new array with the same ids is not a change. Both lists are in the
 * feed's chronological order, and rows are never removed.
 */
export function classifyChange(prev: readonly Message[], next: readonly Message[]): ListChange {
  const change: ListChange = { initial: false, before: [], within: [], after: [] };
  if (prev.length === 0) {
    change.initial = next.length > 0;
    return change;
  }
  const known = new Set(prev.map((message) => message.id));
  const firstId = prev[0].id;
  const lastId = prev[prev.length - 1].id;
  let zone: "before" | "within" | "after" = "before";
  for (const { id } of next) {
    if (id === firstId) zone = "within";
    if (!known.has(id)) change[zone].push(id);
    if (id === lastId) zone = "after";
  }
  return change;
}

/** `within` and `after` are incoming messages; `before` is older history. */
export function hasIncoming(change: ListChange): boolean {
  return change.within.length > 0 || change.after.length > 0;
}

export type ScrollDecision = {
  /** `bottom`: jump to the newest row. `anchor`: keep the reader's visible row where it was. */
  scroll: "bottom" | "anchor";
  pill: "show" | "clear" | "keep";
};

/** The priority table of room-panel design §5.1, for one committed update. */
export function decideScroll(input: {
  change: ListChange;
  /** An explicit request (own send, pill click) whose row is in this commit. */
  bottomRequested: boolean;
  /** A manual "Load more messages" hold is active. */
  holding: boolean;
  /** Measured before this update. */
  wasNearBottom: boolean;
}): ScrollDecision {
  if (input.bottomRequested) return { scroll: "bottom", pill: "clear" };
  if (input.change.initial) return { scroll: "bottom", pill: "clear" };
  if (hasIncoming(input.change)) {
    if (input.holding) return { scroll: "anchor", pill: "show" };
    if (input.wasNearBottom) return { scroll: "bottom", pill: "clear" };
    return { scroll: "anchor", pill: "show" };
  }
  // Only older rows, or nothing new: keep the reading position, leave the pill alone.
  return { scroll: "anchor", pill: "keep" };
}

/** When the list's own height changes (the footer grew or shrank). */
export function decideResize(input: { holding: boolean; wasNearBottom: boolean }): "bottom" | "anchor" {
  return input.wasNearBottom && !input.holding ? "bottom" : "anchor";
}

/** A row's box relative to the top edge of the list viewport. */
export type RowBox = { id: string; top: number; bottom: number };

/** The reader's position: a row and its top offset, negative when partly scrolled out. */
export type Anchor = { id: string; offset: number };

/** The first row with any part inside the viewport, in document order. Lazy: stops at the hit. */
export function pickAnchor(rows: Iterable<RowBox>, viewportHeight: number): Anchor | null {
  for (const row of rows) {
    if (row.bottom > 0 && row.top < viewportHeight) return { id: row.id, offset: row.top };
  }
  return null;
}

/**
 * How far to move `scrollTop` so the anchor row returns to its old offset.
 * Only displacement above the row counts: 100 px added above and 100 px below
 * give 100, not 200.
 */
export function anchorAdjustment(anchor: Anchor, currentOffset: number): number {
  return currentOffset - anchor.offset;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test src/components/room/listScroll.test.ts`
Expected: PASS, 31 tests.

- [ ] **Step 5: Lint, typecheck and commit**

Run: `pnpm lint && pnpm typecheck`
Expected: clean.

```bash
git add src/components/room/listScroll.ts src/components/room/listScroll.test.ts
git commit -m "feat(room): add the pure scroll decisions of the message list"
```

---

### Task 5: Message list

**Files:**
- Create: `src/components/room/MessageItem.tsx`, `src/components/room/LoadOlderButton.tsx`, `src/components/room/MessageList.tsx`
- Test: `src/components/room/MessageList.test.tsx`

**Interfaces:**
- Consumes: everything Task 4 produces; `formatMessageTime(iso)` (Task 3); `msg(n, overrides?)` from `@/lib/feed/test-helpers` (Task 1); `FeedState` from `@/lib/feed/types`; `Button` from `@/components/ui/button`.
- Produces: `type LoadOlderButtonProps = { disabled: boolean; busy: boolean; onClick(): void }` and `LoadOlderButton`; `MessageItem` (`{ message: Message }`, memoized, an `<article data-message-id>`); `type MessageListProps = { messages: Message[]; hasOlder: boolean; loading: FeedState["inflight"]; onLoadOlder(): void; ref?: Ref<MessageListHandle> }`; `type MessageListHandle = { scrollToBottom(messageId?: string): void; holdPosition(): () => void }`; `MessageList`.

- [ ] **Step 1: Write the failing component tests**

Create `src/components/room/MessageList.test.tsx`. jsdom has no layout, so the file installs a small fake: the element with `role="log"` has a 200 px viewport, every row is 50 px, the "Load older" block is 40 px, and `scrollTop` clamps like a browser. jsdom fires no scroll events for `scrollTop` writes; `userScrollTo` fires one to play the reader, and a bare `fireEvent.scroll` plays the browser reporting the list's own write.

```tsx
// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MessageList, type MessageListHandle, type MessageListProps } from "@/components/room/MessageList";
import { msg } from "@/lib/feed/test-helpers";
import type { Message } from "@/lib/schemas/types";

// jsdom has no layout. This fake gives the list a 200 px viewport, every row
// 50 px and the "Load older" block 40 px, and clamps scrollTop like a browser.
const VIEWPORT = 200;
const ROW = 50;
const LOAD_OLDER = 40;

const scrollTops = new WeakMap<Element, number>();
const isList = (el: Element) => el.getAttribute("role") === "log";
const rowsIn = (list: Element) => Array.from(list.querySelectorAll("[data-message-id]"));
const headerHeight = (list: Element) => (list.querySelector("button") ? LOAD_OLDER : 0);
const contentHeight = (list: Element) => headerHeight(list) + rowsIn(list).length * ROW;

function installFakeLayout() {
  Object.defineProperties(HTMLElement.prototype, {
    clientHeight: { configurable: true, get(this: HTMLElement) { return isList(this) ? VIEWPORT : 0; } },
    scrollHeight: { configurable: true, get(this: HTMLElement) { return isList(this) ? contentHeight(this) : 0; } },
    scrollTop: {
      configurable: true,
      get(this: HTMLElement) { return scrollTops.get(this) ?? 0; },
      set(this: HTMLElement, value: number) {
        const max = Math.max(0, contentHeight(this) - VIEWPORT);
        scrollTops.set(this, Math.min(Math.max(0, value), max));
      },
    },
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const list = this.closest('[role="log"]');
    const index = list ? rowsIn(list).indexOf(this) : -1;
    if (!list || index < 0) return new DOMRect(0, 0, 300, isList(this) ? VIEWPORT : 0);
    const top = headerHeight(list) + index * ROW - (scrollTops.get(list) ?? 0);
    return new DOMRect(0, top, 300, ROW);
  });
}

function removeFakeLayout() {
  // The real accessors live on Element.prototype; deleting the overrides restores them.
  for (const key of ["clientHeight", "scrollHeight", "scrollTop"] as const) {
    delete (HTMLElement.prototype as Partial<HTMLElement>)[key];
  }
  vi.restoreAllMocks();
}

const many = (from: number, to: number): Message[] =>
  Array.from({ length: to - from + 1 }, (_, index) => msg(from + index));

function setup(initial: Partial<MessageListProps> = {}) {
  const ref = createRef<MessageListHandle>();
  const onLoadOlder = vi.fn();
  const props: MessageListProps = { messages: [], hasOlder: false, loading: null, onLoadOlder, ...initial };
  const view = render(<MessageList ref={ref} {...props} />);
  const list = screen.getByRole("log");
  return {
    ref,
    list,
    onLoadOlder,
    update(next: Partial<MessageListProps>) {
      Object.assign(props, next);
      view.rerender(<MessageList ref={ref} {...props} />);
    },
    /** The reader scrolls: move, then the browser's scroll event. */
    userScrollTo(top: number) {
      list.scrollTop = top;
      fireEvent.scroll(list);
    },
    /** Top offset of a row inside the list viewport. */
    offsetOf: (n: number) =>
      screen.getByText(`message ${n}`).closest("[data-message-id]")!.getBoundingClientRect().top,
    pill: () => screen.queryByRole("button", { name: "New messages" }),
    unmount: view.unmount,
  };
}

const bottomOf = (list: HTMLElement) => list.scrollHeight - VIEWPORT;

beforeEach(installFakeLayout);
afterEach(removeFakeLayout);

describe("MessageList rendering", () => {
  it("is a polite log whose rows keep line breaks and show a machine-readable time", () => {
    const { list } = setup({ messages: [msg(1, { text: "two\nlines" })] });

    expect(list).toHaveAttribute("aria-live", "polite");
    expect(list).toHaveAttribute("aria-busy", "false");
    expect(screen.getByText("author-1")).toHaveClass("font-medium");
    expect(screen.getByText(/two\s+lines/)).toHaveClass("whitespace-pre-wrap", "break-words");
    expect(list.querySelector("time")).toHaveAttribute("datetime", msg(1).createdAt);
  });

  it("hides Load older without older history", () => {
    setup({ messages: many(1, 3), hasOlder: false });
    expect(screen.queryByRole("button", { name: "Load older" })).not.toBeInTheDocument();
  });

  it("puts Load older first and reports clicks", () => {
    const { list, onLoadOlder } = setup({ messages: many(1, 3), hasOlder: true });
    const button = screen.getByRole("button", { name: "Load older" });

    fireEvent.click(button);

    expect(list.firstElementChild).toContainElement(button);
    expect(onLoadOlder).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["older", true, true],
    ["newer", true, false],
    ["initial", true, false],
    [null, false, false],
  ] as const)("while loading %s: disabled %s, spinner %s", (loading, disabled, spinner) => {
    const { list } = setup({ messages: many(1, 3), hasOlder: true, loading });
    const button = screen.getByRole("button", { name: "Load older" });

    expect(button.hasAttribute("disabled")).toBe(disabled);
    expect(button.querySelector("svg") !== null).toBe(spinner);
    expect(list).toHaveAttribute("aria-busy", String(loading === "older"));
  });
});

describe("MessageList scrolling", () => {
  it("opens at the bottom of initial history", () => {
    const { list } = setup({ messages: many(1, 10) });
    expect(list.scrollTop).toBe(300); // 10 rows of 50 in a 200 px viewport
  });

  it("opens at the bottom when history arrives after an empty first render", () => {
    const { list, update, pill } = setup();
    update({ messages: many(1, 10) });

    expect(list.scrollTop).toBe(300);
    expect(pill()).toBeNull();
  });

  it("keeps the visible row in place when older rows are prepended", () => {
    const { list, update, userScrollTo, offsetOf, pill } = setup({ messages: many(11, 20), hasOlder: true });
    userScrollTo(65); // row 11 starts 25 px above the viewport's top edge
    expect(offsetOf(11)).toBe(-25);

    update({ messages: many(6, 20) });

    expect(offsetOf(11)).toBe(-25);
    expect(list.scrollTop).toBe(65 + 5 * ROW);
    expect(pill()).toBeNull();
  });

  it("keeps the visible row in place when Load older disappears", () => {
    const { update, userScrollTo, offsetOf } = setup({ messages: many(1, 10), hasOlder: true });
    userScrollTo(100);
    const before = offsetOf(3);

    update({ hasOlder: false });

    expect(offsetOf(3)).toBe(before);
  });

  it("follows an append when the reader is near the bottom", () => {
    const { list, update, userScrollTo, pill } = setup({ messages: many(1, 10) });
    userScrollTo(bottomOf(list) - 32);

    update({ messages: many(1, 11) });

    expect(list.scrollTop).toBe(bottomOf(list));
    expect(pill()).toBeNull();
  });

  it("shows the pill and leaves scrollTop alone for an append while scrolled up", () => {
    const { list, update, userScrollTo, pill } = setup({ messages: many(1, 10) });
    userScrollTo(100);

    update({ messages: many(1, 11) });

    expect(list.scrollTop).toBe(100);
    expect(pill()).toBeInTheDocument();
  });

  it("scrolls down and hides the pill when it is clicked", () => {
    const { list, update, userScrollTo, pill } = setup({ messages: many(1, 10) });
    userScrollTo(100);
    update({ messages: many(1, 11) });

    fireEvent.click(pill()!);

    expect(list.scrollTop).toBe(bottomOf(list));
    expect(pill()).toBeNull();
  });

  it("hides the pill when the reader scrolls to the bottom", () => {
    const { list, update, userScrollTo, pill } = setup({ messages: many(1, 10) });
    userScrollTo(100);
    update({ messages: many(1, 11) });

    userScrollTo(bottomOf(list) - 10);

    expect(pill()).toBeNull();
  });

  it("treats a same-ids array and a duplicate-only update as no change", () => {
    const { list, update, userScrollTo, pill } = setup({ messages: many(1, 10) });
    userScrollTo(100);

    update({ messages: [...many(1, 10)] });

    expect(list.scrollTop).toBe(100);
    expect(pill()).toBeNull();
  });

  it("applies the near-bottom and pill rules to interior additions", () => {
    const sparse = [msg(1), msg(2), msg(3), msg(4), msg(5), msg(6), msg(8)];
    const near = setup({ messages: sparse });
    near.update({ messages: many(1, 8) }); // 7 lands between 6 and 8
    expect(near.list.scrollTop).toBe(bottomOf(near.list));
    expect(near.pill()).toBeNull();
    near.unmount();

    const away = setup({ messages: sparse });
    away.userScrollTo(50);
    const before = away.offsetOf(2);
    away.update({ messages: many(1, 8) });
    expect(away.offsetOf(2)).toBe(before);
    expect(away.pill()).toBeInTheDocument();
  });

  it("adjusts by the rows above only when rows arrive above and below at once", () => {
    const { list, update, userScrollTo, offsetOf, pill } = setup({ messages: many(11, 20), hasOlder: true });
    userScrollTo(140); // row 13 is the first visible row
    const before = offsetOf(13);

    update({ messages: many(9, 22) }); // 100 px above and 100 px below in one commit

    expect(list.scrollTop).toBe(240); // +100, not +200
    expect(offsetOf(13)).toBe(before);
    expect(pill()).toBeInTheDocument();
  });

  it("does not let the scroll event of its own correction hide a new pill", () => {
    const sparse = [msg(1), msg(3), msg(4), msg(5), msg(6), msg(7), msg(8)];
    const { ref, list, update, pill } = setup({ messages: sparse });
    const finish = ref.current!.holdPosition(); // a hold keeps the position even at the bottom

    update({ messages: many(1, 8) }); // 2 lands above the visible rows: corrected by +50
    fireEvent.scroll(list); // the browser reports our own write
    expect(pill()).toBeInTheDocument();

    fireEvent.scroll(list); // a later event at the bottom is the reader's
    expect(pill()).toBeNull();
    act(finish);
  });

  it("keeps following the bottom when the list's height changes", () => {
    const observers: ResizeObserverCallback[] = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: ResizeObserverCallback) {
          observers.push(callback);
        }
        observe() {}
        disconnect() {}
      },
    );
    const { list, userScrollTo } = setup({ messages: many(1, 10) });
    const resize = () => act(() => observers[0]([], {} as ResizeObserver));

    list.scrollTop = 250; // the viewport shrank under a reader who was at the bottom
    resize();
    expect(list.scrollTop).toBe(bottomOf(list));

    userScrollTo(100);
    resize();
    expect(list.scrollTop).toBe(100);
    vi.unstubAllGlobals();
  });
});

describe("MessageList handle", () => {
  it("scrollToBottom() jumps at once and clears the pill", () => {
    const { ref, list, update, userScrollTo, pill } = setup({ messages: many(1, 10) });
    userScrollTo(100);
    update({ messages: many(1, 11) });

    act(() => ref.current!.scrollToBottom());

    expect(list.scrollTop).toBe(bottomOf(list));
    expect(pill()).toBeNull();
  });

  it("scrollToBottom(id) waits for that row to commit", () => {
    const { ref, list, update, userScrollTo, pill } = setup({ messages: many(1, 10) });
    userScrollTo(100);

    act(() => ref.current!.scrollToBottom(msg(11).id));
    expect(list.scrollTop).toBe(100);

    update({ messages: many(1, 11) });
    expect(list.scrollTop).toBe(bottomOf(list));
    expect(pill()).toBeNull();
  });

  it("scrollToBottom(id) applies at once when the row is already there", () => {
    const { ref, list, userScrollTo } = setup({ messages: many(1, 10) });
    userScrollTo(100);

    act(() => ref.current!.scrollToBottom(msg(10).id));

    expect(list.scrollTop).toBe(bottomOf(list));
  });

  it("holds the position near the bottom, through an unrelated append and a final interior batch", () => {
    const sparse = [msg(1), msg(2), msg(3), msg(4), msg(6), msg(7), msg(8)];
    const { ref, list, update, pill } = setup({ messages: sparse });
    const atBottom = list.scrollTop;
    const finish = ref.current!.holdPosition();

    update({ messages: [...sparse, msg(9)] }); // unrelated arrival: does not consume the hold
    expect(list.scrollTop).toBe(atBottom);
    expect(pill()).toBeInTheDocument();

    // The request's batch lands between displayed rows; finish() runs before React commits it.
    act(() => {
      finish();
      update({ messages: many(1, 9) });
    });
    expect(list.scrollTop).toBe(atBottom);

    update({ messages: many(1, 10) }); // the hold is over: near the bottom follows again
    expect(list.scrollTop).toBe(atBottom); // 150 is more than 32 px from the new bottom
    expect(pill()).toBeInTheDocument();
  });

  it("releases a finished hold even when no commit brought rows (empty, failed or duplicate batch)", () => {
    const { ref, list, update, pill } = setup({ messages: many(1, 10) });
    const finish = ref.current!.holdPosition();

    act(finish); // request start and completion before any intermediate render
    act(finish); // idempotent
    expect(pill()).toBeNull();

    update({ messages: many(1, 11) });
    expect(list.scrollTop).toBe(bottomOf(list)); // following again
    expect(pill()).toBeNull();
  });

  it("keeps a pill from a separate arrival when the held batch was empty", () => {
    const { ref, update, userScrollTo, pill } = setup({ messages: many(1, 10) });
    userScrollTo(100);
    update({ messages: many(1, 11) });
    const finish = ref.current!.holdPosition();

    act(finish);

    expect(pill()).toBeInTheDocument();
  });

  it("lets an own send reach the bottom during a hold without ending the hold", () => {
    const { ref, list, update, pill } = setup({ messages: many(1, 10) });
    const finish = ref.current!.holdPosition();

    act(() => ref.current!.scrollToBottom(msg(12).id));
    update({ messages: [...many(1, 10), msg(12)] });
    expect(list.scrollTop).toBe(bottomOf(list));
    expect(pill()).toBeNull();

    const held = list.scrollTop;
    update({ messages: many(1, 12) }); // the manual batch: 11 lands inside
    expect(pill()).toBeInTheDocument();
    expect(list.scrollTop).toBe(held); // held in place: no longer following the new bottom
    expect(list.scrollTop).toBeLessThan(bottomOf(list));
    act(finish);
  });

  it("ignores a finish callback that outlives the list", () => {
    const { ref, unmount } = setup({ messages: many(1, 10) });
    const finish = ref.current!.holdPosition();

    unmount();

    expect(() => finish()).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test src/components/room/MessageList.test.tsx`
Expected: FAIL with `Failed to resolve import "@/components/room/MessageList"`.

- [ ] **Step 3: Create the row and the "Load older" button**

Create `src/components/room/MessageItem.tsx`:

```tsx
import { memo } from "react";

import type { Message } from "@/lib/schemas/types";
import { formatMessageTime } from "@/lib/time/format";

/**
 * One row (map-shell design §8), an `article` so tests and assistive tech can
 * address rows by role. `data-message-id` is how the list finds a row to
 * measure. Memoized: a row re-renders only when its message changes.
 */
export const MessageItem = memo(function MessageItem({ message }: { message: Message }) {
  return (
    <article data-message-id={message.id} className="flex flex-col gap-0.5 py-1.5">
      <p className="font-medium">{message.author}</p>
      <p className="break-words whitespace-pre-wrap">{message.text}</p>
      <time dateTime={message.createdAt} className="self-end text-xs text-muted-foreground">
        {formatMessageTime(message.createdAt)}
      </time>
    </article>
  );
});
```

Create `src/components/room/LoadOlderButton.tsx`:

```tsx
import { FaSpinner } from "react-icons/fa";

import { Button } from "@/components/ui/button";

export type LoadOlderButtonProps = { disabled: boolean; busy: boolean; onClick(): void };

/** First element of the message list. Presentational: the list derives the flags. */
export function LoadOlderButton({ disabled, busy, onClick }: LoadOlderButtonProps) {
  return (
    <div className="flex justify-center pb-2">
      <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={onClick}>
        {busy ? <FaSpinner aria-hidden className="animate-spin" /> : null}
        Load older
      </Button>
    </div>
  );
}
```

- [ ] **Step 4: Implement the list**

Create `src/components/room/MessageList.tsx`:

```tsx
"use client";

import {
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type Ref,
} from "react";

import { LoadOlderButton } from "@/components/room/LoadOlderButton";
import { MessageItem } from "@/components/room/MessageItem";
import {
  anchorAdjustment,
  classifyChange,
  decideResize,
  decideScroll,
  isNearBottom,
  pickAnchor,
  type Anchor,
  type RowBox,
} from "@/components/room/listScroll";
import { Button } from "@/components/ui/button";
import type { FeedState } from "@/lib/feed/types";
import type { Message } from "@/lib/schemas/types";

export type MessageListProps = {
  messages: Message[];
  hasOlder: boolean;
  loading: FeedState["inflight"];
  onLoadOlder(): void;
  ref?: Ref<MessageListHandle>;
};

export type MessageListHandle = {
  /** Jump to the newest row; with an id, once that row has committed. */
  scrollToBottom(messageId?: string): void;
  /** Start a manual-load hold; the returned callback finishes it and is idempotent. */
  holdPosition(): () => void;
};

/** One manual "Load more messages" request. Released by the commit after it finishes. */
type Hold = { finishing: boolean };

function rowElements(list: HTMLElement): HTMLElement[] {
  return Array.from(list.querySelectorAll<HTMLElement>("[data-message-id]"));
}

/** Row boxes relative to the list viewport, measured one at a time. */
function* rowBoxes(list: HTMLElement): Generator<RowBox> {
  const viewportTop = list.getBoundingClientRect().top;
  for (const row of rowElements(list)) {
    const rect = row.getBoundingClientRect();
    yield { id: row.dataset.messageId ?? "", top: rect.top - viewportTop, bottom: rect.bottom - viewportTop };
  }
}

function offsetOf(list: HTMLElement, id: string): number | null {
  const row = rowElements(list).find((element) => element.dataset.messageId === id);
  if (!row) return null;
  return row.getBoundingClientRect().top - list.getBoundingClientRect().top;
}

/**
 * The conversation's scroll container (room-panel design §5). It measures the
 * DOM and applies what `listScroll` decides: initial history and own sends go
 * to the bottom, incoming rows follow only a reader who is already there, and
 * otherwise the first visible row keeps its place and the "New messages" pill
 * shows. Browser scroll anchoring is off, so displacement is corrected once.
 */
export function MessageList({ messages, hasOlder, loading, onLoadOlder, ref }: MessageListProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState(false);
  const [holdTick, setHoldTick] = useState(0);

  // Measurements and requests live in refs: they describe the committed DOM,
  // so an abandoned render can never overwrite them.
  const committed = useRef<readonly Message[]>([]);
  const anchor = useRef<Anchor | null>(null);
  const nearBottom = useRef(true);
  const holds = useRef(new Set<Hold>());
  const bottomRequest = useRef<{ id?: string } | null>(null);
  /** `scrollTop` right after our own write, to tell its scroll event from the reader's. */
  const ownScrollTop = useRef<number | null>(null);

  const measure = useCallback(() => {
    const list = listRef.current;
    if (!list) return;
    nearBottom.current = isNearBottom(list);
    anchor.current = pickAnchor(rowBoxes(list), list.clientHeight);
  }, []);

  const writeScrollTop = useCallback((list: HTMLElement, value: number) => {
    const before = list.scrollTop;
    list.scrollTop = value;
    if (list.scrollTop !== before) ownScrollTop.current = list.scrollTop;
  }, []);

  const apply = useCallback(
    (scroll: "bottom" | "anchor") => {
      const list = listRef.current;
      if (!list) return;
      if (scroll === "bottom") {
        writeScrollTop(list, list.scrollHeight);
      } else if (anchor.current) {
        const offset = offsetOf(list, anchor.current.id);
        const delta = offset === null ? 0 : anchorAdjustment(anchor.current, offset);
        if (delta !== 0) writeScrollTop(list, list.scrollTop + delta);
      }
      // With no visible row the browser keeps scrollTop, clamped to the new range.
      measure();
    },
    [measure, writeScrollTop],
  );

  // Reconcile each commit that can move rows: new messages, "Load older" appearing or
  // going, and the tick of a finished hold. Additions are found by id, never inferred
  // from endpoints or loading flags.
  useLayoutEffect(() => {
    const change = classifyChange(committed.current, messages);
    committed.current = messages;

    const request = bottomRequest.current;
    const bottomRequested =
      request !== null && (request.id === undefined || messages.some((m) => m.id === request.id));
    if (bottomRequested) bottomRequest.current = null;

    const decision = decideScroll({
      change,
      bottomRequested,
      holding: holds.current.size > 0,
      wasNearBottom: nearBottom.current,
    });
    apply(decision.scroll);
    if (decision.pill === "show") setPill(true);
    if (decision.pill === "clear") setPill(false);

    // A finished hold has now seen the final snapshot of its request.
    for (const hold of [...holds.current]) if (hold.finishing) holds.current.delete(hold);
  }, [messages, hasOlder, holdTick, apply]);

  // The list's own height changes when the footer grows or shrinks.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      apply(decideResize({ holding: holds.current.size > 0, wasNearBottom: nearBottom.current }));
    });
    observer.observe(list);
    return () => observer.disconnect();
  }, [apply]);

  useImperativeHandle(
    ref,
    () => ({
      scrollToBottom(messageId) {
        const present = messageId === undefined || committed.current.some((m) => m.id === messageId);
        if (!present) {
          bottomRequest.current = { id: messageId }; // applied by the commit that brings the row
          return;
        }
        apply("bottom");
        setPill(false);
      },
      holdPosition() {
        const hold: Hold = { finishing: false };
        holds.current.add(hold);
        return () => {
          if (hold.finishing) return;
          hold.finishing = true;
          // Force a commit: it reconciles the request's final snapshot under the hold, then releases it.
          setHoldTick((tick) => tick + 1);
        };
      },
    }),
    [apply],
  );

  function onScroll() {
    const list = listRef.current;
    if (!list) return;
    const own = ownScrollTop.current !== null && Math.abs(list.scrollTop - ownScrollTop.current) < 1;
    ownScrollTop.current = null;
    measure();
    // Only the reader's own scrolling hides the pill, never our anchor correction.
    if (!own && nearBottom.current) setPill(false);
  }

  return (
    <div className="relative flex min-h-24 flex-1 flex-col">
      <div
        ref={listRef}
        role="log"
        aria-live="polite"
        aria-busy={loading === "older"}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-y-auto [overflow-anchor:none]"
      >
        {hasOlder ? (
          <LoadOlderButton disabled={loading !== null} busy={loading === "older"} onClick={onLoadOlder} />
        ) : null}
        {messages.map((message) => (
          <MessageItem key={message.id} message={message} />
        ))}
      </div>
      {pill ? (
        <Button
          type="button"
          size="sm"
          className="absolute bottom-2 left-1/2 -translate-x-1/2 shadow-md"
          onClick={() => {
            apply("bottom");
            setPill(false);
          }}
        >
          New messages
        </Button>
      ) : null}
    </div>
  );
}
```

Points that are easy to get wrong:
- Measurements (`anchor`, `nearBottom`) are taken **after** each commit and on each scroll event, and read **before** the next update is applied. Never measure during render.
- `decideScroll` receives `holds.current.size > 0` before finished holds are deleted, so the final snapshot of a manual request is reconciled under its hold.
- The wrapper has `min-h-24` (96 px): the list can never be squeezed below the spec's minimum by a tall footer.
- The pill is a sibling of the scroll container, not a child, so it does not scroll and does not change `scrollHeight`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm test src/components/room/MessageList.test.tsx`
Expected: PASS, 28 tests.

- [ ] **Step 6: Run the whole suite, lint and typecheck**

Run: `pnpm test && pnpm lint && pnpm typecheck`
Expected: 35 files / 662 tests passing (with Tasks 1–4 done); lint has no `react-hooks/exhaustive-deps` warning; typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add src/components/room/MessageItem.tsx src/components/room/LoadOlderButton.tsx src/components/room/MessageList.tsx src/components/room/MessageList.test.tsx
git commit -m "feat(room): add the message list with anchor-preserving scroll and the new-messages pill"
```

---

### Task 6: Selection seed

**Files:**
- Modify: `src/lib/page/selection.ts`
- Test: `src/lib/page/selection.test.ts` (modify)

**Interfaces:**
- Consumes: `Message`, `Room` from `@/lib/schemas/types`.
- Produces: `Selection`'s room variant becomes `{ kind: "room"; room: Room; prefill?: Prefill; seed?: Message }`; `SelectionAction`'s `roomCreated` becomes `{ type: "roomCreated"; room: Room; message: Message }`. Nothing in the repository dispatches `roomCreated` yet (chunk 10 will), so no caller changes.

- [ ] **Step 1: Replace the test file with the extended table**

Replace `src/lib/page/selection.test.ts` with:

```ts
import { describe, expect, it } from "vitest";

import { type Selection, selectionReducer } from "@/lib/page/selection";
import type { Message, Room } from "@/lib/schemas/types";

const roomA: Room = {
  id: "00000000-0000-4000-8000-00000000000a",
  name: "brave-crimson-otter",
  lat: 46.7712,
  lng: 23.6236,
  createdAt: "2026-09-16T15:00:00.000000Z",
};
const roomB: Room = { ...roomA, id: "00000000-0000-4000-8000-00000000000b", name: "calm-amber-heron" };
const prefill = { author: "ana", text: "hello" };
const first: Message = {
  id: "00000000-0000-4000-8000-0000000000f1",
  chatroomId: roomB.id,
  author: "ana",
  text: "first!",
  createdAt: "2026-09-16T15:00:00.000000Z",
};

const none: Selection = { kind: "none" };
const draft: Selection = { kind: "draft", lat: 1, lng: 2 };
const selectedA: Selection = { kind: "room", room: roomA, prefill };
const createdA: Selection = { kind: "room", room: roomA, seed: { ...first, chatroomId: roomA.id } };

const everyState: [string, Selection][] = [
  ["none", none],
  ["draft", draft],
  ["room", selectedA],
  ["created room", createdA],
];

describe("selectionReducer", () => {
  it.each(everyState)("clickEmpty from %s places a draft", (_, state) => {
    expect(selectionReducer(state, { type: "clickEmpty", lat: 10, lng: 20 })).toEqual({
      kind: "draft",
      lat: 10,
      lng: 20,
    });
  });

  it.each(everyState)("clickPin from %s selects the room without prefill or seed", (_, state) => {
    expect(selectionReducer(state, { type: "clickPin", room: roomB })).toEqual({
      kind: "room",
      room: roomB,
    });
  });

  it("clickPin on the already selected room returns the same state object", () => {
    const next = selectionReducer(selectedA, { type: "clickPin", room: { ...roomA } });

    expect(next).toBe(selectedA);
  });

  it("clickPin on the room just created keeps its seed by returning the same state object", () => {
    expect(selectionReducer(createdA, { type: "clickPin", room: { ...roomA } })).toBe(createdA);
  });

  it("re-opening a created room after close has no seed", () => {
    const closed = selectionReducer(createdA, { type: "close" });

    expect(selectionReducer(closed, { type: "clickPin", room: roomA })).toEqual({ kind: "room", room: roomA });
  });

  it.each(everyState)("roomCreated from %s selects the new room with its first message as seed", (_, state) => {
    expect(selectionReducer(state, { type: "roomCreated", room: roomB, message: first })).toEqual({
      kind: "room",
      room: roomB,
      seed: first,
    });
  });

  it.each(everyState)("movedToExisting from %s carries the prefill and never a seed", (_, state) => {
    expect(
      selectionReducer(state, { type: "movedToExisting", room: roomB, prefill }),
    ).toEqual({ kind: "room", room: roomB, prefill });
  });

  it.each(everyState)("close from %s clears the selection", (_, state) => {
    expect(selectionReducer(state, { type: "close" })).toEqual({ kind: "none" });
  });

  it("does not mutate the previous state", () => {
    const before = structuredClone(selectedA);

    selectionReducer(selectedA, { type: "clickEmpty", lat: 1, lng: 1 });
    selectionReducer(selectedA, { type: "close" });

    expect(selectedA).toEqual(before);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test src/lib/page/selection.test.ts`
Expected: FAIL. The four `roomCreated … with its first message as seed` cases fail with a missing `seed` in the received object; the other cases pass. (`pnpm typecheck` would also fail now: `message` is not yet part of `roomCreated`.)

- [ ] **Step 3: Add the seed to the reducer**

Replace `src/lib/page/selection.ts` with:

```ts
import type { Message, Room } from "@/lib/schemas/types";

/** Text chunk 10 carries into the room panel when a create lands on an existing room. */
export type Prefill = { author: string; text: string };

/** What the map page shows in its panel (spec §6). */
export type Selection =
  | { kind: "none" }
  | { kind: "draft"; lat: number; lng: number }
  | { kind: "room"; room: Room; prefill?: Prefill; seed?: Message };

export type SelectionAction =
  | { type: "clickEmpty"; lat: number; lng: number }
  | { type: "clickPin"; room: Room }
  | { type: "roomCreated"; room: Room; message: Message } // message becomes the seed
  | { type: "movedToExisting"; room: Room; prefill: Prefill }
  | { type: "close" };

/**
 * Pure transition table (spec §6). `clickPin` on the already selected room
 * returns the same object so the keyed room panel is not remounted and its
 * prefill and seed survive. Only `roomCreated` sets a seed: the first message
 * of a room this visitor just created (room-panel design §3.1).
 */
export function selectionReducer(state: Selection, action: SelectionAction): Selection {
  switch (action.type) {
    case "clickEmpty":
      return { kind: "draft", lat: action.lat, lng: action.lng };
    case "clickPin":
      return state.kind === "room" && state.room.id === action.room.id
        ? state
        : { kind: "room", room: action.room };
    case "roomCreated":
      return { kind: "room", room: action.room, seed: action.message };
    case "movedToExisting":
      return { kind: "room", room: action.room, prefill: action.prefill };
    case "close":
      return { kind: "none" };
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test src/lib/page/selection.test.ts`
Expected: PASS, 24 tests.

- [ ] **Step 5: Lint, typecheck and commit**

Run: `pnpm lint && pnpm typecheck`
Expected: clean.

```bash
git add src/lib/page/selection.ts src/lib/page/selection.test.ts
git commit -m "feat(page): carry the first message of a created room as the selection's seed"
```

---

### Task 7: `ComposeForm` textarea sizing prop

**Files:**
- Modify: `src/components/compose/ComposeForm.tsx`
- Test: `src/components/compose/ComposeForm.test.tsx` (modify)

**Interfaces:**
- Consumes: nothing new.
- Produces: `ComposeFormProps.textareaClassName?: string`, passed as `className` to the form's `Textarea`. Validation, submission and every existing caller keep their contracts.

- [ ] **Step 1: Add the failing tests**

In `src/components/compose/ComposeForm.test.tsx`, inside `describe("ComposeForm props", …)`, insert these two tests directly before `it("uses submitLabel for the button", …)`:

```tsx
  it("passes textareaClassName to the message field only", () => {
    const { author, text } = setup({ textareaClassName: "field-sizing-fixed h-16" });
    expect(text()).toHaveClass("field-sizing-fixed", "h-16");
    expect(text()).not.toHaveClass("field-sizing-content"); // the default sizing is replaced, not doubled
    expect(author()).not.toHaveClass("h-16");
  });

  it("keeps the content-sized message field by default", () => {
    const { text } = setup();
    expect(text()).toHaveClass("field-sizing-content");
  });
```

- [ ] **Step 2: Run the tests to verify the new one fails**

Run: `pnpm test src/components/compose/ComposeForm.test.tsx`
Expected: FAIL in "passes textareaClassName to the message field only" (the textarea lacks `field-sizing-fixed`); the other 18 tests pass. TypeScript also reports that `textareaClassName` is not a known prop.

- [ ] **Step 3: Add the prop**

In `src/components/compose/ComposeForm.tsx` make three edits.

In `ComposeFormProps`, after the `disabled?: boolean;` member:

```ts
  /** Extra classes for the message field; the room panel bounds its height with this. */
  textareaClassName?: string;
```

In the component's parameter list, between `disabled = false,` and `onSubmit,`:

```ts
  textareaClassName,
```

On the `<Textarea …>` element, directly after `rows={3}`:

```tsx
          className={textareaClassName}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test src/components/compose/ComposeForm.test.tsx`
Expected: PASS, 19 tests.

- [ ] **Step 5: Lint, typecheck and commit**

Run: `pnpm lint && pnpm typecheck`
Expected: clean.

```bash
git add src/components/compose/ComposeForm.tsx src/components/compose/ComposeForm.test.tsx
git commit -m "feat(compose): accept textareaClassName so a host can bound the message field"
```

---

### Task 8: Room panel

**Files:**
- Create: `src/components/ui/alert.tsx` (generated by shadcn), `src/components/room/BacklogNotice.tsx`, `src/components/room/RoomPanel.tsx`
- Modify: `src/lib/feed/test-helpers.ts` (append `manualTimers`)
- Test: `src/components/room/RoomPanel.test.tsx`

**Interfaces:**
- Consumes: `useRoomFeed(roomId, { seed, deps })` → `RoomFeed` (Task 2); `FeedNotReadyError`, `FeedDeps`, `FeedTimers` (Task 1); `MessageList`, `MessageListHandle` (Task 5); `ComposeForm` with `textareaClassName` (Task 7); `PanelFrame` (`title`, `onClose`, `children`, `footer`); `ApiValidationError` (`new ApiValidationError([{ path, message }])`); `useDisplayName(): [name, setName]`; `Prefill = { author: string; text: string }` from `@/lib/page/selection`; `FeedError` from `@/lib/feed/types`.
- Produces: `type BacklogNoticeProps = { disabled: boolean; busy: boolean; onLoadMore(): void }` and `BacklogNotice`; `type RoomPanelProps = { room: Room; seed?: Message; prefill?: Prefill; onClose(): void; feedDeps?: Partial<FeedDeps> }`; `RoomPanel`; copy constants `ROOM_GONE_HINT`, `LOAD_FAILED_HINT`, `OLDER_FAILED`, `NEWER_FAILED`, `NEWER_FAILED_BACKLOG`; test helper `manualTimers()` → `{ timers: FeedTimers, tick(): void }`.

- [ ] **Step 1: Add the shadcn alert**

```bash
pnpm exec shadcn add alert -y
git status --short
```

Expected: exactly one new file, `src/components/ui/alert.tsx`, exporting `Alert`, `AlertTitle`, `AlertDescription` and `AlertAction` (verified with the project's CLI on 2026-09-17; the CLI's only dependency, `cn`, is already installed). `Alert` renders `role="alert"`. If the CLI rewrites `src/app/globals.css`, revert it with `git checkout src/app/globals.css`. If a newer registry version no longer exports `AlertAction`, add this to the generated file and its export list:

```tsx
function AlertAction({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="alert-action" className={cn("absolute top-2 right-2", className)} {...props} />
}
```

- [ ] **Step 2: Append hand-fired timers to the feed test helpers**

Component tests keep real timers for `user-event`, so the poll interval is injected through `FeedDeps.timers` and fired by hand. In `src/lib/feed/test-helpers.ts`, add this import after the `@/lib/feed/realtime` import:

```ts
import type { FeedTimers } from "@/lib/feed/store";
```

and append at the end of the file:

```ts
/** Timers the test fires by hand, for component tests that keep real timers for user-event. */
export function manualTimers() {
  const intervals = new Map<number, () => void>();
  let nextId = 1;
  const timers = {
    setInterval: (callback: () => void) => {
      intervals.set(nextId, callback);
      return nextId++;
    },
    clearInterval: (handle: number) => void intervals.delete(handle),
    setTimeout: () => 0, // the idle timer never fires in these tests
    clearTimeout: () => {},
  } as unknown as FeedTimers;
  return { timers, tick: () => [...intervals.values()].forEach((callback) => callback()) };
}
```

- [ ] **Step 3: Write the failing panel tests**

Create `src/components/room/RoomPanel.test.tsx`:

```tsx
// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SUBMIT_FAILED_MESSAGE } from "@/components/compose/fieldErrors";
import {
  LOAD_FAILED_HINT,
  NEWER_FAILED,
  NEWER_FAILED_BACKLOG,
  OLDER_FAILED,
  ROOM_GONE_HINT,
  RoomPanel,
  type RoomPanelProps,
} from "@/components/room/RoomPanel";
import { ApiRequestError, ApiValidationError } from "@/lib/api/client";
import { FeedNotReadyError, type FeedDeps } from "@/lib/feed/store";
import {
  ROOM,
  TEST_CONFIG,
  catchUp,
  fakeMessages,
  fakeRealtime,
  id,
  manualTimers,
  msg,
  page,
} from "@/lib/feed/test-helpers";
import { DISPLAY_NAME_KEY } from "@/lib/storage/displayName";
import type { Room } from "@/lib/schemas/types";

const room: Room = {
  id: ROOM,
  name: "brave-crimson-otter",
  lat: 46.7712,
  lng: 23.6236,
  createdAt: "2026-09-16T15:00:00.000000Z",
};

/** Lets settled promises run inside `act`, so React commits what the store published. */
const settle = () => act(async () => {});

function setup(props: Partial<RoomPanelProps> = {}) {
  const messages = fakeMessages();
  const realtime = fakeRealtime();
  const clock = manualTimers();
  const feedDeps: FeedDeps = {
    messages: messages.api,
    subscribe: realtime.subscribe,
    config: TEST_CONFIG,
    timers: clock.timers,
  };
  const onClose = vi.fn();
  const user = userEvent.setup();
  const view = render(<RoomPanel room={room} onClose={onClose} feedDeps={feedDeps} {...props} />);
  return {
    user,
    messages,
    realtime,
    onClose,
    tick: () => act(() => clock.tick()),
    root: () => view.container.firstElementChild as HTMLElement,
    author: () => screen.getByLabelText("Display name"),
    text: () => screen.getByLabelText("Message"),
    send: () => screen.getByRole("button", { name: "Send" }),
    unmount: view.unmount,
  };
}

/** History [1, 2] loaded (older pages exist), realtime refused, first catch-up answered empty. */
async function openPolling(props: Partial<RoomPanelProps> = {}) {
  const ctx = setup(props);
  ctx.messages.list[0].resolve(page([msg(1), msg(2)], true));
  await settle();
  act(() => ctx.realtime.attempts[0].handlers.onFailed("refused"));
  ctx.messages.listAfter[0].resolve(catchUp([], id(2)));
  await settle();
  return ctx;
}

/** As `openPolling`, then a poll answers with message 3 and says more rows exist. */
async function openWithBacklog() {
  const ctx = await openPolling();
  ctx.tick();
  ctx.messages.listAfter[1].resolve(catchUp([msg(3)], id(3), true));
  await settle();
  return ctx;
}

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  return () => vi.restoreAllMocks();
});

describe("RoomPanel states", () => {
  it("shows a spinner and a disabled form while opening", async () => {
    const { root, author, text, send, onClose, user } = setup();

    expect(screen.getByRole("status")).toHaveTextContent("Loading messages…");
    expect(screen.getByText(room.name)).toBeInTheDocument();
    expect(author()).toBeDisabled();
    expect(text()).toBeDisabled();
    expect(send()).toBeDisabled();
    expect(root()).toHaveAttribute("data-connection", "connecting");

    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders history, enables the form and reports the polling connection", async () => {
    const { root, send, text } = await openPolling();

    const log = screen.getByRole("log");
    expect(within(log).getByText("message 1")).toBeInTheDocument();
    expect(within(log).getByText("message 2")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(send()).toBeEnabled();
    expect(text()).toHaveClass("field-sizing-fixed", "h-16", "resize-none", "overflow-y-auto");
    expect(root()).toHaveAttribute("data-connection", "polling");
  });

  it("shows a persistent hint after an initial failure and keeps the form disabled", async () => {
    const { messages, send } = setup();
    messages.list[0].reject(new Error("offline"));
    await settle();

    expect(screen.getByText(LOAD_FAILED_HINT)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Dismiss" })).not.toBeInTheDocument();
    expect(screen.queryByRole("log")).not.toBeInTheDocument();
    expect(send()).toBeDisabled();
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("offline"));
  });

  it("shows the room-gone hint after a 404 from any fetch", async () => {
    const { messages, send, user } = await openPolling();
    await user.click(screen.getByRole("button", { name: "Load older" }));
    messages.list[1].reject(new ApiRequestError(404, "not_found", "Room not found"));
    await settle();

    expect(screen.getByText(ROOM_GONE_HINT)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Dismiss" })).not.toBeInTheDocument();
    expect(screen.queryByRole("log")).not.toBeInTheDocument();
    expect(send()).toBeDisabled();
  });

  it("shows a seeded room at once with no history request", () => {
    const { messages, send } = setup({ seed: msg(7) });

    expect(within(screen.getByRole("log")).getByText("message 7")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(send()).toBeEnabled();
    expect(messages.api.list).not.toHaveBeenCalled();
  });

  it("fills the form from a prefill, ahead of the remembered name", async () => {
    localStorage.setItem(DISPLAY_NAME_KEY, "remembered");
    const { author, text } = await openPolling({ prefill: { author: "ana", text: "unsent draft" } });

    expect(author()).toHaveValue("ana");
    expect(text()).toHaveValue("unsent draft");
  });

  it("falls back to the remembered display name", async () => {
    localStorage.setItem(DISPLAY_NAME_KEY, "remembered");
    const { author } = await openPolling();

    expect(author()).toHaveValue("remembered");
  });
});

describe("RoomPanel fetch errors", () => {
  it("shows a dismissible alert after an older failure; the button is the retry", async () => {
    const { messages, user } = await openPolling();
    const loadOlder = () => screen.getByRole("button", { name: "Load older" });
    await user.click(loadOlder());
    expect(loadOlder()).toBeDisabled();
    messages.list[1].reject(new Error("offline"));
    await settle();

    expect(screen.getByText(OLDER_FAILED)).toBeInTheDocument();
    expect(screen.queryByText(/offline/)).not.toBeInTheDocument(); // raw message stays in the console
    expect(loadOlder()).toBeEnabled();
    expect(screen.getByRole("log")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText(OLDER_FAILED)).not.toBeInTheDocument();

    await user.click(loadOlder());
    expect(messages.api.list).toHaveBeenCalledTimes(3);
  });

  it("says a failed check retries automatically when there is no backlog", async () => {
    const { messages, tick } = await openPolling();
    tick();
    messages.listAfter[1].reject(new Error("offline"));
    await settle();

    expect(screen.getByText(NEWER_FAILED)).toBeInTheDocument();
  });

  it("points at Load more messages when a backlog fetch fails", async () => {
    const { messages, user } = await openWithBacklog();
    await user.click(screen.getByRole("button", { name: "Load more messages" }));
    messages.listAfter[2].reject(new Error("offline"));
    await settle();

    expect(screen.getByText(NEWER_FAILED_BACKLOG)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Load more messages" })).toBeEnabled();
  });

  it("warns once per error object, not once per render", async () => {
    const { messages, tick, user, text } = await openPolling();
    tick();
    messages.listAfter[1].reject(new Error("offline"));
    await settle();

    await user.type(text(), "re-render"); // the same error object through many renders

    expect(console.warn).toHaveBeenCalledTimes(1);
  });
});

describe("RoomPanel backlog", () => {
  it("shows the notice, loads the next page under a hold and shows the pill", async () => {
    const { messages, user } = await openWithBacklog();
    expect(screen.getByText("More messages are available")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Load more messages" }));
    expect(messages.api.listAfter).toHaveBeenLastCalledWith(ROOM, id(3));
    expect(screen.getByRole("button", { name: "Load more messages" })).toBeDisabled();
    messages.listAfter[2].resolve(catchUp([msg(4)], id(4)));
    await settle();

    expect(within(screen.getByRole("log")).getByText("message 4")).toBeInTheDocument();
    expect(screen.queryByText("More messages are available")).not.toBeInTheDocument();
    // jsdom has no layout, so the reader counts as "at the bottom": only the hold explains a pill.
    expect(screen.getByRole("button", { name: "New messages" })).toBeInTheDocument();
  });

  it("shows no pill when an automatic poll brings the same kind of row", async () => {
    const { messages, tick } = await openPolling();
    tick();
    messages.listAfter[1].resolve(catchUp([msg(3)], id(3)));
    await settle();

    expect(within(screen.getByRole("log")).getByText("message 3")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New messages" })).not.toBeInTheDocument();
  });

  it("disables Load more messages during an older fetch, without its spinner", async () => {
    const { user } = await openWithBacklog();
    await user.click(screen.getByRole("button", { name: "Load older" }));

    const loadMore = screen.getByRole("button", { name: "Load more messages" });
    expect(loadMore).toBeDisabled();
    expect(loadMore.querySelector("svg")).toBeNull();
  });
});

describe("RoomPanel submit", () => {
  it("appends the sent message once, clears the draft, and a later poll does not duplicate it", async () => {
    const { messages, user, author, text, send, tick } = await openPolling();
    await user.type(author(), "ann");
    await user.type(text(), "hello");

    await user.click(send());
    expect(messages.api.post).toHaveBeenCalledWith(ROOM, { author: "ann", text: "hello" });
    messages.post[0].resolve(msg(3, { author: "ann", text: "hello" }));
    await settle();

    const log = screen.getByRole("log");
    expect(within(log).getAllByText("hello")).toHaveLength(1);
    expect(text()).toHaveValue("");
    expect(author()).toHaveValue("ann");

    tick();
    messages.listAfter[1].resolve(catchUp([msg(3, { author: "ann", text: "hello" })], id(3)));
    await settle();
    expect(within(log).getAllByText("hello")).toHaveLength(1);
  });

  it("turns FeedNotReadyError into a form-level message and keeps the draft", async () => {
    const { messages, user, author, text, send } = await openPolling();
    await user.type(author(), "ann");
    await user.type(text(), "hello");

    await user.click(send());
    // The store rethrows a POST rejection unchanged, so this reaches the panel's
    // adapter exactly as the store's own readiness rejection does.
    messages.post[0].reject(new FeedNotReadyError());
    await settle();

    expect(screen.getByText("Wait for the room to load, or reopen it if loading failed.")).toBeInTheDocument();
    expect(screen.queryByText(SUBMIT_FAILED_MESSAGE)).not.toBeInTheDocument();
    expect(text()).toHaveValue("hello");
    expect(localStorage.getItem(DISPLAY_NAME_KEY)).toBeNull();
  });

  it("lets ComposeForm map an API validation error to its field", async () => {
    const { messages, user, author, text, send } = await openPolling();
    await user.type(author(), "ann");
    await user.type(text(), "hello");

    await user.click(send());
    messages.post[0].reject(
      new ApiValidationError([{ path: "text", message: "must be between 1 and 3000 characters" }]),
    );
    await settle();

    expect(screen.getByText("Message must be between 1 and 3000 characters")).toBeInTheDocument();
    expect(text()).toHaveValue("hello");
  });

  it("shows the uncertain-write warning when the request itself fails", async () => {
    const { messages, user, author, text, send } = await openPolling();
    await user.type(author(), "ann");
    await user.type(text(), "hello");

    await user.click(send());
    messages.post[0].reject(new TypeError("Failed to fetch"));
    await settle();

    await waitFor(() => expect(screen.getByText(SUBMIT_FAILED_MESSAGE)).toBeInTheDocument());
    expect(text()).toHaveValue("hello");
  });
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `pnpm test src/components/room/RoomPanel.test.tsx`
Expected: FAIL with `Failed to resolve import "@/components/room/RoomPanel"`.

- [ ] **Step 5: Create the backlog notice**

Create `src/components/room/BacklogNotice.tsx`:

```tsx
import { FaSpinner } from "react-icons/fa";

import { Button } from "@/components/ui/button";

export type BacklogNoticeProps = { disabled: boolean; busy: boolean; onLoadMore(): void };

/** Shown above the compose form while a catch-up page said more rows exist (PRD 4 "History"). */
export function BacklogNotice({ disabled, busy, onLoadMore }: BacklogNoticeProps) {
  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <p className="text-muted-foreground">More messages are available</p>
      <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={onLoadMore}>
        {busy ? <FaSpinner aria-hidden className="animate-spin" /> : null}
        Load more messages
      </Button>
    </div>
  );
}
```

- [ ] **Step 6: Implement the panel**

Create `src/components/room/RoomPanel.tsx`:

```tsx
"use client";

import { useEffect, useRef } from "react";
import { FaSpinner, FaTimes } from "react-icons/fa";

import { ComposeForm } from "@/components/compose/ComposeForm";
import { PanelFrame } from "@/components/panel/PanelFrame";
import { BacklogNotice } from "@/components/room/BacklogNotice";
import { MessageList, type MessageListHandle } from "@/components/room/MessageList";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ApiValidationError } from "@/lib/api/client";
import { FeedNotReadyError, type FeedDeps } from "@/lib/feed/store";
import type { FeedError } from "@/lib/feed/types";
import { useRoomFeed } from "@/lib/feed/useRoomFeed";
import type { Prefill } from "@/lib/page/selection";
import type { PostMessageInput } from "@/lib/schemas/message";
import type { Message, Room } from "@/lib/schemas/types";
import { useDisplayName } from "@/lib/storage/useDisplayName";

export type RoomPanelProps = {
  room: Room;
  /** First message of a room this visitor just created. */
  seed?: Message;
  /** Unsent draft from a 409 hand-off (chunk 10). */
  prefill?: Prefill;
  onClose(): void;
  /** Tests inject a fake api, subscribe, config and timers. */
  feedDeps?: Partial<FeedDeps>;
};

export const ROOM_GONE_HINT = "This room no longer exists.";
export const LOAD_FAILED_HINT = "Couldn't load this room. Close it and open it again.";
export const OLDER_FAILED = "Couldn't load older messages. Try again.";
export const NEWER_FAILED = "Couldn't check for new messages. Retrying automatically.";
export const NEWER_FAILED_BACKLOG = "Couldn't check for new messages. Use Load more messages to retry.";

/**
 * A fixed 64 px message field that scrolls inside itself (room-panel design
 * §4.1), so a long draft never pushes Send or the list out of the panel.
 */
const TEXTAREA_CLASS = "field-sizing-fixed h-16 resize-none overflow-y-auto";

function fetchAlertText(error: FeedError, backlog: boolean): string {
  if (error.op === "older") return OLDER_FAILED;
  return backlog ? NEWER_FAILED_BACKLOG : NEWER_FAILED;
}

/**
 * An open room (room-panel design §4): the feed hook, the panel frame, the
 * message list and the footer. Keyed by room id in `MapShell`, so another room
 * remounts it and resets the feed, the drafts and every scroll request.
 */
export function RoomPanel({ room, seed, prefill, onClose, feedDeps }: RoomPanelProps) {
  const feed = useRoomFeed(room.id, { seed, deps: feedDeps });
  const [name] = useDisplayName();
  const listRef = useRef<MessageListHandle>(null);

  // The visitor sees fixed copy; the raw message goes to the console, once per error object.
  const { error } = feed;
  const logged = useRef<FeedError | null>(null);
  useEffect(() => {
    if (error === null || logged.current === error) return;
    logged.current = error;
    console.warn(`Room ${room.id}: ${error.op} fetch failed: ${error.message}`);
  }, [error, room.id]);

  async function submit(input: PostMessageInput): Promise<void> {
    try {
      const message = await feed.send(input);
      listRef.current?.scrollToBottom(message.id); // applied once this row has committed
    } catch (failure) {
      if (failure instanceof FeedNotReadyError) {
        // Known no-write failure: a form-level message, drafts kept, no uncertain-write warning.
        throw new ApiValidationError([{ path: "", message: failure.message }]);
      }
      throw failure; // ComposeForm maps API errors itself
    }
  }

  async function loadMore() {
    // The hold belongs to this request: it ends when this call's completion settles.
    const finish = listRef.current?.holdPosition();
    try {
      await feed.loadNewer();
    } finally {
      finish?.();
    }
  }

  const gone = error?.notFound === true;
  const failedToOpen = !gone && error?.op === "initial";
  const fetchAlert = feed.ready && error !== null && error.op !== "initial" ? error : null;

  let body;
  if (gone) body = <p className="text-muted-foreground">{ROOM_GONE_HINT}</p>;
  else if (failedToOpen) body = <p className="text-muted-foreground">{LOAD_FAILED_HINT}</p>;
  else if (!feed.ready) {
    body = (
      <p role="status" className="flex items-center justify-center gap-2 py-6 text-muted-foreground">
        <FaSpinner aria-hidden className="animate-spin" />
        Loading messages…
      </p>
    );
  } else {
    body = (
      <MessageList
        ref={listRef}
        messages={feed.messages}
        hasOlder={feed.hasOlder}
        loading={feed.loading}
        onLoadOlder={feed.loadOlder}
      />
    );
  }

  return (
    <div data-connection={feed.connection} className="flex min-h-0 w-full flex-col">
      <PanelFrame
        title={room.name}
        onClose={onClose}
        footer={
          <div className="flex w-full flex-col gap-2">
            {fetchAlert ? (
              <Alert className="has-data-[slot=alert-action]:pr-10">
                <AlertDescription>{fetchAlertText(fetchAlert, feed.backlog)}</AlertDescription>
                <AlertAction>
                  <Button variant="ghost" size="icon-xs" aria-label="Dismiss" onClick={feed.dismissError}>
                    <FaTimes aria-hidden />
                  </Button>
                </AlertAction>
              </Alert>
            ) : null}
            {feed.ready && feed.backlog ? (
              <BacklogNotice
                disabled={feed.loading !== null}
                busy={feed.loading === "newer"}
                onLoadMore={() => void loadMore()}
              />
            ) : null}
            <ComposeForm
              submitLabel="Send"
              disabled={!feed.ready}
              initialAuthor={prefill?.author ?? name}
              initialText={prefill?.text}
              textareaClassName={TEXTAREA_CLASS}
              onSubmit={submit}
            />
          </div>
        }
      >
        {body}
      </PanelFrame>
    </div>
  );
}
```

Points that are easy to get wrong:
- `ComposeForm` is always the third child of the footer column, behind two conditional slots, so it never remounts and drafts survive loading, failure and notices.
- The two hints have no dismiss control and the panel never calls `dismissError` for them. `disabled={!feed.ready}` covers every non-ready row of the state table.
- `loadMore` starts the hold **before** calling `feed.loadNewer()` and finishes it in `finally`. Do not watch `feed.loading` to decide when the batch is done.
- `submit` must rethrow. Swallowing the error would resolve the form's promise and clear the draft.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm test src/components/room/RoomPanel.test.tsx`
Expected: PASS, 18 tests.

- [ ] **Step 8: Run the whole suite, lint and typecheck**

Run: `pnpm test && pnpm lint && pnpm typecheck`
Expected: 36 files / 689 tests passing (with Tasks 1–7 done); lint and typecheck clean.

- [ ] **Step 9: Commit**

```bash
git add src/components/ui/alert.tsx src/components/room/BacklogNotice.tsx src/components/room/RoomPanel.tsx src/components/room/RoomPanel.test.tsx src/lib/feed/test-helpers.ts
git commit -m "feat(room): add the room panel with its loading, error and backlog surfaces"
```

---

### Task 9: `MapShell` renders the room panel

**Files:**
- Create: `src/components/panel/PanelSlot.tsx`
- Modify: `src/components/map/MapShell.tsx`
- Test: `src/components/map/MapShell.test.tsx` (modify)

**Interfaces:**
- Consumes: `RoomPanel` and `RoomPanelProps` (Task 8); `Selection` with `seed` (Task 6).
- Produces: `PanelSlot({ children })`, the absolutely positioned top-right slot (`w-96`, `max-h-[calc(100dvh-2rem)]`, flex column). `MapShell` renders `<RoomPanel key={selection.room.id} room={selection.room} seed={selection.seed} prefill={selection.prefill} onClose={close} />` for a room selection. Task 13's fixtures reuse `PanelSlot`.

- [ ] **Step 1: Replace the MapShell tests**

The room placeholder goes away, so its assertions change, and the real panel now mounts inside the shell: its hook would read the environment and call `fetch`. The test file therefore mocks `@/lib/config/client` and the `api` export of `@/lib/api/client` (requests never settle). Replace `src/components/map/MapShell.test.tsx` with:

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MapShell, pinsToRender } from "@/components/map/MapShell";
import type { MapViewProps } from "@/components/map/MapView";
import type { RoomPins } from "@/lib/map/useRoomPins";
import type { Selection } from "@/lib/page/selection";
import type { Message, Room } from "@/lib/schemas/types";

const fakePins = vi.hoisted(() => ({ current: null as RoomPins | null }));

vi.mock("@/lib/map/useRoomPins", () => ({
  useRoomPins: () => {
    if (fakePins.current === null) throw new Error("test did not set fakePins");
    return fakePins.current;
  },
}));

// The room panel runs its real feed hook. Its browser defaults are replaced:
// a fixed config, and a messages API whose requests never settle.
const fakeMessages = vi.hoisted(() => ({
  list: vi.fn(() => new Promise<never>(() => {})),
  listAfter: vi.fn(() => new Promise<never>(() => {})),
  post: vi.fn(() => new Promise<never>(() => {})),
}));

vi.mock("@/lib/config/client", () => ({
  getClientConfig: () => ({
    supabaseUrl: "http://127.0.0.1:55021",
    supabaseAnonKey: "anon",
    pollIntervalMs: 30_000,
    realtimeIdleTimeoutMs: 180_000,
  }),
}));

vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  api: { rooms: {}, messages: fakeMessages },
}));

// The map bundle never loads in tests: `next/dynamic` returns a fake MapView
// that renders the pins as buttons and exposes the three callbacks.
vi.mock("next/dynamic", () => ({
  default: () =>
    function FakeMapView(props: MapViewProps) {
      return (
        <div data-testid="map">
          {props.rooms.map((room) => (
            <button
              key={room.id}
              type="button"
              data-testid="pin"
              data-selected={String(room.id === props.selectedRoomId)}
              onClick={() => props.onPinClick(room)}
            >
              {room.name}
            </button>
          ))}
          {props.draft ? (
            <span data-testid="draft">
              {props.draft.lat},{props.draft.lng}
            </span>
          ) : null}
          <button
            type="button"
            data-testid="empty"
            onClick={() => props.onEmptyClick({ lat: 46.5, lng: 23.5 })}
          >
            empty
          </button>
          <button
            type="button"
            data-testid="move"
            onClick={() => props.onViewportChange({ west: 1, south: 2, east: 3, north: 4 })}
          >
            move
          </button>
        </div>
      );
    },
}));

const roomA: Room = {
  id: "00000000-0000-4000-8000-00000000000a",
  name: "brave-crimson-otter",
  lat: 46.7712,
  lng: 23.6236,
  createdAt: "2026-09-16T15:00:00.000000Z",
};
const roomB: Room = { ...roomA, id: "00000000-0000-4000-8000-00000000000b", name: "calm-amber-heron" };

function pinsWith(overrides: Partial<RoomPins> = {}): RoomPins {
  return {
    rooms: [],
    truncated: false,
    status: "ready",
    setViewport: vi.fn(),
    refresh: vi.fn(),
    insertRoom: vi.fn(),
    ...overrides,
  };
}

function renderShell(pins: RoomPins = pinsWith(), initialSelection: Selection = { kind: "none" }) {
  fakePins.current = pins;
  return render(
    <MapShell initialSelection={initialSelection} initialCenter={{ lat: 0, lng: 0 }} initialZoom={2} />,
  );
}

const greeting = () => screen.queryByText("Click on the map to start a chat");
const closeButton = () => screen.queryByRole("button", { name: "Close" });

afterEach(() => {
  cleanup();
  fakePins.current = null;
  vi.clearAllMocks();
});

describe("pinsToRender", () => {
  it("returns the fetched rooms unchanged when nothing or a draft is selected", () => {
    const rooms = [roomA];

    expect(pinsToRender(rooms, { kind: "none" })).toBe(rooms);
    expect(pinsToRender(rooms, { kind: "draft", lat: 1, lng: 2 })).toBe(rooms);
  });

  it("returns the fetched rooms unchanged when the selected room is among them", () => {
    const rooms = [roomA, roomB];

    expect(pinsToRender(rooms, { kind: "room", room: roomB })).toBe(rooms);
  });

  it("appends the selected room when the fetched rooms omit it", () => {
    expect(pinsToRender([roomA], { kind: "room", room: roomB })).toEqual([roomA, roomB]);
  });
});

describe("MapShell", () => {
  it("shows the greeting first, with no close button", () => {
    renderShell();

    expect(greeting()).toBeTruthy();
    expect(closeButton()).toBeNull();
  });

  it("forwards viewport changes to the pins hook", () => {
    const pins = pinsWith();
    renderShell(pins);

    fireEvent.click(screen.getByTestId("move"));

    expect(pins.setViewport).toHaveBeenCalledWith({ west: 1, south: 2, east: 3, north: 4 });
  });

  it("shows the New chatroom placeholder with the coordinates after an empty click", () => {
    renderShell();

    fireEvent.click(screen.getByTestId("empty"));

    expect(screen.getByText("New chatroom")).toBeTruthy();
    expect(screen.getByText("46.500000, 23.500000")).toBeTruthy();
    expect(screen.getByTestId("draft").textContent).toBe("46.5,23.5");
    expect(greeting()).toBeNull();
  });

  it("opens the room panel and marks the pin selected after a pin click", () => {
    renderShell(pinsWith({ rooms: [roomA, roomB] }));

    fireEvent.click(screen.getByRole("button", { name: roomB.name }));

    expect(screen.getByRole("status").textContent).toContain("Loading messages…");
    expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();
    expect(fakeMessages.list).toHaveBeenCalledWith(roomB.id);
    expect(screen.getAllByText(roomB.name)).toHaveLength(2); // pin and panel title
    expect(screen.getByRole("button", { name: roomB.name }).getAttribute("data-selected")).toBe("true");
    expect(screen.getByRole("button", { name: roomA.name }).getAttribute("data-selected")).toBe("false");
    expect(screen.queryByTestId("draft")).toBeNull();
  });

  it("remounts the panel with a fresh feed when another pin is clicked", () => {
    renderShell(pinsWith({ rooms: [roomA, roomB] }));

    fireEvent.click(screen.getByRole("button", { name: roomA.name }));
    fireEvent.click(screen.getByRole("button", { name: roomB.name }));

    expect(fakeMessages.list.mock.calls).toEqual([[roomA.id], [roomB.id]]);
  });

  it("shows the seed of a freshly created room without a history request", () => {
    const seed: Message = {
      id: "00000000-0000-4000-8000-0000000000f1",
      chatroomId: roomA.id,
      author: "ana",
      text: "first message here",
      createdAt: "2026-09-16T15:00:00.000000Z",
    };
    renderShell(pinsWith({ rooms: [roomA] }), { kind: "room", room: roomA, seed });

    expect(screen.getByRole("log").textContent).toContain("first message here");
    expect(fakeMessages.list).not.toHaveBeenCalled();
  });

  it("passes a prefill to the panel's form", () => {
    renderShell(pinsWith({ rooms: [roomA] }), {
      kind: "room",
      room: roomA,
      prefill: { author: "ana", text: "unsent draft" },
    });

    expect((screen.getByLabelText("Message") as HTMLTextAreaElement).value).toBe("unsent draft");
  });

  it("unmounts the panel and returns to the greeting after close", () => {
    renderShell(pinsWith({ rooms: [roomA] }));
    fireEvent.click(screen.getByRole("button", { name: roomA.name }));

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(greeting()).toBeTruthy();
    expect(closeButton()).toBeNull();
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
  });

  it("replaces an open room with the new-room form on an empty click", () => {
    renderShell(pinsWith({ rooms: [roomA] }));
    fireEvent.click(screen.getByRole("button", { name: roomA.name }));

    fireEvent.click(screen.getByTestId("empty"));

    expect(screen.getByText("New chatroom")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
  });

  it("passes a pin for a selected room that the fetched rooms omit", () => {
    renderShell(pinsWith({ rooms: [roomA] }), { kind: "room", room: roomB });

    const pins = screen.getAllByTestId("pin");
    expect(pins.map((pin) => pin.textContent)).toEqual([roomA.name, roomB.name]);
    expect(pins[1].getAttribute("data-selected")).toBe("true");
  });

  it("shows no status pill when pins are fine", () => {
    renderShell();

    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows the truncation pill, which wins over a failed refresh", () => {
    renderShell(pinsWith({ truncated: true, status: "error" }));

    expect(screen.getByRole("status").textContent).toBe("Zoom in to see more rooms");
  });

  it("shows the refresh failure pill", () => {
    renderShell(pinsWith({ status: "error" }));

    expect(screen.getByRole("status").textContent).toBe("Couldn't refresh rooms");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test src/components/map/MapShell.test.tsx`
Expected: 4 failed, 12 passed. "opens the room panel…", "remounts the panel…", "shows the seed…" and "passes a prefill…" fail because the shell still renders "Room panel arrives in chunk 9."; the close and replace tests already pass against the placeholder.

- [ ] **Step 3: Extract the panel slot**

Create `src/components/panel/PanelSlot.tsx`:

```tsx
import type { ReactNode } from "react";

/**
 * Where the one floating panel sits on the map page (map-shell design §3):
 * top right, 24rem wide, never taller than the viewport minus its margins.
 * A flex column, so the panel inside can shrink and scroll its own body.
 */
export function PanelSlot({ children }: { children: ReactNode }) {
  return (
    <div className="absolute top-4 right-4 z-10 flex max-h-[calc(100dvh-2rem)] w-96 flex-col">
      {children}
    </div>
  );
}
```

- [ ] **Step 4: Wire the room panel**

Replace `src/components/map/MapShell.tsx` with:

```tsx
"use client";

import dynamic from "next/dynamic";
import { useCallback, useMemo, useReducer } from "react";

import { MapStatus } from "@/components/map/MapStatus";
import type { MapViewProps } from "@/components/map/MapView";
import { PanelFrame } from "@/components/panel/PanelFrame";
import { PanelSlot } from "@/components/panel/PanelSlot";
import { WelcomeCard } from "@/components/panel/WelcomeCard";
import { RoomPanel } from "@/components/room/RoomPanel";
import { useRoomPins } from "@/lib/map/useRoomPins";
import type { LatLng } from "@/lib/map/viewport";
import { type Selection, selectionReducer } from "@/lib/page/selection";
import type { Room } from "@/lib/schemas/types";

// Leaflet touches `window` at import time, so the map is a client-only bundle.
// The neutral placeholder keeps the panel slot positioned before it arrives.
const MapView = dynamic<MapViewProps>(() => import("@/components/map/MapView"), {
  ssr: false,
  loading: () => <div className="h-full w-full bg-muted" />,
});

export type MapShellProps = {
  initialSelection: Selection;
  initialCenter: LatLng;
  initialZoom: number;
};

/** The fetched rooms plus the selected room when the capped response omits it (spec §5.3, PRD 4). */
export function pinsToRender(rooms: Room[], selection: Selection): Room[] {
  if (selection.kind !== "room") return rooms;
  const selectedId = selection.room.id;
  return rooms.some((room) => room.id === selectedId) ? rooms : [...rooms, selection.room];
}

/**
 * The map page (spec §3): owns the selection and the pins, renders the map,
 * the status pill and the one floating panel. The panel and the pill are
 * siblings of the Leaflet container, so their pointer events never reach the
 * map and Leaflet's own z-indexes stay scoped to its container.
 */
export function MapShell({ initialSelection, initialCenter, initialZoom }: MapShellProps) {
  const [selection, dispatch] = useReducer(selectionReducer, initialSelection);
  const pins = useRoomPins();
  const rooms = useMemo(() => pinsToRender(pins.rooms, selection), [pins.rooms, selection]);

  const onEmptyClick = useCallback(
    (point: LatLng) => dispatch({ type: "clickEmpty", lat: point.lat, lng: point.lng }),
    [],
  );
  const onPinClick = useCallback((room: Room) => dispatch({ type: "clickPin", room }), []);
  const close = useCallback(() => dispatch({ type: "close" }), []);

  return (
    <div className="relative h-dvh w-full overflow-hidden">
      <div className="absolute inset-0 z-0">
        <MapView
          center={initialCenter}
          zoom={initialZoom}
          rooms={rooms}
          selectedRoomId={selection.kind === "room" ? selection.room.id : undefined}
          draft={selection.kind === "draft" ? { lat: selection.lat, lng: selection.lng } : undefined}
          onViewportChange={pins.setViewport}
          onEmptyClick={onEmptyClick}
          onPinClick={onPinClick}
        />
      </div>
      <MapStatus truncated={pins.truncated} refreshFailed={pins.status === "error"} />
      <PanelSlot>
        {selection.kind === "none" ? <WelcomeCard /> : null}
        {selection.kind === "draft" ? (
          // Chunk 10 replaces the body and footer with NewRoomPopup.
          <PanelFrame title="New chatroom" onClose={close}>
            <p className="text-muted-foreground">
              {selection.lat.toFixed(6)}, {selection.lng.toFixed(6)}
            </p>
          </PanelFrame>
        ) : null}
        {selection.kind === "room" ? (
          // Keyed by room id so selecting another room remounts the panel and resets its feed.
          <RoomPanel
            key={selection.room.id}
            room={selection.room}
            seed={selection.seed}
            prefill={selection.prefill}
            onClose={close}
          />
        ) : null}
      </PanelSlot>
    </div>
  );
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm test src/components/map/MapShell.test.tsx`
Expected: PASS, 16 tests.

- [ ] **Step 6: Run the whole suite, lint and typecheck**

Run: `pnpm test && pnpm lint && pnpm typecheck`
Expected: 36 files / 692 tests passing (with Tasks 1–8 done); lint and typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add src/components/panel/PanelSlot.tsx src/components/map/MapShell.tsx src/components/map/MapShell.test.tsx
git commit -m "feat(map): open the room panel from a room selection"
```

---

### Task 10: Keyboard-operable pins

Leaflet 1.9.4 makes markers focusable (`tabindex="0"`, `role="button"`) but only opens popups on Enter; a plain marker ignores the keyboard (reconciliation item 2). The e2e helper `openRoom` focuses a pin and presses Enter, so this fix precedes the harness.

**Files:**
- Modify: `src/components/map/RoomPins.tsx`, `docs/superpowers/specs/2026-09-16-map-shell-design.md` (§7, one sentence)
- Test: `src/components/map/RoomPins.test.tsx` (modify)

**Interfaces:**
- Consumes: `LeafletKeyboardEvent` (`{ originalEvent: KeyboardEvent }`) from `leaflet`. Leaflet forwards `keydown` from a focused marker icon to the marker's `eventHandlers`.
- Produces: no API change. `RoomPinsProps` is unchanged; Enter or Space on a focused pin calls `onPinClick(room)`.

- [ ] **Step 1: Let the fake marker forward key presses, and add the failing tests**

In `src/components/map/RoomPins.test.tsx` make three edits.

Replace the `eventHandlers` member of `FakeMarkerProps`:

```ts
  eventHandlers?: {
    click?: () => void;
    keydown?: (event: { originalEvent: KeyboardEvent }) => void;
  };
```

On the fake `<button>`, directly after the `onClick` line:

```tsx
        onKeyDown={(event) => eventHandlers?.keydown?.({ originalEvent: event.nativeEvent })}
```

Insert these tests directly before `it("keeps position and eventHandlers references stable across re-renders", …)`:

```tsx
  it.each(["Enter", " "])("opens the room on the %j key, as a button would", (key) => {
    const onPinClick = vi.fn();
    render(<RoomPins rooms={[roomA, roomB]} onPinClick={onPinClick} />);

    fireEvent.keyDown(screen.getAllByTestId("marker")[1], { key });

    expect(onPinClick).toHaveBeenCalledTimes(1);
    expect(onPinClick).toHaveBeenCalledWith(roomB);
  });

  it("ignores other keys", () => {
    const onPinClick = vi.fn();
    render(<RoomPins rooms={[roomA]} onPinClick={onPinClick} />);

    fireEvent.keyDown(screen.getByTestId("marker"), { key: "Tab" });

    expect(onPinClick).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test src/components/map/RoomPins.test.tsx`
Expected: FAIL in the two "opens the room on the … key" cases (`onPinClick` was called 0 times); "ignores other keys" and the five existing tests pass.

- [ ] **Step 3: Handle Enter and Space**

Replace `src/components/map/RoomPins.tsx` with:

```tsx
"use client";

import type { LeafletKeyboardEvent } from "leaflet";
import { memo, useMemo } from "react";
import { Marker } from "react-leaflet";

import { pinIcon } from "@/components/map/pinIcon";
import type { Room } from "@/lib/schemas/types";

export type RoomPinsProps = {
  rooms: Room[];
  selectedRoomId?: string;
  onPinClick(room: Room): void;
};

/**
 * One marker per room (spec §7). `title` gives the native tooltip. Leaflet
 * makes markers focusable with `role="button"` but only opens popups on Enter,
 * so Enter and Space are handled here. Marker clicks do not bubble to the map,
 * so they never place a draft pin.
 */
export function RoomPins({ rooms, selectedRoomId, onPinClick }: RoomPinsProps) {
  return (
    <>
      {rooms.map((room) => (
        <RoomPin
          key={room.id}
          room={room}
          selected={room.id === selectedRoomId}
          onPinClick={onPinClick}
        />
      ))}
    </>
  );
}

/**
 * Internal marker component. Position and event handlers are memoised per room
 * to prevent unnecessary re-renders and handler rebinding when other rooms' pins change.
 */
const RoomPin = memo(function RoomPin({
  room,
  selected,
  onPinClick,
}: {
  room: Room;
  selected: boolean;
  onPinClick(room: Room): void;
}) {
  const position = useMemo<[number, number]>(
    () => [room.lat, room.lng],
    [room.lat, room.lng]
  );

  const eventHandlers = useMemo(
    () => ({
      click: () => onPinClick(room),
      keydown: (event: LeafletKeyboardEvent) => {
        const { key } = event.originalEvent;
        if (key === "Enter" || key === " ") onPinClick(room);
      },
    }),
    [room, onPinClick]
  );

  return (
    <Marker
      position={position}
      icon={pinIcon(selected ? "selected" : "room")}
      title={room.name}
      eventHandlers={eventHandlers}
    />
  );
});
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test src/components/map/RoomPins.test.tsx`
Expected: PASS, 8 tests. The reference-stability test still passes: the handlers object is memoized on `[room, onPinClick]` as before.

- [ ] **Step 5: Correct the design sentence**

In `docs/superpowers/specs/2026-09-16-map-shell-design.md` §7, replace

```
  native tooltip, `eventHandlers={{ click: () => onPinClick(room) }}`. Leaflet markers are
  keyboard focusable and Enter triggers click.
```

with

```
  native tooltip, and `eventHandlers` for `click` and `keydown`. Leaflet markers are keyboard
  focusable (`role="button"`), but Leaflet only opens popups on Enter, so `RoomPins` calls
  `onPinClick` itself for Enter and Space (corrected in chunk 9).
```

- [ ] **Step 6: Lint, typecheck and commit**

Run: `pnpm test && pnpm lint && pnpm typecheck`
Expected: 36 files / 695 tests passing (with Tasks 1–9 done); clean.

```bash
git add src/components/map/RoomPins.tsx src/components/map/RoomPins.test.tsx docs/superpowers/specs/2026-09-16-map-shell-design.md
git commit -m "fix(map): open a room with Enter or Space on its focused pin"
```

---

### Task 11: Playwright harness

**Files:**
- Create: `playwright.config.ts`, `tests/e2e/helpers.ts`, `tests/e2e/harness.spec.ts`, `src/app/e2e/roomRegion.ts`, `src/app/e2e/map-region/page.dev.tsx`, `src/app/e2e/map-region/MapRegionFixture.tsx`
- Modify: `package.json` (devDependency, script), `pnpm-lock.yaml`, `.gitignore`, `next.config.ts`

**Interfaces:**
- Consumes: the running app: `POST /api/rooms` → `201 { room, message }` or `409 { error: { code: "conflict", room } }`; `POST /api/rooms/:id/messages` → `201 { message }`; `GET /api/health` → 200 when the stack is reachable; pins with `title = room.name` that open on Enter (Task 10); the panel's `role="log"` list with `article` rows (Tasks 5, 8, 9).
- Produces (`tests/e2e/helpers.ts`): `type Room`, `type Message`, `POLL_INTERVAL_MS = 30_000`, `ROOM_REGION`, `createRoom(request, first?)` → `{ room, message }`, `postMessage(request, roomId, input)` → `Message`, `postMessages(request, roomId, count, { prefix?, from? })` → `Message[]`, `roomWithMessages(request, total)` → `Room`, `openRoom(page, room)` and `openPollingRoom(page, room)` → the log `Locator`, `pollNow(page)`, `expectNoCatchUp(page)`, `rows(log)`, `distanceFromBottom(log)`, `scrollTopOf(log)`, `scrollListTo(log, top)`, `topOf(row)`, `pill(page)`, `fillCompose(page, author, text)`.

- [ ] **Step 1: Install Playwright and Chromium**

```bash
pnpm add -D @playwright/test
pnpm exec playwright install chromium
```

Expected: `@playwright/test` appears under `devDependencies` (the prototype ran on 1.62.0; any 1.45+ has the `page.clock` API this suite needs). The second command downloads Chromium into the user cache, outside the repository.

- [ ] **Step 2: Add the script and the ignore rules**

In `package.json`, add to `"scripts"` after `"test:api"`:

```json
    "test:e2e": "playwright test"
```

(add the comma the previous line now needs). Append to `.gitignore`:

```
# playwright
/test-results/
/playwright-report/
```

- [ ] **Step 3: Create the Playwright configuration**

Create `playwright.config.ts`:

```ts
import { defineConfig, devices } from "@playwright/test";

// The Supbuddy mapping of this project's dev server. Override for CI or another port.
const baseURL = process.env.E2E_BASE_URL ?? "https://map-chat.map-chat.test";

/**
 * End-to-end tests (room-panel design §8): real layout, real scrolling and the
 * full HTTP path, against the dev server and the local Supabase stack.
 * Run with `pnpm test:e2e`; not part of `pnpm test`.
 */
export default defineConfig({
  testDir: "tests/e2e",
  // Every test creates its own room, so files and tests may run in parallel.
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  reporter: "list",
  timeout: process.env.E2E_SLOW_SETUP === "1" ? 120_000 : 60_000,
  use: {
    baseURL,
    ignoreHTTPSErrors: true, // the Supbuddy certificate is local
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      // The explicit viewport comes last, so a device preset can never change it.
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 720 } },
    },
  ],
  webServer: {
    // Next 16 allows one dev server per project directory: a running one is reused.
    command: "pnpm dev",
    url: `${baseURL}/api/health`,
    ignoreHTTPSErrors: true,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
```

- [ ] **Step 4: Create the helpers**

Create `tests/e2e/helpers.ts`:

```ts
import { setTimeout as nodeDelay } from "node:timers/promises";
import { expect, type APIRequestContext, type Locator, type Page } from "@playwright/test";

import { ROOM_REGION } from "../../src/app/e2e/roomRegion";

export { ROOM_REGION };

export type Room = { id: string; name: string; lat: number; lng: number; createdAt: string };
export type Message = { id: string; chatroomId: string; author: string; text: string; createdAt: string };

export const POLL_INTERVAL_MS = 30_000;

/**
 * Rooms are created inside this box. All four corners are inside the opening
 * map view (centre 46.7712, 23.6236, zoom 2) at 1280 × 720, away from the edges.
 * Recheck the corners if the map's centre, zoom or the test viewport changes.
 */
// ROOM_REGION is shared with the dev-only bounds fixture (created in Step 5a).

const round6 = (x: number) => Math.round(x * 1e6) / 1e6;
const between = (min: number, max: number) => round6(min + Math.random() * (max - min));

/**
 * A fresh room through the real API. A coordinate conflict (409) picks new
 * coordinates, at most five times; any other failure is not retried, because
 * the write may have happened.
 */
export async function createRoom(
  request: APIRequestContext,
  first: { author: string; text: string } = { author: "e2e", text: "message 1" },
): Promise<{ room: Room; message: Message }> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await request.post("/api/rooms", {
      data: {
        lat: between(ROOM_REGION.minLat, ROOM_REGION.maxLat),
        lng: between(ROOM_REGION.minLng, ROOM_REGION.maxLng),
        ...first,
      },
    });
    if (response.status() === 409) continue;
    expect(response.status(), await response.text()).toBe(201);
    return (await response.json()) as { room: Room; message: Message };
  }
  throw new Error("createRoom: five coordinate conflicts in a row");
}

export async function postMessage(
  request: APIRequestContext,
  roomId: string,
  input: { author: string; text: string },
): Promise<Message> {
  const response = await request.post(`/api/rooms/${roomId}/messages`, { data: input });
  expect(response.status(), await response.text()).toBe(201);
  return ((await response.json()) as { message: Message }).message;
}

/** Posts one at a time, so `createdAt` order is the post order. Texts: `<prefix> <n>`. */
export async function postMessages(
  request: APIRequestContext,
  roomId: string,
  count: number,
  opts: { prefix?: string; from?: number } = {},
): Promise<Message[]> {
  const { prefix = "message", from = 1 } = opts;
  const posted: Message[] = [];
  for (let n = from; n < from + count; n += 1) {
    posted.push(await postMessage(request, roomId, { author: "e2e", text: `${prefix} ${n}` }));
  }
  return posted;
}

/** A room holding `total` messages: "message 1" (the first message) to "message <total>". */
export async function roomWithMessages(request: APIRequestContext, total: number): Promise<Room> {
  const { room } = await createRoom(request);
  await postMessages(request, room.id, total - 1, { from: 2 });
  return room;
}

/**
 * Opens a room from its pin. The marker is focused and activated with Enter
 * (map-shell design §7), so overlapping pins at world zoom cannot steal a click.
 */
export async function openRoom(page: Page, room: Room): Promise<Locator> {
  await page.goto("/");
  const marker = page.getByTitle(room.name, { exact: true });
  await marker.waitFor();
  await marker.focus();
  await page.keyboard.press("Enter");
  const log = page.getByRole("log");
  await expect(log).toBeVisible();
  return log;
}

type CatchUpProbe = { started: number; settled: number };
declare global {
  interface Window { __roomCatchUpProbe: CatchUpProbe }
}

/**
 * Installs observation only: original fetch, status, body and failures pass through.
 * The task after JSON consumption lets the API/store promise continuations drain.
 * MessageChannel is deliberately independent of the paused timer/RAF clock.
 */
async function observeCatchUps(page: Page, roomId: string) {
  await page.addInitScript((id) => {
    const probe = { started: 0, settled: 0 };
    window.__roomCatchUpProbe = probe;
    const originalFetch = window.fetch.bind(window);
    const markSettled = () => {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => {
        probe.settled += 1;
        channel.port1.close();
        channel.port2.close();
      };
      channel.port2.postMessage(null);
    };
    window.fetch = async (...args: Parameters<typeof fetch>) => {
      const input = args[0];
      const url = new URL(input instanceof Request ? input.url : String(input), location.href);
      const method = args[1]?.method ?? (input instanceof Request ? input.method : "GET");
      const watched = method.toUpperCase() === "GET" &&
        url.pathname === `/api/rooms/${id}/messages` && url.searchParams.has("after");
      if (!watched) return originalFetch(...args);
      probe.started += 1; // before the real request: even a slow response cannot hide a tick
      try {
        const response = await originalFetch(...args);
        const originalJson = response.json.bind(response);
        response.json = async () => {
          try { return await originalJson(); }
          finally { markSettled(); }
        };
        return response;
      } catch (error) {
        markSettled();
        throw error;
      }
    };
  }, roomId);
}

const probeOf = (page: Page) => page.evaluate(() => ({ ...window.__roomCatchUpProbe }));

async function waitForCatchUpIdle(page: Page, minimum: number) {
  await expect.poll(async () => {
    const probe = await probeOf(page);
    return probe.settled >= minimum && probe.started === probe.settled;
  }).toBe(true);
}

/** Opens and settles the startup catch-up, then freezes time before scenario writes. */
export async function openPollingRoom(page: Page, room: Room): Promise<Locator> {
  await observeCatchUps(page, room.id);
  await page.clock.install();
  const log = await openRoom(page, room);
  await waitForCatchUpIdle(page, 1);
  // A future instant avoids pauseAt rejecting a timestamp already passed during the tool round trip.
  // If this crosses a tick, settle that request too, while no scenario writes exist yet.
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  await waitForCatchUpIdle(page, 1);
  await page.clock.runFor(32); // render/ResizeObserver frames, not a network-completion sleep
  await waitForCatchUpIdle(page, 1);
  if (process.env.E2E_SLOW_SETUP === "1") {
    const before = await probeOf(page);
    const at = await page.evaluate(() => Date.now());
    await nodeDelay(POLL_INTERVAL_MS + 1000); // deliberate adverse setup, runner time only
    expect(await page.evaluate(() => Date.now())).toBe(at);
    expect(await probeOf(page)).toEqual(before);
  }
  return log;
}

/** One deliberate tick; wait for real JSON consumption before checking the rendered result. */
export async function pollNow(page: Page): Promise<void> {
  const before = await probeOf(page);
  expect(before.started).toBe(before.settled);
  await page.clock.fastForward(POLL_INTERVAL_MS);
  await waitForCatchUpIdle(page, before.started + 1);
  await page.clock.runFor(32);
}

/** No request may even start while backlog owns the cursor. */
export async function expectNoCatchUp(page: Page): Promise<void> {
  const before = await probeOf(page);
  expect(before.started).toBe(before.settled);
  await page.clock.fastForward(POLL_INTERVAL_MS);
  await page.clock.runFor(32);
  expect(await probeOf(page)).toEqual(before);
}

export const rows = (log: Locator) => log.getByRole("article");

/** Pixels between the list's scroll position and its bottom. */
export const distanceFromBottom = (log: Locator) =>
  log.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight);

export const scrollTopOf = (log: Locator) => log.evaluate((el) => el.scrollTop);

export async function scrollListTo(log: Locator, top: number): Promise<void> {
  await log.evaluate((el, value) => {
    el.scrollTop = value;
  }, top);
}

/** The row's top edge in page coordinates. */
export async function topOf(row: Locator): Promise<number> {
  const box = await row.boundingBox();
  if (box === null) throw new Error("row is not rendered");
  return box.y;
}

export const pill = (page: Page) => page.getByRole("button", { name: "New messages" });

export async function fillCompose(page: Page, author: string, text: string): Promise<void> {
  await page.getByLabel("Display name").fill(author);
  await page.getByLabel("Message").fill(text);
}
```

- [ ] **Step 5: Create the harness checks**

Create `tests/e2e/harness.spec.ts`. The first two checks use the real app/API. The third uses the real MapView at its production defaults and 1280 × 720; it reads projected corners from actual initial bounds, independently of the capped room list. Step 5a creates this fixture; run all three checks after it exists.

```ts
import { expect, test } from "@playwright/test";

import { ROOM_REGION, createRoom, openRoom, rows } from "./helpers";

const EDGE_MARGIN_PX = 40;

test("the dev server and the local Supabase stack answer", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.status(), await response.text()).toBe(200);
});

test("a room created through the API opens from its pin with the keyboard", async ({ page, request }) => {
  const { room, message } = await createRoom(request, { author: "e2e", text: "harness check" });

  const log = await openRoom(page, room);

  await expect(page.getByText(room.name, { exact: true })).toBeVisible();
  await expect(rows(log)).toHaveCount(1);
  await expect(log.getByText(message.text)).toBeVisible();
});

test("every corner stays inside the opening view even when its pin is omitted by the cap", async ({ page }) => {
  await page.goto("/e2e/map-region");
  const report = page.getByRole("status", { name: "Map bounds" });
  await expect(report).toContainText('"ready":true');
  const measured = JSON.parse(await report.innerText()) as {
    ready: boolean;
    candidateCount: number;
    displayedCount: number;
    cornerPinsIncluded: boolean;
    corners: { lat: number; lng: number; inside: boolean; x: number; y: number }[];
  };
  expect(page.viewportSize()).toEqual({ width: 1280, height: 720 });
  expect(measured.candidateCount).toBe(505); // 501 newer rooms plus four old corners
  expect(measured.displayedCount).toBe(500);
  expect(measured.cornerPinsIncluded).toBe(false);
  expect(measured.corners.map(({ lat, lng }) => ({ lat, lng }))).toEqual(
    [ROOM_REGION.minLat, ROOM_REGION.maxLat].flatMap((lat) =>
      [ROOM_REGION.minLng, ROOM_REGION.maxLng].map((lng) => ({ lat, lng }))),
  );
  for (const corner of measured.corners) {
    expect(corner.inside).toBe(true);
    expect(corner.x).toBeGreaterThan(EDGE_MARGIN_PX);
    expect(corner.y).toBeGreaterThan(EDGE_MARGIN_PX);
    expect(corner.x).toBeLessThan(1280 - EDGE_MARGIN_PX);
    expect(corner.y).toBeLessThan(720 - EDGE_MARGIN_PX);
  }
});

```

- [ ] **Step 5a: Add the dev-only initial-bounds fixture**

Read `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/pageExtensions.md` before changing Next configuration. Task 13 reuses this extension for its room fixtures.

Replace `next.config.ts` with:

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["map-chat.map-chat.test"],
  // `page.dev.tsx` is a route for the dev server only. A production build does
  // not list the extension, so the e2e fixtures under src/app/e2e never ship.
  pageExtensions:
    process.env.NODE_ENV === "production"
      ? ["tsx", "ts", "jsx", "js"]
      : ["tsx", "ts", "jsx", "js", "dev.tsx"],
};

export default nextConfig;
```

Create `src/app/e2e/roomRegion.ts` (browser-safe constants shared by the fixture and test helpers):

```ts
export const ROOM_REGION = { minLat: 40, maxLat: 50, minLng: 0, maxLng: 10 };
```

Create `src/app/e2e/map-region/page.dev.tsx`:

```tsx
"use client";

import dynamic from "next/dynamic";

const MapRegionFixture = dynamic(() => import("./MapRegionFixture"), { ssr: false });
export default function MapRegionPage() {
  return <MapRegionFixture />;
}
```

Create `src/app/e2e/map-region/MapRegionFixture.tsx`:

```tsx
"use client";

import { CRS, latLng } from "leaflet";
import { useState } from "react";

import { ROOM_REGION } from "@/app/e2e/roomRegion";
import MapView from "@/components/map/MapView";
import { DEFAULT_CENTER, WORLD_ZOOM } from "@/components/map/mapDefaults";
import { PIN_LIMIT, sortRoomsNewestFirst, type Viewport } from "@/lib/map/viewport";
import type { Room } from "@/lib/schemas/types";

const cornerPoints = [ROOM_REGION.minLat, ROOM_REGION.maxLat].flatMap((lat) =>
  [ROOM_REGION.minLng, ROOM_REGION.maxLng].map((lng) => ({ lat, lng })),
);
const roomId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const cornerRooms: Room[] = cornerPoints.map((point, index) => ({
  ...point, id: roomId(index + 1), name: `corner-${point.lat}-${point.lng}`,
  createdAt: "2025-01-01T00:00:00.000000Z",
}));
const newerRooms: Room[] = Array.from({ length: 501 }, (_, index) => ({
  id: roomId(index + 5), name: `newer-fixture-${index}`, lat: 45, lng: index / 50,
  createdAt: "2026-01-01T00:00:00.000000Z",
}));
const candidates = [...cornerRooms, ...newerRooms];
const rooms = sortRoomsNewestFirst(candidates).slice(0, PIN_LIMIT);
const ignore = () => {};

/** Real map geometry, synthetic capped pins; no database requests or corner-room reuse. */
export default function MapRegionFixture() {
  const [viewport, setViewport] = useState<Viewport | null>(null);
  const origin = viewport
    ? CRS.EPSG3857.latLngToPoint(latLng(viewport.north, viewport.west), WORLD_ZOOM)
    : null;
  const corners = viewport && origin ? cornerPoints.map(({ lat, lng }) => {
    const point = CRS.EPSG3857.latLngToPoint(latLng(lat, lng), WORLD_ZOOM).subtract(origin);
    return {
      lat, lng, x: point.x, y: point.y,
      inside: lat >= viewport.south && lat <= viewport.north &&
        lng >= viewport.west && lng <= viewport.east,
    };
  }) : [];
  return (
    <div className="relative h-dvh w-full overflow-hidden">
      <MapView center={DEFAULT_CENTER} zoom={WORLD_ZOOM} rooms={rooms}
        onViewportChange={setViewport} onEmptyClick={ignore} onPinClick={ignore} />
      <output role="status" aria-label="Map bounds" className="absolute top-0 left-0 z-10 max-w-full bg-background text-xs">
        {JSON.stringify({ ready: viewport !== null, candidateCount: candidates.length,
          displayedCount: rooms.length,
          cornerPinsIncluded: rooms.some((room) => cornerRooms.some((corner) => corner.id === room.id)),
          corners })}
      </output>
    </div>
  );
}
```

The callback comes from the real `MapEvents` initial `getBounds()` report. The measured points use the same EPSG:3857 projection and current opening zoom, with the actual northwest viewport bound as origin. Corners are deliberately absent from the 500 rendered pins; their geometry remains measurable. This fixture is a geometry exception to API-only data setup, like Task 13's list/layout fixtures; the HTTP opening checks continue to create fresh rooms through the API. Do not call `/api/rooms` or increase the product pin cap for this test.

Run `pnpm test:e2e tests/e2e/harness.spec.ts` after Step 6's startup check; expected `3 passed`, including the cap case. Run `pnpm build` and require no `/e2e/map-region` route. The complete production route-list check is repeated in Task 13 after its two fixtures are added.

- [ ] **Step 6: Verify the start-up path with Supbuddy**

The spec requires this before any scenario is written. With the local Supabase stack running (`pnpm db:status` prints the URLs; start it from Supbuddy if not) and **no** dev server running:

```bash
curl -sk -o /dev/null -w "%{http_code}\n" https://map-chat.map-chat.test/api/health
pnpm test:e2e tests/e2e/harness.spec.ts
```

Expected: `curl` prints `502` (mapping up, no server). Playwright then starts `pnpm dev` (`supbuddy run -- next dev`), waits for `/api/health`, and reports `3 passed`. Run the command a second time while `pnpm dev` runs in another terminal: Playwright must reuse that server and report `3 passed` again.

`supbuddy run` finds the project from the working directory, and this worktree is a different path from the registered checkout. If it does not recognise the worktree, or the web server step times out: run `pnpm dev` in a second terminal, open the `https://…` URL it prints, and make `/api/health` answer 200 first (a 503 means the stack is down or `.env.local` is stale: `pnpm db:env`). Then rerun. Do not edit resolver files or a `Caddyfile`. As a fallback that needs no Supbuddy mapping (this is what the prototype used), run `pnpm exec next dev -p 3100 -H 127.0.0.1` and `E2E_BASE_URL=http://127.0.0.1:3100 pnpm test:e2e tests/e2e/harness.spec.ts`; record in the commit message body which path you verified.

If "opens from its pin with the keyboard" fails while the other two pass, Task 10 is missing.

- [ ] **Step 7: Lint and typecheck**

Run: `pnpm test && pnpm lint && pnpm typecheck`
Expected: still 36 files / 695 tests (Vitest does not pick up `tests/e2e`); lint clean; typecheck now also covers `playwright.config.ts` and `tests/e2e/**`.

- [ ] **Step 8: Commit**

`next dev` re-adds its own block to `AGENTS.md` when it starts. If `git status` shows `AGENTS.md` (or `CLAUDE.md`) modified by it, include the file in this commit; the block itself says that committing it keeps the tree clean.

```bash
git add package.json pnpm-lock.yaml .gitignore playwright.config.ts tests/e2e/helpers.ts tests/e2e/harness.spec.ts next.config.ts src/app/e2e/roomRegion.ts src/app/e2e/map-region
git commit -m "test(e2e): add the Playwright harness, API helpers and start-up checks"
```

---

### Task 12: Room-panel scenarios over real HTTP

These tests are written after the code they exercise, so the expected first result is a pass. A failure is a product defect or a wrong assumption about layout: use superpowers:systematic-debugging, open the trace (`pnpm exec playwright show-trace <path printed in the failure>`), and fix the cause. Do not loosen an assertion or add a wait to make a scenario pass.

**Files:**
- Create: `tests/e2e/room-panel.spec.ts`

**Interfaces:**
- Consumes: everything `tests/e2e/helpers.ts` exports (Task 11); the panel's visible copy (`Load older`, `Load more messages`, `More messages are available`, `New messages`, `Send`, labels `Display name` and `Message`).
- Produces: scenarios 1–8 and the real-HTTP half of scenario 10 of the room-panel design §8. Task 13 adds scenario 9 and the second test of scenario 10 to this file.

- [ ] **Step 1: Write the scenarios**

Create `tests/e2e/room-panel.spec.ts`:

```ts
import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  createRoom,
  distanceFromBottom,
  fillCompose,
  openRoom,
  openPollingRoom,
  expectNoCatchUp,
  pill,
  pollNow,
  postMessage,
  postMessages,
  roomWithMessages,
  rows,
  scrollListTo,
  scrollTopOf,
  topOf,
} from "./helpers";

const POSITION_TOLERANCE_PX = 2;

/** The row whose message text is exactly `text` ("message 1" does not match "message 10"). */
const row = (log: Locator, text: string) =>
  rows(log).filter({ has: log.page().getByText(text, { exact: true }) });

async function expectAtBottom(log: Locator) {
  await expect.poll(() => distanceFromBottom(log)).toBeLessThanOrEqual(1);
}

async function expectSameTop(target: Locator, before: number) {
  await expect.poll(async () => Math.abs((await topOf(target)) - before)).toBeLessThanOrEqual(
    POSITION_TOLERANCE_PX,
  );
}

async function send(page: Page, author: string, text: string) {
  await fillCompose(page, author, text);
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByLabel("Message")).toHaveValue("");
}

test.describe("1. open and initial position", () => {
  test("shows author, text and time in ascending order", async ({ page, request }) => {
    const room = await roomWithMessages(request, 3);

    const log = await openRoom(page, room);

    await expect(rows(log)).toHaveCount(3);
    await expect(rows(log)).toContainText(["message 1", "message 2", "message 3"]);
    await expect(rows(log).first()).toContainText("e2e");
    await expect(rows(log).first().getByRole("time")).toHaveText(/^\d{2}:\d{2}$/);
  });

  test("opens a long room at its newest message", async ({ page, request }) => {
    const room = await roomWithMessages(request, 125);

    const log = await openRoom(page, room);

    await expect(rows(log)).toHaveCount(100);
    await expect(row(log, "message 125")).toBeInViewport();
    await expectAtBottom(log);
  });
});

test("2. Load older keeps the reader's position", async ({ page, request }) => {
  const room = await roomWithMessages(request, 125);
  const log = await openRoom(page, room);
  await expect(rows(log)).toHaveCount(100);
  const loadOlder = page.getByRole("button", { name: "Load older" });

  await scrollListTo(log, 0);
  const first = row(log, "message 26");
  const before = await topOf(first);
  await loadOlder.click();

  await expect(rows(log)).toHaveCount(120);
  await expectSameTop(first, before);
  await expect(loadOlder).toBeVisible();
  await expect(pill(page)).toBeHidden();

  await scrollListTo(log, 0);
  const second = row(log, "message 6");
  const beforeLast = await topOf(second);
  await loadOlder.click();

  await expect(rows(log)).toHaveCount(125);
  await expect(loadOlder).toBeHidden();
  await expectSameTop(second, beforeLast); // the button above it disappeared in the same commit
});

test("3. an incoming message at the bottom is followed without a pill", async ({ page, request }) => {
  const room = await roomWithMessages(request, 30);
  const log = await openPollingRoom(page, room);
  await expectAtBottom(log);

  await postMessage(request, room.id, { author: "other", text: "incoming one" });
  await pollNow(page);

  await expect(row(log, "incoming one")).toBeInViewport();
  await expectAtBottom(log);
  await expect(pill(page)).toBeHidden();
});

test("4. an incoming message while scrolled up shows the pill and keeps scrollTop", async ({ page, request }) => {
  const room = await roomWithMessages(request, 30);
  const log = await openPollingRoom(page, room);
  await scrollListTo(log, 120);
  const before = await scrollTopOf(log);

  await postMessage(request, room.id, { author: "other", text: "incoming two" });
  await pollNow(page);

  await expect(pill(page)).toBeVisible();
  expect(await scrollTopOf(log)).toBe(before);
  await expect(row(log, "incoming two")).not.toBeInViewport();

  await pill(page).click();
  await expectAtBottom(log);
  await expect(pill(page)).toBeHidden();
  await expect(row(log, "incoming two")).toBeInViewport();
});

test.describe("5. send", () => {
  test("appends once, clears the draft, keeps line breaks and remembers the name", async ({ page, request }) => {
    const room = await roomWithMessages(request, 2);
    const log = await openPollingRoom(page, room);

    await send(page, "ann", "first line\nsecond line");

    const sent = rows(log).filter({ hasText: "second line" });
    await expect(sent).toHaveCount(1);
    await expect(page.getByLabel("Display name")).toHaveValue("ann");
    const oneLine = await row(log, "message 2").getByText("message 2").boundingBox();
    const twoLines = await sent.getByText("second line").boundingBox();
    expect(twoLines!.height).toBeGreaterThan(oneLine!.height * 1.5); // pre-wrap in real layout

    await postMessage(request, room.id, { author: "other", text: "poll completion witness" });
    await pollNow(page);
    await expect(row(log, "poll completion witness")).toHaveCount(1);
    await expect(rows(log)).toHaveCount(4);
    await expect(sent).toHaveCount(1);

    await openRoom(page, room); // reload and re-open
    await expect(page.getByLabel("Display name")).toHaveValue("ann");
    await expect(rows(page.getByRole("log")).filter({ hasText: "second line" })).toHaveCount(1);
  });

  test("an own send ends at the bottom even when scrolled up", async ({ page, request }) => {
    const room = await roomWithMessages(request, 30);
    const log = await openRoom(page, room);
    await scrollListTo(log, 0);

    await send(page, "ann", "sent from far up");

    await expect(row(log, "sent from far up")).toBeInViewport();
    await expectAtBottom(log);
    await expect(pill(page)).toBeHidden();
  });
});

test("6. a backlog pauses polling until Load more messages drains it", async ({ page, request }) => {
  const room = await roomWithMessages(request, 5);
  const log = await openPollingRoom(page, room);
  await expect(rows(log)).toHaveCount(5);
  await postMessages(request, room.id, 105, { prefix: "backlog" });

  await pollNow(page);
  await expect(page.getByText("More messages are available")).toBeVisible();
  await expect(rows(log)).toHaveCount(105);

  await expectNoCatchUp(page); // observe absence of a room-specific after request
  await expect(rows(log)).toHaveCount(105);

  await expectAtBottom(log);
  const before = await scrollTopOf(log);
  await page.getByRole("button", { name: "Load more messages" }).click();

  await expect(rows(log)).toHaveCount(110);
  await expect(page.getByText("More messages are available")).toBeHidden();
  await expect(pill(page)).toBeVisible();
  expect(await scrollTopOf(log)).toBe(before);
});

test.describe("7. local time", () => {
  test.use({ timezoneId: "Europe/Bucharest" });

  test("shows the message's time in the browser's zone", async ({ page, request }) => {
    const { room, message } = await createRoom(request, { author: "e2e", text: "what time is it" });
    const expected = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Bucharest",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(new Date(message.createdAt));

    const log = await openRoom(page, room);

    await expect(rows(log).first().getByRole("time")).toHaveText(expected);
    await expect(rows(log).first().getByRole("time")).toHaveAttribute("datetime", message.createdAt);
  });
});

test.describe("8. interior catch-up and manual backlog", () => {
  // Own C is taller than the list, so the reader can be scrolled up while C is
  // still the first visible row. Rows that land before C then push it down, and
  // only the anchor correction keeps it in place.
  const OWN_C = Array.from({ length: 40 }, (_, index) => `own C line ${String(index + 1).padStart(2, "0")}`).join("\n");
  const ownC = (log: Locator) => rows(log).filter({ hasText: "own C line 01" });

  /** Leaves the bottom by 100 px; C still covers the whole list viewport. */
  async function scrollUpInsideOwnC(log: Locator) {
    await expectAtBottom(log);
    await scrollListTo(log, (await scrollTopOf(log)) - 100);
    const list = (await log.boundingBox())!;
    const c = (await ownC(log).boundingBox())!;
    expect(c.y).toBeLessThan(list.y);
    expect(c.y + c.height).toBeGreaterThan(list.y + list.height);
  }

  test("follows an interior insert when near the bottom", async ({ page, request }) => {
    const room = await roomWithMessages(request, 30);
    const log = await openPollingRoom(page, room);
    // Another visitor's B exists before own C is sent, so the next catch-up inserts B above C.
    await postMessage(request, room.id, { author: "other", text: "interior B" });
    await send(page, "ann", "own C");
    await expect(row(log, "interior B")).toHaveCount(0);

    await pollNow(page);

    await expect(row(log, "interior B")).toBeVisible();
    expect(await topOf(row(log, "interior B"))).toBeLessThan(await topOf(row(log, "own C")));
    await expectAtBottom(log);
    await expect(pill(page)).toBeHidden();
  });

  test("keeps the visible row in place for an interior insert and shows the pill", async ({ page, request }) => {
    const room = await roomWithMessages(request, 30);
    const log = await openPollingRoom(page, room);
    await postMessage(request, room.id, { author: "other", text: "interior B" });
    await send(page, "ann", OWN_C);
    await scrollUpInsideOwnC(log);
    const before = await topOf(ownC(log));

    await pollNow(page);

    await expect(row(log, "interior B")).toHaveCount(1); // inserted above the row being read
    await expect(pill(page)).toBeVisible();
    await expectSameTop(ownC(log), before);
  });

  test("shows the pill for a manual backlog page that lands entirely before own C", async ({ page, request }) => {
    const room = await roomWithMessages(request, 3);
    const log = await openPollingRoom(page, room);
    await postMessages(request, room.id, 105, { prefix: "backlog" });
    await send(page, "ann", OWN_C); // displayed last, ahead of the bookmark
    await pollNow(page);
    await expect(page.getByText("More messages are available")).toBeVisible();
    await expect(rows(log)).toHaveCount(104); // 3 + own C + the first 100 of the backlog
    await expect(rows(log).last()).toContainText("own C line 01");
    await scrollUpInsideOwnC(log);
    const before = await topOf(ownC(log));

    await page.getByRole("button", { name: "Load more messages" }).click();

    // First and last ids are unchanged: only the full id comparison sees these five rows.
    await expect(rows(log)).toHaveCount(109);
    await expect(rows(log).last()).toContainText("own C line 01");
    await expect(pill(page)).toBeVisible();
    await expectSameTop(ownC(log), before);
  });
});

test.describe("10. bounded compose layout", () => {
  // 120 lines of 24 characters and 119 newlines: 2999 code points.
  const LONG_DRAFT = Array.from(
    { length: 120 },
    (_, index) => `line ${String(index + 1).padStart(3, "0")} of a long draft`,
  ).join("\n");

  async function expectBoundedLayout(page: Page) {
    const viewport = page.viewportSize()!;
    const textarea = page.getByLabel("Message");
    const scrolls = await textarea.evaluate((el) => el.scrollHeight > el.clientHeight + 1);
    expect(scrolls, "the textarea scrolls inside itself").toBe(true);
    expect((await textarea.boundingBox())!.height).toBeLessThanOrEqual(72);

    for (const control of [
      page.getByRole("button", { name: "Send" }),
      page.getByRole("button", { name: "Close" }),
      page.getByLabel("Display name"),
    ]) {
      const box = (await control.boundingBox())!;
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    }

    const list = (await page.getByRole("log").boundingBox())!;
    expect(list.height).toBeGreaterThanOrEqual(96);
    const pageScrolls = await page.evaluate(
      () => document.documentElement.scrollHeight > window.innerHeight || document.body.scrollHeight > window.innerHeight,
    );
    expect(pageScrolls, "the page has no scrollbar").toBe(false);
  }

  test("a long many-line draft stays inside the panel and can be sent", async ({ page, request }) => {
    expect([...LONG_DRAFT]).toHaveLength(2999);
    const room = await roomWithMessages(request, 30);
    const log = await openRoom(page, room);

    await fillCompose(page, "ann", LONG_DRAFT);
    await expectBoundedLayout(page);

    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByLabel("Message")).toHaveValue("");
    await expect(rows(log)).toHaveCount(31);
    const sentText = await rows(log).last().getByRole("paragraph").nth(1).innerText();
    expect(sentText).toBe(LONG_DRAFT);
  });
});
```

How the scenarios map to the spec: `openPollingRoom` installs the clock before navigation, observes real startup JSON consumption and pauses before scenario writes. `pollNow` advances 30 seconds and waits for the resulting catch-up; `expectNoCatchUp` proves a backlog tick starts no request. The fresh sentinel in scenario 5 proves the response reached the DOM before deduplication is asserted. The observer never fabricates a response, and the public API paths remain real. With the default sizes (initial 100, page 20), a 125-message room shows messages 26–125 first, so "message 26" is the top row before the first "Load older" and "message 6" before the second. In scenario 8, B is posted **before** own C is sent, so C is displayed ahead of the bookmark and the next catch-up inserts B above it.

- [ ] **Step 2: Run the scenarios**

Run: `pnpm test:e2e tests/e2e/room-panel.spec.ts`
Expected: `13 passed` in well under a minute. The 125-message and 105-message tests take the longest (they post sequentially through the API).

- [ ] **Step 3: Prove the position assertions can fail**

A position test that cannot fail is worthless. Temporarily break the anchor correction and watch the right tests go red:

```bash
sed -i '' 's/  return currentOffset - anchor.offset;/  return 0 * (currentOffset - anchor.offset);/' src/components/room/listScroll.ts
pnpm test:e2e tests/e2e/room-panel.spec.ts -g "2\. Load older|8\. interior"
git checkout src/components/room/listScroll.ts
```

Expected with the mutation: scenario 2 and the two position tests of scenario 8 **fail** ("keeps the visible row in place…", "shows the pill for a manual backlog page…"); "follows an interior insert when near the bottom" still passes. After `git checkout`, `git status --short src/` prints nothing. (On Linux use `sed -i` without the `''`.)

- [ ] **Step 3a: Exercise slow setup and prove the polling assertions can fail**

Run with deliberately delayed setup (the runner waits 31 seconds after the browser clock is paused):

```bash
E2E_SLOW_SETUP=1 pnpm test:e2e tests/e2e/room-panel.spec.ts -g "6\. a backlog|8\. interior"
```

Expected: `4 passed`; no room-specific catch-up starts and browser time does not advance during the delay. Subsequent controlled ticks still produce the original 100/5 backlog split and B-before-C scenario. The delay is an adverse input, never a correctness/completion wait. Normal runs add no real-time sleeps.

The following script temporarily mutates only the exact reducer clauses involved, runs the focused browser check, and restores the original bytes in `finally`, including on failure or interruption. It makes no database changes itself. Execute from the worktree after the normal scenarios pass:

```bash
python3 - <<'PY_MUTATE'
from pathlib import Path
import subprocess

path = Path("src/lib/feed/reducer.ts")
original = path.read_bytes()
source = original.decode()
poll_guard = 'if (!state.polling || state.inflight !== null || state.backlog) return ignore(state);'
merge = 'messages: mergeMessages(state.messages, action.page.messages),'
mutations = [
    ("periodic polling disabled", poll_guard,
     'if (state.polling || !state.polling) return ignore(state);', r"5\. send"),
    ("newer response duplicates already displayed rows", merge,
     'messages: [...state.messages, ...action.page.messages].sort(compareCreatedAtId),', r"5\. send"),
    ("backlog no longer suppresses periodic requests", poll_guard,
     'if (!state.polling || state.inflight !== null) return ignore(state);', r"6\. a backlog"),
]
try:
    for label, before, after, pattern in mutations:
        assert source.count(before) == 1, f"Clause drift: {label}"
        path.write_text(source.replace(before, after))
        result = subprocess.run([
            "pnpm", "test:e2e", "tests/e2e/room-panel.spec.ts", "-g", pattern,
        ], check=False)
        assert result.returncode != 0, f"Mutation survived: {label}"
        # Inspect output: failure must be the catch-up/sentinel, duplicate count,
        # or unexpected request assertion, not compilation or setup failure.
        print(f"Inspect expected assertion failure: {label}")
        path.write_bytes(original)
finally:
    path.write_bytes(original)
PY_MUTATE
```

Expected failures: disabled polling times out waiting for a new observed catch-up; broken newer merge fails the four-row/one-own-row assertions after the witness commits; backlog polling fails `expectNoCatchUp` because `started` increases even if the response is slow. A compile error or unrelated setup failure does not count as detecting a mutation. After inspecting those reasons, rerun `pnpm test:e2e tests/e2e/room-panel.spec.ts` and require `13 passed` with the original reducer restored. Product reducer behavior is unchanged by this task.

- [ ] **Step 4: Check for flakiness**

Run: `pnpm test:e2e tests/e2e/room-panel.spec.ts --repeat-each 3`
Expected: `39 passed`, none flaky.

- [ ] **Step 5: Lint, typecheck and commit**

Run: `pnpm lint && pnpm typecheck`
Expected: clean.

```bash
git add tests/e2e/room-panel.spec.ts
git commit -m "test(e2e): cover the room panel over real HTTP polling"
```

---

### Task 13: Dev-only fixtures, mixed-update geometry and notice layout

Scenario 9 needs one props update that adds rows above **and** below the reader in a single commit, which the real feed cannot be made to do deterministically. Scenario 10's second half needs the fetch alert, the backlog notice and a compose error on screen together. Both use fixture pages that exist only in the dev server (reconciliation item 12).

**Files:**
- Modify: `tests/e2e/room-panel.spec.ts` (Task 11 already configured dev-only pages)
- Create: `src/app/e2e/fixtureMessages.ts`, `src/app/e2e/message-list/page.dev.tsx`, `src/app/e2e/room-panel-layout/page.dev.tsx`

**Interfaces:**
- Consumes: `MessageList` (Task 5), `RoomPanel` with `feedDeps` (Task 8), `PanelSlot` (Task 9), `PanelFrame`, `FeedDeps` (Task 1); the `row`, `expectSameTop` and `expectBoundedLayout` helpers and the `LONG_DRAFT` constant already in `tests/e2e/room-panel.spec.ts` (Task 12).
- Produces: dev-server routes `/e2e/message-list` (button "Add rows above and below"; 30 rows become 50) and `/e2e/room-panel-layout` (a panel whose first catch-up reports a backlog, whose next catch-up fails and whose sends fail). Neither exists in a production build.

- [ ] **Step 1: Confirm the fixture routing contract**

Task 11 read the bundled `pageExtensions.md` guide and set the Next configuration. Reuse that contract: a route file is `page.<extension>`, so `page.dev.tsx` is a page only while `dev.tsx` is a listed extension; with the default list its basename is `page.dev`, which is not a route file.

- [ ] **Step 2: Add the scenarios first**

In `tests/e2e/room-panel.spec.ts`, insert scenario 9 directly before `test.describe("10. bounded compose layout", …)`:

```ts
test("9. rows added above and below in one commit keep the visible row in place", async ({ page }) => {
  await page.goto("/e2e/message-list");
  const log = page.getByRole("log");
  await expect(rows(log)).toHaveCount(30);
  await row(log, "fixture message 25").scrollIntoViewIfNeeded();
  await scrollListTo(log, (await scrollTopOf(log)) - 30);
  const anchor = row(log, "fixture message 25");
  await expect(anchor).toBeInViewport();
  const before = await topOf(anchor);

  await page.getByRole("button", { name: "Add rows above and below" }).click();

  await expect(rows(log)).toHaveCount(50);
  await expectSameTop(anchor, before);
  await expect(pill(page)).toBeVisible();
});
```

and add this second test at the end of `test.describe("10. bounded compose layout", …)`, after the long-draft test:

```ts
  test("fetch alert, backlog notice and compose error fit together with the long draft", async ({ page }) => {
    await page.goto("/e2e/room-panel-layout");
    await page.getByRole("button", { name: "Load more messages" }).click();
    await expect(page.getByText("Use Load more messages to retry.")).toBeVisible();
    await fillCompose(page, "ann", LONG_DRAFT);
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(/Couldn't send\./)).toBeVisible();
    await expect(page.getByText("More messages are available")).toBeVisible();

    await expectBoundedLayout(page);
  });
```

- [ ] **Step 3: Run them to verify they fail**

Run: `pnpm test:e2e tests/e2e/room-panel.spec.ts -g "9\. rows added|fit together"`
Expected: both FAIL: `/e2e/message-list` and `/e2e/room-panel-layout` answer 404, so the log and the button never appear. The layout test fails by running into the 60 s test timeout while it waits for "Load more messages".

- [ ] **Step 4: Confirm the dev-only page extension**

Task 11 already enabled the dev-only extension. Keep that configuration unchanged. Confirm `/e2e/map-region` still loads before adding the two room fixtures.

- [ ] **Step 5: Create the fixtures**

Create `src/app/e2e/fixtureMessages.ts`:

```ts
import type { Message } from "@/lib/schemas/types";

export const FIXTURE_ROOM_ID = "11111111-1111-4111-8111-111111111111";

/** Message `n`; every third one has three lines, so row heights differ like real chat. */
export function fixtureMessage(n: number): Message {
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    chatroomId: FIXTURE_ROOM_ID,
    author: `author-${n}`,
    text: n % 3 === 0 ? `fixture message ${n}\nsecond line\nthird line` : `fixture message ${n}`,
    createdAt: `2026-09-16T10:00:00.${String(n).padStart(6, "0")}Z`,
  };
}

export function fixtureRange(from: number, to: number): Message[] {
  return Array.from({ length: to - from + 1 }, (_, index) => fixtureMessage(from + index));
}
```

Create `src/app/e2e/message-list/page.dev.tsx`:

```tsx
"use client";

import { useState } from "react";

import { fixtureRange } from "@/app/e2e/fixtureMessages";
import { PanelFrame } from "@/components/panel/PanelFrame";
import { PanelSlot } from "@/components/panel/PanelSlot";
import { MessageList } from "@/components/room/MessageList";

/**
 * Dev-server-only fixture for tests/e2e (room-panel design §8 scenario 9): the
 * real MessageList in the real panel slot, with props the test changes in one
 * commit. Served at /e2e/message-list by `next dev`; absent from `next build`.
 */
export default function MessageListFixture() {
  const [messages, setMessages] = useState(() => fixtureRange(11, 40));

  return (
    <div className="relative h-dvh w-full overflow-hidden">
      <button type="button" className="m-4 underline" onClick={() => setMessages(fixtureRange(1, 50))}>
        Add rows above and below
      </button>
      <PanelSlot>
        <PanelFrame title="MessageList fixture">
          <MessageList messages={messages} hasOlder loading={null} onLoadOlder={() => {}} />
        </PanelFrame>
      </PanelSlot>
    </div>
  );
}
```

Create `src/app/e2e/room-panel-layout/page.dev.tsx`:

```tsx
"use client";

import { FIXTURE_ROOM_ID, fixtureMessage, fixtureRange } from "@/app/e2e/fixtureMessages";
import { PanelSlot } from "@/components/panel/PanelSlot";
import { RoomPanel } from "@/components/room/RoomPanel";
import type { FeedDeps } from "@/lib/feed/store";

const room = {
  id: FIXTURE_ROOM_ID,
  name: "layout-fixture-room",
  lat: 45,
  lng: 5,
  createdAt: "2026-09-16T10:00:00.000000Z",
};

/**
 * A scripted feed: history loads, realtime is refused, the first catch-up
 * reports a backlog, the catch-up after it fails and every send fails. That
 * puts the fetch alert, the backlog notice and a compose error on screen
 * together. The script depends only on the cursor, so Strict Mode's second
 * store sees the same sequence as the first.
 */
const feedDeps: FeedDeps = {
  messages: {
    list: async () => ({ messages: fixtureRange(1, 30), hasMore: true }),
    listAfter: async (_roomId, after) => {
      if (after !== fixtureMessage(30).id) throw new Error("fixture: catch-up fails");
      const next = fixtureMessage(31);
      return { messages: [next], hasMore: true, nextCursor: next.id };
    },
    post: async () => {
      throw new TypeError("fixture: send fails");
    },
  },
  subscribe: (_roomId, handlers) => {
    handlers.onFailed("fixture: polling only");
    return { unsubscribe: () => {} };
  },
  config: { pollIntervalMs: 3_600_000, realtimeIdleTimeoutMs: 3_600_000 },
};

/**
 * Dev-server-only fixture for tests/e2e (room-panel design §8 scenario 10):
 * the real RoomPanel in the real slot, to measure the footer with every notice
 * showing. Served at /e2e/room-panel-layout by `next dev`; absent from `next build`.
 */
export default function RoomPanelLayoutFixture() {
  return (
    <div className="relative h-dvh w-full overflow-hidden">
      <PanelSlot>
        <RoomPanel room={room} onClose={() => {}} feedDeps={feedDeps} />
      </PanelSlot>
    </div>
  );
}
```

- [ ] **Step 6: Run the two scenarios to verify they pass**

The dev-only extension was configured in Task 11. If `/e2e/message-list` answers 404, verify that the running server uses this worktree and its updated Next configuration; restart `pnpm dev` from this worktree if needed.

Run: `pnpm test:e2e tests/e2e/room-panel.spec.ts -g "9\. rows added|fit together"`
Expected: `2 passed`.

- [ ] **Step 7: Prove the fixtures never ship**

Run: `pnpm build`
Expected: the build succeeds and the printed route list is exactly `/`, `/_not-found`, `/api/health`, `/api/rooms`, `/api/rooms/[id]`, `/api/rooms/[id]/messages`. There is **no** `/e2e/…` line. (Next 16 builds into `.next` while the dev server uses `.next/dev`, so a running dev server is not disturbed.)

- [ ] **Step 8: Run the whole e2e suite, then lint and typecheck**

Run: `pnpm test:e2e --repeat-each 3`
Expected: `54 passed` (18 tests, three times), none flaky.

Run: `pnpm test && pnpm lint && pnpm typecheck`
Expected: 36 files / 695 tests; clean.

- [ ] **Step 9: Commit**

```bash
git add src/app/e2e/fixtureMessages.ts src/app/e2e/message-list src/app/e2e/room-panel-layout tests/e2e/room-panel.spec.ts
git commit -m "test(e2e): add dev-only fixtures for mixed-update geometry and notice layout"
```

---

### Task 14: README and final verification

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: the finished chunk.
- Produces: documentation only.

- [ ] **Step 1: Add the e2e script to the Scripts table**

In `README.md` under "## Scripts", add this row after the `pnpm test:api` row:

```markdown
| `pnpm test:e2e`   | Playwright (Chromium) against the dev server and the stack |
```

- [ ] **Step 2: Complete the "Room feed" section**

Replace the first paragraph and the module table of "## Room feed" (from "The client-side core of an open room" down to the `@/lib/feed/reducer` table row) with:

```markdown
The client-side core of an open room (PRD 4 "History", 6.4, 6.7) is a pure reducer, a
framework-free store that runs its effects, and a React hook over that store. The realtime
adapter arrives with chunk 11; until then every room polls.
Design: `docs/superpowers/specs/2026-09-16-room-feed-design.md`.

| Module                  | Provides                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------ |
| `@/lib/feed/types`      | `FeedState`, `FeedAction`, `FeedEffect`, `FeedError`, `Connection`, `FetchOp`             |
| `@/lib/feed/reducer`    | `initialFeedState(roomId)`, `feedReducer(state, action)` returning `[state, effects]`, `mergeMessages`, `connectionOf`, `EMPTY_HISTORY_MESSAGE` |
| `@/lib/feed/realtime`   | `SubscribeToRoom`, `RealtimeHandlers`, `RealtimeHandle`; `pollingOnlySubscribe`, the stand-in adapter that refuses realtime |
| `@/lib/feed/store`      | `createFeedStore(roomId, deps, seed?)`, `FeedDeps`, `FeedStore`, `FeedNotReadyError`      |
| `@/lib/feed/useRoomFeed` | `useRoomFeed(roomId, { seed, deps })` returning `RoomFeed`                                |
```

and append this paragraph at the end of the section (after the paragraph ending "for display."):

```markdown
`createFeedStore` is inert until `start({ hidden })`. It queues reentrant actions, gives
every `subscribe` effect its own attempt token (the first failure is terminal, a late
callback is ignored, a handle is always cleaned up exactly once) and ignores every result
that arrives after `dispose()`. `send` rejects with `FeedNotReadyError` and posts nothing
unless the room is open. `loadNewer()` returns a promise that resolves once the fetch that
call started has been reduced and published, or at once when the request was ignored; read
failures stay in `error` and never reject it. `useRoomFeed` creates the store in a layout
effect and disposes it in the cleanup, so rendering, server rendering and Strict Mode's
effect replay never reuse or leak a store; it also tracks `document.visibilityState`.
```

- [ ] **Step 3: Add the "Room panel" section**

Insert directly before "## Tests":

```markdown
## Room panel

Clicking a pin (or pressing Enter or Space on a focused pin) opens the room in the floating
panel (PRD 3 Flow B). Design: `docs/superpowers/specs/2026-09-17-room-panel-design.md`.

| Module                             | Provides                                                                 |
| ---------------------------------- | ------------------------------------------------------------------------ |
| `@/components/room/RoomPanel`      | The panel: feed hook, loading and error surfaces, backlog notice, compose form |
| `@/components/room/MessageList`    | The scroll container (`role="log"`), "Load older", the "New messages" pill; handle `scrollToBottom(id?)` and `holdPosition()` |
| `@/components/room/listScroll`     | Pure scroll decisions: `classifyChange`, `decideScroll`, `decideResize`, `pickAnchor`, `anchorAdjustment`, `isNearBottom` |
| `@/components/panel/PanelSlot`     | The top-right slot that caps the panel at the viewport height            |
| `@/lib/time/format`                | `formatMessageTime(iso, { now, timeZone, locale })`: `17:03`, `16 Sep 17:03`, `16 Sep 2025 17:03` |

The list opens at the newest message. New rows are found by comparing message ids, so rows
that land between displayed rows count too. A reader within 32 px of the bottom follows
incoming messages; otherwise the first visible row keeps its place and "New messages" shows.
An own send always ends at the bottom. "Load more messages" keeps the reader's position for
the whole request and shows the pill. Only one fetch runs at a time, so "Load older" and
"Load more messages" are disabled while any fetch is in flight. A failed initial load and a
room that no longer exists show a persistent hint and keep the form disabled; a failed older
or newer fetch shows a dismissible alert. The message field is a fixed 64 px and scrolls
inside itself, so Send and at least 96 px of messages stay visible at 1280 × 720.

The panel root has `data-connection` (`connecting`, `polling`, `realtime`) for tests; nothing
visible. A room created in chunk 10 passes its first message through the selection as `seed`
and opens without a history request.
```

- [ ] **Step 4: Add the "End-to-end tests" section**

Insert directly after the "## Tests" section (before "## Compose form and display name"):

```markdown
## End-to-end tests

`pnpm test:e2e` runs Playwright (Chromium, 1280 × 720) against the real dev server and the
local Supabase stack. It proves what jsdom cannot: layout, scrolling and the full HTTP path
with polling. First time: `pnpm exec playwright install chromium`.

- The base URL is `https://map-chat.map-chat.test` (the Supbuddy mapping); set `E2E_BASE_URL`
  for another one. Playwright starts `pnpm dev` when no server answers and reuses a running one.
- HTTP scenarios create their data through the API and never reset the database. Rooms accumulate.
  An operator may separately choose `pnpm db:reset` only when all local development data is
  disposable: it resets the entire local database, reapplies migrations and reloads seed.sql,
  discarding unrelated rooms/messages and unrecorded local changes too. It is not test cleanup.
- `pnpm test:api` and `pnpm test:db` truncate tables. Never run them while `pnpm test:e2e` runs.
- Polling scenarios settle startup, pause their installed clock before setup writes, then fire
  ticks with `page.clock.fastForward(30_000)`. Real fetch/JSON completion is observed; the
  poll interval is not overridden. `E2E_SLOW_SETUP=1` deliberately adds 31 seconds of runner
  time after each polling room opens, proving setup cannot accidentally fire a poll.
- `src/app/e2e/**/page.dev.tsx` are fixture pages for these tests. `next.config.ts` lists the
  `dev.tsx` page extension only outside production, so `next build` does not contain them.
```

- [ ] **Step 5: Final verification**

Run each command and compare with the expected result. Evidence before claims: paste the summary lines into your hand-off.

```bash
pnpm test
pnpm lint
pnpm typecheck
pnpm build
pnpm test:e2e
```

Expected: `pnpm test` → 36 files, 695 tests passed. `pnpm lint` → no output after the header. `pnpm typecheck` → exits 0. `pnpm build` → succeeds, route list without `/e2e`. `pnpm test:e2e` → `18 passed`.

Then one manual pass in a browser at the Supbuddy URL: open a seeded or freshly created room from its pin, send a two-line message, watch it appear once; resize the window to 1280 × 720 and paste a very long draft: the textarea scrolls inside itself and Send stays visible. Leave the local data intact; final verification has no database cleanup step.

- [ ] **Step 6: Commit**

```bash
git add README.md
git commit -m "docs(room): document the room panel, the feed store and hook, and the e2e suite"
```

---

## Handoff to chunks 10, 11 and 12

- **Chunk 10 (new chatroom).** Dispatch `{ type: "roomCreated", room, message }` with both values of the `created` outcome; the selection stores `message` as `seed` and `MapShell` already passes it to `RoomPanel`. For a 409, dispatch `movedToExisting` with `{ author, text }` as `prefill` and no seed. Add the seeded-open e2e scenario on this harness (`createRoom` in `tests/e2e/helpers.ts` is the API path; the scenario itself goes through the popup). `PanelFrame.title` is a `ReactNode`: chunk 10 decides on `RoomTitle`.
- **Chunk 11 (realtime).** Add `subscribeToRoom` to `src/lib/feed/realtime.ts`, make it the default in `resolveDeps` (`src/lib/feed/useRoomFeed.ts`) and delete `pollingOnlySubscribe` if nothing else uses it (the store test "polling with the stand-in adapter" then switches to `fakeRealtime()` plus `onFailed`). Attach `attachActivityTracking` to the panel root (the `div` with `data-connection`) with `feed.activity`. The e2e scenarios assume polling; give them a way to stay in polling mode or adapt `pollNow`.
- **Chunk 12 (URL and polish).** Observe `feed.error?.notFound` to close the panel and show the page-level notice; the panel already stops at `ROOM_GONE_HINT`. `openRoom` may switch to `/room/<id>`.

## Not in this chunk

Realtime and activity tracking; `NewRoomPopup`, `RoomTitle` and the 409 notice; URL sync and closing the panel for a gone room; mobile layout; list virtualization; a message count on the pill; a visible connection indicator; e2e coverage of error and retry semantics or hidden tabs (the notice geometry is covered by scenario 10).

## Self-review

- **Spec coverage.** Room-panel design §1 decisions: 1 (Tasks 5, 8: disabled flags from `loading`), 2 (Tasks 6, 8, 9), 3 (Task 8), 4 (Task 8 `data-connection`), 5–6 and 11 (Tasks 4, 5, 8), 7 (Task 4), 8 (Task 3), 9 (Tasks 11–13), 10 (Task 8 passes `room.name`), 12 (Tasks 7, 8, 12, 13). §3 files: every row of the "New files" and "Modified files" lists has a task; `package.json`, `.gitignore`, `README.md` in Tasks 11 and 14. §3.1 (Task 6), §3.2 (Tasks 5, 8). §4 state table, footer order, copy, `console.warn` once per error object, submit adapter (Task 8); §4.1 (Tasks 7, 8; browser acceptance in Tasks 12, 13). §5 props, handle, `role="log"`, `aria-live`, `aria-busy`, row layout (Task 5); §5.1 (Tasks 4, 5); §5.2 holds, completion promise, commit-aware `scrollToBottom`, pill rules (Tasks 1, 2, 5, 8). §6 (Task 3). §7: each listed test file and case (Tasks 1–9); room-feed design §9 acceptance F-001 (Tasks 1, 2), F-002 (Task 1 "channel attempts"), F-003 (Task 1 "visibility", Task 2), F-004 (Task 1), F-005 (Task 1 "send", Task 8). §8 setup table (Task 11), cap-independent region corner check with 501 newer synthetic rooms (Task 11 Step 5a), paused setup and observed polling/mutation checks (Task 12 Step 3a), scenarios 1–8 and 10 (Task 12), 9 and 10's fixture half (Task 13). §9 out of scope is restated above.
- **Gaps found and closed while writing.** The spec's time table cannot be produced with `month: "short"` (item 1). The spec's keyboard `openRoom` cannot work against chunk 6 as merged (item 2, Task 10). A one-line own message makes scenario 8's position assertion vacuous (item 14, Task 12 Step 3).
- **Placeholders.** None: every created file has its full content, every modified file has exact edits or its full replacement, every command has its expected output.
- **Type consistency.** `FeedDeps`/`FeedStore`/`FeedNotReadyError` (Task 1) are used with the same members in Tasks 2, 8 and 13; `RoomFeed.loadNewer(): Promise<void>` (Task 2) is awaited in `RoomPanel.loadMore` (Task 8); `MessageListHandle.scrollToBottom(messageId?)` and `holdPosition(): () => void` (Task 5) are called with those shapes in Task 8; `ScrollDecision.scroll` is `"bottom" | "anchor"` in Tasks 4 and 5; `Selection.seed` (Task 6) is read in Task 9; `textareaClassName` (Task 7) is passed in Task 8; `manualTimers()` returns `{ timers, tick }` (Task 8 helper and test); e2e helper names in Task 11 match their imports in Tasks 12 and 13 (`createRoom`, `postMessage`, `postMessages`, `roomWithMessages`, `openRoom`, `openPollingRoom`, `pollNow`, `expectNoCatchUp`, `rows`, `distanceFromBottom`, `scrollTopOf`, `scrollListTo`, `topOf`, `pill`, `fillCompose`); the copy constants exported by `RoomPanel.tsx` are the ones its test imports.
