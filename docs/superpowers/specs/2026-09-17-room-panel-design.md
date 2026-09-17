# Map Chat — Room panel design (chunk 9)

**Review feedback:** [2026-09-17-room-panel-design-feedback.md](2026-09-17-room-panel-design-feedback.md)

Status: Review findings accepted and incorporated · Date: 2026-09-17
Sources: `docs/PRD.md` §3 Flow B, §4 (Message display, History, Compose behavior), §6.7, §8;
`docs/superpowers/specs/2026-09-16-room-feed-design.md` §6, §7, §9 (store and hook);
`docs/superpowers/specs/2026-09-16-map-shell-design.md` §6, §8 (selection, panel frame, scroll
rules); `docs/superpowers/plans/2026-09-16-chunk-07-compose-form.md` "Handoff to chunks 9 and
10"; `docs/superpowers/specs/2026-09-16-map-chat-implementation-chunks.md` chunk 9.

Chunk 9 opens a room from a pin and runs it end to end over HTTP polling. Its store and hook
are specified in the room-feed design. Section 5 refines and supersedes the map-shell design's
scroll measurement rules, including mixed updates and internal textarea scrolling.
This spec fixes the panel's components and
props, its loading and error surfaces, the scroll semantics beyond the 32 px rule, the time
format, the first-message seed path through the selection state, and the chunk's tests,
including the project's first Playwright suite.

## 1. Scope and decisions

In scope: `src/lib/feed/store.ts` and `src/lib/feed/useRoomFeed.ts` (as specified in the
room-feed design), `src/lib/time/format.ts`, `src/components/room/*` except `NewRoomPopup` and
`RoomTitle`, the seed field in `src/lib/page/selection.ts`, the `RoomPanel` wiring in
`MapShell`, bounded textarea styling in `ComposeForm`, and the Playwright harness with the
room-panel scenarios. The feed's manual `loadNewer()` completion promise is specified here
and mirrored in the room-feed contract; reducer transitions are unchanged.

Decisions made in this spec:

1. **One fetch at a time, in the UI.** The reducer ignores `olderRequested` and
   `newerRequested` while any fetch is in flight. The panel therefore disables "Load older"
   and "Load more messages" while `feed.loading !== null`, and shows a spinner only on the
   button whose own operation is running. The reducer is unchanged.
2. **Seed path.** Chunk 9 builds the whole path for the first message of a freshly created
   room: `roomCreated` carries it, the room selection stores it as `seed`, `MapShell` passes it
   to `RoomPanel`, which passes it to `useRoomFeed`. Chunk 10 only dispatches the action.
3. **Error surfaces.** Chunk 9 owns every in-panel error surface (section 4). Chunk 12 adds
   only the page-level reaction to a room that no longer exists.
4. **No connection indicator.** The panel root carries `data-connection` for tests and the
   chunk 11 smoke; nothing visible.
5. **Own send scrolls to the bottom** regardless of the reader's position. The PRD's
   "only if already at the bottom" rule applies to incoming messages.
6. **A manual backlog batch keeps the reader's position** and shows the "New messages" pill,
   including additions between displayed rows. A hold lasts through that request's completion;
   unrelated arrivals cannot consume it. Empty or duplicate-only results create no new pill.
7. **Scroll decisions are pure functions** in `listScroll.ts`; `MessageList` only measures and
   applies. jsdom has no layout, so the rules are unit-tested as functions and proven in a real
   browser by Playwright.
8. **Time format** uses a fixed `en-GB` locale with a 24-hour clock and adds the year for
   messages from another year.
9. **Playwright** is introduced for what jsdom cannot prove: layout, scrolling, and the full
   HTTP path with polling (section 8).
10. **`titleSlot` is dropped** from the earlier `RoomPanelProps` draft. `PanelFrame.title` is
    already a `ReactNode`; chunk 9 passes `room.name` and chunk 10's spec decides on `RoomTitle`.
11. **Preserve a visible row**, not the total scroll-height difference, when retaining the
    reader's position. Added IDs are detected across the whole list, including interior inserts.
12. **Bound the composer** at the supported desktop size. The textarea may scroll internally;
    Send, notices and a usable message viewport remain reachable with a valid many-line draft.

## 2. Dependencies

| Dependency | State at writing time | Needed for |
| --- | --- | --- |
| Chunk 5: `MessagesApi`, `MessagePage`, `CatchUpPage`, `ApiRequestError`, `ApiValidationError` | Merged (`src/lib/api/client.ts`, `src/lib/schemas/types.ts`) | store |
| Chunk 6: `PanelFrame`, `MapShell`, `selectionReducer`, `Prefill` | Merged | panel, wiring |
| Chunk 7: `ComposeForm`, `useDisplayName` | In progress on `chunk-07-compose-form` (Task 1 of 6) | panel footer |
| Chunk 8: `feedReducer`, `connectionOf`, feed types | In progress on `chunk-08-feed-reducer` (Task 1 of 5) | store |

Chunks 7 and 8 must be merged before the chunk 9 plan is executed. The plan's first task
verifies their real exports against the names used here and in the room-feed design and reads
any drift from the source files.

## 3. Files and interfaces

New files

| Path | Contents |
| --- | --- |
| `src/lib/feed/store.ts`, `store.test.ts` | Room-feed design §6, §9 |
| `src/lib/feed/useRoomFeed.ts`, `useRoomFeed.test.tsx` | Room-feed design §7, §9 |
| `src/lib/time/format.ts`, `format.test.ts` | `formatMessageTime` (section 6) |
| `src/components/room/RoomPanel.tsx`, `RoomPanel.test.tsx` | Composes the hook, `PanelFrame`, the list and the footer (section 4) |
| `src/components/room/MessageList.tsx`, `MessageList.test.tsx` | The scroll container, "New messages" pill (section 5) |
| `src/components/room/MessageItem.tsx` | One row; memoized |
| `src/components/room/LoadOlderButton.tsx` | First element of the list |
| `src/components/room/BacklogNotice.tsx` | "More messages are available" + "Load more messages" |
| `src/components/room/listScroll.ts`, `listScroll.test.ts` | Pure scroll decisions (section 5) |
| `playwright.config.ts`, `tests/e2e/helpers.ts`, `tests/e2e/room-panel.spec.ts` | Section 8 |

Modified files

- `src/lib/page/selection.ts` and its test (section 3.1).
- `src/components/compose/ComposeForm.tsx` and its test: an optional `textareaClassName?: string`
  passed to its `Textarea`, allowing the room panel's bounded sizing (section 4.1). Chunk 9
  owns this integration change; validation, submission and default callers keep their contracts.
- `src/components/map/MapShell.tsx` and its test: the room placeholder becomes
  `<RoomPanel key={selection.room.id} room={selection.room} seed={selection.seed}
  prefill={selection.prefill} onClose={close} />`.
- `package.json` (`@playwright/test`, script `test:e2e`), `.gitignore` (`test-results/`,
  `playwright-report/`), `README.md` (room panel and e2e sections).

### 3.1 Selection seed

```ts
// src/lib/page/selection.ts
export type Selection =
  | { kind: "none" }
  | { kind: "draft"; lat: number; lng: number }
  | { kind: "room"; room: Room; prefill?: Prefill; seed?: Message };

export type SelectionAction =
  | { type: "clickEmpty"; lat: number; lng: number }
  | { type: "clickPin"; room: Room }
  | { type: "roomCreated"; room: Room; message: Message }   // message becomes the seed
  | { type: "movedToExisting"; room: Room; prefill: Prefill }
  | { type: "close" };
```

- `roomCreated` → `{ kind: "room", room, seed: message }`.
- `movedToExisting` never sets a seed: the existing room has other visitors' history and loads
  it normally. `prefill` is unsent draft text, not a message.
- `clickPin` on the already selected room still returns the same state object, so seed and
  prefill survive and the keyed panel is not remounted. `clickPin` on another room, and
  re-opening the same room after `close`, produce a selection without a seed.
- The hook captures the seed once per room identity (room-feed design §7); a later change of
  the prop does nothing.

### 3.2 Panel props

```ts
// src/components/room/RoomPanel.tsx
export type RoomPanelProps = {
  room: Room;
  seed?: Message;                 // first message of a room this visitor just created
  prefill?: Prefill;              // unsent draft from a 409 hand-off (chunk 10)
  onClose(): void;
  feedDeps?: Partial<FeedDeps>;   // tests inject fake api, subscribe, config, timers
};
```

`RoomPanel` calls `useRoomFeed(room.id, { seed, deps: feedDeps })`.

The two buttons are presentational; `RoomPanel` and `MessageList` derive their flags from
`feed.loading` as section 4 describes:

```ts
// src/components/room/LoadOlderButton.tsx
export type LoadOlderButtonProps = { disabled: boolean; busy: boolean; onClick(): void };
// src/components/room/BacklogNotice.tsx
export type BacklogNoticeProps = { disabled: boolean; busy: boolean; onLoadMore(): void };
```

## 4. Panel states, errors and submit

Header: `PanelFrame` with `title={room.name}` and `onClose`. Body and footer by feed condition,
first matching row wins:

| Feed condition | Body | Footer |
| --- | --- | --- |
| `error?.notFound` (any op) | Persistent hint: "This room no longer exists." | `ComposeForm` disabled |
| `error?.op === 'initial'` | Persistent hint: "Couldn't load this room. Close it and open it again." | `ComposeForm` disabled |
| `!ready` | Centered spinner with "Loading messages…" | `ComposeForm` disabled |
| `ready` | `MessageList` | fetch alert (if any), `BacklogNotice` (if any), `ComposeForm` |

The two hints have no dismiss control and the panel never calls `dismissError` for them, so a
failed room cannot be made to look usable (room-feed design §7). A seeded room never shows the
spinner row after commit: its first published store snapshot is already `ready`.

Footer while `ready`, top to bottom:

1. **Fetch alert**, when `error?.op` is `'older'` or `'newer'`: a shadcn `Alert` with a close
   button that calls `feed.dismissError()`.
   - older: "Couldn't load older messages. Try again."
   - newer, no backlog: "Couldn't check for new messages. Retrying automatically."
   - newer, `backlog` true: "Couldn't check for new messages. Use Load more messages to retry."
   The raw `error.message` is not shown; it is written with `console.warn` once per error
   object.
2. **`BacklogNotice`**, when `feed.backlog`: the text "More messages are available" and the
   button "Load more messages". Disabled while `feed.loading !== null`; spinner only while
   `loading === 'newer'`. Its click handler begins a list hold, calls `feed.loadNewer()`, and
   finishes that hold when the returned completion promise settles (section 5).
3. **`ComposeForm`** (chunk 7): `submitLabel="Send"`, `disabled={!feed.ready}`,
   `initialAuthor={prefill?.author ?? name}` with `const [name] = useDisplayName()`,
   `initialText={prefill?.text}`, `onSubmit={submit}`, and bounded `textareaClassName` styling
   as section 4.1 describes.

`LoadOlderButton`: label "Load older"; hidden when `!hasOlder`; disabled while
`loading !== null`; spinner only while `loading === 'older'`. After an older failure it is
enabled again, so clicking it is the retry.

Submit adapter (alongside the manual-load hold lifecycle):

```ts
async function submit(input: PostMessageInput): Promise<void> {
  try {
    const message = await feed.send(input);
    listRef.current?.scrollToBottom(message.id); // apply once this row is committed
  } catch (error) {
    if (error instanceof FeedNotReadyError) {
      // Known no-write failure: form-level message, drafts kept, no uncertain-write warning.
      throw new ApiValidationError([{ path: "", message: error.message }]);
    }
    throw error;                         // ComposeForm maps API errors itself
  }
}
```

Pending-state disabling, field errors, the uncertain-write warning and display-name persistence
belong to chunk 7's `ComposeForm` and are not re-specified.

Other rules

- The panel root element carries `data-connection={feed.connection}`.
- `feed.activity` is not wired in chunk 9. Chunk 11 attaches `attachActivityTracking` to the
  panel root. With chunk 9's stub `subscribe`, every room runs in polling mode and no idle
  timer runs.
- Room gone: chunk 9 stops at the persistent hint. Chunk 12 observes the same
  `error.notFound` to close the panel and show a page-level notice.

### 4.1 Bounded desktop composer

At 1280 × 720 CSS pixels, the header and footer controls must fit inside the panel slot,
with at least 96 px of message viewport when history is ready. This also applies with the
fetch alert, backlog notice and a compose error present together. Layout spacing and wrapping
may be compacted to meet this constraint; the page must not acquire a scrollbar.

The room panel supplies a fixed-height textarea, initially 64 px, using `field-sizing-fixed`,
bounded height, `resize-none` and `overflow-y-auto` through `textareaClassName`. Long text and
many explicit newlines scroll inside the input instead of growing the footer. All 3000 allowed
code points remain editable and submittable. The message list is the only conversation scroll
container; the textarea's internal editing scroll is an explicit exception. Chunk 9's plan
must include the small ComposeForm prop change and real-browser layout acceptance below.

## 5. Message list and scroll rules

```ts
// src/components/room/MessageList.tsx
export type MessageListProps = {
  messages: Message[];
  hasOlder: boolean;
  loading: FeedState["inflight"];
  onLoadOlder(): void;
};
export type MessageListHandle = {
  scrollToBottom(messageId?: string): void; // wait for that row's commit if necessary
  holdPosition(): () => void;              // returns an idempotent finish callback
};
```

The list is the conversation scroll container (`overflow-y-auto`) and has `role="log"`,
`aria-live="polite"`, and `aria-busy` while `loading === 'older'`. `LoadOlderButton` is its
first child. Row layout follows map-shell design §8: author in `font-medium`, text with
`whitespace-pre-wrap break-words`, time in `text-xs text-muted-foreground` right-aligned,
rendered as `<time dateTime={message.createdAt}>`.

```ts
// src/components/room/listScroll.ts
export type ScrollMetrics = { scrollTop: number; scrollHeight: number; clientHeight: number };
export const NEAR_BOTTOM_PX = 32;
/** scrollHeight - scrollTop - clientHeight <= threshold */
export function isNearBottom(m: ScrollMetrics, threshold?: number): boolean;

export type ListChange = {
  initial: boolean;
  before: string[];   // newly added IDs before the previous first row
  within: string[];   // newly added IDs between previous rows
  after: string[];    // newly added IDs after the previous last row
};
export function classifyChange(prev: readonly Message[], next: readonly Message[]): ListChange;
```

### 5.1 Changes and reading anchors

Compare the full ID sets from consecutive committed snapshots. Only previously unseen IDs
count as additions; a new array containing the same IDs is not a change. Noninitial additions
are partitioned by their position relative to the old first and last rows, using the feed's
existing chronological order. Both `within` and `after` count as incoming additions. An empty
next list has `initial = false` and empty groups; the first nonempty snapshot has
`initial = true` and empty groups and is handled by the initial-position rule.

Before an update, retain the first visible message ID and its top offset relative to the
list viewport (which may be negative for a partially visible row), along with near-bottom
status. Refresh these measurements after commits and on user scrolling. Do not depend only
on the first and last IDs to trigger reconciliation. Capture committed DOM measurements;
an abandoned render must not overwrite the previous snapshot or anchor.

To preserve position after layout, adjust scrollTop by the change in that same row's viewport
offset. This compensates only for displacement above the row, even when another row is added
below it or Load older disappears. Coordinate with browser scroll anchoring so the displacement
is applied once. No aggregate scroll-height delta is used for mixed updates. With 100 px added
above and 100 px below, the existing visible row requires a 100 px adjustment, not 200 px.
If no row was visible, retain scrollTop clamped to the new valid range; initial history still
uses the bottom rule. Rows are not removed during this chunk's room lifetime.

Apply these rules in priority order after the relevant rows commit:

| Condition | Action |
| --- | --- |
| Explicit bottom request (own send or pill click) | scroll to bottom and clear the pill |
| Initial nonempty history | scroll to bottom |
| Active manual hold with incoming additions | preserve the visible-row anchor and show the pill |
| Incoming additions, previously near bottom, no hold | scroll to bottom |
| Incoming additions, previously away from bottom | preserve the anchor and show the pill |
| Only older additions | preserve the anchor; do not create a pill |
| No added IDs | do not create a pill or treat the result as new messages |

The same rules handle interior-only and combined before/within/after additions. A pure append
while scrolled up leaves scrollTop unchanged because its anchor is not displaced. Preserve
the anchor through footer size changes too; when following the bottom outside a manual hold,
keep following the bottom as the available list height changes.

### 5.2 Manual holds and explicit scrolling

- `holdPosition()` starts a request-scoped hold and returns its finish callback. While active,
  every incoming addition preserves the current reading anchor, including interior inserts.
  An unrelated arrival never consumes the hold. User scrolling updates the anchor normally.
- The panel calls the finish callback after that invocation of `feed.loadNewer()` settles.
  `loadNewer(): Promise<void>` resolves after its accepted HTTP response or failure has been
  reduced and published; ignored requests resolve immediately. Read failures remain in
  `feed.error` rather than rejecting this completion promise. Disposal resolves pending
  completions without mutating a replacement room. The store/hook own this completion signal;
  the reducer and polling behavior do not change (room-feed design sections 6–7).
- Finishing retains the hold for reconciliation of the final published snapshot, then releases
  it. This must work even when request start and completion occur before React renders an
  intermediate `loading === 'newer'` state. Do not infer completion or additions from endpoint
  IDs or from observing a loading transition. Empty, failed and duplicate-only batches finish
  the hold without creating a pill; any pill from a separate arrival is retained.
- `scrollToBottom(messageId)` queues an explicit bottom request until that message exists in
  the committed list; if already present, it applies immediately. Without an ID it applies to
  the current list. This request clears the pill and wins for that commit even during a hold,
  but does not end the hold: later arrivals from the manual batch still preserve position.
  This avoids assuming that resolving `send` guarantees a DOM commit. Discard pending requests
  on unmount; an old room's finish callback cannot affect the new room.
- The pill is a button labelled "New messages", positioned over the list's bottom edge outside
  the scroll content. Click requests the bottom. It hides on that explicit request or when
  user scrolling brings the reader near the bottom; automatic anchor corrections must not
  immediately hide a newly shown pill. It shows no count.

## 6. Time format

```ts
// src/lib/time/format.ts
export function formatMessageTime(
  iso: string,
  opts?: { now?: Date; timeZone?: string; locale?: string },
): string;
```

| Message date in the target zone | Output |
| --- | --- |
| Same calendar day as `now` | `17:03` |
| Same year, another day | `16 Sep 17:03` |
| Another year | `16 Sep 2025 17:03` |

- Defaults: `now = new Date()`, `timeZone` = the runtime's zone, `locale = "en-GB"` with
  `hourCycle: "h23"`. The UI is English-only; the fixed locale keeps output deterministic.
- The string is assembled from `Intl.DateTimeFormat#formatToParts` (day, short month, year,
  hour, minute), so no locale punctuation leaks in.
- Day and year comparison uses the formatted parts of both dates in the target zone, never UTC
  fields.
- `createdAt` has six fractional digits; `new Date` truncates them. `Date` is for display only,
  never for ordering.
- `now` is read at render. A message from "today" keeps its short form until the next render
  after midnight; accepted.
- No hydration risk: the feed's server and hydration snapshot has no messages, so no time is
  formatted on the server.

## 7. Unit and component tests

Vitest; component files opt in with `// @vitest-environment jsdom`.

- `store.test.ts`, `useRoomFeed.test.tsx`: room-feed design §9 including the acceptance cases
  for F-001, F-003, F-004 and F-005, and the F-002 cases that the stub and a fake failing
  adapter can exercise. Cases needing a confirming adapter stay in chunk 11. Manual newer
  completion waits for its own response/failure publication, resolves on ignored requests or
  disposal, and is not settled by an unrelated received message or a different request.
- `format.test.ts`: `2026-09-16T15:00:00.000000Z` in `Europe/Bucharest` → `18:00`; another day
  of the same year; another year; a message just after local midnight whose UTC date is the
  previous day formats as "today"; microsecond input parses.
- `listScroll.test.ts`: empty and initial snapshots; duplicate-only snapshots; before, within,
  after and every combination of additions; `[A, C] → [A, B, C]` reports B within;
  `isNearBottom` at 32 px, at 33 px, and with all-zero metrics.
- `MessageList.test.tsx` (stubbed scroll and row geometry): initial render
  scrolls to the bottom; prepend preserves the visible row; append near the bottom scrolls;
  append while scrolled up shows the pill and leaves `scrollTop`; pill click scrolls and hides
  it; user scrolling to the bottom hides it; interior incoming additions follow the same
  near-bottom/pill rules; mixed additions preserve a visible row (100 px above plus 100 px
  below adjusts by 100 px). A hold survives an unrelated append and applies to a final
  interior-only batch; finish handles failure, duplicate-only and empty batches, synchronous
  completion without an intermediate loading render, and unmount. Own send during a hold
  scrolls after its row commits, but does not release the hold. `scrollToBottom()`;
  Load older hidden when `!hasOlder`,
  disabled for `loading` `'older'` and `'newer'`, spinner only for `'older'`; text element has
  `whitespace-pre-wrap`; `role="log"`.
- `RoomPanel.test.tsx` (fake `feedDeps`, controllable promises): spinner and disabled compose
  while opening; history renders and compose enables; initial failure → persistent hint, no
  dismiss control, compose disabled; 404 → room-gone hint; older failure → alert, dismiss calls
  through, button enabled for retry; newer-failure copy with and without backlog; backlog
  notice calls `loadNewer` and is disabled during an older fetch; submit appends once and the
  next poll does not duplicate it; `FeedNotReadyError` → form-level message, draft kept, no
  uncertain-write warning; an API rejection reaches `ComposeForm`; `prefill` fills author and
  text; seeded panel shows the seed with zero `messages.list` calls; `data-connection`.
- `ComposeForm.test.tsx`: `textareaClassName` reaches the textarea, and the panel supplies its
  bounded styling. The existing submit, validation and draft-preservation tests remain intact;
  browser acceptance, not class assertions, proves the sizing behavior.
- `selection.test.ts`: `roomCreated` stores the seed; `movedToExisting` has none; `clickPin`
  on the same room returns the same object; `clickPin` on another room drops seed and prefill.
- `MapShell.test.tsx`: a room selection renders `RoomPanel`; a seeded initial selection shows
  the seed message; close unmounts the panel.

## 8. Playwright end-to-end tests

Purpose: prove what jsdom cannot — real layout and scrolling, and the full HTTP path with
polling. Error behavior, hidden-tab behaviour and Strict Mode replay stay in the Vitest suites;
browser layout fixtures may display notices to check their geometry.

Setup

| Item | Decision |
| --- | --- |
| Package, script | devDependency `@playwright/test`; project `chromium` only; `"test:e2e": "playwright test"`. Not part of `pnpm test`. |
| Viewport | Explicit `viewport: { width: 1280, height: 720 }` for every room-panel scenario. Helpers must not inherit a device preset's different size. |
| Location | `tests/e2e/**/*.spec.ts`, helpers in `tests/e2e/helpers.ts`. The Vitest configs include only `src/**`, `tests/api/**` and `tests/db/**`. |
| Server | `webServer: { command: "pnpm dev", url: baseURL, reuseExistingServer: true }`. `baseURL = process.env.E2E_BASE_URL ?? "https://map-chat.map-chat.test"` (the Supbuddy mapping), `ignoreHTTPSErrors: true`. Next 16 allows one dev server per project directory, so an already running one is reused. The plan's first e2e task verifies this start-up path with Supbuddy before any scenario is written. Requires the local Supabase stack. |
| Poll timing | `page.clock.install()` before navigation, then `page.clock.fastForward(30_000)` to fire a poll tick. Network stays real. No `NEXT_PUBLIC_POLL_INTERVAL_MS` override, because it is inlined at server start and a reused server may not have it. |
| Data | Through the real API with the `request` fixture: `createRoom()` posts `/api/rooms` with 6-decimal coordinates randomized within lat `[40, 50]`, lng `[0, 10]`, safely inside the fixed opening viewport, and returns `{ room, message }`. A coordinate-conflict 409 chooses fresh coordinates with a bounded setup retry; a failed/uncertain write is not retried automatically. `postMessages(roomId, n)` posts sequentially so `createdAt` order is the post order. No DB reset, no service-role key, no shared rooms; spec files may run in parallel. |
| Opening a room | `openRoom(page, room)`: go to `/`, wait for the marker with `title = room.name`, focus it and press Enter. Keyboard activation is guaranteed by map-shell design §7 and avoids clicks landing on overlapping pins at world zoom. Chunk 12 may switch the helper to `/room/<id>`. |
| Selectors | Roles and visible text only: `getByRole("log")`, button names, form labels. No test ids. |
| Caveats (README) | Rooms accumulate in the local DB until `pnpm db:reset`. `test:api` and `test:db` truncate tables: never run them while `test:e2e` runs. |

The helper acceptance check verifies all four coordinate-region corners against the actual
opening map bounds at 1280 × 720, with margin from the viewport edges. Changing the map's
center, zoom or test viewport requires rechecking that invariant. Pin overlap is still handled
by focus/Enter; the helpers do not rely on selecting a room absent from the viewport response.

Scenarios (`tests/e2e/room-panel.spec.ts`)

1. **Open and initial position.** A room with 3 messages shows author, text and time in
   ascending order. A room with 125 messages opens at the newest: the last message is in the
   viewport and `scrollHeight - scrollTop - clientHeight <= 1`.
2. **Load older keeps the position.** In the 125-message room (100 shown): scroll to the top,
   record the first message's `boundingBox().y`, click "Load older" → 120 rows, the recorded
   message within ±2 px, button present. Click again → 125 rows, button gone.
3. **Incoming at the bottom.** Post through the API, fast-forward 30 s: the message is in the
   viewport and no pill shows.
4. **Incoming while scrolled up.** Scroll up, post, fast-forward: the pill shows and
   `scrollTop` is unchanged. Click the pill: at the bottom, pill hidden.
5. **Send.** Fill the name and a two-line message, click Send: the message appears once, the
   textarea is empty, the name remains, and the text element is taller than a one-line
   message's (pre-wrap in real layout). After a fast-forwarded poll it still appears once.
   After reload and re-open, the name is prefilled. Variant: send while scrolled up ends at the
   bottom.
6. **Backlog.** With the room open, post 105 messages, fast-forward: "More messages are
   available" shows and exactly 100 rows were added. A further fast-forward adds none. Click
   "Load more messages": 5 more rows, notice gone, `scrollTop` unchanged, pill shown.
7. **Local time.** With `test.use({ timezoneId: "Europe/Bucharest" })`, the posted message's
   time equals the API's `createdAt` formatted in that zone as `HH:mm`.
8. **Interior catch-up and manual backlog.** Display an own post C ahead of the bookmark,
   then fetch previously unseen B between older history A and C. Check near-bottom following
   and, separately, preservation of a scrolled-up visible row with the pill shown. Repeat with
   a manual backlog page entirely before the already displayed C: unchanged first/last IDs
   must not suppress the pill, and the anchor's viewport offset stays within ±2 px. Use real
   API setup and controlled poll advancement so B exists before sending C.
9. **Mixed-update geometry.** A focused browser fixture renders the real MessageList with a
   deterministic single props update adding rows above and below a scrolled-up visible row.
   That row stays within ±2 px and the pill shows. The fixture may control props solely to
   guarantee a single commit; it must not substitute a fake list or weaken the real HTTP
   scenarios. Fixture bootstrapping belongs to the plan and must not add a production route.
10. **Bounded compose layout.** At the fixed viewport, enter a valid many-line draft close to
    3000 code points. The textarea scrolls internally; Send and the panel controls stay inside
    the viewport, the ready list has at least 96 px of height, and the page does not scroll.
    Submit successfully and verify the full text. A focused real-component layout fixture
    also checks simultaneous fetch alert, backlog notice and compose error with the long draft;
    this checks geometry, while error/retry semantics stay in Vitest.

Not covered here: seeded open has no producer until chunk 10, whose spec adds that scenario on
this harness; chunk 11 reuses the harness for its realtime scenarios.

## 9. Out of scope

Realtime and activity tracking (chunk 11); `NewRoomPopup`, `RoomTitle`, the 409 notice and its
placement (chunk 10); URL sync and closing the panel on a gone room (chunk 12); mobile layout;
list virtualization; a message count on the pill; a visible connection indicator; e2e coverage
of error/retry semantics and hidden tabs (notice geometry is covered by section 8).
