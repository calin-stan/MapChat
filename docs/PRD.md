# Map Chat — Technical PRD (proof of concept)

Status: DRAFT v4, connection lifecycle decision pending · Date: 2026-09-16

## 1. Summary

An anonymous, location-based chat. The app shows an OpenStreetMap map. Clicking an empty spot
opens a "New chatroom" popup at that point; the room comes into existence when its first message
is posted. Clicking an existing pin opens that room. Anyone can post under any display name
without registering. Rooms update live over Supabase Realtime, with an automatic fallback to
polling to stay inside Supabase's connection budget.

This proof of concept primarily tests whether chatting through a map is useful. Simplicity beats
robustness where the two conflict; section 10 lists what is deliberately deferred. Accepted risks
and unresolved behavior are tracked separately in [Known limitations](KNOWN_LIMITATIONS.md).

## 2. Goals and non-goals

Goals

- Create a room and post to it in one action from the map, with no sign-up.
- Read and post in any existing room, with new messages appearing without a page reload.
- Keep realtime usage within the Supabase Free plan limits by design, not by luck.

Non-goals (for the POC)

- Accounts, identity, or username uniqueness.
- Moderation, reporting, editing, or deleting messages or rooms.
- Rate limiting and abuse prevention beyond input validation.
- Mobile-native apps. The web app should work on phone browsers, but is not optimised for them.

## 3. Users and core flows

Users are anonymous visitors. The browser remembers their last-used display name.

Flow A, create a room

1. User clicks an empty spot on the map. A temporary pin appears and the chatroom popup opens.
2. The popup title is the placeholder "New chatroom". An info icon next to the title shows a
   bubble on hover or tap: "This chatroom will receive a name after the first message is sent."
3. The popup has: display name (prefilled from browser storage, editable), message, Submit.
4. Submit creates the room and its first message in one request. The popup title switches from
   the placeholder to the generated room name, and the room is now live like any other.
5. If another user created a room at the same spot in the meantime, the server answers with that
   existing room instead (section 6.5). The client shows a notice ("A chatroom already exists
   here, you have been moved to it"), opens the existing room, and prefills the compose form with
   the display name and the message text the user tried to send. Nothing is posted automatically.

Flow B, join a room

1. Pins for rooms inside the current map viewport are drawn. Panning or zooming refetches them.
2. Clicking a pin opens the room panel showing the 100 most recent messages, oldest at the top,
   scrolled to the newest.
3. Scrolling to the top reveals a "Load older" button that fetches the next page of older
   messages (20 by default, configurable). The button disappears when there is nothing older.
4. The compose box at the bottom has display name (prefilled, editable) and message. Submit
   posts the message. The name used is saved locally for next time.
5. Polling and catch-up fetch up to 100 newer messages at a time, starting with the earliest
   messages after the cursor. If more remain, a "Load more messages" button fetches the next
   batch of up to 100. This is separate from the "Load older" button for historical messages.

Flow C, live updates (details in section 6.4)

- Opening a room subscribes to its realtime channel.
- After 3 minutes without user activity in the room, the subscription is dropped and the client
  switches to polling: one poll immediately, then every 30 seconds (configurable).
- Sending a message while polling attempts to re-subscribe. If Supabase refuses the connection,
  the client keeps polling.

Rooms are addressable by URL, `/room/<room-id>`, so they can be shared. Opening that URL shows
the map centred on the room with its panel open.

## 4. Functional requirements

Input rules (enforced in the browser for feedback and on the server as the source of truth)

- Display name: required, Unicode text, 1 to 100 characters after trimming.
- Message: required, Unicode text, 1 to 3000 characters after trimming.
- "Character" means a Unicode code point, counted the same way in JavaScript (`[...s].length`)
  and in Postgres (`char_length`).
- Coordinates: latitude in [-90, 90], longitude in [-180, 180].

Message display

- Each message shows author, text (plain text, whitespace preserved, no markup), and posting time.
- Posting time is stored as UTC by the database and rendered in the viewer's local timezone.
  A message stored at 15:00 UTC is shown as 17:00 to a viewer in UTC+2.

History

- Initial load: newest 100 messages. Older messages: pages of 20 (configurable), each page
  containing messages strictly older than the oldest message the client already has.
- Ordering is by creation time; two messages with the same creation time are ordered by id.
- Loading older messages preserves the reader's scroll position. Incoming messages scroll to
  the bottom only if the reader was already at the bottom; otherwise show a new-message indicator.
- When a newer-message page has more results, show "More messages are available" and the
  "Load more messages" button. Do not automatically drain the remaining pages. Pause periodic
  `after` fetches until the user finishes this backlog; then resume the normal polling interval.
  Realtime events and successful sends may still appear, but do not advance the pending page
  cursor or remove the backlog notice. The notice does not promise an exact count.

Map behavior

- Start at a world view, without requesting the visitor's location. Shared room URLs instead
  center on that room at a useful street-level zoom.
- Fetch pins after panning or zooming finishes, and every 30 seconds while the map is visible.
  Insert the visitor's newly created room pin immediately. Ignore responses for obsolete viewports.
- Return at most 500 rooms in a deterministic order (`created_at desc, id desc`), plus `truncated`.
  If truncated, show "Zoom in to see more rooms". A selected room's pin remains visible even if
  it is absent from the capped response. Marker clustering remains deferred.

Compose behavior

- Disable Submit while its request is pending. Clear the message only after confirmed success;
  validation errors and request failures preserve both the display name and message draft.
- Do not automatically retry writes. If a response is lost, explain that the message may have
  been sent and ask the visitor to check the room before retrying. Duplicate-free retries are
  deferred; see [Known limitations](KNOWN_LIMITATIONS.md).

## 5. Tech stack

| Layer             | Choice                                                                 |
| ----------------- | ---------------------------------------------------------------------- |
| Language          | TypeScript throughout                                                  |
| Web framework     | Next.js 16 (App Router) with React, Node.js runtime for route handlers |
| UI components     | shadcn/ui (Tailwind based) wherever a suitable component exists        |
| Icons             | react-icons                                                            |
| Map               | Leaflet 1.9 via react-leaflet 5, OpenStreetMap raster tiles            |
| Database          | Postgres on Supabase                                                   |
| Live updates      | Supabase Realtime, Postgres Changes on the `messages` table            |
| Validation        | zod, shared between client and server                                  |
| Room names        | unique-names-generator, with nanoid for a collision-breaking suffix    |
| Local dev         | Supabase CLI (local stack) plus `next dev`                             |
| Hosting (assumed) | Vercel for the app, Supabase Free plan for the database                |

Map tiles must follow the [OSM tile usage policy](https://operations.osmfoundation.org/policies/tiles/):
use `https://tile.openstreetmap.org/{z}/{x}/{y}.png`, show visible attribution, preserve a valid
browser Referer, honor HTTP caching headers, and do not bulk-download or prefetch tiles outside
the current view. Do not override browser identification or send cache-bypass headers. Service
is best-effort and access may be blocked; a provider swap is expected before any real launch.

## 6. Technical design

### 6.1 Architecture

```
Browser (Next.js client components)
  ├─ Map view ── GET /api/rooms?bbox=…          ─┐
  ├─ Room panel ── GET /api/rooms/:id            │
  │             ── GET /api/rooms/:id/messages   ├─► Next.js route handlers ──► Supabase (service role)
  │             ── POST /api/rooms/:id/messages  │
  │             ── POST /api/rooms              ─┘
  └─ Realtime subscription ──────────────────────────► Supabase Realtime (anon key, read-only)
```

- The app performs its HTTP reads and writes through Next.js route handlers, which validate
  input with zod and talk to Supabase with the service-role key. The browser never writes to
  the database directly.
- The browser holds only the anon key and uses it for realtime. Row Level Security is enabled
  on both tables with a SELECT-only policy and SELECT grants for `anon`; there are no anon
  write policies or table write grants. Direct anonymous reads through the exposed Supabase
  Data API are also allowed: these rooms and messages are public, and route-handler read limits
  are not a security boundary. "Realtime only" describes app usage, not a key restriction.
- The room-creation function uses `SECURITY INVOKER`. Revoke EXECUTE from `PUBLIC`, `anon`, and
  `authenticated`, and grant it only to `service_role`. A caller using the anon key must not be
  able to invoke the write function. No privileged write function may be publicly executable.

### 6.2 Data model

```sql
create table chatrooms (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  lat         double precision not null check (lat between -90 and 90),
  lng         double precision not null check (lng between -180 and 180),
  created_at  timestamptz not null default now(),
  unique (lat, lng)
);

create table messages (
  id           uuid primary key default gen_random_uuid(),
  chatroom_id  uuid not null references chatrooms(id) on delete cascade,
  author       text not null check (char_length(author) between 1 and 100),
  text         text not null check (char_length(text) between 1 and 3000),
  created_at   timestamptz not null default now()
);
create index messages_room_created_idx on messages (chatroom_id, created_at desc, id desc);
```

Changes from the brief: Coordinates are two plain columns; PostGIS is not
needed for a bounding-box lookup. Coordinates are rounded to 6 decimal places (about 11 cm) by
the server before insert, and the unique constraint on `(lat, lng)` is what detects "a room
already exists at this spot". Bounding-box queries use the `(lat, lng)` unique index.

### 6.3 Room naming

Names look like `brave-crimson-otter` (adjective-color-animal from unique-names-generator,
about 24 million combinations). Uniqueness is guaranteed by the database, not by the generator:

1. Server generates a name and inserts the room.
2. On a unique-violation error on `name` (SQLSTATE 23505) it generates a new name and retries,
   up to 5 times.
3. If all retries collide, it appends a 4-character nanoid suffix (`brave-crimson-otter-x7k2`).
   If that insert also has a name collision, return 503 with a retryable error and keep the draft;
   no room or first message is left behind. Do not retry indefinitely.

Distinguish conflicts by the violated constraint, not SQLSTATE alone: both the name and coordinate
constraints produce 23505. Coordinate conflicts follow the 409 flow instead of name regeneration.

Room creation (room row + first message) runs in a single Postgres function so it is atomic.

Alternatives considered: `human-id` (`silly-mice-dance`, pool of 15 million, zero config, less
control over word lists) and `friendly-words` (raw Glitch word lists, needs a custom combiner).
unique-names-generator is recommended for its configurable dictionaries and separator.

### 6.4 Realtime and polling

Supabase enforces realtime limits per project, not per channel. On the Free plan: 200 concurrent
connections, 100 messages per second, 100 channel joins per second. When exceeded, the server
refuses with `too_many_connections`, `too_many_channels`, or `too_many_joins`. The client cannot
query remaining capacity, so "has enough capacity" is implemented as attempt-and-fallback.

Each open room runs a small connection state machine with two states:

- `realtime`: subscribed to channel `room:<id>` for `INSERT` events on `messages` filtered by
  `chatroom_id`. New rows are merged by id and displayed in `(created_at, id)` order.
- `polling`: `GET /api/rooms/:id/messages?after=<sync-cursor>`, run once immediately on
  entering the state and then every `NEXT_PUBLIC_POLL_INTERVAL_MS` (default 30000), except
  while a backlog awaits the "Load more messages" button.

Transitions

- Open room → try `realtime`. Subscribe error or refusal → `polling`.
- In `realtime`, `NEXT_PUBLIC_REALTIME_IDLE_TIMEOUT_MS` (default 180000) with no user activity
  → unsubscribe → `polling`. Activity = pointer, keyboard, scroll or touch events inside the room
  panel, or a message sent. A hidden tab (Page Visibility API) counts as inactive immediately.
- In `polling`, user sends a message → try `realtime`. Refused → stay in `polling`.
- Closing the room → unsubscribe and stop polling.

Synchronization bookmark

- Maintain a per-room `syncCursor` separately from the newest displayed message and the cursor
  for loading older history. It records progress through ordered HTTP fetches, not live arrivals.
- On opening an existing room, load initial history and initialize `syncCursor` to the newest
  message in that response, then attempt the subscription. On successful atomic room creation,
  initialize it to the returned first message. Later POST responses never advance it. If initial
  history unexpectedly contains no messages, repeat initial history loading rather than invent
  a cursor; normally every room has its atomic first message.
- Before each subscription attempt, capture the current `syncCursor`. Once the subscription
  is confirmed, fetch `after=<captured-sync-cursor>` to cover the interval before confirmation.
  Subscription refusal enters polling using the same bookmark. If a backlog already awaits
  "Load more messages", retain its bookmark and notice instead of automatically fetching a page.
- A successful `after` response is merged by id and advances `syncCursor` to its `nextCursor`,
  even when some returned rows were already displayed from realtime or a POST response. An empty
  response leaves the bookmark unchanged. Failed fetches do not advance it.
- Realtime events, later POST responses, and older-history pages update the displayed collection
  but never advance `syncCursor`. Always merge by id and sort by `(created_at, id)` ascending;
  arrival order must not determine display order.
- Catch-up fetches at most 100 messages. If `hasMore` is true, `syncCursor` is also the pending
  continuation bookmark for "Load more messages"; new arrivals cannot move it. When the backlog
  is exhausted, polling resumes if that is the current transport mode.

For example: the last fetch reached A, another visitor posts B, and the current visitor posts C.
Displaying C does not move the bookmark from A. The next fetch after A retrieves B and C, and
the duplicate C is merged. This prevents client-side gaps; the accepted transaction commit-order
limitation still applies. Connection-failure behavior remains a pending decision in section 9.

Postgres Changes is chosen over Broadcast for the POC because it needs no trigger code. It fans
out one message per subscriber per insert, which counts against the 100 messages per second
budget; the inactivity timeout keeps subscriber counts low. Migrating to Broadcast-from-database
is the known upgrade path if throughput becomes a problem.

### 6.5 API

| Method and path                                   | Purpose                                                   |
| ------------------------------------------------- | --------------------------------------------------------- |
| `GET /api/rooms?bbox=minLng,minLat,maxLng,maxLat` | `{rooms, truncated}`; rooms in viewport, capped at 500    |
| `GET /api/rooms/:id`                              | Room details, used when opening a shared `/room/<id>` URL |
| `POST /api/rooms` `{lat, lng, author, text}`      | Create room plus first message, returns room and message  |
| `GET /api/rooms/:id/messages`                     | Newest `HISTORY_INITIAL_SIZE` messages (default 100)      |
| `GET /api/rooms/:id/messages?before=<message-id>` | Next `HISTORY_PAGE_SIZE` older messages (default 20)      |
| `GET /api/rooms/:id/messages?after=<message-id>`  | Earliest 100 messages after cursor, for polling/catch-up   |
| `POST /api/rooms/:id/messages` `{author, text}`   | Post a message, returns it                                |

Cursor semantics: the server looks up the cursor message's `(created_at, id)` within the requested
room and applies a tuple comparison. Ties on `created_at` resolve by id.

- Initial history and `before`: order by `created_at desc, id desc`; `before` uses tuple `<`.
  Render the result oldest first. Include `hasMore` so the client can show or hide "Load older",
  including after the initial history request.
- `after`: use tuple `>` and order by `created_at asc, id asc`, returning at most 100 messages.
  Read up to 101 matching rows to calculate `hasMore`, but return only the first 100. Respond
  with `{messages, nextCursor, hasMore}`; `nextCursor` is the last returned message ID, or the
  supplied cursor if the result is empty. Each click on "Load more messages" uses that cursor.
  Retain this continuation cursor independently of newer realtime events or POST responses.
- `hasMore` describes the query's snapshot; new messages may arrive after the response.
- Malformed cursors, a cursor outside the requested room, an unknown cursor, or supplying both
  `before` and `after` return 400. An unknown room returns 404.

Conflict on `POST /api/rooms`: if the `(lat, lng)` unique constraint fires, the server responds
`409 Conflict` with the existing room in the body. The client handles this as described in
Flow A step 5. The message is not posted to the existing room automatically.

Validation failures return 400 with a field-level error list. Unknown room returns 404.

### 6.6 Configuration

| Variable                               | Scope           | Default | Meaning                             |
| -------------------------------------- | --------------- | ------- | ----------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`             | client + server | —       | Supabase project URL                |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`        | client + server | —       | Anon key, realtime only             |
| `SUPABASE_SERVICE_ROLE_KEY`            | server only     | —       | Used by route handlers              |
| `NEXT_PUBLIC_POLL_INTERVAL_MS`         | client          | 30000   | Polling interval                    |
| `NEXT_PUBLIC_REALTIME_IDLE_TIMEOUT_MS` | client          | 180000  | Inactivity before dropping realtime |
| `HISTORY_INITIAL_SIZE`                 | server          | 100     | Messages on first load              |
| `HISTORY_PAGE_SIZE`                    | server          | 20      | Messages per "Load older" page      |

Client-side values must carry the `NEXT_PUBLIC_` prefix to be bundled by Next.js. All values are
parsed and validated once at startup with defaults applied.

### 6.7 Client state

- Display name lives in `localStorage` under a single key, read on mount and written on every
  successful submit. Storage access is wrapped so a blocked storage API degrades to "not remembered".
- Room feed logic (history, pagination cursor, connection state machine, de-duplication) is one
  hook with a pure reducer so it can be unit-tested without a browser or Supabase.
- Track `syncCursor`, older-history pagination, and the displayed messages independently.
  The newest displayed message is never used to infer synchronization progress.
- The "New chatroom" popup and the room panel share the same compose form component, so the
  409 hand-off (prefilling name and message into the existing room) is a state transfer, not a
  second implementation.

## 7. Non-functional requirements

- Works in current Chrome, Firefox, Safari, including phone browsers.
- Realtime usage stays within Free plan limits under the expected POC load (tens of concurrent users).
- No secrets in the browser bundle other than the Supabase anon key.

## 8. Testing

- Unit (Vitest): shared zod schemas, name generation with retry, cursor query building,
  connection state machine transitions, synchronization bookmark advancement, de-duplication
  and chronological merging, config parsing, timezone formatting. Verify that realtime events,
  later POST responses, older-history pages, and failed fetches cannot advance `syncCursor`.
- Integration: route handlers against a local Supabase stack (create room, 409 on duplicate
  spot, post, page older, poll newer with created_at ties). Concurrent creation at the same
  rounded coordinates must leave one room and only the winning request's first message.
  With no additional writes, a backlog of 250 messages must load as 100, 100, then 50 with
  correct continuation cursors and `hasMore`. Separately verify that newer realtime events or
  POST responses between button clicks cannot advance the pending cursor or skip backlog rows.
  Verify the A/B/C scenario in section 6.4 retrieves B after C is displayed, and that messages
  committed between initial history loading and subscription confirmation are caught up.
  Verify anonymous reads are allowed, but anonymous table writes and function execution fail.
- Manual smoke: two browsers in one room, verify realtime, inactivity fallback with immediate
  first poll, and re-subscribe on send. Verify failed sends preserve drafts, history loading
  preserves scroll position, and map truncation is visible.
- Product evaluation: observe whether testers can discover a room, start a conversation at a
  chosen location, and join another visitor's room without guidance. Collect feedback on whether
  the map adds value and whether overlapping pins or delayed messages obstruct conversation.

## 9. Open questions

Confirmed choices and pending decisions:

1. "Same spot" for the 409 rule means identical coordinates after rounding to 6 decimals. Two
   clicks a metre apart create two rooms. A radius-based rule would contradict the earlier
   "no proximity merging" choice, so it is not used.
2. The `after` cursor compares on `(created_at, id)`. A message whose transaction commits after a
   later-timestamped one could be skipped by a poll. This is accepted for the POC and documented
   in [Known limitations](KNOWN_LIMITATIONS.md).
3. Accepted: automatic polling, reconnect catch-up, and manual forward pagination use the
   separate synchronization bookmark in section 6.4. Live arrivals and later POST responses
   do not advance it; results are de-duplicated and displayed in chronological order.
4. Pending explanation/review: handling a connection that fails after subscribing, offline or
   hidden tabs, foreground recovery, overlapping polls, and stale responses after room changes.
   These behaviors must not be assumed resolved by the existing two transport modes.

## 10. Deferred (explicitly out of scope for the POC)

- Rate limiting per IP, spam and profanity filtering, reporting.
- Per-room subscriber cap via Supabase Presence (an extra lever if project-wide limits bite).
- Broadcast-from-database instead of Postgres Changes.
- Production tile provider, marker clustering for dense areas, proximity merge of nearby rooms.
- Re-subscribing to realtime on any activity, not only on sending a message.
- Room lifecycle: archiving empty or stale rooms.
- Commit-order-safe polling cursor.
- Duplicate-free retries after an uncertain write response.

See [Known limitations](KNOWN_LIMITATIONS.md) for impacts, workarounds, and unresolved decisions.
