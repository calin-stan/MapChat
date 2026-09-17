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
| `@/lib/schemas/message`  | `authorSchema`, `messageTextSchema`, `postMessageInputSchema`                             |
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
| `@/lib/page/selection`        | `Selection` (`none` / `draft` / `room`) and `selectionReducer`                               |
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
`messages` stays sorted by `compareCreatedAtId` and unique by id. Both cursors are set when
the room opens, from the initial history page or the creation seed. After that, `syncCursor`
(the PRD 6.4 bookmark) moves only on `newerLoaded` and `olderCursor` only on `olderLoaded`;
realtime events, POST responses and failures never move either. At most one
fetch is in flight; a catch-up that cannot start is owed (`newerWanted`) and runs when the
fetch settles. A 404 from any fetch is terminal: the reducer drops every transport and then
ignores everything except `closed`. `connectionOf(state)` gives `realtime`, `polling` or
`connecting` for display.

## Tests

Unit tests live next to the code as `*.test.ts` and run in a Node environment. A component
test can opt into jsdom with `// @vitest-environment jsdom` as its first line.

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
