# Chunk 8: Room Feed Reducer Implementation Plan

**Review feedback:** [2026-09-17-chunk-08-feed-reducer-feedback.md](2026-09-17-chunk-08-feed-reducer-feedback.md)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The pure, framework-free core of an open room: the state, actions and effects that describe history, older and newer paging, the synchronization bookmark and the realtime-or-polling connection lifecycle, with one unit test per transition rule of the design.

**Architecture:** `feedReducer(state, action)` returns `[nextState, effects]`. Effects are plain data (`fetchInitial`, `fetchNewer`, `subscribe`, `startPolling`, …) that the store of chunk 9 interprets against the API client, the realtime adapter of chunk 11 and timers. The reducer holds no I/O, no timers and no React. The design's named sub-procedures (enter polling, select initial transport, drop channel, auto catch-up) are small helper functions that append effects in a fixed order, so every rule of the design is one table row in the test file. An action the current state does not accept returns the *same* state object and an empty effect list, which the store can use to skip notifications.

**Tech Stack:** TypeScript 5 (`strict`), Vitest 5 (Node environment, no DOM), pnpm 10, Node 22. Consumes `Message`, `MessagePage`, `CatchUpPage` from `@/lib/schemas/types` and `compareCreatedAtId` from `@/lib/time/ordering`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-16-room-feed-design.md` (approved revision of 2026-09-17; its review companion `2026-09-16-room-feed-design-feedback.md` records the accepted findings F-001–F-005). This plan implements §1 decisions 2–5 and 10, §2 (chunk 8 rows), §3, §4, §5 and the reducer bullet of §9. Parent: `docs/superpowers/specs/2026-09-16-map-chat-implementation-chunks.md` §0 (global constraints), §0.1 (layout), §0.2 (DTOs), "Chunk 8". PRD (`docs/PRD.md` v4): §4 "History", §6.4 "Realtime and polling" (transitions and synchronization bookmark), §6.7 "Client state", §8 "Testing" (unit bullet). The store, hook, realtime adapter and activity tracking (spec §6–§8) belong to chunks 9 and 11 and are **not** built here.

## Global Constraints

Copied from the chunks document §0 and the feed design where they apply to this chunk:

- Language: TypeScript, `strict: true`, no `any` in committed code.
- Package manager: pnpm (`packageManager: pnpm@10.9.0`). Node 22 LTS.
- Framework: Next.js 16, App Router. Nothing in this chunk is a component or a route; the modules must stay importable from both server and client code (no `"use client"`, no browser globals, no `server-only`).
- Data contracts (spec §0.2 and chunk 4/5): `Message = { id; chatroomId; author; text; createdAt }` with `createdAt` canonical ISO-8601 UTC with six fractional digits (`"2026-09-16T15:00:00.123456Z"`); `MessagePage = { messages: Message[]; hasMore: boolean }` ascending; `CatchUpPage = MessagePage & { nextCursor: string }`. Ordering is always `compareCreatedAtId` (tuple `(created_at, id)`), never arrival order and never `Date`.
- PRD §6.4 bookmark: "Realtime events, later POST responses, and older-history pages update the displayed collection but never advance `syncCursor`. Always merge by id and sort by `(created_at, id)` ascending; arrival order must not determine display order." "An empty response leaves the bookmark unchanged. Failed fetches do not advance it." "If initial history unexpectedly contains no messages, repeat initial history loading rather than invent a cursor."
- PRD §6.4 transitions: open → try realtime, refusal → polling; idle timeout in realtime → unsubscribe → polling (one poll immediately, then periodic); send while polling → try realtime; hidden tab counts as inactive immediately; close → unsubscribe and stop polling. Backlog: "Pause periodic `after` fetches until the user finishes this backlog" (PRD §4).
- Spec §1 decision 2: at most one message fetch in flight; a channel that fails after subscribing enters polling; late results for a closed room are ignored. No offline handling, no backoff.
- Spec §3 invariants: `messages` sorted and unique by id; `olderCursor` and `syncCursor` come only from server pages (or the creation seed), never from `messages`; `polling` and `channel` are independent; `connectionOf` priority `realtime` > `polling` > `connecting`.
- Copy: the empty-history error message is exactly `Room has no messages` (spec §5).
- Tests: Vitest, TDD (failing test first). Unit tests colocated as `*.test.ts` next to the source, Node environment (`vitest.config.ts` includes `src/**/*.test.{ts,tsx}`). Target one path with `pnpm test <path>` **without** `--`.
- Lint: `pnpm lint` (`eslint-config-next` 16) must pass with zero errors after every task. Use braces around `case` bodies that declare variables and return from every `case` (no fallthrough).
- Commits: conventional commits, one commit per task. This repository has no GitButler workspace (`but status` reports "No GitButler project found"), so the steps use plain `git`; if GitButler is active when you execute, use the `commit` skill with the same messages.

## Prerequisites (verified on 2026-09-17)

- `main` is at `784c2ee` (merge of chunk 4). Chunks 1–4 are merged. Baseline on `main`: `pnpm test` reports **14 files, 222 tests** passing; `pnpm typecheck` exits 0.
- Present on `main` and used here: `Message` in `src/lib/schemas/types.ts`; `compareCreatedAtId(a, b)` in `src/lib/time/ordering.ts` (ascending tuple order on canonical timestamps and lowercase UUIDs, returns 0 only for equal tuples).
- **Chunk 5 is not merged.** It lives on branch `chunk-05-messages-api` (`f558052b691289b18aa1f4680f9e4f63d235fe6d` at review time, worktree `/Users/calin/dev/other/wp-worktrees/chunk-05-messages-api`). The only chunk 5 artefact this chunk needs is the two page types it appended to `src/lib/schemas/types.ts`. Task 1 checks each declaration against that pinned revision and appends only missing declarations, preserving unrelated DTOs. Existing compatible declarations need no change; their presence does not prove chunk 5 is merged. Nothing else from chunk 5 (`MessagesApi`, `listAfter`, the repository, the migration) is imported by this chunk; those are consumed by chunk 9's store.
- Chunks 6 and 7 (branches `chunk-06-map-shell`, `chunk-07-compose-form` if created) are independent of this chunk and are not needed.
- `vitest.config.ts`: `environment: "node"`, alias `@` → `src`, no `setupFiles`. Test files are linted by `pnpm lint`; keep helpers used.
- `tsconfig.json` does not enable `noUncheckedIndexedAccess`, so `messages[0]` is typed `Message`; guard with a length check where the array may be empty.
- `pnpm typecheck` runs `next typegen && tsc --noEmit`; it needs no `.env.local`.

## Before you start: worktree

Execute this plan in its own worktree, following the sibling convention in use:

```bash
cd /Users/calin/dev/other/wp
git worktree add -b chunk-08-feed-reducer /Users/calin/dev/other/wp-worktrees/chunk-08-feed-reducer main
cd /Users/calin/dev/other/wp-worktrees/chunk-08-feed-reducer
```

Before installing or implementing, bring the required review inputs into this worktree. They
are currently untracked in the source checkout. Run the following in Bash from the new worktree;
it copies only missing files, rejects conflicting existing copies for explicit reconciliation,
and commits only this named documentation set. If all files are already tracked and identical,
no documentation commit is needed. Keep all review companions and their history intact.

```bash
feed_docs=(
  docs/superpowers/plans/2026-09-17-chunk-08-feed-reducer.md
  docs/superpowers/plans/2026-09-17-chunk-08-feed-reducer-feedback.md
  docs/superpowers/specs/2026-09-16-room-feed-design.md
  docs/superpowers/specs/2026-09-16-room-feed-design-feedback.md
  docs/superpowers/specs/2026-09-16-map-chat-implementation-chunks.md
  docs/superpowers/plans/2026-09-16-chunk-04-rooms-api.md
  docs/superpowers/plans/2026-09-16-chunk-04-rooms-api-feedback.md
  docs/superpowers/plans/2026-09-16-chunk-05-messages-api.md
  docs/superpowers/plans/2026-09-16-chunk-05-messages-api-feedback.md
)
for feed_doc in "${feed_docs[@]}"; do
  feed_source="/Users/calin/dev/other/wp/$feed_doc"
  test -f "$feed_source" || exit 1
  if test -e "$feed_doc"; then
    cmp "$feed_source" "$feed_doc" || exit 1
  else
    mkdir -p "$(dirname "$feed_doc")" || exit 1
    cp "$feed_source" "$feed_doc" || exit 1
  fi
done
git add -- "${feed_docs[@]}"
if ! git diff --cached --quiet -- "${feed_docs[@]}"; then
  git commit --only -m "docs(feed): preserve reducer plan and design review inputs" -- "${feed_docs[@]}"
fi
git ls-files --error-unmatch -- "${feed_docs[@]}"
```

Expected: all nine files are tracked in the new worktree, including the design referenced by
the eventual README. PRD, Known limitations and the map-shell design are already tracked on
`main`. If a source file is missing or differs from an existing worktree copy, reconcile that
specific document before continuing; do not overwrite it or stage unrelated plans.

```bash
pnpm install
pnpm test && pnpm typecheck
```

Expected: `pnpm test` reports 14 files / 222 tests passing (more if other chunks merged first; record the number); `pnpm typecheck` exits 0. Every path below is relative to this worktree.

## Spec reconciliation and design decisions

The spec wins on everything not listed here. These are the points where the plan pins down something the spec leaves open, or departs from its wording:

1. **Paths** are under `src/` with `@/` imports (spec §2 already says `src/lib/feed/...`).
2. **Ignored actions return the same state reference** and `[]`. The spec says "ignored"; this plan makes that observable (`expect(next).toBe(before)`) and lets chunk 9's store skip listener notification when the reference is unchanged.
3. **`visibilityChanged` with no change is ignored.** The spec's table sets `hidden` on every event. When `action.hidden === state.hidden` nothing can change (a hidden state never holds a live or pending channel, because every path that subscribes checks `!hidden`), so the reducer returns the same reference. This is the spec's "a repeated hidden event while already polling neither restarts the timer nor fetches again", made general.
4. **`enterPolling` while already polling is a full no-op** (no `startPolling`, no catch-up), matching the sentence above. Every caller in §5 is already guarded by `!polling`, so this is defensive.
5. **`notFound` recovery emits cleanup unconditionally.** Spec: "drop channel, stop polling, set `polling = false`". The reducer emits `unsubscribe`, `stopIdleTimer`, `stopPolling` in that order regardless of `channel`/`polling`, exactly like `closed` (whose order is `unsubscribe`, `stopPolling`, `stopIdleTimer`, as the spec lists it). All three are idempotent in the store.
6. **Pages are sorted before use.** `historyLoaded` and `olderLoaded` run the page through `mergeMessages([], page.messages)` first, so `olderCursor` (first id) and `syncCursor` (last id) come from tuple order, not arrival order. The server already returns pages ascending; this makes the reducer's invariants independent of that.
7. **`mergeMessages` returns `existing` itself when nothing is new** (duplicate-only or empty incoming). `existing` must already be sorted, which the state invariant guarantees. Otherwise it returns a new array (`[...existing, ...fresh].sort(compareCreatedAtId)`), never mutating its inputs.
8. **Owed catch-up is one helper.** `newerLoaded`, `olderLoaded` and the older-failure recovery all "capture and clear `newerWanted`, then run auto catch-up". Because `backlog` can only become true in `newerLoaded`, which clears `newerWanted`, the state `newerWanted && backlog` cannot survive a reduction; the uniform helper therefore satisfies both wordings in §5 (`newerLoaded` "if `newerWanted && backlog`: `newerWanted = false`" is the helper's no-fetch branch).
9. **`channelFailed.reason` is not stored.** The reducer has no field for it; the store (chunk 9/11) may log it. The action keeps the field so the adapter contract in spec §8 is unchanged.
10. **Named helper types.** `FetchOp = 'initial' | 'older' | 'newer'`, `FeedStatus`, `ChannelState` are exported from `types.ts` in addition to the spec's types, so tests and the store can name them.
11. **`EMPTY_HISTORY_MESSAGE`** is an exported constant of `reducer.ts` holding the spec's `Room has no messages`, so chunk 9/12 can match it without retyping the string.
12. **`opened` after a failed initial fetch is accepted by the reducer** (status is still `opening`, `inflight` is `null`). The spec assigns the "exactly once per store instance" rule to the store; the reducer does not add a flag for it.
13. **`fetchFailed` for `newer` while `channel === 'subscribing'`** (initial join not yet confirmed, or re-subscribe during polling) changes only `inflight` and `error`; the spec's "retain that interval; a pending subscription may still confirm and request catch-up by the ordinary confirmation rule" covers both the polling and the not-yet-polling case, and `channelFailed` still leads to polling if the join is refused.
14. **README** gains a "Room feed" section listing the modules and the reducer contract, as earlier chunks documented theirs.

## File structure

| Path | Responsibility | Task |
| --- | --- | --- |
| `src/lib/schemas/types.ts` (modify, only if a required page declaration is absent) | `MessagePage`, `CatchUpPage`, verbatim from chunk 5 | 1 |
| `src/lib/feed/types.ts` | `FetchOp`, `FeedError`, `FeedStatus`, `ChannelState`, `FeedState`, `Connection`, `FeedAction`, `FeedEffect` | 1 |
| `src/lib/feed/reducer.ts` | `EMPTY_HISTORY_MESSAGE`, `initialFeedState`, `connectionOf`, `mergeMessages`, `feedReducer` and its private helpers | 1–4 |
| `src/lib/feed/reducer.test.ts` | Fixtures, `mergeMessages`/`connectionOf` tests, one table row per §5 rule, named scenarios | 1–5 |
| `README.md` (modify) | "Room feed" section before "## Tests" | 5 |

Dependency order: Task 1 (types, initial state, merge) → Task 2 (reducer skeleton: guards, opening, channel outcomes, visibility, close) → Task 3 (newer/older paging, receive, send) → Task 4 (failures, dismissal, exhaustiveness) → Task 5 (multi-step scenarios, docs, final verification). The reducer file grows across Tasks 2–4; each task shows exactly what to add.

---

### Task 1: Page types, feed types, initial state and message merging

**Files:**
- Modify: `src/lib/schemas/types.ts` (append two types, only if absent)
- Create: `src/lib/feed/types.ts`, `src/lib/feed/reducer.ts`
- Test: `src/lib/feed/reducer.test.ts`

**Interfaces:**
- Consumes: `Message` from `@/lib/schemas/types`; `compareCreatedAtId(a: { createdAt: string; id: string }, b: same): number` from `@/lib/time/ordering`.
- Produces:
  - `MessagePage = { messages: Message[]; hasMore: boolean }`, `CatchUpPage = MessagePage & { nextCursor: string }` in `@/lib/schemas/types` (identical to chunk 5).
  - `@/lib/feed/types`: every type in the block below (Step 3).
  - `@/lib/feed/reducer`: `initialFeedState(roomId: string): FeedState`, `connectionOf(state: FeedState): Connection`, `mergeMessages(existing: Message[], incoming: Message[]): Message[]`.

- [ ] **Step 1: Check each page type and add only missing declarations**

```bash
cd /Users/calin/dev/other/wp-worktrees/chunk-08-feed-reducer
rg -n -A 4 '^export type (MessagePage|CatchUpPage) =' src/lib/schemas/types.ts
```

A search match locates a declaration; inspect its complete definition to verify its shape.
Check `MessagePage` and `CatchUpPage` separately against the block below. If both are present
and compatible, leave the file unchanged and proceed to Step 2. If either is absent, append
only that declaration and its comment; if both are absent, append the whole block. Preserve
all other declarations. Type presence is not evidence that chunk 5 has merged.

The block is copied from pinned chunk 5 revision
`f558052b691289b18aa1f4680f9e4f63d235fe6d`, not the moving branch tip. Keep the copied text
unchanged to minimize merge conflicts:

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

Review the two declarations against the recorded source and inspect the scoped working diff:

```bash
git show f558052b691289b18aa1f4680f9e4f63d235fe6d:src/lib/schemas/types.ts
rg -n -A 4 '^export type (MessagePage|CatchUpPage) =' src/lib/schemas/types.ts
git diff -- src/lib/schemas/types.ts
```

Expected: exactly one compatible export of each type: `MessagePage` contains
`messages: Message[]` and `hasMore: boolean`; `CatchUpPage` intersects it with
`nextCursor: string`. The diff contains only declarations/comments that were missing, or is
empty. Compare only these declarations with the pinned source. If an existing page contract
has drifted, reconcile that contract with the approved feed design and record the decision
before continuing. Never replace the whole shared types file to resolve differences elsewhere.
The typecheck in Step 6 validates the consumer imports.

- [ ] **Step 2: Write the feed types**

Create `src/lib/feed/types.ts`:

```ts
import type { CatchUpPage, Message, MessagePage } from "@/lib/schemas/types";

/**
 * Types of the room feed core (design: docs/superpowers/specs/2026-09-16-room-feed-design.md
 * §3–§4). The reducer in `@/lib/feed/reducer` is pure; effects are data that the
 * store (chunk 9) runs against the API client, the realtime adapter and timers.
 */

/** Which HTTP read an in-flight marker, a failure or an error refers to. */
export type FetchOp = "initial" | "older" | "newer";

/** A failed read. Kept until dismissed; a `notFound` error is terminal for the room. */
export type FeedError = {
  op: FetchOp;
  message: string;
  /** True when the API answered 404: the room is gone. */
  notFound: boolean;
};

export type FeedStatus = "opening" | "open" | "closed";

export type ChannelState = "none" | "subscribing" | "subscribed";

export type FeedState = {
  roomId: string;
  status: FeedStatus;
  /** Current document visibility; retained while opening. */
  hidden: boolean;
  /** Ascending by compareCreatedAtId, unique by id. */
  messages: Message[];
  /** First id of the last successful initial/before page; the "Load older" cursor. */
  olderCursor: string | null;
  /** hasMore of that page. */
  hasOlder: boolean;
  /** PRD 6.4 synchronization bookmark; only `newerLoaded` moves it. */
  syncCursor: string | null;
  /** The last catch-up said hasMore; periodic catch-up is paused. */
  backlog: boolean;
  /** A catch-up is owed but another fetch is in flight. */
  newerWanted: boolean;
  /** At most one fetch at a time. */
  inflight: FetchOp | null;
  /** The poll timer is running. */
  polling: boolean;
  channel: ChannelState;
  error: FeedError | null;
  /** An empty initial history is retried once. */
  initialRetried: boolean;
};

/** What the panel shows: derived by `connectionOf`, never stored. */
export type Connection = "connecting" | "realtime" | "polling";

export type FeedAction =
  | { type: "opened"; hidden: boolean; seed?: Message } // seed = first message from atomic room creation
  | { type: "historyLoaded"; page: MessagePage }
  | { type: "olderRequested" }
  | { type: "olderLoaded"; page: MessagePage }
  | { type: "newerRequested" } // "Load more messages" click
  | { type: "pollTick" } // from the poll timer
  | { type: "newerLoaded"; page: CatchUpPage }
  | { type: "fetchFailed"; op: FetchOp; message: string; notFound: boolean }
  | { type: "received"; message: Message } // realtime insert or own POST response
  | { type: "sent" } // after a successful own POST
  | { type: "subscribed" }
  | { type: "channelFailed"; reason: string } // refusal, timeout, or drop after subscribed
  | { type: "idle" } // idle timer fired
  | { type: "visibilityChanged"; hidden: boolean }
  | { type: "errorDismissed" }
  | { type: "closed" };

export type FeedEffect =
  | { type: "fetchInitial" }
  | { type: "fetchOlder"; before: string }
  | { type: "fetchNewer"; after: string }
  | { type: "subscribe" }
  | { type: "unsubscribe" }
  | { type: "startPolling" }
  | { type: "stopPolling" }
  | { type: "startIdleTimer" }
  | { type: "stopIdleTimer" };
```

- [ ] **Step 3: Write the failing tests for the three pure helpers**

Create `src/lib/feed/reducer.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import type { FeedState } from "@/lib/feed/types";
import type { Message } from "@/lib/schemas/types";

import { connectionOf, initialFeedState, mergeMessages } from "@/lib/feed/reducer";

const ROOM = "11111111-1111-4111-8111-111111111111";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** Message `n`, created `micros` microseconds into the same second (default: n). */
function msg(n: number, micros = n): Message {
  return {
    id: id(n),
    chatroomId: ROOM,
    author: `author-${n}`,
    text: `message ${n}`,
    createdAt: `2026-09-16T10:00:00.${String(micros).padStart(6, "0")}Z`,
  };
}

const m1 = msg(1);
const m2 = msg(2);
const m3 = msg(3);
const m4 = msg(4);

describe("initialFeedState", () => {
  it("starts opening, empty, visible and without transports", () => {
    expect(initialFeedState(ROOM)).toEqual({
      roomId: ROOM,
      status: "opening",
      hidden: false,
      messages: [],
      olderCursor: null,
      hasOlder: false,
      syncCursor: null,
      backlog: false,
      newerWanted: false,
      inflight: null,
      polling: false,
      channel: "none",
      error: null,
      initialRetried: false,
    } satisfies FeedState);
  });
});

describe("connectionOf", () => {
  it.each<[string, Partial<FeedState>, string]>([
    ["realtime when subscribed", { channel: "subscribed" }, "realtime"],
    ["realtime wins over a polling flag", { channel: "subscribed", polling: true }, "realtime"],
    ["polling with no channel", { channel: "none", polling: true }, "polling"],
    ["polling while re-subscribing", { channel: "subscribing", polling: true }, "polling"],
    ["connecting while subscribing without polling", { channel: "subscribing" }, "connecting"],
    ["connecting before any transport", {}, "connecting"],
  ])("%s", (_name, overrides, expected) => {
    expect(connectionOf({ ...initialFeedState(ROOM), ...overrides })).toBe(expected);
  });
});

describe("mergeMessages", () => {
  it("returns the existing array itself when nothing is new", () => {
    const existing = [m1, m2];
    expect(mergeMessages(existing, [m2])).toBe(existing);
    expect(mergeMessages(existing, [])).toBe(existing);
  });

  it("keeps the existing row when an incoming row has a known id", () => {
    const kept = { ...m1, text: "kept" };
    const replaced = { ...m1, text: "replaced" };
    expect(mergeMessages([kept], [replaced])).toEqual([kept]);
  });

  it("sorts out-of-order arrivals into tuple order", () => {
    expect(mergeMessages([m1, m3], [m4, m2])).toEqual([m1, m2, m3, m4]);
  });

  it("orders by microsecond before UUID within one millisecond", () => {
    const earlierWithLargerId = msg(2, 123100);
    const laterWithSmallerId = msg(1, 123900);
    expect(mergeMessages([], [laterWithSmallerId, earlierWithLargerId])).toEqual([
      earlierWithLargerId,
      laterWithSmallerId,
    ]);
  });

  it("dedupes within the incoming batch", () => {
    expect(mergeMessages([], [m1, m1])).toEqual([m1]);
  });

  it("handles empty inputs", () => {
    expect(mergeMessages([], [])).toEqual([]);
  });

  it("does not mutate its inputs", () => {
    const existing = [m2];
    const incoming = [m1];
    mergeMessages(existing, incoming);
    expect(existing).toEqual([m2]);
    expect(incoming).toEqual([m1]);
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `pnpm test src/lib/feed`
Expected: FAIL. Vitest cannot resolve the import `@/lib/feed/reducer` (the file does not exist yet).

- [ ] **Step 5: Implement the three helpers**

Create `src/lib/feed/reducer.ts`:

```ts
import type { Connection, FeedState } from "@/lib/feed/types";
import type { Message } from "@/lib/schemas/types";

import { compareCreatedAtId } from "@/lib/time/ordering";

/** Error message when initial history is empty twice (spec §5 "Opening"). */
export const EMPTY_HISTORY_MESSAGE = "Room has no messages";

export function initialFeedState(roomId: string): FeedState {
  return {
    roomId,
    status: "opening",
    hidden: false,
    messages: [],
    olderCursor: null,
    hasOlder: false,
    syncCursor: null,
    backlog: false,
    newerWanted: false,
    inflight: null,
    polling: false,
    channel: "none",
    error: null,
    initialRetried: false,
  };
}

/** What the panel shows: a confirmed channel wins, then a running poll timer. */
export function connectionOf(state: FeedState): Connection {
  if (state.channel === "subscribed") return "realtime";
  if (state.polling) return "polling";
  return "connecting";
}

/**
 * Dedupes `incoming` against `existing` by id (the existing row wins) and
 * returns the union in `compareCreatedAtId` order. `existing` must already be
 * sorted (the state invariant); it is returned as is when nothing is new.
 * Never mutates its inputs and never touches cursors.
 */
export function mergeMessages(existing: Message[], incoming: Message[]): Message[] {
  const known = new Set(existing.map((message) => message.id));
  const fresh: Message[] = [];
  for (const message of incoming) {
    if (known.has(message.id)) continue;
    known.add(message.id);
    fresh.push(message);
  }
  if (fresh.length === 0) return existing;
  return [...existing, ...fresh].sort(compareCreatedAtId);
}
```

- [ ] **Step 6: Run the tests and the project checks**

Run: `pnpm test src/lib/feed`
Expected: PASS, 1 file, 14 tests (1 initial state, 6 connection, 7 merge).

Run: `pnpm typecheck && pnpm lint`
Expected: both exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/lib/schemas/types.ts src/lib/feed/types.ts src/lib/feed/reducer.ts src/lib/feed/reducer.test.ts
git commit -m "feat(feed): add feed state types, initial state and message merging"
git status --short
```

(If both page types were already compatible, `git add src/lib/schemas/types.ts` is a harmless no-op.)

---

### Task 2: Reducer skeleton: guards, opening, channel outcomes, visibility and close

**Files:**
- Modify: `src/lib/feed/reducer.ts` (replace the whole file with the version below; it keeps Task 1's exports)
- Test: `src/lib/feed/reducer.test.ts` (append)

**Interfaces:**
- Consumes: Task 1's types and helpers.
- Produces: `feedReducer(state: FeedState, action: FeedAction): [FeedState, FeedEffect[]]` handling `opened`, `historyLoaded`, `subscribed`, `channelFailed`, `idle`, `visibilityChanged`, `closed`, plus the two guards (closed; terminal `notFound`). Every other action is ignored until Tasks 3–4 add it. Private helpers `ignore`, `sortPage`, `clearError`, `fetchNewer`, `autoCatchUp`, `enterPolling`, `dropChannel`, `selectInitialTransport` are reused by later tasks under these exact names.

- [ ] **Step 1: Append the table-test scaffolding and the opening/channel rows**

Append to `src/lib/feed/reducer.test.ts`. First extend the imports at the top of the file so they read:

```ts
import { describe, expect, it } from "vitest";

import type { FeedAction, FeedEffect, FeedError, FeedState } from "@/lib/feed/types";
import type { Message, MessagePage } from "@/lib/schemas/types";

import {
  EMPTY_HISTORY_MESSAGE,
  connectionOf,
  feedReducer,
  initialFeedState,
  mergeMessages,
} from "@/lib/feed/reducer";
```

Every table row checks state and action immutability, including paging transitions and ignored
actions. Retain these assertions as Tasks 3–4 add rows; they do not change the test count.

Then append at the end of the file:

```ts
// ---------------------------------------------------------------------------
// Transition table (spec §5). One row per rule; `after` lists only the fields
// that change, or "ignored" for "same state object back, no effects".
// ---------------------------------------------------------------------------

type Row = {
  name: string;
  before: FeedState;
  action: FeedAction;
  after: Partial<FeedState> | "ignored";
  effects?: FeedEffect[];
};

function check({ before, action, after, effects = [] }: Row): void {
  // Snapshot before reduction: expected values must not inherit an input mutation.
  const beforeSnapshot = structuredClone(before);
  const actionSnapshot = structuredClone(action);
  const expected = after === "ignored" ? beforeSnapshot : structuredClone({ ...before, ...after });
  const [next, fx] = feedReducer(before, action);
  expect(before).toEqual(beforeSnapshot);
  expect(action).toEqual(actionSnapshot);
  if (after === "ignored") {
    expect(next).toBe(before);
    expect(fx).toEqual([]);
    return;
  }
  expect(next).toEqual(expected);
  expect(fx).toEqual(effects);
}

/** `initialFeedState` plus overrides: an opening room. */
function state(overrides: Partial<FeedState> = {}): FeedState {
  return { ...initialFeedState(ROOM), ...overrides };
}

/** An open room showing m1..m2 over a confirmed channel (after history + subscribed). */
function live(overrides: Partial<FeedState> = {}): FeedState {
  return state({
    status: "open",
    messages: [m1, m2],
    olderCursor: m1.id,
    syncCursor: m2.id,
    hasOlder: true,
    channel: "subscribed",
    ...overrides,
  });
}

/** The same room in polling mode with no channel. */
function pollingRoom(overrides: Partial<FeedState> = {}): FeedState {
  return live({ channel: "none", polling: true, ...overrides });
}

const page = (messages: Message[], hasMore: boolean): MessagePage => ({ messages, hasMore });

const fetchInitial: FeedEffect = { type: "fetchInitial" };
const subscribe: FeedEffect = { type: "subscribe" };
const unsubscribe: FeedEffect = { type: "unsubscribe" };
const startPolling: FeedEffect = { type: "startPolling" };
const stopPolling: FeedEffect = { type: "stopPolling" };
const startIdleTimer: FeedEffect = { type: "startIdleTimer" };
const stopIdleTimer: FeedEffect = { type: "stopIdleTimer" };
const fetchNewer = (after: string): FeedEffect => ({ type: "fetchNewer", after });

const notFoundError: FeedError = { op: "newer", message: "gone", notFound: true };

describe("feedReducer guards", () => {
  it.each<Row>([
    {
      name: "ignores every action once closed",
      before: state({ status: "closed" }),
      action: { type: "opened", hidden: false },
      after: "ignored",
    },
    {
      name: "ignores visibility once closed",
      before: live({ status: "closed", channel: "none" }),
      action: { type: "visibilityChanged", hidden: true },
      after: "ignored",
    },
    {
      name: "ignores everything but closed after a room-gone error",
      before: live({ channel: "none", error: notFoundError }),
      action: { type: "visibilityChanged", hidden: true },
      after: "ignored",
    },
    {
      name: "still closes after a room-gone error",
      before: live({ channel: "none", error: notFoundError }),
      action: { type: "closed" },
      after: { status: "closed" },
      effects: [unsubscribe, stopPolling, stopIdleTimer],
    },
  ])("$name", (row) => check(row));
});

describe("feedReducer opening", () => {
  it.each<Row>([
    {
      name: "opened without a seed fetches initial history",
      before: state(),
      action: { type: "opened", hidden: false },
      after: { inflight: "initial" },
      effects: [fetchInitial],
    },
    {
      name: "opened while hidden records visibility and still fetches",
      before: state(),
      action: { type: "opened", hidden: true },
      after: { hidden: true, inflight: "initial" },
      effects: [fetchInitial],
    },
    {
      name: "opened with a seed is open at once and subscribes when visible",
      before: state(),
      action: { type: "opened", hidden: false, seed: m1 },
      after: {
        status: "open",
        messages: [m1],
        syncCursor: m1.id,
        olderCursor: m1.id,
        hasOlder: false,
        channel: "subscribing",
      },
      effects: [subscribe],
    },
    {
      name: "opened with a seed while hidden enters polling with an immediate catch-up",
      before: state(),
      action: { type: "opened", hidden: true, seed: m1 },
      after: {
        hidden: true,
        status: "open",
        messages: [m1],
        syncCursor: m1.id,
        olderCursor: m1.id,
        hasOlder: false,
        polling: true,
        inflight: "newer",
      },
      effects: [startPolling, fetchNewer(m1.id)],
    },
    {
      name: "opened while the initial fetch is in flight is ignored",
      before: state({ inflight: "initial" }),
      action: { type: "opened", hidden: false },
      after: "ignored",
    },
    {
      name: "opened on an open room is ignored",
      before: live(),
      action: { type: "opened", hidden: false },
      after: "ignored",
    },
    {
      name: "historyLoaded sorts the page, sets both cursors and subscribes",
      before: state({ inflight: "initial" }),
      action: { type: "historyLoaded", page: page([m2, m1], true) },
      after: {
        status: "open",
        inflight: null,
        messages: [m1, m2],
        olderCursor: m1.id,
        syncCursor: m2.id,
        hasOlder: true,
        channel: "subscribing",
      },
      effects: [subscribe],
    },
    {
      name: "historyLoaded while hidden enters polling instead of subscribing",
      before: state({ inflight: "initial", hidden: true }),
      action: { type: "historyLoaded", page: page([m1, m2], false) },
      after: {
        status: "open",
        inflight: "newer",
        messages: [m1, m2],
        olderCursor: m1.id,
        syncCursor: m2.id,
        hasOlder: false,
        polling: true,
      },
      effects: [startPolling, fetchNewer(m2.id)],
    },
    {
      name: "historyLoaded clears a previous initial error",
      before: state({
        inflight: "initial",
        initialRetried: true,
        error: { op: "initial", message: EMPTY_HISTORY_MESSAGE, notFound: false },
      }),
      action: { type: "historyLoaded", page: page([m1], false) },
      after: {
        status: "open",
        inflight: null,
        messages: [m1],
        olderCursor: m1.id,
        syncCursor: m1.id,
        hasOlder: false,
        error: null,
        channel: "subscribing",
      },
      effects: [subscribe],
    },
    {
      name: "historyLoaded with an empty page retries once",
      before: state({ inflight: "initial" }),
      action: { type: "historyLoaded", page: page([], false) },
      after: { initialRetried: true },
      effects: [fetchInitial],
    },
    {
      name: "historyLoaded empty a second time fails without a cursor or transport",
      before: state({ inflight: "initial", initialRetried: true }),
      action: { type: "historyLoaded", page: page([], false) },
      after: {
        inflight: null,
        error: { op: "initial", message: EMPTY_HISTORY_MESSAGE, notFound: false },
      },
    },
    {
      name: "historyLoaded without an initial fetch in flight is ignored",
      before: live(),
      action: { type: "historyLoaded", page: page([m3], false) },
      after: "ignored",
    },
  ])("$name", (row) => check(row));
});

describe("feedReducer channel outcomes", () => {
  it.each<Row>([
    {
      name: "subscribed starts the idle timer and catches up after the bookmark",
      before: live({ channel: "subscribing" }),
      action: { type: "subscribed" },
      after: { channel: "subscribed", inflight: "newer" },
      effects: [startIdleTimer, fetchNewer(m2.id)],
    },
    {
      name: "subscribed while polling stops the poll timer first",
      before: pollingRoom({ channel: "subscribing" }),
      action: { type: "subscribed" },
      after: { channel: "subscribed", polling: false, inflight: "newer" },
      effects: [stopPolling, startIdleTimer, fetchNewer(m2.id)],
    },
    {
      name: "subscribed with a backlog does not fetch automatically",
      before: live({ channel: "subscribing", backlog: true }),
      action: { type: "subscribed" },
      after: { channel: "subscribed" },
      effects: [startIdleTimer],
    },
    {
      name: "subscribed while a fetch is in flight owes the catch-up",
      before: live({ channel: "subscribing", inflight: "older" }),
      action: { type: "subscribed" },
      after: { channel: "subscribed", newerWanted: true },
      effects: [startIdleTimer],
    },
    {
      name: "subscribed while hidden is ignored",
      before: live({ channel: "subscribing", hidden: true }),
      action: { type: "subscribed" },
      after: "ignored",
    },
    {
      name: "subscribed with no pending attempt is ignored",
      before: pollingRoom(),
      action: { type: "subscribed" },
      after: "ignored",
    },
    {
      name: "channelFailed on the initial join cleans up and enters polling",
      before: live({ channel: "subscribing" }),
      action: { type: "channelFailed", reason: "too_many_connections" },
      after: { channel: "none", polling: true, inflight: "newer" },
      effects: [unsubscribe, stopIdleTimer, startPolling, fetchNewer(m2.id)],
    },
    {
      name: "channelFailed on a re-subscribe keeps the running poll timer",
      before: pollingRoom({ channel: "subscribing" }),
      action: { type: "channelFailed", reason: "TIMED_OUT" },
      after: { channel: "none" },
      effects: [unsubscribe, stopIdleTimer],
    },
    {
      name: "channelFailed after subscribed enters polling with an immediate catch-up",
      before: live(),
      action: { type: "channelFailed", reason: "CLOSED" },
      after: { channel: "none", polling: true, inflight: "newer" },
      effects: [unsubscribe, stopIdleTimer, startPolling, fetchNewer(m2.id)],
    },
    {
      name: "channelFailed with no channel is ignored",
      before: pollingRoom(),
      action: { type: "channelFailed", reason: "CLOSED" },
      after: "ignored",
    },
    {
      name: "idle in realtime drops the channel and enters polling",
      before: live(),
      action: { type: "idle" },
      after: { channel: "none", polling: true, inflight: "newer" },
      effects: [unsubscribe, stopIdleTimer, startPolling, fetchNewer(m2.id)],
    },
    {
      name: "idle while polling is ignored",
      before: pollingRoom(),
      action: { type: "idle" },
      after: "ignored",
    },
    {
      name: "idle while subscribing is ignored",
      before: live({ channel: "subscribing" }),
      action: { type: "idle" },
      after: "ignored",
    },
    {
      name: "becoming visible only records visibility",
      before: pollingRoom({ hidden: true }),
      action: { type: "visibilityChanged", hidden: false },
      after: { hidden: false },
    },
    {
      name: "becoming visible while already visible is ignored",
      before: live(),
      action: { type: "visibilityChanged", hidden: false },
      after: "ignored",
    },
    {
      name: "hiding in realtime drops the channel and enters polling",
      before: live(),
      action: { type: "visibilityChanged", hidden: true },
      after: { hidden: true, channel: "none", polling: true, inflight: "newer" },
      effects: [unsubscribe, stopIdleTimer, startPolling, fetchNewer(m2.id)],
    },
    {
      name: "hiding during the initial join cancels it and enters polling",
      before: live({ channel: "subscribing" }),
      action: { type: "visibilityChanged", hidden: true },
      after: { hidden: true, channel: "none", polling: true, inflight: "newer" },
      effects: [unsubscribe, stopIdleTimer, startPolling, fetchNewer(m2.id)],
    },
    {
      name: "hiding during a re-subscribe cancels it and keeps polling",
      before: pollingRoom({ channel: "subscribing" }),
      action: { type: "visibilityChanged", hidden: true },
      after: { hidden: true, channel: "none" },
      effects: [unsubscribe, stopIdleTimer],
    },
    {
      name: "hiding while polling only records visibility",
      before: pollingRoom(),
      action: { type: "visibilityChanged", hidden: true },
      after: { hidden: true },
    },
    {
      name: "hiding during opening only records visibility",
      before: state({ inflight: "initial" }),
      action: { type: "visibilityChanged", hidden: true },
      after: { hidden: true },
    },
    {
      name: "a repeated hidden event while polling is ignored",
      before: pollingRoom({ hidden: true }),
      action: { type: "visibilityChanged", hidden: true },
      after: "ignored",
    },
    {
      name: "closed from realtime emits every cleanup",
      before: live(),
      action: { type: "closed" },
      after: { status: "closed", channel: "none", polling: false },
      effects: [unsubscribe, stopPolling, stopIdleTimer],
    },
    {
      name: "closed while opening emits every cleanup too",
      before: state({ inflight: "initial" }),
      action: { type: "closed" },
      after: { status: "closed" },
      effects: [unsubscribe, stopPolling, stopIdleTimer],
    },
    {
      name: "closed while polling stops it",
      before: pollingRoom(),
      action: { type: "closed" },
      after: { status: "closed", polling: false },
      effects: [unsubscribe, stopPolling, stopIdleTimer],
    },
  ])("$name", (row) => check(row));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/lib/feed`
Expected: FAIL. `feedReducer` is not yet exported from `@/lib/feed/reducer`, so Vite resolves the import to `undefined` and every table row fails with `TypeError: feedReducer is not a function`; Task 1's 14 tests still pass.

- [ ] **Step 3: Implement the reducer skeleton**

Replace `src/lib/feed/reducer.ts` with:

```ts
import type {
  Connection,
  FeedAction,
  FeedEffect,
  FeedState,
  FetchOp,
} from "@/lib/feed/types";
import type { Message } from "@/lib/schemas/types";

import { compareCreatedAtId } from "@/lib/time/ordering";

/** Error message when initial history is empty twice (spec §5 "Opening"). */
export const EMPTY_HISTORY_MESSAGE = "Room has no messages";

type Result = [FeedState, FeedEffect[]];

export function initialFeedState(roomId: string): FeedState {
  return {
    roomId,
    status: "opening",
    hidden: false,
    messages: [],
    olderCursor: null,
    hasOlder: false,
    syncCursor: null,
    backlog: false,
    newerWanted: false,
    inflight: null,
    polling: false,
    channel: "none",
    error: null,
    initialRetried: false,
  };
}

/** What the panel shows: a confirmed channel wins, then a running poll timer. */
export function connectionOf(state: FeedState): Connection {
  if (state.channel === "subscribed") return "realtime";
  if (state.polling) return "polling";
  return "connecting";
}

/**
 * Dedupes `incoming` against `existing` by id (the existing row wins) and
 * returns the union in `compareCreatedAtId` order. `existing` must already be
 * sorted (the state invariant); it is returned as is when nothing is new.
 * Never mutates its inputs and never touches cursors.
 */
export function mergeMessages(existing: Message[], incoming: Message[]): Message[] {
  const known = new Set(existing.map((message) => message.id));
  const fresh: Message[] = [];
  for (const message of incoming) {
    if (known.has(message.id)) continue;
    known.add(message.id);
    fresh.push(message);
  }
  if (fresh.length === 0) return existing;
  return [...existing, ...fresh].sort(compareCreatedAtId);
}

// ---------------------------------------------------------------------------
// Helpers. Each takes the effect list to append to and returns the next state.
// Effect order inside a helper is part of the contract (spec §5).
// ---------------------------------------------------------------------------

/** The action does not apply: same state object, no effects. */
function ignore(state: FeedState): Result {
  return [state, []];
}

/** A server page in tuple order, deduped, so cursors never depend on arrival order. */
function sortPage(messages: Message[]): Message[] {
  return mergeMessages([], messages);
}

/** Clears the error only when it belongs to the operation that just succeeded. */
function clearError(state: FeedState, op: FetchOp): FeedState {
  return state.error?.op === op ? { ...state, error: null } : state;
}

function fetchNewer(state: FeedState, after: string, fx: FeedEffect[]): FeedState {
  fx.push({ type: "fetchNewer", after });
  return { ...state, inflight: "newer" };
}

/**
 * Auto catch-up (spec §5): a backlog owns the cursor, so do nothing; an
 * in-flight fetch defers it (`newerWanted`); otherwise fetch after the bookmark.
 */
function autoCatchUp(state: FeedState, fx: FeedEffect[]): FeedState {
  if (state.backlog) return state;
  if (state.inflight !== null) return { ...state, newerWanted: true };
  if (state.syncCursor === null) return state;
  return fetchNewer(state, state.syncCursor, fx);
}

/** Enter polling: start the timer once, then auto catch-up. Already polling: no-op. */
function enterPolling(state: FeedState, fx: FeedEffect[]): FeedState {
  if (state.polling) return state;
  fx.push({ type: "startPolling" });
  return autoCatchUp({ ...state, polling: true }, fx);
}

/** Drop channel: unsubscribe (idempotent), stop the idle timer, forget the channel. */
function dropChannel(state: FeedState, fx: FeedEffect[]): FeedState {
  fx.push({ type: "unsubscribe" }, { type: "stopIdleTimer" });
  return { ...state, channel: "none" };
}

/** Select initial transport: hidden rooms poll; visible rooms try realtime. */
function selectInitialTransport(state: FeedState, fx: FeedEffect[]): FeedState {
  if (state.hidden) return enterPolling(state, fx);
  fx.push({ type: "subscribe" });
  return { ...state, channel: "subscribing" };
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

/**
 * Pure transition function of the room feed (spec §5). Returns the next state
 * and the effects the store must run, in order. An action the state does not
 * accept returns the same state object and no effects.
 */
export function feedReducer(state: FeedState, action: FeedAction): Result {
  if (state.status === "closed") return ignore(state);
  if (state.error?.notFound && action.type !== "closed") return ignore(state);

  const fx: FeedEffect[] = [];

  switch (action.type) {
    case "opened": {
      if (state.status !== "opening" || state.inflight !== null) return ignore(state);
      if (!action.seed) {
        fx.push({ type: "fetchInitial" });
        return [{ ...state, hidden: action.hidden, inflight: "initial" }, fx];
      }
      const seeded: FeedState = {
        ...state,
        hidden: action.hidden,
        status: "open",
        messages: [action.seed],
        syncCursor: action.seed.id,
        olderCursor: action.seed.id,
        hasOlder: false,
      };
      return [selectInitialTransport(seeded, fx), fx];
    }

    case "historyLoaded": {
      if (state.inflight !== "initial") return ignore(state);
      const messages = sortPage(action.page.messages);
      if (messages.length === 0) {
        if (!state.initialRetried) {
          fx.push({ type: "fetchInitial" });
          return [{ ...state, initialRetried: true }, fx];
        }
        const error = { op: "initial" as const, message: EMPTY_HISTORY_MESSAGE, notFound: false };
        return [{ ...state, inflight: null, error }, fx];
      }
      const loaded: FeedState = {
        ...clearError(state, "initial"),
        status: "open",
        inflight: null,
        messages,
        olderCursor: messages[0].id,
        syncCursor: messages[messages.length - 1].id,
        hasOlder: action.page.hasMore,
      };
      return [selectInitialTransport(loaded, fx), fx];
    }

    case "subscribed": {
      if (state.channel !== "subscribing" || state.hidden) return ignore(state);
      let next: FeedState = { ...state, channel: "subscribed" };
      if (next.polling) {
        fx.push({ type: "stopPolling" });
        next = { ...next, polling: false };
      }
      fx.push({ type: "startIdleTimer" });
      return [autoCatchUp(next, fx), fx];
    }

    case "channelFailed": {
      if (state.channel === "none") return ignore(state);
      // `action.reason` is for the store's logging; the state has no field for it.
      return [enterPolling(dropChannel(state, fx), fx), fx];
    }

    case "idle": {
      if (state.channel !== "subscribed") return ignore(state);
      return [enterPolling(dropChannel(state, fx), fx), fx];
    }

    case "visibilityChanged": {
      if (action.hidden === state.hidden) return ignore(state);
      if (!action.hidden) return [{ ...state, hidden: false }, fx];
      let next: FeedState = { ...state, hidden: true };
      if (next.channel !== "none") next = dropChannel(next, fx);
      if (next.status === "open" && !next.polling) next = enterPolling(next, fx);
      return [next, fx];
    }

    case "closed": {
      fx.push({ type: "unsubscribe" }, { type: "stopPolling" }, { type: "stopIdleTimer" });
      return [{ ...state, status: "closed", channel: "none", polling: false }, fx];
    }

    default:
      return ignore(state);
  }
}
```

- [ ] **Step 4: Run the tests and the project checks**

Run: `pnpm test src/lib/feed`
Expected: PASS, 1 file, 54 tests (14 from Task 1, 4 guards, 12 opening, 24 channel outcomes).

Run: `pnpm typecheck && pnpm lint`
Expected: both exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/lib/feed/reducer.ts src/lib/feed/reducer.test.ts
git commit -m "feat(feed): reduce opening, channel, visibility and close transitions"
git status --short
```

---

### Task 3: Fetching newer and older, receiving and sending

**Files:**
- Modify: `src/lib/feed/reducer.ts` (add one helper and seven `case` blocks)
- Test: `src/lib/feed/reducer.test.ts` (append)

**Interfaces:**
- Consumes: Task 2's helpers `ignore`, `sortPage`, `clearError`, `fetchNewer`, `autoCatchUp`.
- Produces: `feedReducer` handling `pollTick`, `newerRequested`, `newerLoaded`, `olderRequested`, `olderLoaded`, `received`, `sent`; private helper `runOwedCatchUp(state, fx)` reused by Task 4.

- [ ] **Step 1: Append the paging, receive and send rows**

Extend the `@/lib/schemas/types` import at the top of `src/lib/feed/reducer.test.ts` to:

```ts
import type { CatchUpPage, Message, MessagePage } from "@/lib/schemas/types";
```

Add `m0` next to the other fixtures (after `const m4 = msg(4);`):

```ts
const m0 = msg(0);
```

Then append at the end of the file:

```ts
const catchUp = (messages: Message[], nextCursor: string, hasMore: boolean): CatchUpPage => ({
  messages,
  nextCursor,
  hasMore,
});
const fetchOlder = (before: string): FeedEffect => ({ type: "fetchOlder", before });

describe("feedReducer fetching newer", () => {
  it.each<Row>([
    {
      name: "pollTick while polling and idle fetches after the bookmark",
      before: pollingRoom(),
      action: { type: "pollTick" },
      after: { inflight: "newer" },
      effects: [fetchNewer(m2.id)],
    },
    {
      name: "pollTick while a fetch is in flight is ignored",
      before: pollingRoom({ inflight: "older" }),
      action: { type: "pollTick" },
      after: "ignored",
    },
    {
      name: "pollTick during a backlog is ignored",
      before: pollingRoom({ backlog: true }),
      action: { type: "pollTick" },
      after: "ignored",
    },
    {
      name: "pollTick in realtime is ignored",
      before: live(),
      action: { type: "pollTick" },
      after: "ignored",
    },
    {
      name: "pollTick without a bookmark is ignored",
      before: pollingRoom({ syncCursor: null }),
      action: { type: "pollTick" },
      after: "ignored",
    },
    {
      name: "newerRequested drains a backlog while polling",
      before: pollingRoom({ backlog: true }),
      action: { type: "newerRequested" },
      after: { inflight: "newer" },
      effects: [fetchNewer(m2.id)],
    },
    {
      name: "newerRequested drains a backlog in realtime",
      before: live({ backlog: true }),
      action: { type: "newerRequested" },
      after: { inflight: "newer" },
      effects: [fetchNewer(m2.id)],
    },
    {
      name: "newerRequested while a fetch is in flight is ignored",
      before: live({ inflight: "newer" }),
      action: { type: "newerRequested" },
      after: "ignored",
    },
    {
      name: "newerRequested while opening is ignored",
      before: state({ inflight: "initial" }),
      action: { type: "newerRequested" },
      after: "ignored",
    },
    {
      name: "newerLoaded merges and advances the bookmark to nextCursor",
      before: pollingRoom({ inflight: "newer" }),
      action: { type: "newerLoaded", page: catchUp([m3, m4], m4.id, false) },
      after: { inflight: null, messages: [m1, m2, m3, m4], syncCursor: m4.id },
    },
    {
      name: "newerLoaded trusts nextCursor even for an empty page",
      before: pollingRoom({ inflight: "newer" }),
      action: { type: "newerLoaded", page: catchUp([], m3.id, false) },
      after: { inflight: null, syncCursor: m3.id },
    },
    {
      name: "newerLoaded with hasMore records a backlog",
      before: pollingRoom({ inflight: "newer" }),
      action: { type: "newerLoaded", page: catchUp([m3], m3.id, true) },
      after: { inflight: null, messages: [m1, m2, m3], syncCursor: m3.id, backlog: true },
    },
    {
      name: "newerLoaded without hasMore clears the backlog",
      before: pollingRoom({ inflight: "newer", backlog: true }),
      action: { type: "newerLoaded", page: catchUp([m3], m3.id, false) },
      after: { inflight: null, messages: [m1, m2, m3], syncCursor: m3.id, backlog: false },
    },
    {
      name: "newerLoaded runs an owed catch-up from the new bookmark",
      before: pollingRoom({ inflight: "newer", newerWanted: true }),
      action: { type: "newerLoaded", page: catchUp([m3], m3.id, false) },
      after: { inflight: "newer", newerWanted: false, messages: [m1, m2, m3], syncCursor: m3.id },
      effects: [fetchNewer(m3.id)],
    },
    {
      name: "newerLoaded with an owed catch-up but a backlog only clears the flag",
      before: pollingRoom({ inflight: "newer", newerWanted: true }),
      action: { type: "newerLoaded", page: catchUp([m3], m3.id, true) },
      after: {
        inflight: null,
        newerWanted: false,
        backlog: true,
        messages: [m1, m2, m3],
        syncCursor: m3.id,
      },
    },
    {
      name: "newerLoaded dedupes a message already shown from a POST response",
      before: pollingRoom({ inflight: "newer", messages: [m1, m2, m4] }),
      action: { type: "newerLoaded", page: catchUp([m3, m4], m4.id, false) },
      after: { inflight: null, messages: [m1, m2, m3, m4], syncCursor: m4.id },
    },
    {
      name: "newerLoaded clears a newer error",
      before: pollingRoom({
        inflight: "newer",
        error: { op: "newer", message: "boom", notFound: false },
      }),
      action: { type: "newerLoaded", page: catchUp([m3], m3.id, false) },
      after: { inflight: null, messages: [m1, m2, m3], syncCursor: m3.id, error: null },
    },
    {
      name: "newerLoaded keeps an older error",
      before: pollingRoom({
        inflight: "newer",
        error: { op: "older", message: "boom", notFound: false },
      }),
      action: { type: "newerLoaded", page: catchUp([m3], m3.id, false) },
      after: { inflight: null, messages: [m1, m2, m3], syncCursor: m3.id },
    },
    {
      name: "newerLoaded without a newer fetch in flight is ignored",
      before: pollingRoom(),
      action: { type: "newerLoaded", page: catchUp([m3], m3.id, false) },
      after: "ignored",
    },
  ])("$name", (row) => check(row));
});

describe("feedReducer fetching older", () => {
  it.each<Row>([
    {
      name: "olderRequested fetches before the older cursor",
      before: live(),
      action: { type: "olderRequested" },
      after: { inflight: "older" },
      effects: [fetchOlder(m1.id)],
    },
    {
      name: "olderRequested with nothing older is ignored",
      before: live({ hasOlder: false }),
      action: { type: "olderRequested" },
      after: "ignored",
    },
    {
      name: "a second olderRequested before the page lands is ignored",
      before: live({ inflight: "older" }),
      action: { type: "olderRequested" },
      after: "ignored",
    },
    {
      name: "olderRequested while opening is ignored",
      before: state({ inflight: "initial" }),
      action: { type: "olderRequested" },
      after: "ignored",
    },
    {
      name: "olderLoaded prepends, moves the older cursor and leaves the bookmark",
      before: live({ inflight: "older", messages: [m3, m4], olderCursor: m3.id, syncCursor: m4.id }),
      action: { type: "olderLoaded", page: page([m1, m2], true) },
      after: {
        inflight: null,
        messages: [m1, m2, m3, m4],
        olderCursor: m1.id,
        hasOlder: true,
        syncCursor: m4.id,
      },
    },
    {
      name: "olderLoaded on the last page hides Load older",
      before: live({ inflight: "older", messages: [m2, m3], olderCursor: m2.id, syncCursor: m3.id }),
      action: { type: "olderLoaded", page: page([m1], false) },
      after: { inflight: null, messages: [m1, m2, m3], olderCursor: m1.id, hasOlder: false },
    },
    {
      name: "olderLoaded with an empty page keeps the cursor",
      before: live({ inflight: "older" }),
      action: { type: "olderLoaded", page: page([], false) },
      after: { inflight: null, hasOlder: false },
    },
    {
      name: "olderLoaded runs an owed catch-up",
      before: live({ inflight: "older", newerWanted: true }),
      action: { type: "olderLoaded", page: page([m0], false) },
      after: {
        inflight: "newer",
        newerWanted: false,
        messages: [m0, m1, m2],
        olderCursor: m0.id,
        hasOlder: false,
      },
      effects: [fetchNewer(m2.id)],
    },
    {
      name: "olderLoaded clears an older error",
      before: live({ inflight: "older", error: { op: "older", message: "boom", notFound: false } }),
      action: { type: "olderLoaded", page: page([m0], false) },
      after: { inflight: null, messages: [m0, m1, m2], olderCursor: m0.id, hasOlder: false, error: null },
    },
    {
      name: "olderLoaded without an older fetch in flight is ignored",
      before: live(),
      action: { type: "olderLoaded", page: page([m0], false) },
      after: "ignored",
    },
  ])("$name", (row) => check(row));
});

describe("feedReducer receiving and sending", () => {
  it.each<Row>([
    {
      name: "received appends a live message without moving the bookmark",
      before: live(),
      action: { type: "received", message: m3 },
      after: { messages: [m1, m2, m3] },
    },
    {
      name: "received with a duplicate id is a no-op",
      before: live(),
      action: { type: "received", message: m2 },
      after: "ignored",
    },
    {
      name: "received out of order is sorted in",
      before: live({ messages: [m1, m3] }),
      action: { type: "received", message: m2 },
      after: { messages: [m1, m2, m3] },
    },
    {
      name: "received during a backlog is displayed and the backlog stays",
      before: live({ backlog: true }),
      action: { type: "received", message: m3 },
      after: { messages: [m1, m2, m3] },
    },
    {
      name: "received while opening is ignored",
      before: state({ inflight: "initial" }),
      action: { type: "received", message: m1 },
      after: "ignored",
    },
    {
      name: "sent in realtime restarts the idle timer",
      before: live(),
      action: { type: "sent" },
      after: {},
      effects: [startIdleTimer],
    },
    {
      name: "sent while polling tries realtime and keeps polling",
      before: pollingRoom(),
      action: { type: "sent" },
      after: { channel: "subscribing" },
      effects: [subscribe],
    },
    {
      name: "sent while a re-subscribe is pending does not subscribe again",
      before: pollingRoom({ channel: "subscribing" }),
      action: { type: "sent" },
      after: "ignored",
    },
    {
      name: "sent while hidden does not subscribe",
      before: pollingRoom({ hidden: true }),
      action: { type: "sent" },
      after: "ignored",
    },
    {
      name: "sent while opening is ignored",
      before: state({ inflight: "initial" }),
      action: { type: "sent" },
      after: "ignored",
    },
  ])("$name", (row) => check(row));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/lib/feed`
Expected: FAIL. Every row whose `after` is not `"ignored"` fails (for example "pollTick while polling and idle fetches after the bookmark" expects `inflight: "newer"` but the default branch returns the unchanged state). Rows expecting `"ignored"` pass already.

- [ ] **Step 3: Add the helper and the seven cases**

In `src/lib/feed/reducer.ts`, add this helper directly after `autoCatchUp`:

```ts
/** Runs a deferred catch-up once the blocking fetch has settled (spec §5 `newerLoaded`). */
function runOwedCatchUp(state: FeedState, fx: FeedEffect[]): FeedState {
  if (!state.newerWanted) return state;
  return autoCatchUp({ ...state, newerWanted: false }, fx);
}
```

Then insert these cases in `feedReducer`, before the `default:` line:

```ts
    case "pollTick": {
      if (!state.polling || state.inflight !== null || state.backlog) return ignore(state);
      if (state.syncCursor === null) return ignore(state);
      return [fetchNewer(state, state.syncCursor, fx), fx];
    }

    case "newerRequested": {
      if (state.status !== "open" || state.inflight !== null) return ignore(state);
      if (state.syncCursor === null) return ignore(state);
      return [fetchNewer(state, state.syncCursor, fx), fx];
    }

    case "newerLoaded": {
      if (state.inflight !== "newer") return ignore(state);
      const next: FeedState = {
        ...clearError(state, "newer"),
        inflight: null,
        messages: mergeMessages(state.messages, action.page.messages),
        syncCursor: action.page.nextCursor,
        backlog: action.page.hasMore,
      };
      return [runOwedCatchUp(next, fx), fx];
    }

    case "olderRequested": {
      if (state.status !== "open" || state.inflight !== null || !state.hasOlder) {
        return ignore(state);
      }
      if (state.olderCursor === null) return ignore(state);
      fx.push({ type: "fetchOlder", before: state.olderCursor });
      return [{ ...state, inflight: "older" }, fx];
    }

    case "olderLoaded": {
      if (state.inflight !== "older") return ignore(state);
      const older = sortPage(action.page.messages);
      const next: FeedState = {
        ...clearError(state, "older"),
        inflight: null,
        messages: mergeMessages(state.messages, older),
        olderCursor: older.length > 0 ? older[0].id : state.olderCursor,
        hasOlder: action.page.hasMore,
      };
      return [runOwedCatchUp(next, fx), fx];
    }

    case "received": {
      if (state.status !== "open") return ignore(state);
      const messages = mergeMessages(state.messages, [action.message]);
      if (messages === state.messages) return ignore(state);
      return [{ ...state, messages }, fx];
    }

    case "sent": {
      if (state.hidden) return ignore(state);
      if (state.channel === "subscribed") {
        fx.push({ type: "startIdleTimer" });
        return [state, fx];
      }
      if (state.status === "open" && state.channel === "none") {
        fx.push({ type: "subscribe" });
        return [{ ...state, channel: "subscribing" }, fx];
      }
      return ignore(state);
    }
```

- [ ] **Step 4: Run the tests and the project checks**

Run: `pnpm test src/lib/feed`
Expected: PASS, 1 file, 93 tests (54 from before, 19 newer, 10 older, 10 receive/send).

Run: `pnpm typecheck && pnpm lint`
Expected: both exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/lib/feed/reducer.ts src/lib/feed/reducer.test.ts
git commit -m "feat(feed): reduce history paging, catch-up, receive and send"
git status --short
```

---

### Task 4: Fetch failures, error dismissal and exhaustiveness

**Files:**
- Modify: `src/lib/feed/reducer.ts` (two `case` blocks; replace `default`)
- Test: `src/lib/feed/reducer.test.ts` (append)

**Interfaces:**
- Consumes: Task 2/3 helpers `ignore`, `dropChannel`, `runOwedCatchUp`.
- Produces: `feedReducer` handling `fetchFailed` and `errorDismissed`; the `switch` becomes exhaustive over `FeedAction` so adding an action without a case is a type error.

- [ ] **Step 1: Append the failure rows**

Extend the `@/lib/feed/types` import at the top of `src/lib/feed/reducer.test.ts` to:

```ts
import type { FeedAction, FeedEffect, FeedError, FeedState, FetchOp } from "@/lib/feed/types";
```

Then append at the end of the file:

```ts
const failure = (op: FetchOp, message = "boom"): FeedError => ({ op, message, notFound: false });
const failed = (op: FetchOp, message = "boom"): FeedAction => ({
  type: "fetchFailed",
  op,
  message,
  notFound: false,
});

describe("feedReducer failures and dismissal", () => {
  it.each<Row>([
    {
      name: "initial failure keeps the room opening with no transport",
      before: state({ inflight: "initial" }),
      action: failed("initial"),
      after: { inflight: null, error: failure("initial") },
    },
    {
      name: "initial failure clears an owed catch-up",
      before: state({ inflight: "initial", newerWanted: true }),
      action: failed("initial"),
      after: { inflight: null, newerWanted: false, error: failure("initial") },
    },
    {
      name: "older failure with nothing owed only records the error",
      before: live({ inflight: "older" }),
      action: failed("older"),
      after: { inflight: null, error: failure("older") },
    },
    {
      name: "older failure releases an owed catch-up even in realtime",
      before: live({ inflight: "older", newerWanted: true }),
      action: failed("older"),
      after: { inflight: "newer", newerWanted: false, error: failure("older") },
      effects: [fetchNewer(m2.id)],
    },
    {
      name: "older failure with an owed catch-up but a backlog only clears the flag",
      before: live({ inflight: "older", newerWanted: true, backlog: true }),
      action: failed("older"),
      after: { inflight: null, newerWanted: false, error: failure("older") },
    },
    {
      name: "newer failure in realtime drops the channel and polls without an immediate retry",
      before: live({ inflight: "newer" }),
      action: failed("newer"),
      after: { inflight: null, channel: "none", polling: true, error: failure("newer") },
      effects: [unsubscribe, stopIdleTimer, startPolling],
    },
    {
      name: "newer failure while polling waits for the next tick",
      before: pollingRoom({ inflight: "newer" }),
      action: failed("newer"),
      after: { inflight: null, error: failure("newer") },
    },
    {
      name: "newer failure during a re-subscribe keeps the interval and the attempt",
      before: pollingRoom({ inflight: "newer", channel: "subscribing" }),
      action: failed("newer"),
      after: { inflight: null, error: failure("newer") },
    },
    {
      name: "newer failure during the initial join leaves the attempt to decide",
      before: live({ inflight: "newer", channel: "subscribing" }),
      action: failed("newer"),
      after: { inflight: null, error: failure("newer") },
    },
    {
      name: "newer failure keeps a backlog and its cursor",
      before: pollingRoom({ inflight: "newer", backlog: true }),
      action: failed("newer"),
      after: { inflight: null, error: failure("newer") },
    },
    {
      name: "newer failure clears an owed catch-up",
      before: pollingRoom({ inflight: "newer", newerWanted: true }),
      action: failed("newer"),
      after: { inflight: null, newerWanted: false, error: failure("newer") },
    },
    {
      name: "a failure for a different operation is ignored",
      before: live({ inflight: "older" }),
      action: failed("newer"),
      after: "ignored",
    },
    {
      name: "a failure with nothing in flight is ignored",
      before: live(),
      action: failed("newer"),
      after: "ignored",
    },
    {
      name: "a 404 in realtime is terminal: every transport stops",
      before: live({ inflight: "newer" }),
      action: { type: "fetchFailed", op: "newer", message: "gone", notFound: true },
      after: {
        inflight: null,
        channel: "none",
        polling: false,
        error: { op: "newer", message: "gone", notFound: true },
      },
      effects: [unsubscribe, stopIdleTimer, stopPolling],
    },
    {
      name: "a 404 while polling is terminal too",
      before: pollingRoom({ inflight: "newer", newerWanted: true }),
      action: { type: "fetchFailed", op: "newer", message: "gone", notFound: true },
      after: {
        inflight: null,
        newerWanted: false,
        polling: false,
        error: { op: "newer", message: "gone", notFound: true },
      },
      effects: [unsubscribe, stopIdleTimer, stopPolling],
    },
    {
      name: "a 404 during opening is terminal",
      before: state({ inflight: "initial" }),
      action: { type: "fetchFailed", op: "initial", message: "gone", notFound: true },
      after: { inflight: null, error: { op: "initial", message: "gone", notFound: true } },
      effects: [unsubscribe, stopIdleTimer, stopPolling],
    },
    {
      name: "errorDismissed clears an ordinary error",
      before: live({ error: failure("older") }),
      action: { type: "errorDismissed" },
      after: { error: null },
    },
    {
      name: "errorDismissed with no error is ignored",
      before: live(),
      action: { type: "errorDismissed" },
      after: "ignored",
    },
    {
      name: "errorDismissed cannot clear a room-gone error",
      before: live({ channel: "none", error: notFoundError }),
      action: { type: "errorDismissed" },
      after: "ignored",
    },
    {
      name: "sent after a room-gone error is ignored",
      before: live({ channel: "none", error: notFoundError }),
      action: { type: "sent" },
      after: "ignored",
    },
    {
      name: "newerRequested after a room-gone error is ignored",
      before: live({ channel: "none", error: notFoundError }),
      action: { type: "newerRequested" },
      after: "ignored",
    },
  ])("$name", (row) => check(row));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/lib/feed`
Expected: FAIL on the rows that expect a state change (for example "initial failure keeps the room opening with no transport"); the "ignored" rows pass.

- [ ] **Step 3: Add the two cases and make the switch exhaustive**

In `feedReducer` in `src/lib/feed/reducer.ts`, insert before `default:`:

```ts
    case "fetchFailed": {
      if (state.inflight !== action.op) return ignore(state);
      const failed: FeedState = {
        ...state,
        inflight: null,
        error: { op: action.op, message: action.message, notFound: action.notFound },
      };
      if (action.notFound) {
        // The room is gone: no retries, no transports; only `closed` is accepted from here.
        fx.push({ type: "unsubscribe" }, { type: "stopIdleTimer" }, { type: "stopPolling" });
        return [{ ...failed, newerWanted: false, channel: "none", polling: false }, fx];
      }
      if (action.op === "initial") return [{ ...failed, newerWanted: false }, fx];
      if (action.op === "older") return [runOwedCatchUp(failed, fx), fx];
      // newer: keep the bookmark; the next poll tick (or the backlog button) retries.
      const stalled: FeedState = { ...failed, newerWanted: false };
      if (stalled.channel !== "subscribed") return [stalled, fx];
      const dropped = dropChannel(stalled, fx);
      fx.push({ type: "startPolling" });
      return [{ ...dropped, polling: true }, fx];
    }

    case "errorDismissed": {
      if (state.error === null) return ignore(state);
      return [{ ...state, error: null }, fx];
    }
```

Then replace the `default:` branch with an exhaustiveness check:

```ts
    default: {
      const unreachable: never = action;
      return unreachable;
    }
```

(`never` is assignable to the return type, and TypeScript reports an error on the assignment if any `FeedAction` member lacks a `case`.)

- [ ] **Step 4: Run the tests and the project checks**

Run: `pnpm test src/lib/feed`
Expected: PASS, 1 file, 114 tests (93 from before, 21 failures/dismissal).

Run: `pnpm typecheck && pnpm lint`
Expected: both exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/lib/feed/reducer.ts src/lib/feed/reducer.test.ts
git commit -m "feat(feed): reduce fetch failures with polling recovery and a terminal 404"
git status --short
```

---

### Task 5: Named scenarios, README section and final verification

**Files:**
- Test: `src/lib/feed/reducer.test.ts` (append)
- Modify: `README.md` (new "Room feed" section before `## Tests`)

**Interfaces:**
- Consumes: the complete `feedReducer`.
- Produces: the multi-step scenarios named in spec §5 "Edge cases", §9 (F-004 sequences) and PRD §8 (bookmark advancement); the README handoff for chunk 9.

These tests exercise sequences of actions. They should pass without touching the reducer; if one fails, the reducer has a bug against the spec: fix the reducer (and the affected table row, if a row encoded the same mistake), do not weaken the scenario.

- [ ] **Step 1: Append the scenario tests**

Append at the end of `src/lib/feed/reducer.test.ts`:

```ts
// ---------------------------------------------------------------------------
// Scenarios: sequences from spec §5 "Edge cases", §9 (F-004) and PRD §8.
// ---------------------------------------------------------------------------

/** Folds `actions` over the reducer; returns the final state and each step's effects. */
function run(start: FeedState, actions: FeedAction[]): { state: FeedState; effects: FeedEffect[][] } {
  const effects: FeedEffect[][] = [];
  const end = actions.reduce((current, action) => {
    const [next, fx] = feedReducer(current, action);
    effects.push(fx);
    return next;
  }, start);
  return { state: end, effects };
}

describe("feedReducer scenarios", () => {
  it("opens an existing room: history, subscribe, confirmation catch-up", () => {
    const { state: end, effects } = run(state(), [
      { type: "opened", hidden: false },
      { type: "historyLoaded", page: page([m1, m2], true) },
      { type: "subscribed" },
      { type: "newerLoaded", page: catchUp([], m2.id, false) },
    ]);
    expect(effects).toEqual([[fetchInitial], [subscribe], [startIdleTimer, fetchNewer(m2.id)], []]);
    expect(connectionOf(end)).toBe("realtime");
    expect(end).toMatchObject({ status: "open", syncCursor: m2.id, olderCursor: m1.id, inflight: null });
  });

  it("falls back to polling when the subscription is refused, then polls on ticks", () => {
    const { state: end, effects } = run(state(), [
      { type: "opened", hidden: false },
      { type: "historyLoaded", page: page([m1, m2], false) },
      { type: "channelFailed", reason: "too_many_connections" },
      { type: "newerLoaded", page: catchUp([], m2.id, false) },
      { type: "pollTick" },
      { type: "newerLoaded", page: catchUp([m3], m3.id, false) },
      { type: "pollTick" },
    ]);
    expect(effects).toEqual([
      [fetchInitial],
      [subscribe],
      [unsubscribe, stopIdleTimer, startPolling, fetchNewer(m2.id)],
      [],
      [fetchNewer(m2.id)],
      [],
      [fetchNewer(m3.id)],
    ]);
    expect(connectionOf(end)).toBe("polling");
    expect(end.messages).toEqual([m1, m2, m3]);
  });

  it("a realtime message during a backlog is shown, the bookmark and notice stay", () => {
    const { state: end, effects } = run(pollingRoom({ backlog: true }), [
      { type: "received", message: m4 },
      { type: "pollTick" },
      { type: "newerRequested" },
    ]);
    expect(end.messages).toEqual([m1, m2, m4]);
    expect(end).toMatchObject({ syncCursor: m2.id, backlog: true, inflight: "newer" });
    expect(effects).toEqual([[], [], [fetchNewer(m2.id)]]);
  });

  it("A/B/C (PRD 6.4): displaying own post C never moves the bookmark past B", () => {
    // Last fetch reached A (m1). Another visitor posts B (m2); this visitor posts C (m3).
    const start = pollingRoom({ messages: [m1], olderCursor: m1.id, syncCursor: m1.id });
    const { state: end, effects } = run(start, [
      { type: "received", message: m3 },
      { type: "pollTick" },
      { type: "newerLoaded", page: catchUp([m2, m3], m3.id, false) },
    ]);
    expect(effects[1]).toEqual([fetchNewer(m1.id)]);
    expect(end.messages).toEqual([m1, m2, m3]);
    expect(end.syncCursor).toBe(m3.id);
  });

  it("idle during an older page: polling starts, the catch-up runs when the page lands", () => {
    const { state: end, effects } = run(live({ inflight: "older" }), [
      { type: "idle" },
      { type: "olderLoaded", page: page([m0], false) },
    ]);
    expect(effects).toEqual([[unsubscribe, stopIdleTimer, startPolling], [fetchNewer(m2.id)]]);
    expect(end).toMatchObject({ polling: true, channel: "none", newerWanted: false, inflight: "newer" });
    expect(end.messages).toEqual([m0, m1, m2]);
  });

  it("subscribed during a poll: the owed catch-up runs from the poll's new bookmark", () => {
    const { effects } = run(pollingRoom({ channel: "subscribing", inflight: "newer" }), [
      { type: "subscribed" },
      { type: "newerLoaded", page: catchUp([m3], m3.id, false) },
    ]);
    expect(effects).toEqual([[stopPolling, startIdleTimer], [fetchNewer(m3.id)]]);
  });

  it("sent twice while a re-subscribe is pending subscribes once", () => {
    const { effects } = run(pollingRoom(), [{ type: "sent" }, { type: "sent" }]);
    expect(effects).toEqual([[subscribe], []]);
  });

  it("two olderRequested before the page lands fetch once", () => {
    const { effects } = run(live(), [{ type: "olderRequested" }, { type: "olderRequested" }]);
    expect(effects).toEqual([[fetchOlder(m1.id)], []]);
  });

  it("a channel that drops after live use polls and re-subscribes only on send", () => {
    const { state: end, effects } = run(live(), [
      { type: "channelFailed", reason: "CLOSED" },
      { type: "newerLoaded", page: catchUp([], m2.id, false) },
      { type: "pollTick" },
      { type: "newerLoaded", page: catchUp([m3], m3.id, false) },
      { type: "sent" },
    ]);
    expect(effects.slice(0, 4).flat()).not.toContainEqual(subscribe);
    expect(effects[4]).toEqual([subscribe]);
    expect(end).toMatchObject({ channel: "subscribing", polling: true });
  });

  it("empty initial history is retried once, then errors with no cursor and no transport", () => {
    const { state: end, effects } = run(state(), [
      { type: "opened", hidden: false },
      { type: "historyLoaded", page: page([], false) },
      { type: "historyLoaded", page: page([], false) },
    ]);
    expect(effects).toEqual([[fetchInitial], [fetchInitial], []]);
    expect(end).toMatchObject({
      status: "opening",
      syncCursor: null,
      olderCursor: null,
      inflight: null,
      polling: false,
      channel: "none",
      error: { op: "initial", message: EMPTY_HISTORY_MESSAGE, notFound: false },
    });
  });

  it("every action after closed is ignored", () => {
    const closed = feedReducer(live(), { type: "closed" })[0];
    const actions: FeedAction[] = [
      { type: "opened", hidden: false },
      { type: "historyLoaded", page: page([m3], false) },
      { type: "olderRequested" },
      { type: "olderLoaded", page: page([m0], false) },
      { type: "newerRequested" },
      { type: "pollTick" },
      { type: "newerLoaded", page: catchUp([m3], m3.id, false) },
      failed("newer"),
      { type: "received", message: m3 },
      { type: "sent" },
      { type: "subscribed" },
      { type: "channelFailed", reason: "CLOSED" },
      { type: "idle" },
      { type: "visibilityChanged", hidden: true },
      { type: "errorDismissed" },
      { type: "closed" },
    ];
    for (const action of actions) {
      expect(feedReducer(closed, action)).toEqual([closed, []]);
      expect(feedReducer(closed, action)[0]).toBe(closed);
    }
  });

  it("F-004: a failed confirmation catch-up polls from the same bookmark and recovers", () => {
    const { state: end, effects } = run(live({ channel: "subscribing" }), [
      { type: "subscribed" },
      failed("newer"),
      { type: "pollTick" },
      { type: "newerLoaded", page: catchUp([m3], m3.id, false) },
    ]);
    expect(effects).toEqual([
      [startIdleTimer, fetchNewer(m2.id)],
      [unsubscribe, stopIdleTimer, startPolling],
      [fetchNewer(m2.id)],
      [],
    ]);
    expect(end).toMatchObject({ channel: "none", polling: true, syncCursor: m3.id, error: null });
    expect(end.messages).toEqual([m1, m2, m3]);
  });

  it("F-004: confirmation during an older page whose fetch then fails still runs the catch-up", () => {
    const { state: end, effects } = run(live({ channel: "subscribing", inflight: "older" }), [
      { type: "subscribed" },
      failed("older"),
      { type: "newerLoaded", page: catchUp([m3], m3.id, false) },
    ]);
    expect(effects).toEqual([[startIdleTimer], [fetchNewer(m2.id)], []]);
    expect(end.error).toEqual(failure("older"));
    expect(end).toMatchObject({ channel: "subscribed", syncCursor: m3.id, inflight: null });
  });

  it("F-004: a failed backlog page keeps the button and the cursor; ticks stay paused", () => {
    const { state: end, effects } = run(pollingRoom({ backlog: true }), [
      { type: "newerRequested" },
      failed("newer"),
      { type: "pollTick" },
      { type: "newerRequested" },
    ]);
    expect(effects).toEqual([[fetchNewer(m2.id)], [], [], [fetchNewer(m2.id)]]);
    expect(end).toMatchObject({ backlog: true, syncCursor: m2.id, error: failure("newer") });
  });

  it("F-004: a 404 is terminal; nothing restarts a transport or re-enables the feed", () => {
    const { state: end, effects } = run(pollingRoom(), [
      { type: "pollTick" },
      { type: "fetchFailed", op: "newer", message: "gone", notFound: true },
      { type: "pollTick" },
      { type: "sent" },
      { type: "newerRequested" },
      { type: "errorDismissed" },
      { type: "visibilityChanged", hidden: false },
      { type: "closed" },
    ]);
    expect(effects).toEqual([
      [fetchNewer(m2.id)],
      [unsubscribe, stopIdleTimer, stopPolling],
      [],
      [],
      [],
      [],
      [],
      [unsubscribe, stopPolling, stopIdleTimer],
    ]);
    expect(end).toMatchObject({ status: "closed", error: notFoundError });
  });

  it("PRD 8: only newerLoaded advances the bookmark", () => {
    const steps: FeedAction[] = [
      { type: "received", message: m4 },
      { type: "olderRequested" },
      { type: "olderLoaded", page: page([m0], false) },
      { type: "pollTick" },
      failed("newer"),
    ];
    const { state: unchanged } = run(pollingRoom(), steps);
    expect(unchanged.syncCursor).toBe(m2.id);
    const { state: advanced } = run(unchanged, [
      { type: "pollTick" },
      { type: "newerLoaded", page: catchUp([m3, m4], m4.id, false) },
    ]);
    expect(advanced.syncCursor).toBe(m4.id);
    expect(advanced.messages).toEqual([m0, m1, m2, m3, m4]);
  });

  it("F-003: hiding during opening selects polling when history lands", () => {
    const { state: end, effects } = run(state(), [
      { type: "opened", hidden: false },
      { type: "visibilityChanged", hidden: true },
      { type: "historyLoaded", page: page([m1, m2], false) },
    ]);
    expect(effects).toEqual([[fetchInitial], [], [startPolling, fetchNewer(m2.id)]]);
    expect(end).toMatchObject({ hidden: true, polling: true, channel: "none" });
  });

  it("F-003: hiding during the join makes a late confirmation harmless", () => {
    const { state: end, effects } = run(live({ channel: "subscribing" }), [
      { type: "visibilityChanged", hidden: true },
      { type: "subscribed" },
      { type: "visibilityChanged", hidden: false },
      { type: "sent" },
    ]);
    expect(effects).toEqual([
      [unsubscribe, stopIdleTimer, startPolling, fetchNewer(m2.id)],
      [],
      [],
      [subscribe],
    ]);
    expect(end).toMatchObject({ hidden: false, polling: true, channel: "subscribing" });
  });

  it("F-003: a seeded room opened while hidden polls at once", () => {
    const { state: end, effects } = run(state(), [{ type: "opened", hidden: true, seed: m1 }]);
    expect(effects).toEqual([[startPolling, fetchNewer(m1.id)]]);
    expect(end).toMatchObject({ status: "open", channel: "none", polling: true, syncCursor: m1.id });
  });
});
```

- [ ] **Step 2: Run the scenarios**

Run: `pnpm test src/lib/feed`
Expected: PASS, 1 file, 133 tests (114 from before, 19 scenarios). If a scenario fails, read its expected effect list against spec §5, fix `src/lib/feed/reducer.ts`, and re-run the whole file; the table rows must keep passing.

- [ ] **Step 3: Document the module in the README**

Insert this section in `README.md` immediately before the line `## Tests` (after the last section that precedes it; if chunks 6 or 7 merged first they add sections of their own, keep the new one before `## Tests`):

```markdown
## Room feed

The client-side core of an open room (PRD 4 "History", 6.4, 6.7) is a pure reducer. The
store that runs its effects and the React hook arrive with chunk 9; the realtime adapter
with chunk 11. Design: `docs/superpowers/specs/2026-09-16-room-feed-design.md`.

| Module                | Provides                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------ |
| `@/lib/feed/types`    | `FeedState`, `FeedAction`, `FeedEffect`, `FeedError`, `Connection`, `FetchOp`             |
| `@/lib/feed/reducer`  | `initialFeedState(roomId)`, `feedReducer(state, action)` returning `[state, effects]`, `mergeMessages`, `connectionOf`, `EMPTY_HISTORY_MESSAGE` |

`feedReducer` performs no I/O. It returns the next state plus an ordered list of effects
(`fetchInitial`, `fetchOlder`, `fetchNewer`, `subscribe`, `unsubscribe`, `startPolling`,
`stopPolling`, `startIdleTimer`, `stopIdleTimer`) for the caller to run after storing the
state. An action the state does not accept returns the same state object and no effects.
`messages` stays sorted by `compareCreatedAtId` and unique by id. `syncCursor` (the PRD 6.4
bookmark) moves only on `newerLoaded`; `olderCursor` only on `historyLoaded` and
`olderLoaded`; realtime events, POST responses and failures never move either. At most one
fetch is in flight; a catch-up that cannot start is owed (`newerWanted`) and runs when the
fetch settles. A 404 from any fetch is terminal: the reducer drops every transport and then
ignores everything except `closed`. `connectionOf(state)` gives `realtime`, `polling` or
`connecting` for display.
```

- [ ] **Step 4: Full verification**

```bash
cd /Users/calin/dev/other/wp-worktrees/chunk-08-feed-reducer
pnpm test && pnpm lint && pnpm typecheck
```

Expected: Vitest reports 15 files passing (the 14 baseline files plus `src/lib/feed/reducer.test.ts`), 355 tests (222 + 133) unless other chunks merged first; ESLint and `tsc` exit 0. `pnpm test:db` and `pnpm test:api` are unaffected (no database or route code changed) and need not run.

- [ ] **Step 5: Commit**

```bash
git add src/lib/feed/reducer.test.ts README.md
git commit -m "test(feed): cover the room feed scenarios; document the feed reducer"
git status --short
```

Expected: `git status --short` prints nothing after all intentional implementation and plan/feedback tracking changes are committed. The required documentation is tracked by the preflight handoff commit; unrelated untracked plans remain in the original checkout. If task tracking changed the copied plan or its feedback, inspect and commit those specific documentation changes before the final clean-tree check.

---

## Handoff to chunk 9 (store) and chunk 11 (adapter)

What the store may rely on, beyond the spec:

- `feedReducer` never throws and never mutates its input. An ignored action returns the *same* `FeedState` reference with `[]`; the store may skip notifying listeners in that case (spec §6 says "notifies listeners once" per dispatch; skipping on identity is an allowed optimisation, not a requirement).
- Effect order is fixed per rule and tested: `subscribed` while polling → `stopPolling`, `startIdleTimer`, `fetchNewer`; `idle`/`channelFailed`/hidden in realtime → `unsubscribe`, `stopIdleTimer`, `startPolling`, `fetchNewer`; `closed` → `unsubscribe`, `stopPolling`, `stopIdleTimer`; terminal 404 → `unsubscribe`, `stopIdleTimer`, `stopPolling`. All cleanup effects may arrive when nothing is running; the store's handlers must be idempotent (spec §6).
- `fetchNewer.after` is always the current `syncCursor` at emission time. `fetchOlder.before` is always the current `olderCursor`.
- The reducer accepts a second `opened` after an initial failure; the store, not the reducer, enforces "start once per instance".
- `channelFailed.reason` is not stored; log it in the store if useful.
- `EMPTY_HISTORY_MESSAGE` is the only reducer-generated error message; all other `error.message` values come from `fetchFailed.message` (the store maps `ApiRequestError.message` there).
- `hidden` is plain data. The store dispatches `visibilityChanged` from `document.visibilitychange` and passes the current value in `opened`; the reducer never reads `document`.
