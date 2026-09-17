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
| `pnpm typecheck`  | `next typegen && tsc --noEmit`                      |
| `pnpm test`       | Vitest, single run                                  |
| `pnpm test:watch` | Vitest in watch mode                                |
| `pnpm test:api`   | Route-handler tests in `tests/api/` (needs the stack)  |
| `pnpm test:e2e`   | Playwright (Chromium) against the dev server and the stack |
| `pnpm db:status`  | `supabase status` (URLs and keys for this project)  |
| `pnpm db:env`     | Regenerate `.env.local` from the running stack      |

Starting, stopping and restarting Supabase is done through Supbuddy (app, MCP tools
`start_supabase` / `stop_supabase`, or `supbuddy supabase start|stop <project>`, where
`<project>` is the id from `.supbuddy/meta.json`). Do not run a bare `supabase start`; it
would compete with Supbuddy for the same containers.

Without Supbuddy (for example in CI), run `pnpm exec next dev` instead of `pnpm dev`.

## Configuration

All variables are listed with defaults in [.env.example](.env.example) and specified in
PRD section 6.6. `src/instrumentation.ts` validates every variable once, at server start,
listing every problem it finds in one message. Under `next start` a bad config stops the
server before it accepts any requests; under `next dev` the server keeps running and every
request fails until the config is fixed. Application code reads configuration through two
accessors in `src/lib/config`, each of which parses on first use and memoises the result for
the life of the process:

- `getClientConfig()` from `@/lib/config/client` for browser-safe values (`NEXT_PUBLIC_*`).
- `getServerConfig()` from `@/lib/config/server` for route handlers. It imports `server-only`,
  so importing it from a client component is a build error.

## Shared domain layer

Code imported by both route handlers and client components (PRD sections 4, 6.1, 6.3, 6.5):

| Module                   | Provides                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------- |
| `@/lib/schemas/common`   | `countChars` (Unicode code points, like Postgres `char_length`), `trimmedText`, `requiredOr` |
| `@/lib/schemas/message`  | `AUTHOR_MAX_CHARS`, `TEXT_MAX_CHARS`, `authorSchema`, `messageTextSchema`, `postMessageInputSchema` |
| `@/lib/schemas/room`     | `latSchema`, `lngSchema`, `createRoomInputSchema`, `roundCoord` (6 decimals)              |
| `@/lib/schemas/query`    | `bboxSchema` (`minLng,minLat,maxLng,maxLat`), `uuidSchema`, `messagesQuerySchema`         |
| `@/lib/schemas/types`    | `Room` and `Message` API types                                                            |
| `@/lib/names/generate`   | `generateRoomName`, `withSuffix`, `NameCollision`, `insertWithUniqueName`                 |
| `@/lib/supabase/server`  | `createServiceClient()`: service-role key, importable from server code only               |
| `@/lib/supabase/browser` | `getBrowserClient()`: one anon-key client for Realtime                                    |

Validation messages are short phrases meant to follow a field name, such as "is required" or
"must be between 1 and 100 characters". Schemas validate but do not round coordinates; the
rooms repository (`createRoom` in `@/lib/db/rooms`) calls `roundCoord` before insert.

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

## Map

The home page is a full-viewport Leaflet map (PRD sections 3, 4, 5). `src/app/page.tsx` stays a
server component and renders `MapShell`, the client component that owns all page state. The map
itself is loaded with `next/dynamic` and `ssr: false` because Leaflet touches `window` on import.

| Module                        | Provides                                                                                     |
| ----------------------------- | -------------------------------------------------------------------------------------------- |
| `@/lib/map/viewport`          | `toQueryBoxes` (splits antimeridian-crossing viewports), `mergeBoxResults`, `PIN_LIMIT` (500) |
| `@/lib/map/useRoomPins`       | 250 ms debounce, immediate viewport invalidation, request ownership, 30 s visible-tab ticks that skip pending work |
| `@/lib/page/selection`        | `Selection` (`none`, optionally with the `gone` room / `draft` / `room`) and `selectionReducer`; `@/lib/page/handoff` wraps it for `MapShell` |
| `@/lib/page/selectionUrl`     | `pathForSelection` and `useSelectionUrl`: the address follows the open room with `history.replaceState` |
| `@/lib/page/sharedRoom`       | `loadSharedRoom(id)`, server-only: the room behind `/room/<id>`, or null                     |
| `@/components/map/MapShell`   | The page: selection, pins, status pill and the floating panel slot                          |
| `@/components/map/MapView`    | `MapContainer` with OSM tiles, `RoomPins` and `DraftPin`; props in, events out               |
| `@/components/map/pinIcon`    | `divIcon` pins (`room`, `selected`, `draft`); no icon assets, no `L.Icon.Default` patch       |
| `@/components/panel/PanelFrame` | Header / body / footer chrome shared by the welcome card, the new-room form and the room panel |

Tiles come from `https://tile.openstreetmap.org` with the OpenStreetMap attribution; the map is
limited to one world copy (`maxBounds`, `noWrap`). A viewport that crosses the antimeridian is
queried as two boxes and the results are merged, deduplicated and capped at 500 newest-first.
When the cap is hit the map shows "Zoom in to see more rooms"; when a refresh fails it keeps the
previous pins and shows "Couldn't refresh rooms" until a later refresh succeeds.

Viewport changes invalidate old results immediately. Periodic ticks skip a pending debounce or
request for the current viewport. Hiding the tab cancels scheduled requests; returning refreshes
once using the latest viewport. Single map clicks place a draft after a 500 ms arbitration window;
double-clicks within that window cancel placement. Clicks outside valid world coordinates are ignored.
The two Fiji seed rooms are visited separately at opposite edges of the single rendered world.

## Room feed

The client-side core of an open room (PRD 4 "History", 6.4, 6.7) is a pure reducer, a
framework-free store that runs its effects, and a React hook over that store. The store talks
to Supabase Realtime through an injected adapter; the hook's default is `subscribeToRoom`.
Design: `docs/superpowers/specs/2026-09-16-room-feed-design.md`.

| Module                  | Provides                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------ |
| `@/lib/feed/types`      | `FeedState`, `FeedAction`, `FeedEffect`, `FeedError`, `Connection`, `FetchOp`             |
| `@/lib/feed/reducer`    | `initialFeedState(roomId)`, `feedReducer(state, action)` returning `[state, effects]`, `mergeMessages`, `connectionOf`, `EMPTY_HISTORY_MESSAGE` |
| `@/lib/feed/realtime`   | `subscribeToRoom(roomId, handlers, client?)`, the Supabase Realtime adapter; `SubscribeToRoom`, `RealtimeHandlers`, `RealtimeHandle`, `TOPIC_BUSY`, `POSTGRES_READY_TIMEOUT_MS`; `pollingOnlySubscribe`, an adapter for tests and fixtures that refuses realtime |
| `@/lib/feed/activity`   | `attachActivityTracking(el, { onActivity, ignoreScroll? })` returning the detach function              |
| `@/lib/feed/store`      | `createFeedStore(roomId, deps, seed?)`, `FeedDeps`, `FeedStore`, `FeedNotReadyError`      |
| `@/lib/feed/useRoomFeed` | `useRoomFeed(roomId, { seed, deps })` returning `RoomFeed`                                |

`feedReducer` performs no I/O. It returns the next state plus an ordered list of effects
(`fetchInitial`, `fetchOlder`, `fetchNewer`, `subscribe`, `unsubscribe`, `startPolling`,
`stopPolling`, `startIdleTimer`, `stopIdleTimer`) for the caller to run after storing the
state. An action the state does not accept returns the same state object and no effects.
`messages` stays sorted by `compareCreatedAtId` and unique by id. Both cursors are set when
the room opens, from the initial history page or the creation seed. After that, `syncCursor`
(the PRD 6.4 bookmark) moves only on `newerLoaded` and `olderCursor` only on `olderLoaded`;
realtime events, POST responses and failures never move either. At most one
fetch is in flight; a catch-up that cannot start is owed (`newerWanted`) and runs when the
fetch settles. A 404 from any fetch is terminal: the reducer drops every transport and then
ignores everything except `closed`. `connectionOf(state)` gives `realtime`, `polling` or
`connecting` for display.

`createFeedStore` is inert until `start({ hidden })`. It queues reentrant actions, gives
every `subscribe` effect its own attempt token (the first failure is terminal, a late
callback is ignored, a handle is always cleaned up exactly once) and ignores every result
that arrives after `dispose()`. `send` rejects with `FeedNotReadyError` and posts nothing
unless the room is open. `loadNewer()` returns a promise that resolves once the fetch that
call started has been reduced and published, or at once when the request was ignored; read
failures stay in `error` and never reject it. `useRoomFeed` creates the store in a layout
effect and disposes it in the cleanup, so rendering, server rendering and Strict Mode's
effect replay never reuse or leak a store; it also tracks `document.visibilityState`.

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
"Load more messages" are disabled while any fetch is in flight. A failed initial load shows
a persistent hint and keeps the form disabled; a failed older or newer fetch shows a
dismissible alert. A room that no longer exists (a 404 from any read) is reported through
`onGone(room)`: the map page closes the panel and shows "The chatroom <name> no longer
exists." above the greeting; a host without `onGone` keeps the in-panel hint. The message field is a fixed 64 px and scrolls
inside itself, so Send and at least 96 px of messages stay visible at 1280 × 720.

The panel root has `data-connection` (`connecting`, `polling`, `realtime`) for tests; nothing
visible. The same element reports activity (`pointerdown`, `pointermove`, `keydown`, `wheel`,
`scroll`, `touchstart`) to the feed, which postpones the realtime idle timeout; a sent message
counts too. MessageList classifies its own scroll events: automatic following and anchor
correction are excluded, while reader scrolling is reported once. A room created in chunk 10
passes its first message through the selection as `seed` and opens without a history request.

## New chatroom flow

Clicking an empty spot opens the "New chatroom" form in the floating panel (PRD 3 Flow A).
Create sends the first message with the clicked coordinates; the server rounds them to six
decimals, and the form's hint shows that rounded spot.
Design: `docs/superpowers/specs/2026-09-17-new-room-flow-design.md`.

| Module                           | Provides                                                                  |
| --------------------------------- | ------------------------------------------------------------------------- |
| `@/components/room/NewRoomPopup` | The draft panel: hint, info bubble, `ComposeForm` "Create", the create call; reports `onCreated`, `onConflict`, `onFailed` |
| `@/components/room/MovedNotice`  | The dismissible notice shown after a create landed on an existing room     |
| `@/lib/page/handoff`             | `handoffReducer` around `selectionReducer`: panel `revision`, create `recovery`, `draftPanelKey`, `roomPanelKey` |
| `@/components/compose/ComposeForm` | Also `autoFocusField`, `submitFailedMessage`, `initialErrors`, `BOUNDED_TEXTAREA_CLASS` |

- **Created.** The new room's pin is inserted at once and its panel opens already showing the
  first message, with no history request; catch-up starts from that message.
- **A room already exists there (409).** Nothing is written. The visitor is moved into the
  existing room with a notice; name and message are prefilled and unsent. The notice goes away
  when dismissed or after a successful send.
- **The outcome always takes over the panel.** A create that settles after the visitor closed
  the form, opened a room or placed another draft still opens its room, or restores its draft,
  and replaces whatever is showing, including unsent edits made meanwhile. Several pending
  creates apply in the order they settle. Every outcome mounts a fresh panel, even for a room
  that is already open. Pending creates do not survive a page reload.
- **Failure.** The submitted name and message come back in a fresh form at the submitted
  coordinates with the error. Nothing is retried automatically. After a lost response the room
  may exist: Create at the same spot then opens it through the 409 path, while moving the pin
  first starts a separate creation at the new spot.
- **Pins.** A room inserted by an outcome keeps its pin while it is selected, even when an
  older refresh omits it. After closing, the pin follows the normal viewport refresh and the
  500-pin cap.
- The info bubble opens on hover and keyboard focus only (see `docs/KNOWN_LIMITATIONS.md`).

`tests/e2e/new-room.spec.ts` covers the flow in Chromium. Each run leaves three rooms at
random spots outside the fixture region; `clickEmptySpot` retries around existing rooms, and
on a very crowded local map it fails with a hint to reset disposable data.

## Shareable room URL

Every room has an address, `/room/<id>` (PRD 3). `src/app/room/[id]/page.tsx` is a server
component: it loads the room with `loadSharedRoom` (service-role client, never the browser)
and renders the same `MapShell` as `/`, started with the room selected, the map centred on it
and `ROOM_ZOOM` (16). The route is rendered per request. An id that is not a UUID, or that no
room has, answers 404 with `src/app/not-found.tsx` ("Open the map" leads to `/`); the same
page serves every unmatched URL.

While the app is open the address follows the selection: `useSelectionUrl` in `MapShell`
calls `history.replaceState` with `/room/<id>` for an open room (also right after creating
one, or after a 409 hand-off) and `/` otherwise. It adds no history entries and never
navigates: the panel and its feed stay mounted. A reload or a pasted link lands on the room
page.

A room that disappears while open closes its panel: `RoomPanel` calls `onGone(room)` on the
feed's terminal 404, `MapShell` dispatches `roomGone`, the selection becomes
`{ kind: "none", gone: room }`, the pins are refreshed and `RoomGoneNotice` shows above the
greeting until it is dismissed or something else is selected.

## Tests

Unit tests live next to the code as `*.test.ts` and run in a Node environment. A component
test opts into jsdom with `// @vitest-environment jsdom` as its first line and uses Testing
Library (`@testing-library/react`, `user-event`); `vitest.setup.ts` registers the jest-dom
matchers for every file and, when a DOM exists, cleans it between tests. Target one file with
`pnpm test <path>` (no `--`).

## End-to-end tests

`pnpm test:e2e` runs Playwright (Chromium, 1280 × 720) against the real dev server and the
local Supabase stack. It proves what jsdom cannot: layout, scrolling, the full HTTP path with
polling, and live delivery over the local stack's Realtime server. First time: `pnpm exec
playwright install chromium`.

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
- Polling scenarios call `refuseRealtime(page)`, which closes the `/realtime/v1/websocket`
  connection in the browser: the real adapter sees a refused connection and the room polls.
  Realtime scenarios (`tests/e2e/realtime.spec.ts`) use `openLiveRoom`, which waits for
  `data-connection="realtime"` and then pauses the clock. A row that appears while the clock is
  paused, with no new catch-up request, came over the websocket. `goIdle` fast-forwards the
  180 s idle timeout.
- `tests/e2e/shared-room.spec.ts` covers `/room/<id>`, the address following the selection
  (no page/RSC requests for either selection path and the same map control retained from
  both entry routes; no absolute history-request counts under Strict Mode), the 404 page and the gone-room
  notice. The API has no delete, so that last scenario answers one room's messages endpoint
  with a 404 through `page.route`; it is the suite's only HTTP interception.
- `src/app/e2e/**/page.dev.tsx` are fixture pages for these tests. `next.config.ts` lists the
  `dev.tsx` page extension only outside production, so `next build` does not contain them.

## Compose form and display name

The "New chatroom" popup and the room panel render the same form (PRD 6.7), so the 409
hand-off is a prop change, not a second implementation.

| Module                          | Provides                                                                                     |
| ------------------------------- | -------------------------------------------------------------------------------------------- |
| `@/lib/storage/displayName`     | `DISPLAY_NAME_KEY`, `readDisplayName`, `writeDisplayName`, `subscribeDisplayName`; every access is wrapped, so blocked or missing storage means "not remembered" |
| `@/lib/storage/useDisplayName`  | `useDisplayName(): [name, setName]`; `""` on the server and while hydrating, the stored name after mount, updated across tabs |
| `@/components/compose/ComposeForm` | `ComposeForm({ initialAuthor, initialText?, submitLabel?, disabled?, onSubmit })`      |
| `@/components/compose/fieldErrors` | `submitErrors`, `toComposeErrors`, `isValidationError`, `SUBMIT_FAILED_MESSAGE` |

`ComposeForm` validates with `postMessageInputSchema`, shows "<Field> <message>" under each
field, and shows remaining characters counted in code points. On submit it disables both fields
and the button, preventing edits that could be erased by the pending response,
awaits `onSubmit` with the trimmed values, and on success clears the message, keeps the name
and stores it. If `onSubmit` rejects with an error named `ApiValidationError` carrying
`fields: { path, message }[]`, the messages appear under their fields (other paths become one
form-level line); an `ApiRequestError` with code `unavailable` shows the server's message;
any other rejection shows a "may still have gone through" notice. Drafts survive every
rejection. Pass `initialAuthor={name}` from `useDisplayName()`; a value that arrives after
mount is adopted while the field is untouched.

## Database

The schema lives in `supabase/migrations/` as plain SQL, applied to the Supbuddy-managed local
Supabase stack with the Supabase CLI. Start and stop the stack through Supbuddy (app or MCP
`start_supabase` / `stop_supabase`), not with `supabase start`.

| Command           | What it does                                                          |
| ----------------- | --------------------------------------------------------------------- |
| `pnpm db:migrate` | Applies migrations not yet applied to the local database              |
| `pnpm db:reset`   | Drops and rebuilds the local database from all migrations, then loads `supabase/seed.sql` |
| `pnpm test:db`    | Runs the database tests in `tests/db/` against the local stack        |

`pnpm test` does not touch the database; `pnpm test:db` needs the stack running. The tests connect
with `DATABASE_URL` if set, otherwise with the `DB_URL` reported by `supabase status -o env`.
The RPC contract tests also read `API_URL` and `SERVICE_ROLE_KEY` from that CLI command and call
the local API through Supabase's client. Any `DATABASE_URL` override must refer to the same project.
`pnpm test:db` truncates the `chatrooms` and `messages` tables in the local database, deleting any
local dev data in them. Run `pnpm db:reset` again to get the seed data back. The seed is repeatable through this reset;
its inserts are not idempotent against an already populated database.

Schema summary (see `docs/PRD.md` section 6):

- `chatrooms` and `messages` have Row Level Security enabled. `anon` may only SELECT; there are no
  anon write grants or policies. `service_role` (used by the route handlers) has full access.
- `messages` is in the `supabase_realtime` publication for Postgres Changes.
- `create_room_with_first_message(p_lat, p_lng, p_name, p_author, p_text)` inserts a room and its
  first message atomically and returns `{"room", "message"}`. Only `service_role` may execute it.
  Direct SQL errors include `constraint_name`. RPC errors expose the name inside `message`:
  after checking `code === "23505"`, extract the exact quoted constraint name and recognize only
  `chatrooms_name_key` (retry with a new name) or `chatrooms_lat_lng_key` (a room already exists
  at that spot). Unrecognized errors follow the unexpected-error path without a name retry.
- `list_messages(p_room, p_mode, p_cursor, p_limit)` returns one history page (`initial`, `before`
  or `after` a cursor, comparing `(created_at, id)`). It raises `PT404` for an unknown room and
  `PT400` for a cursor outside the room; PostgREST maps those to HTTP 404 and 400. Only
  `service_role` may execute it.
