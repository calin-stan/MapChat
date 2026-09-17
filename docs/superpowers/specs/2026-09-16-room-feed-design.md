# Map Chat — Room feed design (chunks 8, 9 hook, 11)

**Review feedback:** [2026-09-16-room-feed-design-feedback.md](2026-09-16-room-feed-design-feedback.md)

Status: Review findings accepted and incorporated · Date: 2026-09-16 · Revised: 2026-09-17
Sources: `docs/PRD.md` §3 Flow B/C, §4 History, §6.4, §6.5, §6.7, §9; `docs/KNOWN_LIMITATIONS.md`;
`docs/superpowers/specs/2026-09-16-map-chat-implementation-chunks.md` chunks 8, 9, 11; the
approved chunk 4 and chunk 5 plans (client shape, timestamp precision, cursor handoff).

This spec covers the pure feed core (chunk 8), the store and hook that run it (chunk 9), and
the realtime adapter that plugs into it (chunk 11). Each chunk still gets its own plan; the
plans read their interfaces from here.

## 1. Scope and decisions

The room feed is the client-side brain of an open room: history, older and newer pagination,
the synchronization bookmark, and the realtime-or-polling connection lifecycle. It has no UI.

Decisions made in this spec (all others follow the PRD):

1. **Architecture.** A pure reducer returns `[nextState, effects]`. Effects are data describing
   outside actions. A framework-free store interprets effects against injected dependencies
   (API client, realtime adapter, timers). The React hook is a thin wrapper over the store.
2. **Connection lifecycle.** Of the pending items in `KNOWN_LIMITATIONS.md` ("Pending:
   connection lifecycle"), this spec adopts three: a channel that fails after subscribing enters
   polling; at most one message fetch is in flight at a time; late results for a closed room
   are ignored. The PRD's hidden-tab rule ("hidden counts as inactive immediately") stays. No
   offline handling, no backoff, no automatic retry beyond the next poll tick.
3. **Subscription order.** For an existing room, the subscription is attempted only after
   initial history has loaded (PRD §6.4). A freshly created room is seeded with its first
   message and, when visible, subscribes without a history fetch. Hidden rooms enter polling
   once their seed or history initializes the bookmark.
4. **Captured cursor.** PRD §6.4 says to capture `syncCursor` before subscribing and fetch after
   it once confirmed. Because `syncCursor` only advances when an ordered fetch completes, its
   value at confirmation time never exceeds what has been covered. The reducer therefore fetches
   after the current `syncCursor` on `subscribed`; no separate captured field is needed.
5. **Polling timer.** `startPolling` starts a timer that dispatches `pollTick` at the configured
   interval. Every fetch is decided by the reducer: the immediate poll on entering polling is
   an explicit `fetchNewer` effect (except failed-newer recovery, which waits for the next tick),
   and ticks that arrive while a fetch is in flight or a
   backlog is pending are ignored. This enforces "one fetch at a time" and "pause periodic
   catch-up during a backlog" with no extra timer effects.
6. **Activity.** User activity restarts the idle timer inside the store without dispatching an
   action, because pointer events are far too frequent to route through state.
7. **Extra file.** `src/lib/feed/store.ts` (chunk 9) is added to the file layout so the effect
   interpreter can be tested with fake timers and fake dependencies and no React.
8. **React lifecycle.** Store construction is inert. Each committed hook effect setup creates
   and starts a fresh store; cleanup permanently disposes that instance. Rendering reads a
   stable snapshot bridge, including a deterministic server/hydration snapshot.
9. **Visibility.** The hook owns document visibility tracking from chunk 9 onward. Hidden state
   is recorded even during opening; hidden rooms never start or retain a realtime attempt.
   Becoming visible only changes eligibility for the next send, not the transport.
10. **Read recovery.** A failed newer fetch in realtime falls back to polling and retries on
    the next tick (or manual backlog click). An older failure still releases an owed catch-up.
11. **Send readiness.** Sending is disabled until seed/history initialization succeeds. The
    hook exposes `ready`; the store rejects premature sends before making a POST.

## 2. Files

| Path | Chunk | Contents |
| --- | --- | --- |
| `src/lib/feed/types.ts` | 8 | `FeedState`, `FeedAction`, `FeedEffect`, `FeedError`, `Connection` |
| `src/lib/feed/reducer.ts` | 8 | `initialFeedState`, `feedReducer`, `mergeMessages`, `connectionOf` |
| `src/lib/feed/reducer.test.ts` | 8 | Table-driven transition tests, merge tests |
| `src/lib/feed/store.ts` | 9 | `createFeedStore`, `FeedDeps`, `FeedStore` (effect interpreter) |
| `src/lib/feed/store.test.ts` | 9, 11 | Interpreter tests with fake timers and fake deps |
| `src/lib/feed/useRoomFeed.ts` | 9 | `useRoomFeed`, `RoomFeed` |
| `src/lib/feed/useRoomFeed.test.tsx` | 9 | Hook lifecycle test |
| `src/lib/feed/realtime.ts` | 11 | `subscribeToRoom`, `SubscribeToRoom`, `RealtimeHandle` |
| `src/lib/feed/realtime.test.ts` | 11 | Fake-channel status and payload mapping tests |
| `src/lib/feed/activity.ts` | 11 | `attachActivityTracking` |

Consumed, unchanged: `Message`, `MessagePage`, `CatchUpPage` from `@/lib/schemas/types`;
`PostMessageInput` from `@/lib/schemas/message`; `MessagesApi`, `ApiRequestError` from
`@/lib/api/client` (chunk 5); `compareCreatedAtId` from `@/lib/time/ordering` and `toMessage`
from `@/lib/db/rows` (chunk 4, browser-safe); `getClientConfig()` from `@/lib/config/client`.

Dependency status (updated 2026-09-17): chunks 4 and 5 are merged; `MessagesApi`,
`MessagePage`, `CatchUpPage`, `ApiRequestError` and `ApiValidationError` exist with the names
above in `src/lib/api/client.ts` and `src/lib/schemas/types.ts`. Plans still verify the real
exports before their first task and read any drift from the source files.

Chunk 9's panel, its error surfaces, scroll semantics, seed path and tests are specified in
[2026-09-17-room-panel-design.md](2026-09-17-room-panel-design.md). Where section 7 below
describes panel wiring (`ComposeForm`, the loading-failed hint), that spec is the owner.

## 3. State

```ts
// src/lib/feed/types.ts
export type FeedError = {
  op: 'initial' | 'older' | 'newer';
  message: string;
  notFound: boolean;            // true when the API answered 404: the room is gone
};

export type FeedState = {
  roomId: string;
  status: 'opening' | 'open' | 'closed';
  hidden: boolean;             // current document visibility, retained while opening
  messages: Message[];          // ascending by compareCreatedAtId, unique by id
  olderCursor: string | null;   // first id of the last successful initial/before page
  hasOlder: boolean;            // hasMore of that page
  syncCursor: string | null;    // PRD 6.4 bookmark; only newerLoaded moves it
  backlog: boolean;             // last catch-up said hasMore; periodic catch-up paused
  newerWanted: boolean;         // a catch-up is owed but a fetch is in flight
  inflight: 'initial' | 'older' | 'newer' | null;   // at most one fetch at a time
  polling: boolean;             // poll timer running
  channel: 'none' | 'subscribing' | 'subscribed';
  error: FeedError | null;
  initialRetried: boolean;      // empty initial history is retried once
};

export type Connection = 'connecting' | 'realtime' | 'polling';
```

Invariants

- `messages` is sorted with `compareCreatedAtId` (microsecond precision, id tiebreak) and has
  no duplicate ids. Arrival order never determines display order.
- `olderCursor` and `syncCursor` are set only from server pages, never from `messages`.
- `polling` and `channel` are independent: while re-subscribing after a send, polling keeps
  running until the channel is confirmed.
- `connectionOf(state)`: `'realtime'` if `channel === 'subscribed'`; else `'polling'` if
  `polling`; else `'connecting'`.
- `initialFeedState(roomId)`: `status: 'opening'`, empty messages, all cursors `null`,
  `hasOlder: false`, every boolean `false`, `inflight: null`, `channel: 'none'`, `error: null`.

## 4. Actions and effects

```ts
export type FeedAction =
  | { type: 'opened'; hidden: boolean; seed?: Message }        // seed = first message from atomic room creation
  | { type: 'historyLoaded'; page: MessagePage }
  | { type: 'olderRequested' }
  | { type: 'olderLoaded'; page: MessagePage }
  | { type: 'newerRequested' }                // "Load more messages" click
  | { type: 'pollTick' }                      // from the poll timer
  | { type: 'newerLoaded'; page: CatchUpPage }
  | { type: 'fetchFailed'; op: 'initial' | 'older' | 'newer'; message: string; notFound: boolean }
  | { type: 'received'; message: Message }    // realtime insert or own POST response
  | { type: 'sent' }                          // after a successful own POST
  | { type: 'subscribed' }
  | { type: 'channelFailed'; reason: string } // refusal, timeout, or drop after subscribed
  | { type: 'idle' }                          // idle timer fired
  | { type: 'visibilityChanged'; hidden: boolean }
  | { type: 'errorDismissed' }
  | { type: 'closed' };

export type FeedEffect =
  | { type: 'fetchInitial' }
  | { type: 'fetchOlder'; before: string }
  | { type: 'fetchNewer'; after: string }
  | { type: 'subscribe' }
  | { type: 'unsubscribe' }
  | { type: 'startPolling' }
  | { type: 'stopPolling' }
  | { type: 'startIdleTimer' }
  | { type: 'stopIdleTimer' };
```

```ts
// src/lib/feed/reducer.ts
export function initialFeedState(roomId: string): FeedState;
export function feedReducer(state: FeedState, action: FeedAction): [FeedState, FeedEffect[]];
export function mergeMessages(existing: Message[], incoming: Message[]): Message[];
export function connectionOf(state: FeedState): Connection;
```

`mergeMessages` dedupes by id (an incoming row with a known id is dropped; the existing row
is kept) and sorts the union with `compareCreatedAtId`. It never touches cursors.

## 5. Transition rules

Every rule is one row of the table-driven test. Unless a rule says otherwise, fields not
mentioned are unchanged and no effects are emitted.

**Guard.** Any action while `status === 'closed'` is ignored. This is the reducer-level
stale-result guard. While `error?.notFound` is true, all actions except `closed` are
ignored, so stale callbacks, visibility changes, and manual clicks cannot restart a gone room.

Named sub-procedures are reused below:

- **Enter polling**: if not already polling, set `polling = true` and emit `startPolling`;
  then **auto catch-up**. An existing interval is not restarted.
- **Select initial transport**: if `hidden`, enter polling; otherwise set
  `channel = 'subscribing'` and emit `subscribe`.
- **Drop channel**: emit `unsubscribe`, then `stopIdleTimer`; set `channel = 'none'`.
  Unsubscribe is idempotent and invalidates the attempt before SDK cleanup (section 6).
- **Auto catch-up**: if `backlog` is true, do nothing (the backlog notice and button own the
  cursor). Else if `inflight !== null`, set `newerWanted = true`. Else if `syncCursor` is
  set, `inflight = 'newer'` and effect `fetchNewer(after: syncCursor)`.

### Opening

| Action | Precondition | Result |
| --- | --- | --- |
| `opened` (no seed) | `status === 'opening' && inflight === null` | `hidden = action.hidden`; `inflight = 'initial'`; effect `fetchInitial` |
| `opened` (seed) | `status === 'opening' && inflight === null` | `hidden = action.hidden`; `messages = [seed]`; `syncCursor = olderCursor = seed.id`; `hasOlder = false`; `status = 'open'`; select initial transport |
| `historyLoaded`, page non-empty | `inflight === 'initial'` | `messages = page.messages` (sorted); `syncCursor = last id`; `olderCursor = first id`; `hasOlder = page.hasMore`; `status = 'open'`; `inflight = null`; clear an initial error; select initial transport |
| `historyLoaded`, page empty, first time | `inflight === 'initial'`, `!initialRetried` | `initialRetried = true`; effect `fetchInitial` (inflight stays `'initial'`) |
| `historyLoaded`, page empty, second time | `inflight === 'initial'`, `initialRetried` | `inflight = null`; `error = { op: 'initial', message: 'Room has no messages', notFound: false }`; status stays `'opening'`; no transports |

`opened` with any other precondition is ignored. The store emits it exactly once per instance
from `start`; reopening after an initial failure requires a new store.

### Channel outcomes

| Action | Precondition | Result |
| --- | --- | --- |
| `subscribed` | `channel === 'subscribing' && !hidden` | `channel = 'subscribed'`; if `polling`: `polling = false`, effect `stopPolling`; effect `startIdleTimer`; then auto catch-up |
| `subscribed` | otherwise | ignored |
| `channelFailed` | `channel === 'subscribing'` | drop channel; if not polling: enter polling (otherwise retain the current interval) |
| `channelFailed` | `channel === 'subscribed'` | drop channel; enter polling |
| `channelFailed` | `channel === 'none'` | ignored |
| `idle` | `channel === 'subscribed'` | drop channel; enter polling |
| `idle` | otherwise | ignored |
| `visibilityChanged` | `action.hidden === false` | `hidden = false`; no transport effects |
| `visibilityChanged` | `action.hidden === true` | `hidden = true`; if channel is subscribing or subscribed: drop channel; if `status === 'open' && !polling`: enter polling; otherwise keep current transport/fetch |

Effect order for `subscribed` while polling: `stopPolling`, `startIdleTimer`, then any
`fetchNewer`. For `idle`: `unsubscribe`, `stopIdleTimer`, `startPolling`, then any
`fetchNewer`. Hiding during opening only records visibility; history completion selects polling.
Hiding during subscription invalidates that attempt, so late confirmation cannot revive it.
A repeated hidden event while already polling neither restarts the timer nor fetches again.

### Fetching newer

| Action | Precondition | Result |
| --- | --- | --- |
| `pollTick` | `polling && inflight === null && !backlog && syncCursor` | `inflight = 'newer'`; effect `fetchNewer(after: syncCursor)` |
| `pollTick` | otherwise | ignored |
| `newerRequested` | `status === 'open' && inflight === null && syncCursor` | `inflight = 'newer'`; effect `fetchNewer(after: syncCursor)` (regardless of `backlog`) |
| `newerRequested` | otherwise | ignored |
| `newerLoaded` | `inflight === 'newer'` | merge; `syncCursor = page.nextCursor` (also when the page is empty); `backlog = page.hasMore`; `inflight = null`; if `newerWanted && !backlog`: `newerWanted = false`, `inflight = 'newer'`, effect `fetchNewer(after: syncCursor)`; if `newerWanted && backlog`: `newerWanted = false` |
| `newerLoaded` | otherwise | ignored |

### Fetching older

| Action | Precondition | Result |
| --- | --- | --- |
| `olderRequested` | `status === 'open' && inflight === null && hasOlder && olderCursor` | `inflight = 'older'`; effect `fetchOlder(before: olderCursor)` |
| `olderRequested` | otherwise | ignored |
| `olderLoaded` | `inflight === 'older'` | merge; `olderCursor = page.messages[0]?.id ?? olderCursor`; `hasOlder = page.hasMore`; `inflight = null`; then if `newerWanted && !backlog`: run the owed catch-up as in `newerLoaded` |
| `olderLoaded` | otherwise | ignored |

### Sending and receiving

| Action | Precondition | Result |
| --- | --- | --- |
| `received` | `status === 'open'` | merge `[message]`; cursors, backlog and channel untouched |
| `received` | otherwise | ignored |
| `sent` | `channel === 'subscribed' && !hidden` | effect `startIdleTimer` (restart) |
| `sent` | `status === 'open' && channel === 'none' && !hidden` | `channel = 'subscribing'`; effect `subscribe`; polling continues |
| `sent` | otherwise | ignored |

### Failures and closing

| Action | Precondition | Result |
| --- | --- | --- |
| `fetchFailed` | `inflight === action.op` | `inflight = null`; `error = { op, message, notFound }`; messages/cursors/backlog preserved; apply the operation-specific recovery below |
| `fetchFailed` | otherwise | ignored |
| `errorDismissed` | `!error?.notFound` | `error = null` |
| `errorDismissed` | `error?.notFound` | ignored (terminal room-gone error) |
| `closed` | `status !== 'closed'` | `status = 'closed'`; effects: `unsubscribe`, `stopPolling`, `stopIdleTimer` unconditionally (all idempotent); `channel = 'none'`, `polling = false` |

Recovery after a matching `fetchFailed`:

- `initial`: clear `newerWanted`; remain opening with no transports and `ready = false`.
  Reopening is the retry; dismissing the error does not make the feed ready.
- `older`: capture and clear `newerWanted`. If it was true and there is no backlog, run auto
  catch-up now, even when realtime is subscribed. This fetch fulfills the existing catch-up
  obligation; it is not a retry of the failed older page.
- `newer`: clear `newerWanted`. If subscribed, drop channel and set `polling = true` with
  `startPolling`, but **do not run auto catch-up here**. The next tick retries from the unchanged
  cursor. If already polling (including while subscribing), retain that interval. A pending
  subscription may still confirm and request catch-up by the ordinary confirmation rule.
  When `backlog` is true, ticks remain paused; the existing Load more button retries instead.
- A `notFound` error skips these retries: clear `newerWanted`, drop channel, stop polling, set
  `polling = false`. Keep the error for the room-gone handling in chunk 12; the hook reports
  `ready = false`. Dismissing this terminal error is ignored so it cannot re-enable sending.
- A successful initial/older/newer page clears an error only when its `op` matches the
  successful fetch. An older-page failure therefore remains visible when owed catch-up succeeds.
  Dismissal changes only the error display, never cursors, backlog, readiness, or retry scheduling
  (except that readiness still respects the terminal room-gone error).

### Edge cases the rules cover

Each of these is a named test:

- A realtime message arrives while a backlog is pending: displayed, `syncCursor` untouched,
  backlog stays.
- Own post C while another visitor posted B after the bookmark: the next catch-up returns B
  and C; C is deduplicated (the PRD §6.4 example).
- `idle` fires while an older page is in flight: polling starts, the catch-up is owed and runs
  when the older page lands.
- `subscribed` arrives while a poll is in flight: same owed-catch-up path.
- `sent` while a re-subscribe is pending: no second `subscribe` effect.
- Two `olderRequested` before the first page lands: the second is ignored.
- The channel drops after minutes of live use: polling starts with an immediate catch-up;
  nothing re-subscribes until the next `sent`.
- Tab hidden while polling: visibility is recorded; no new transport effects.
- `historyLoaded` with an empty page: one retry, then an error and no cursor.
- Any action after `closed`: ignored, state unchanged.

## 6. Store (effect interpreter)

```ts
// src/lib/feed/store.ts
export type FeedTimers = {
  setTimeout: typeof globalThis.setTimeout;
  clearTimeout: typeof globalThis.clearTimeout;
  setInterval: typeof globalThis.setInterval;
  clearInterval: typeof globalThis.clearInterval;
};

export type FeedDeps = {
  messages: MessagesApi;                 // api.messages (chunk 5)
  subscribe: SubscribeToRoom;            // chunk 11 adapter; chunk 9 ships a stub
  config: { pollIntervalMs: number; realtimeIdleTimeoutMs: number };
  timers?: FeedTimers;                   // defaults to the globals
};

export type FeedStore = {
  start(opts: { hidden: boolean }): void;          // once, after committed setup
  getState(): FeedState;
  subscribe(listener: () => void): () => void;   // useSyncExternalStore contract
  dispatch(action: FeedAction): void;
  loadOlder(): void;                              // dispatch olderRequested
  loadNewer(): Promise<void>;                     // manual-request completion; see below
  send(input: PostMessageInput): Promise<Message>;
  activity(): void;                               // restart the idle timer if running
  setHidden(hidden: boolean): void;               // dispatch visibilityChanged
  dismissError(): void;                           // dispatch errorDismissed
  dispose(): void;                                // dispatch closed, then disable all callbacks
};

export function createFeedStore(roomId: string, deps: FeedDeps, seed?: Message): FeedStore;
```

Behaviour

- `createFeedStore` is side-effect-free: it creates `initialFeedState(roomId)` and captures
  dependencies/seed without fetching, subscribing, creating timers, or reading browser globals.
- `start({ hidden })` dispatches `opened` with that visibility and the captured seed exactly
  once. Repeated starts do nothing; a disposed store cannot restart. Before start, action
  methods do nothing except `send`, which rejects as described below. Listener registration and
  snapshot reads are available before start.
- `dispatch` runs `feedReducer`, replaces the stored state, notifies listeners once, then
  interprets the returned effects in order. Effects run after the state is stored, so any
  synchronous callback sees the new state. Reentrant actions are queued until the current
  effect batch finishes, then reduced iteratively, never recursively. This includes callbacks
  made synchronously by `deps.subscribe` before it returns its handle. A disposal request
  immediately invalidates external callbacks and discards queued non-cleanup work; its cleanup
  runs as soon as the current effect returns.
- `fetchInitial` → `messages.list(roomId)`; `fetchOlder` → `messages.list(roomId, { before })`;
  `fetchNewer` → `messages.listAfter(roomId, after)`. Each resolves to `historyLoaded`,
  `olderLoaded`, `newerLoaded` respectively, or rejects to `fetchFailed` with
  `notFound = error instanceof ApiRequestError && error.status === 404` and
  `message = error.message` (or `String(error)`).
- Manual `loadNewer()` dispatches `newerRequested` and returns a completion promise for the
  fetch that invocation starts. Resolve after its response or failure is reduced and published;
  read failures remain in state and do not reject this promise. If the request is ignored
  (including before start, after disposal, or while another fetch is running), resolve
  immediately without attaching to another request. Disposal resolves pending completions
  without publishing stale data. Unrelated messages, polling and later requests cannot settle
  this completion. This store-only bookkeeping supports the room-panel design §5.2 manual
  hold; it does not change reducer transitions or automatic fetch scheduling.
- Each `subscribe` owns a unique attempt token and returned handle. Handlers dispatch
  `subscribed`, `channelFailed(reason)`, `received(message)` only for the current live attempt.
  The first failure immediately marks that attempt terminal and queues `channelFailed`;
  subsequent success, failure, and insert callbacks from it are ignored.
- `unsubscribe` invalidates the token first, then unsubscribes and drops its handle. It is safe
  with no handle and safe to repeat. If an attempt terminates before `deps.subscribe` returns,
  its returned handle is still captured and immediately cleaned up; it is never forgotten.
  A synchronous thrown subscribe error follows the same failure path. Before replacement,
  clean up the old attempt. `dispose` always cleans up the actual handle regardless of reducer
  channel state. SDK removal completion cannot dispatch back into an invalidated attempt.
- `startPolling` starts one interval of `config.pollIntervalMs` dispatching `pollTick`;
  `stopPolling` clears it. Starting twice replaces the previous interval.
- `startIdleTimer` starts one timeout of `config.realtimeIdleTimeoutMs` dispatching `idle`;
  `stopIdleTimer` clears it. Starting twice replaces the previous timeout (this is the restart).
- `activity()` restarts the idle timeout only while subscribed, visible, and a timer is
  running. It does not dispatch.
- `setHidden(hidden)` dispatches `visibilityChanged`; it never counts as user activity.
- `send(input)` first requires a started, undisposed store with `status === 'open'` and no
  terminal `notFound` error. Otherwise reject with `FeedNotReadyError` (`code: 'feed_not_ready'`,
  message: 'Wait for the room to load, or reopen it if loading failed.') without calling POST.
  Export this error from `store.ts`; it is not an API validation or uncertain-write error.
  When ready, await `messages.post(roomId, input)`; dispatch `received(message)` then `sent`
  using current visibility, and return the message. A send finishing after hiding still merges
  its response but does not subscribe. If POST rejects, rethrow unchanged and dispatch nothing.
  A pending POST settling after disposal still resolves/rejects to its caller, without updating
  any store. No write is retried or transferred to a replacement room/store.
- `dispose()` is idempotent: invalidate callbacks first, dispatch `closed` internally and
  release the actual channel and both timers even if reducer state already says none/stopped.
  Drop queued non-cleanup actions/effects. Pending fetch/timer/channel callbacks cannot mutate
  state or notify listeners. Public action methods are thereafter no-ops except `send`, which
  rejects `FeedNotReadyError`; snapshot reads and listener detachment remain safe. The reducer's
  closed guard is a second layer. No disposed instance is reused by React cleanup/setup replay.

## 7. Hook

```ts
// src/lib/feed/useRoomFeed.ts
export type RoomFeed = {
  ready: boolean;               // open, started, live store and no terminal room-gone error
  messages: Message[];
  hasOlder: boolean;
  backlog: boolean;
  loading: FeedState['inflight'];
  connection: Connection;
  error: FeedError | null;
  loadOlder(): void;
  loadNewer(): Promise<void>;
  send(input: PostMessageInput): Promise<Message>;
  activity(): void;
  dismissError(): void;
};

export function useRoomFeed(
  roomId: string,
  opts?: { seed?: Message; deps?: Partial<FeedDeps> },
): RoomFeed;
```

- Rendering creates only a side-effect-free snapshot bridge keyed by `roomId`, with stable
  listener/snapshot functions and callbacks. Its initial snapshot is `initialFeedState(roomId)`
  with `ready = false`, even with a seed. Do not instantiate browser dependencies or start
  store/network/timer work during render, including abandoned renders.
- Use `useSyncExternalStore(bridge.subscribe, bridge.getSnapshot, bridge.getServerSnapshot)`.
  Snapshot objects are cached until changed. The server snapshot and initial hydration snapshot
  use the same deterministic opening data; visibility and seed application happen after commit.
  Shared-room server rendering must not throw, access `document`, or make feed requests.
- Each committed effect setup resolves defaults (`api.messages`, realtime adapter,
  `getClientConfig()`), creates a fresh store, attaches the bridge listener, and attaches a
  `document.visibilitychange` listener that calls `store.setHidden(...)`. Then start the store
  with the current `document.visibilityState === 'hidden'` value and publish its snapshot.
  Reading current visibility on every setup handles already-hidden mounts and setup replay.
- Cleanup detaches the visibility and store listeners, disconnects the bridge from that store,
  marks its published readiness false, and disposes the store. Strict Mode's next setup creates a new instance; it never restarts
  the disposed one. Bridge callbacks delegate only to the currently attached live store;
  `send` rejects `FeedNotReadyError` while none is attached. They remain stable for that room's
  bridge, including across effect replay.
- A `roomId` change selects a fresh inert bridge and opening snapshot immediately, cleans up
  the previous committed store, and starts the new one after commit. Old-room callbacks never
  target the new bridge. In practice `RoomPanel key={room.id}` also enforces a remount.
- `seed` and `deps` are captured for the room identity; later changes do not restart it.
- `loadNewer()` delegates the store's completion promise; with no attached live store it
  resolves immediately. A completion from an old room never targets a replacement bridge.
- `ready` is true only for the attached, started store with `status === 'open'` and no terminal
  room-gone error. Chunk 9 passes `disabled={!feed.ready}` to ComposeForm, preserving draft
  fields during loading/failure. Dismissing an initial-load error keeps `ready = false` and
  a non-dismissible loading-failed hint tells the visitor to reopen the room. Catch
  `FeedNotReadyError` at the panel submit boundary and reject with the existing
  `ApiValidationError([{ path: '', message: error.message }])` form-error shape. Chunk 7 maps
  that non-field path to its form-level message and preserves drafts. Do not swallow the error
  or resolve the submit promise, which would clear the draft. This adapts the known no-write
  failure without changing ComposeForm or showing its uncertain-write warning. Ordinary
  pending-submit disabling and API error handling remain owned by ComposeForm.
- Visibility tracking belongs to the hook from chunk 9 onward, independent of panel activity
  tracking. Hiding is recorded during history loading and cancels a pending/live subscription.
  Returning visible only updates `hidden = false`; it does not fetch or subscribe by itself.
- Chunk 9 default `subscribe`: a stub that calls `onFailed('realtime not implemented')` on
  the next macrotask and returns a no-op handle, so the panel runs in polling mode end to end.
  Chunk 11 replaces the default with `subscribeToRoom` and changes nothing else in the hook.

## 8. Realtime adapter and activity tracking (chunk 11)

```ts
// src/lib/feed/realtime.ts
export type RealtimeHandle = { unsubscribe(): void };
export type RealtimeHandlers = {
  onSubscribed(): void;
  onFailed(reason: string): void;   // may fire after onSubscribed when the channel later drops
  onInsert(message: Message): void;
};
export type SubscribeToRoom = (
  roomId: string,
  handlers: RealtimeHandlers,
  client?: SupabaseClient,
) => RealtimeHandle;
export const subscribeToRoom: SubscribeToRoom;
```

- Channel name `room:<id>`, `postgres_changes` with `event: 'INSERT'`, `schema: 'public'`,
  `table: 'messages'`, `filter: 'chatroom_id=eq.<id>'`. Client defaults to
  `getBrowserClient()` (anon key).
- Status mapping: `SUBSCRIBED` → `onSubscribed()`; `CHANNEL_ERROR`, `TIMED_OUT` →
  `onFailed(status)`; `CLOSED` → `onFailed('CLOSED')` unless `unsubscribe()` was called. The
  supabase-js status callback may also carry an error; include its message in the reason.
- Payload rows (`payload.new`) are mapped with the browser-safe `toMessage` from
  `@/lib/db/rows`. A row that fails the row schema is dropped and logged; it does not fail the
  channel.
- The first failure is terminal for the adapter attempt: suppress subsequent SDK callbacks,
  remove the channel with `client.removeChannel(channel)`, and report `onFailed` once. This
  must stop SDK rejoin work rather than leaving a failed channel to reconnect behind polling.
  `unsubscribe()` also suppresses handlers immediately and removes the channel; failure and
  explicit unsubscribe share idempotent cleanup. Intentional removal never reports failure.
  If removal completes asynchronously, its callbacks remain suppressed. The store's token and
  handle cleanup protect the same contract for injected adapters that do not self-clean.

```ts
// src/lib/feed/activity.ts
export function attachActivityTracking(
  el: HTMLElement,
  handlers: { onActivity(): void },
): () => void;   // detach
```

Listens for `pointerdown`, `pointermove`, `keydown`, `wheel`, `scroll` (capture) and
`touchstart` on `el`, all passive, calling `onActivity`. `RoomPanel` attaches it to its
root with `feed.activity` and detaches on cleanup. Document visibility is owned exclusively by
section 7's hook lifecycle, so it works before chunk 11 and before panel listeners attach.

## 9. Testing

- `reducer.test.ts` (chunk 8): one table entry per row in §5, asserting the next state and the
  exact effect list in order. `mergeMessages`: duplicate id keeps the existing row; same
  millisecond with adversarial UUID order stays in microsecond order; out-of-order arrival
  sorts; empty inputs. Every edge case in §5 by name.
- `store.test.ts` (chunk 9): Vitest fake timers, fake `messages` (controllable promises) and the
  stub `subscribe`. Inert construction → explicit start → initial load → stub failure → polling
  with one immediate `listAfter` and one every `pollIntervalMs`; a tick during an in-flight fetch does not call `listAfter` again;
  `hasMore: true` sets `backlog`, pauses ticks, and `loadNewer` drains it; a response resolving
  after `dispose()` leaves state untouched and does not notify; `send` appends the posted
  message and the next poll does not duplicate it; `loadOlder` uses the page's first id, not the
  displayed oldest.
- Manual-newer completion: response and failure are published before its promise resolves;
  ignored calls resolve without joining another fetch; unrelated received messages do not
  settle it; disposal settles it without stale updates. Hook delegation preserves the promise,
  including immediate completion without a live store and old-room completion after replacement.
- `store.test.ts` additions (chunk 11): fake adapter confirms → `stopPolling`, idle timer runs,
  idle fires → `unsubscribe` and immediate `listAfter`; `activity()` postpones idle; `send` while
  polling calls the adapter again and stops polling on confirmation; `setHidden(true)` while live
  enters polling; `onFailed` after `onSubscribed` enters polling without re-subscribing.
- `realtime.test.ts` (chunk 11): a fake channel object records `on`/`subscribe`; each status
  maps to the right handler; `payload.new` maps through `toMessage`; handlers are silent after
  `unsubscribe()`; a malformed row is dropped.
- `useRoomFeed.test.tsx` (chunk 9, jsdom): the hook exposes store state, `loadOlder` reaches
  the store, unmount disposes, and a `roomId` change creates a new store.

Additional acceptance cases for the accepted review findings:

- F-001: constructor/server/abandoned render performs zero HTTP calls, subscriptions, and timer
  starts; cached snapshots support server rendering and hydration with an initially selected
  room. Strict Mode setup→cleanup→setup leaves exactly one live fresh store; old responses and
  timers are ignored. Verify real unmount and room replacement, including same-room replay.
- F-002: fake adapter fails before returning its handle; handle is still unsubscribed exactly
  once. Failure→late success/insert and failure→close leave no old handlers, channel, or rejoin
  timer alive. Adapter failure/removal emits one failure and no callbacks from intentional close.
- F-003: already-hidden mount (seeded and unseeded), hiding during initial fetch, initial join,
  re-subscription, and pending POST all avoid background realtime. Hiding twice starts no extra
  interval. Becoming visible alone does nothing; a subsequent successful send may subscribe.
- F-004: confirmation catch-up fails with no backlog: cursor stays fixed, channel is cleaned up,
  polling retries on the next tick, and successful recovery retrieves the missing rows and
  clears the newer error. No immediate retry loop. Confirmation during older fetch followed by
  older failure still starts the owed catch-up; older error remains. Backlog failure keeps its
  manual button and cursor. Test terminal 404 separately: no recovery loop or re-enabled send.
- F-005: before start, during slow initial history, after initial failure (including dismissal),
  and after disposal, sends reject with zero POST calls and drafts remain. Successful history
  or a seeded start enables sending; successful send merges exactly once. A hidden pending
  send merges without rejoining; a disposed pending send settles without state updates.

- Manual smoke (chunk 11, PRD §8): two browsers, a message appears without reload; after the
  idle timeout the websocket closes and a poll fires at once; sending reopens it.

## 10. Out of scope

Offline detection, retry backoff, automatic re-subscribe on activity other than sending,
automatic catch-up on return from a hidden tab, and cancelling in-flight requests. These stay
listed in `KNOWN_LIMITATIONS.md` as pending.
