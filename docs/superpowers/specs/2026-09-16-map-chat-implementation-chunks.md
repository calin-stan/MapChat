# Map Chat — Implementation Chunks

Status: DRAFT, pending review · Date: 2026-09-16
Spec source: `docs/PRD.md` (Technical PRD v2). This document does not restate the PRD; it
decomposes it into chunks and fixes the file layout and cross-chunk interfaces so that each chunk
can be planned with `superpowers:writing-plans` and executed independently.

How to use: for each chunk, in order, either (a) run `superpowers:writing-plans` directly with
this document plus the PRD as the spec, or (b) where the chunk is marked **Spec needed: yes**,
first run `superpowers:brainstorming` to produce `docs/superpowers/specs/<date>-<chunk>-design.md`,
then run `superpowers:writing-plans` against that spec. Plans go to
`docs/superpowers/plans/<date>-chunk-NN-<name>.md`.

---

## 0. Global constraints (apply to every chunk)

Copy these into the "Global Constraints" header of every plan.

- Language: TypeScript, `strict: true`, no `any` in committed code.
- Package manager: pnpm. Node 22 LTS.
- Framework: Next.js 16, App Router, route handlers on the Node.js runtime (never Edge).
  In Next 15+ route handler `params` is a `Promise` and must be awaited.
- UI: React 19, Tailwind, shadcn/ui components wherever one fits; icons from `react-icons`.
- Map: `leaflet@1.9.x` + `react-leaflet@5.x`, OpenStreetMap raster tiles with attribution
  `© OpenStreetMap contributors`.
- Data: `@supabase/supabase-js@2.x`. Browser holds only the anon key. All writes go through
  route handlers using the service-role key. RLS on with anon SELECT only.
- Validation: `zod` (latest 4.x at chunk 1 time; pin the version chosen there). One schema
  module shared by client and server.
- Names: `unique-names-generator` (adjectives, colors, animals, separator `-`), `nanoid`
  (4-char suffix, alphabet `0123456789abcdefghijklmnopqrstuvwxyz`).
- Character counting: `[...s].length` in JS, `char_length()` in Postgres. Limits: author 1..100,
  text 1..3000, after `trim()`.
- Coordinates: lat in [-90, 90], lng in [-180, 180], rounded to 6 decimals server-side before
  insert (`Math.round(x * 1e6) / 1e6`).
- Sizes: history initial 100, page 20, bbox result cap 500. Polling 30000 ms, idle 180000 ms.
  All configurable via the env vars in PRD 6.6.
- Tests: Vitest. Unit tests colocated as `*.test.ts(x)` next to the source. Integration tests in
  `tests/integration/**` run with `vitest.integration.config.ts` against the local Supabase
  stack (`supabase start`). Use TDD: failing test first.
- Commits: conventional commits, one commit per task, via the project's `commit` skill
  (GitButler). Exact library versions are resolved in chunk 1 and recorded in `package.json`;
  later plans read them from there.

## 0.1 Target file layout

Fixed here so that every chunk uses the same paths. Chunks create only their own files.

```
app/
  layout.tsx                          chunk 1
  page.tsx                            chunk 6  (map page shell)
  room/[id]/page.tsx                  chunk 12 (shareable URL)
  api/rooms/route.ts                  chunk 4  (GET bbox, POST create)
  api/rooms/[id]/route.ts             chunk 4  (GET room)
  api/rooms/[id]/messages/route.ts    chunk 5  (GET history/cursors, POST message)
components/
  ui/**                               chunk 1  (shadcn generated)
  map/MapView.tsx                     chunk 6
  map/RoomPins.tsx                    chunk 6
  map/DraftPin.tsx                    chunk 6
  compose/ComposeForm.tsx             chunk 7
  room/RoomPanel.tsx                  chunk 9
  room/MessageList.tsx                chunk 9
  room/MessageItem.tsx                chunk 9
  room/LoadOlderButton.tsx            chunk 9
  room/NewRoomPopup.tsx               chunk 10
  room/RoomTitle.tsx                  chunk 10
lib/
  config/server.ts                    chunk 1
  config/client.ts                    chunk 1
  schemas/common.ts                   chunk 3  (countChars, trimmed text helpers)
  schemas/room.ts                     chunk 3
  schemas/message.ts                  chunk 3
  schemas/query.ts                    chunk 3  (bbox, cursor params)
  schemas/types.ts                    chunk 3  (Room, Message DTOs)
  names/generate.ts                   chunk 3
  supabase/server.ts                  chunk 3  (service-role client factory)
  supabase/browser.ts                 chunk 3  (anon client singleton)
  db/rooms.ts                         chunk 4
  db/messages.ts                      chunk 5
  api/errors.ts                       chunk 4  (error response helpers)
  api/client.ts                       chunk 4 (rooms) + chunk 5 (messages): typed fetch wrappers
  storage/displayName.ts              chunk 7
  storage/useDisplayName.ts           chunk 7
  time/format.ts                      chunk 9
  feed/types.ts                       chunk 8
  feed/reducer.ts                     chunk 8
  feed/useRoomFeed.ts                 chunk 9  (polling only) → chunk 11 adds realtime
  feed/realtime.ts                    chunk 11
  feed/activity.ts                    chunk 11
  page/selection.ts                   chunk 6  (map page selection state)
supabase/
  config.toml                         chunk 1
  migrations/20260916000001_schema.sql        chunk 2
  migrations/20260916000002_rls.sql           chunk 2
  migrations/20260916000003_create_room_fn.sql chunk 2
  migrations/20260916000004_realtime.sql      chunk 2
  migrations/20260916000005_list_messages_fn.sql chunk 5
  seed.sql                            chunk 2 (dev only)
tests/
  integration/setup.ts                chunk 2
  integration/db/*.test.ts            chunk 2
  integration/api/rooms.test.ts       chunk 4
  integration/api/messages.test.ts    chunk 5
.env.example                          chunk 1
vitest.config.ts                      chunk 1
vitest.integration.config.ts          chunk 2
```

## 0.2 Shared DTOs (defined in chunk 3, used everywhere)

```ts
// lib/schemas/types.ts
export type Room = { id: string; name: string; lat: number; lng: number; createdAt: string };
export type Message = { id: string; chatroomId: string; author: string; text: string; createdAt: string };
// createdAt is an ISO-8601 UTC string, e.g. "2026-09-16T15:00:00.123Z"
```

API error body (chunk 4):

```ts
type ApiError =
  | { error: { code: 'validation'; fields: { path: string; message: string }[] } }   // 400
  | { error: { code: 'not_found' } }                                                   // 404
  | { error: { code: 'conflict'; room: Room } };                                       // 409
```

---

## Chunk 1 — Scaffold and config

**Spec needed: no** (PRD 5, 6.6 are sufficient).

Goal: a runnable Next.js 16 app with the toolchain, a local Supabase stack, and validated
configuration, so every later chunk has a place to land.

PRD sections: 5 (stack), 6.6 (configuration), 8 (Vitest).

Scope
- `pnpm create next-app` with TypeScript, App Router, Tailwind, ESLint, `src`-less layout as in 0.1.
- Install and pin: react-leaflet, leaflet, @types/leaflet, @supabase/supabase-js, zod,
  unique-names-generator, nanoid, react-icons, vitest, @testing-library/react, jsdom.
- `pnpm dlx shadcn@latest init` and add: button, input, textarea, card, tooltip, alert, sheet.
- `supabase init` producing `supabase/config.toml`; `supabase start` works.
- `.env.example` listing all seven variables from PRD 6.6 with defaults.
- `lib/config/server.ts` and `lib/config/client.ts`: parse `process.env` once with zod, apply
  defaults, throw a descriptive error on missing required values.
- `vitest.config.ts` with jsdom environment for `*.test.tsx` and node for `*.test.ts`.
- Root layout with a full-height body (the map fills the viewport).

Interfaces produced
```ts
// lib/config/server.ts  (import only from server code)
export const serverConfig: {
  supabaseUrl: string; supabaseAnonKey: string; supabaseServiceRoleKey: string;
  historyInitialSize: number; historyPageSize: number;
};
// lib/config/client.ts  (safe for client components; reads NEXT_PUBLIC_* only)
export const clientConfig: {
  supabaseUrl: string; supabaseAnonKey: string;
  pollIntervalMs: number; realtimeIdleTimeoutMs: number;
};
// both files also export the parser for tests:
export function parseServerConfig(env: NodeJS.ProcessEnv): typeof serverConfig;
export function parseClientConfig(env: NodeJS.ProcessEnv): typeof clientConfig;
```

Acceptance
- `pnpm dev` serves a page; `pnpm test` runs config tests; `supabase start` is healthy.
- Unit tests: defaults applied when optional vars absent; non-numeric `NEXT_PUBLIC_POLL_INTERVAL_MS`
  rejected; missing `SUPABASE_SERVICE_ROLE_KEY` throws with the variable name in the message.

Depends on: nothing. First commit of the repository (include `docs/PRD.md`).

---

## Chunk 2 — Database schema and room-creation function

**Spec needed: no** (PRD 6.2, 6.3, 6.1 RLS are sufficient).

Goal: the Postgres side is complete and tested before any application code touches it.

PRD sections: 6.2 (schema), 6.3 (atomic creation), 6.1 (RLS), 6.4 (realtime publication).

Scope
- `..._schema.sql`: `chatrooms`, `messages`, the `messages_room_created_idx` index, exactly as
  PRD 6.2. Name the unique constraints explicitly: `chatrooms_name_key`, `chatrooms_lat_lng_key`.
- `..._rls.sql`: enable RLS on both tables; policy `anon_read_chatrooms` and `anon_read_messages`
  for `select` to role `anon` using `(true)`; no other policies. Revoke insert/update/delete from
  `anon` and `authenticated` explicitly.
- `..._create_room_fn.sql`: function `create_chatroom_with_message` (signature below), `security
  definer`, executable only by `service_role` (revoke from public/anon).
- `..._realtime.sql`: `alter publication supabase_realtime add table messages;` and
  `alter table messages replica identity default;` (INSERT-only events need no full identity).
- `seed.sql`: two rooms with a few messages for manual testing (dev only).
- `tests/integration/setup.ts`: creates a service-role client from env, exports `truncateAll()`.

Interfaces produced
```sql
create function create_chatroom_with_message(
  p_name text, p_lat double precision, p_lng double precision, p_author text, p_text text
) returns table (
  room_id uuid, room_name text, room_lat double precision, room_lng double precision,
  room_created_at timestamptz,
  message_id uuid, message_created_at timestamptz
)
-- Inserts the room then the message in one transaction. Does NOT catch unique violations:
-- the caller inspects SQLSTATE 23505 and the constraint name (chatrooms_name_key vs
-- chatrooms_lat_lng_key) to decide between "retry with a new name" and "409 conflict".
```

Acceptance (integration tests, `tests/integration/db/`)
- Inserting a message with 101-code-point author fails with check violation; 100 passes.
  Use a string of astral-plane characters (e.g. `'𝔘'.repeat(100)`) to prove code-point counting.
- Second `create_chatroom_with_message` at identical `(lat,lng)` raises 23505 naming
  `chatrooms_lat_lng_key`; identical name raises 23505 naming `chatrooms_name_key`.
- If the message insert fails (text empty), no room row remains (atomicity).
- Anon client can `select` from both tables and gets an error on `insert`.

Depends on: chunk 1.

---

## Chunk 3 — Shared domain layer

**Spec needed: no** (PRD 4, 6.3, 6.1 are sufficient).

Goal: the validation schemas, DTO types, room-name generator and Supabase client factories that
both the API and the UI import.

PRD sections: 4 (input rules), 6.3 (naming), 6.1 (clients), 6.5 (query params).

Scope and interfaces produced
```ts
// lib/schemas/common.ts
export function countChars(s: string): number;            // [...s].length
export const trimmedText: (min: number, max: number) => z.ZodType<string>;
  // z.string().transform(trim).refine(countChars in [min,max]) with message "must be between {min} and {max} characters"

// lib/schemas/room.ts
export const latSchema: z.ZodType<number>;                 // -90..90
export const lngSchema: z.ZodType<number>;                 // -180..180
export const createRoomInputSchema = z.object({ lat, lng, author: trimmedText(1,100), text: trimmedText(1,3000) });
export type CreateRoomInput = z.infer<typeof createRoomInputSchema>;
export function roundCoord(x: number): number;             // 6 decimals

// lib/schemas/message.ts
export const postMessageInputSchema = z.object({ author: trimmedText(1,100), text: trimmedText(1,3000) });
export type PostMessageInput = z.infer<typeof postMessageInputSchema>;

// lib/schemas/query.ts
export const bboxSchema: z.ZodType<{ minLng: number; minLat: number; maxLng: number; maxLat: number }>;
  // parses the string "minLng,minLat,maxLng,maxLat"; rejects min > max
export const messagesQuerySchema: z.ZodType<{ before?: string; after?: string }>;
  // both uuid; refine: not both present
export const uuidSchema: z.ZodType<string>;

// lib/schemas/types.ts — Room, Message (see 0.2)

// lib/names/generate.ts
export function generateRoomName(rng?: () => number): string;          // "brave-crimson-otter"
export function withSuffix(name: string, nanoidFn?: () => string): string; // "brave-crimson-otter-x7k2"
export class NameCollision extends Error {}
export async function insertWithUniqueName<T>(
  tryInsert: (name: string) => Promise<T>,   // must throw NameCollision on 23505/chatrooms_name_key
  opts?: { maxRetries?: number /* 5 */ }
): Promise<T>;                                // after maxRetries collisions, one final attempt with withSuffix()

// lib/supabase/server.ts
export function createServiceClient(): SupabaseClient;     // service-role, `auth: { persistSession: false }`
// lib/supabase/browser.ts
export function getBrowserClient(): SupabaseClient;         // anon key, memoised singleton
```

Acceptance (unit tests)
- `trimmedText`: trims, rejects empty after trim, counts code points (an emoji string of 100
  code points but 200 UTF-16 units passes the 100 limit).
- `bboxSchema` parses `"-1,-2,3,4"`, rejects `"3,4,-1,-2"`, rejects 3 parts.
- `messagesQuerySchema` rejects `before` and `after` together.
- `insertWithUniqueName`: succeeds first try; retries exactly 5 times on collision then calls
  once more with a suffixed name; rethrows non-collision errors immediately.
- `generateRoomName` with a seeded rng is deterministic and matches `/^[a-z]+-[a-z]+-[a-z]+$/`.

Depends on: chunk 1.

---

## Chunk 4 — Rooms API

**Spec needed: no** (PRD 6.5 is sufficient).

Goal: create rooms, list rooms in a viewport, fetch one room; plus the shared error helpers and
the browser-side typed client for these three calls.

PRD sections: 6.5 (rooms rows), 6.3, Flow A step 5, 4 (coords).

Scope
- `lib/api/errors.ts`: `validationError(zodError) → Response 400`, `notFound() → 404`,
  `conflict(room) → 409`, `json(data, status)`; error shapes as in 0.2.
- `lib/db/rooms.ts`: repository over the service client.
- Route handlers: `app/api/rooms/route.ts` (GET, POST), `app/api/rooms/[id]/route.ts` (GET).
- `lib/api/client.ts` (rooms part): fetch wrappers used by the UI.

Interfaces produced
```ts
// lib/db/rooms.ts
export async function findRoomsInBbox(db: SupabaseClient, bbox: Bbox, limit = 500): Promise<Room[]>;
export async function findRoomById(db: SupabaseClient, id: string): Promise<Room | null>;
export type CreateRoomResult =
  | { kind: 'created'; room: Room; message: Message }
  | { kind: 'exists'; room: Room };
export async function createRoom(db: SupabaseClient, input: CreateRoomInput): Promise<CreateRoomResult>;
  // rounds coords, calls create_chatroom_with_message via db.rpc inside insertWithUniqueName;
  // on 23505/chatrooms_lat_lng_key → findRoomById-by-coords → { kind: 'exists' }

// HTTP
// GET  /api/rooms?bbox=minLng,minLat,maxLng,maxLat → 200 { rooms: Room[] }   (400 on bad bbox)
// POST /api/rooms  body CreateRoomInput            → 201 { room: Room; message: Message } | 409 ApiError.conflict | 400
// GET  /api/rooms/:id                              → 200 { room: Room } | 404

// lib/api/client.ts
export const api = {
  rooms: {
    list(bbox: Bbox): Promise<Room[]>;
    get(id: string): Promise<Room | null>;
    create(input: CreateRoomInput): Promise<{ status: 'created'; room: Room; message: Message } | { status: 'conflict'; room: Room }>;
  },
  // messages added in chunk 5
};
export class ApiValidationError extends Error { fields: { path: string; message: string }[] }
```

Acceptance (integration, `tests/integration/api/rooms.test.ts`, calling the handler functions
directly with `new Request(...)`)
- POST creates room + message; response room name matches `/^[a-z]+-[a-z]+-[a-z]+(-[a-z0-9]{4})?$/`.
- Second POST with same rounded coords (e.g. 10.1234564 vs 10.1234561) → 409 with the first room.
- POST with author of 101 code points → 400 with `fields[0].path === 'author'`.
- GET bbox returns only rooms inside; 501 rooms inserted → 500 returned.
- GET unknown id → 404; malformed uuid → 400.

Depends on: chunks 2, 3. Parallel with chunk 5.

---

## Chunk 5 — Messages API

**Spec needed: no** (PRD 6.5 cursor semantics and 4 History are precise).

Goal: history, older/newer pagination with tuple cursors, and posting a message.

PRD sections: 6.5 (messages rows, cursor semantics), 4 (History, ordering), 6.6 (sizes).

Scope
- `lib/db/messages.ts`: repository. Cursor lookup: fetch `(created_at, id)` of the cursor
  message (404 if missing or in a different room), then tuple comparison. Implement as a SQL
  function `list_messages(p_room uuid, p_mode text, p_cursor uuid, p_limit int)` in a new
  migration `20260916000005_list_messages_fn.sql` so the tuple comparison is real SQL, not
  emulated in PostgREST filters.
- `app/api/rooms/[id]/messages/route.ts` (GET, POST).
- `lib/api/client.ts` (messages part).

Interfaces produced
```ts
// lib/db/messages.ts
export type ListMode = { mode: 'initial' } | { mode: 'before'; cursorId: string } | { mode: 'after'; cursorId: string };
export async function listMessages(db, roomId: string, mode: ListMode, limit: number)
  : Promise<{ messages: Message[]; hasMore: boolean }>;
  // messages are returned ASCENDING (oldest first) so the client can append/prepend directly.
  // hasMore is meaningful for 'initial' and 'before' (fetch limit+1); always false for 'after'.
  // 'after' returns ALL newer messages, no limit (POC).
export async function insertMessage(db, roomId: string, input: PostMessageInput): Promise<Message>;

// HTTP
// GET  /api/rooms/:id/messages                    → 200 { messages: Message[]; hasMore: boolean }
// GET  /api/rooms/:id/messages?before=<uuid>      → same shape
// GET  /api/rooms/:id/messages?after=<uuid>       → same shape, hasMore false
// POST /api/rooms/:id/messages  body PostMessageInput → 201 { message: Message } | 400 | 404

// lib/api/client.ts (added)
api.messages = {
  list(roomId: string, params?: { before?: string } | { after?: string }): Promise<{ messages: Message[]; hasMore: boolean }>;
  post(roomId: string, input: PostMessageInput): Promise<Message>;
};
```

Acceptance (integration, `tests/integration/api/messages.test.ts`)
- 105 messages → initial returns 100 newest ascending, `hasMore: true`; `before=<oldest of
  those>` returns 5, `hasMore: false`.
- Three messages inserted with identical `created_at` (set explicitly in the test) paginate
  without duplicates or gaps across `before` and `after`, ordered by id on ties.
- `after=<newest>` returns `[]`; `after=<id from another room>` → 404.
- POST to unknown room → 404; POST with 3001-code-point text → 400.

Depends on: chunks 2, 3. Parallel with chunk 4 (both touch `lib/api/client.ts`: chunk 5 adds a
sibling key, no edits to chunk 4's code).

---

## Chunk 6 — Map page shell and map view

**Spec needed: YES.** Design questions not settled by the PRD: Leaflet in Next.js (client-only
dynamic import, Leaflet CSS, marker icon asset fix), viewport-change debounce and bbox padding,
distinguishing a click from a drag, pin appearance, how the page holds "what is selected", and
the desktop/mobile layout of map + panel (side panel vs bottom sheet).

Goal: the map fills the page, pins for rooms in view appear and refresh on pan/zoom, clicking an
empty spot places a draft pin, clicking a pin selects that room. Panel and popup contents are
stubs (rendered by later chunks).

PRD sections: 3 Flow A step 1, Flow B step 1, 5 (map), 7 (browsers).

Scope
- `lib/page/selection.ts`: pure selection state + reducer (see interface).
- `app/page.tsx`: client-rendered shell owning selection state, rendering `MapView` and a
  placeholder for the panel/popup slot.
- `components/map/MapView.tsx` (dynamic, `ssr: false`), `RoomPins.tsx`, `DraftPin.tsx`.
- Pins fetched via `api.rooms.list(bbox)` on `moveend`, debounced (value fixed in spec).

Interfaces produced
```ts
// lib/page/selection.ts
export type Prefill = { author: string; text: string };
export type Selection =
  | { kind: 'none' }
  | { kind: 'draft'; lat: number; lng: number }
  | { kind: 'room'; roomId: string; prefill?: Prefill };
export type SelectionAction =
  | { type: 'clickEmpty'; lat: number; lng: number }
  | { type: 'clickPin'; roomId: string }
  | { type: 'roomCreated'; room: Room }
  | { type: 'movedToExisting'; room: Room; prefill: Prefill }
  | { type: 'close' };
export function selectionReducer(s: Selection, a: SelectionAction): Selection;

// components/map/MapView.tsx
export type MapViewProps = {
  center: { lat: number; lng: number }; zoom: number;
  rooms: Room[]; draft?: { lat: number; lng: number };
  selectedRoomId?: string;
  onViewportChange(bbox: Bbox): void;
  onEmptyClick(p: { lat: number; lng: number }): void;
  onPinClick(roomId: string): void;
};
```

Acceptance
- Unit: `selectionReducer` transitions (draft→room on `roomCreated`, `movedToExisting` carries
  prefill, `close` from any state).
- Component test (jsdom, Leaflet mocked): `RoomPins` renders one marker per room.
- Manual: pins load on the seeded rooms, refresh after pan, draft pin appears on click.

Depends on: chunks 1, 4.

---

## Chunk 7 — Compose form and display name storage

**Spec needed: no** (PRD 3 Flow B step 4, 4, 6.7 are sufficient; component layout is a plain
shadcn form).

Goal: the single compose form reused by the popup and the panel, and the remembered display name.

PRD sections: 4 (input rules, client feedback), 6.7 (localStorage, shared form).

Interfaces produced
```ts
// lib/storage/displayName.ts
export const DISPLAY_NAME_KEY = 'mapchat.displayName';
export function readDisplayName(): string | null;   // try/catch around localStorage; null if blocked
export function writeDisplayName(name: string): void;
// lib/storage/useDisplayName.ts
export function useDisplayName(): [name: string, setName: (n: string) => void]; // '' until mounted

// components/compose/ComposeForm.tsx
export type ComposeFormProps = {
  initialAuthor: string;
  initialText?: string;
  submitLabel?: string;                     // default "Send"
  disabled?: boolean;
  onSubmit(input: PostMessageInput): Promise<void>;  // throws ApiValidationError → shown per field
};
// Behaviour: validates with postMessageInputSchema on submit, shows field errors inline,
// shows remaining-character counters (countChars), clears the text (not the author) after a
// successful submit, and calls writeDisplayName(author) on success.
```

Acceptance (component tests with Testing Library)
- Empty submit shows both field errors and does not call `onSubmit`.
- Valid submit calls `onSubmit` with trimmed values, clears text, persists author.
- Server-side `ApiValidationError` is mapped to the matching field.
- `readDisplayName` returns null when `localStorage` throws.

Depends on: chunk 3. Parallel with chunks 6 and 8.

---

## Chunk 8 — Room feed reducer (history, cursors, connection state machine)

**Spec needed: YES** (short). The PRD gives the state machine, but the reducer/effects design,
action names and dedupe rules are decisions; the spec should cover chunks 8, 9 (hook) and 11
together so the realtime adapter plugs into effects defined here rather than into the hook ad hoc.

Goal: a pure, fully unit-tested core for a room's message list and its connection lifecycle.

PRD sections: 4 (History), 6.4 (state machine), 6.7 (pure reducer).

Interfaces produced (proposed; the spec finalises them)
```ts
// lib/feed/types.ts
export type Connection = 'idle' | 'realtime' | 'polling';
export type FeedState = {
  roomId: string;
  messages: Message[];          // ascending, unique by id
  hasMore: boolean;
  loading: 'initial' | 'older' | 'none';
  connection: Connection;
  error?: string;
};
export type FeedAction =
  | { type: 'opened' }
  | { type: 'historyLoaded'; messages: Message[]; hasMore: boolean }
  | { type: 'olderRequested' }
  | { type: 'olderLoaded'; messages: Message[]; hasMore: boolean }
  | { type: 'newerLoaded'; messages: Message[] }
  | { type: 'received'; message: Message }          // realtime insert or own post
  | { type: 'subscribed' } | { type: 'subscribeFailed'; reason: string }
  | { type: 'idle' } | { type: 'sent' } | { type: 'closed' }
  | { type: 'failed'; error: string };
export type FeedEffect =
  | { type: 'fetchInitial' }
  | { type: 'fetchOlder'; before: string }
  | { type: 'fetchNewer'; after: string | null }
  | { type: 'subscribe' } | { type: 'unsubscribe' }
  | { type: 'startPolling' } | { type: 'stopPolling' }
  | { type: 'startIdleTimer' } | { type: 'stopIdleTimer' };
// lib/feed/reducer.ts
export function feedReducer(s: FeedState, a: FeedAction): [FeedState, FeedEffect[]];
export function initialFeedState(roomId: string): FeedState;
export function mergeMessages(existing: Message[], incoming: Message[]): Message[]; // dedupe by id, sort (createdAt, id)
```

Acceptance (unit tests, table-driven over PRD 6.4 transitions)
- `opened` → effects `fetchInitial`, `subscribe`.
- `subscribed` → `fetchNewer(after: newest)`, `startIdleTimer`; `subscribeFailed` → `startPolling`.
- `idle` in realtime → `unsubscribe`, `startPolling`; `idle` in polling → no effects.
- `sent` in polling → `subscribe`; `sent` in realtime → `startIdleTimer` (restart).
- `closed` → `unsubscribe`, `stopPolling`, `stopIdleTimer`.
- `received` duplicate id is a no-op; out-of-order `newerLoaded` sorts correctly.
- `olderLoaded` prepends and updates `hasMore`.

Depends on: chunk 3. Parallel with chunks 6 and 7.

---

## Chunk 9 — Room panel (polling mode)

**Spec needed: YES** — folded into the chunk 6 spec (layout of the panel, scroll behaviour) and
the chunk 8 spec (hook contract). No separate spec of its own.

Goal: open a room from a pin and use it end to end over HTTP polling: history, Load older,
compose, local-time rendering. Realtime is added in chunk 11 without touching the panel.

PRD sections: 3 Flow B, 4 (Message display, History), 6.4 (`polling` state only), 6.6.

Scope
- `lib/time/format.ts`, `lib/feed/useRoomFeed.ts` (runs effects: fetch*, startPolling/stopPolling,
  idle timer; `subscribe` is a no-op that dispatches `subscribeFailed('not implemented')` until
  chunk 11), `components/room/*` except NewRoomPopup/RoomTitle.
- Wire into `app/page.tsx`: selection `room` → render `RoomPanel`.

Interfaces produced
```ts
// lib/time/format.ts
export function formatMessageTime(iso: string, opts?: { now?: Date; timeZone?: string; locale?: string }): string;
  // same day → "17:03"; otherwise → "16 Sep 17:03"; uses Intl.DateTimeFormat with timeZone

// lib/feed/useRoomFeed.ts
export type RoomFeed = {
  messages: Message[]; hasMore: boolean; loading: FeedState['loading'];
  connection: Connection; error?: string;
  loadOlder(): void;
  send(input: PostMessageInput): Promise<void>;   // posts via api.messages.post, dispatches 'received' then 'sent'
  activity(): void;                               // resets idle timer (chunk 11 wires DOM events to this)
};
export function useRoomFeed(roomId: string, deps?: { api?: typeof api; config?: typeof clientConfig }): RoomFeed;

// components/room/RoomPanel.tsx
export type RoomPanelProps = { room: Room; prefill?: Prefill; onClose(): void; titleSlot?: ReactNode };
```

Acceptance
- Unit: `formatMessageTime('2026-09-16T15:00:00Z', { timeZone: 'Europe/Bucharest' })` → `"18:00"`
  (UTC+3 in September); different-day case.
- Hook test (fake timers, mocked `api`): initial load, poll every `pollIntervalMs`, immediate poll
  on entering polling, `loadOlder` uses the oldest id, `send` appends without duplicate after the
  next poll.
- Component: list renders author/text/time, whitespace preserved (`white-space: pre-wrap`), Load
  older hidden when `hasMore` false, autoscroll to bottom on initial load.

Depends on: chunks 5, 6, 7, 8.

---

## Chunk 10 — New chatroom flow (Flow A)

**Spec needed: YES** (short) — popup vs panel presentation for a draft pin, the info bubble,
the title switch animation/none, and the exact 409 hand-off UX (notice placement and wording).

Goal: click an empty spot, name yourself, write a message, get a live room; handle the
concurrent-creation conflict.

PRD sections: 3 Flow A (all steps), 6.5 (409), 6.7 (state transfer).

Scope
- `components/room/NewRoomPopup.tsx`: placeholder title "New chatroom", tooltip info icon with
  the PRD text, `ComposeForm` with `submitLabel: "Create"`.
- `components/room/RoomTitle.tsx`: shows room name (used by RoomPanel via `titleSlot`).
- On submit: `api.rooms.create({lat,lng,author,text})`. `created` → dispatch `roomCreated(room)`
  (selection becomes `room`, panel opens with the first message already in history). `conflict`
  → dispatch `movedToExisting(room, { author, text })`; panel shows the alert "A chatroom
  already exists here, you have been moved to it" and the compose form is prefilled.
- Refresh pins after creation so the new room's pin replaces the draft pin.

Interfaces consumed: `selectionReducer` (chunk 6), `ComposeForm` (7), `RoomPanel.prefill` (9),
`api.rooms.create` (4).

Acceptance
- Component tests: submit with mocked `api.rooms.create` resolving `created` → `onCreated`
  called with room; resolving `conflict` → `onConflict` called with room and prefill; nothing
  posted automatically (assert `api.messages.post` not called).
- Manual: two browsers click the same spot; second sees the notice and the prefilled form.

Depends on: chunks 4, 6, 7, 9.

---

## Chunk 11 — Realtime with idle fallback

**Spec needed: YES** — covered by the chunk 8 spec (effects contract). No separate spec.

Goal: live updates through Supabase Realtime with the attempt-and-fallback behaviour of PRD 6.4.

PRD sections: 6.4 (all), 6.1 (anon key only), 7 (Free plan limits).

Scope
- `lib/feed/realtime.ts`: adapter around `getBrowserClient().channel('room:<id>')` with
  `postgres_changes` `INSERT` on `public.messages`, filter `chatroom_id=eq.<id>`. Maps
  `SUBSCRIBED` → `subscribed`, `CHANNEL_ERROR` / `TIMED_OUT` / `CLOSED`-before-subscribed →
  `subscribeFailed(reason)`, payload rows → `received(Message)` (snake_case → camelCase).
- `lib/feed/activity.ts`: `attachActivityTracking(el, onActivity, onHidden)` for pointer,
  keyboard, scroll, touch inside the panel, plus `visibilitychange` (hidden → `idle` at once).
- `useRoomFeed`: implement `subscribe`/`unsubscribe` effects with the adapter; wire idle timer
  to `realtimeIdleTimeoutMs`; `RoomPanel` calls `attachActivityTracking` on its root.

Interfaces produced
```ts
// lib/feed/realtime.ts
export type RealtimeHandle = { unsubscribe(): void };
export function subscribeToRoom(roomId: string, handlers: {
  onSubscribed(): void; onFailed(reason: string): void; onInsert(m: Message): void;
}, client?: SupabaseClient): RealtimeHandle;
```

Acceptance
- Unit: adapter with a fake channel object maps each status to the right handler; payload
  mapping test.
- Hook test with fake adapter: `subscribeFailed` → polling starts immediately; idle timer
  fires → unsubscribe + immediate poll; `send` while polling re-subscribes; hidden tab → idle.
- Manual smoke (PRD 8): two browsers, message appears without reload; after 3 minutes idle the
  Network tab shows the websocket closed and a poll fired at once; sending re-opens it.

Depends on: chunks 8, 9.

---

## Chunk 12 — Shareable room URL and polish

**Spec needed: no** (PRD 3 last paragraph, 6.5 GET room by id).

Goal: `/room/<id>` opens the map centred on the room with the panel open; graceful errors.

Scope
- `app/room/[id]/page.tsx`: server component fetches the room via `findRoomById`; 404 → Next
  `notFound()`; otherwise renders the map shell with `initialSelection: { kind: 'room', roomId }`
  and `center` at the room. Refactor the shell from `app/page.tsx` into a shared client
  component (`components/map/MapShell.tsx`) taking `initialSelection` and `initialCenter`.
- Keep the URL in sync: selecting a room pushes `/room/<id>` with `history.replaceState`
  (no navigation); closing returns to `/`.
- Error surfaces: pin fetch failure and message fetch failure show a dismissible alert; API
  `not_found` for a deleted room closes the panel with a notice.

Acceptance
- Integration-ish test of the page's data function; component test that `MapShell` with an
  initial room selection renders `RoomPanel`.
- Manual: paste `/room/<id>` into a second browser; map centred, panel open.

Depends on: chunks 6, 9, 10.

---

## Chunk 13 — Deploy (optional for the POC)

**Spec needed: no.**

Goal: the app runs on Vercel against a hosted Supabase project.

Scope: create the Supabase project, `supabase link` + `supabase db push`, set the seven env
vars in Vercel, confirm the realtime publication exists on the hosted DB, run the manual smoke
from chunk 11 against the deployed URL. Add a `README.md` with local setup and deploy steps.

Depends on: everything above.

---

## Dependency graph

```
1 ─┬─ 2 ─┬─ 4 ─┬─ 6 ─┬─ 9 ─┬─ 10 ─┬─ 12 ─ 13
   │     │     │     │     │      │
   └─ 3 ─┼─ 5 ─┘     │     └─ 11 ─┘
         ├─ 7 ───────┤
         └─ 8 ───────┘
```

Parallel groups: {4, 5} after {2, 3}; {6, 7, 8} after {3, 4}; {10, 11} after 9.

## Specs to write before planning

| Chunk | Spec | Covers |
| ----- | ---- | ------ |
| 6     | `<date>-map-shell-design.md`   | Leaflet/Next integration, viewport fetch, click vs drag, pins, page layout (map + panel + popup on desktop and phone), scroll behaviour of the panel (chunk 9 UI) |
| 8     | `<date>-room-feed-design.md`   | Reducer/effects contract, hook contract, realtime adapter contract, dedupe and ordering rules (chunks 8, 9 hook, 11) |
| 10    | `<date>-new-room-flow-design.md` | Draft-pin popup presentation, info bubble, title switch, 409 notice and prefill UX |

All other chunks are planned directly from this document plus `docs/PRD.md`.
