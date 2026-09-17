# Map Chat — Chunk 6: Map page shell and map view (design)

Status: APPROVED in brainstorming, pending written review · Date: 2026-09-16
Parent: `docs/superpowers/specs/2026-09-16-map-chat-implementation-chunks.md`, "Chunk 6".
PRD: `docs/PRD.md` v4, sections 3 (Flow A step 1, Flow B step 1), 4 (Map behavior), 5 (map,
tiles), 7 (browsers). This spec also fixes the panel layout and message-list scroll rules that
chunks 9 and 10 implement, as the chunks document requires.

## 1. Goal and scope

The map fills the page. Pins for the rooms inside the viewport appear and refresh on pan, zoom
and a timer. Clicking an empty spot places a draft pin. Clicking a pin selects that room. One
floating panel in the top-right corner shows, depending on the selection, a greeting, the
new-room form or the room panel. Panel contents beyond the greeting are placeholders that
chunks 9 and 10 replace. (Superseded: chunks 9 and 10 have since shipped the real new-room form
and room panel described in PRD §3; "placeholder" below is historical, describing this chunk's
own scope at the time it was written.)

Decisions taken in brainstorming that extend the chunks document:

- Chunk 6 absorbs the PRD v4 map behaviour: periodic pin refresh while the tab is visible, the
  truncation notice, the obsolete-response guard, the selected pin staying visible, and the
  immediate insertion of a newly created room's pin (exposed here, called by chunk 10).
- Chunk 6 builds `MapShell({ initialSelection, initialCenter, initialZoom })` now. Chunk 12
  only adds the `/room/[id]` route; it no longer extracts the shell.
- Desktop only. No responsive breakpoints, no bottom sheet.
- The `room` selection carries the whole `Room`, not only its id.
- The pin-refresh failure indicator lives here, so chunk 12's planned pin-fetch alert is dropped.
- Chunk 6 adds `supabase/seed.sql` (dev data) which chunk 2 listed but did not produce.

Out of scope: mobile layout, marker clustering, auto-panning to a selected room, the contents
of the new-room form (chunk 10) and the room panel (chunk 9), realtime (chunk 11).

## 2. Architecture

The shell owns state; the map is a thin view.

```
app/page.tsx (server)  ──renders──►  MapShell (client)
                                        ├─ selectionReducer            lib/page/selection.ts
                                        ├─ useRoomPins                 lib/map/useRoomPins.ts
                                        │    └─ toQueryBoxes, mergeBoxResults   lib/map/viewport.ts
                                        │    └─ api.rooms.list (chunk 4)
                                        ├─ MapView (dynamic, ssr:false)   components/map/MapView.tsx
                                        │    ├─ RoomPins                 components/map/RoomPins.tsx
                                        │    └─ DraftPin                 components/map/DraftPin.tsx
                                        ├─ MapStatus (truncation / refresh error pill)
                                        └─ panel slot: WelcomeCard | new-room placeholder | room placeholder
                                             (all inside PanelFrame)     components/panel/PanelFrame.tsx
                                             (superseded: NewRoomPopup / RoomPanel, chunks 9-10)
```

`MapView` receives data as props and emits three events. It holds no application state. All
logic that can be pure is pure and unit-tested in Node without Leaflet.

## 3. Page shell and layout

`src/app/page.tsx` is a server component:

```tsx
export default function Home() {
  return <MapShell initialSelection={{ kind: "none" }} initialCenter={DEFAULT_CENTER} initialZoom={WORLD_ZOOM} />;
}
```

Constants in `src/components/map/mapDefaults.ts`:

```ts
export const DEFAULT_CENTER = { lat: 46.7712, lng: 23.6236 }; // Cluj-Napoca
export const WORLD_ZOOM = 2;
export const ROOM_ZOOM = 16;    // used by chunk 12 for /room/<id>
export const MIN_ZOOM = 2;
export const MAX_ZOOM = 19;
```

`MapShell` (`"use client"`) renders a full-viewport box (`relative h-dvh w-full overflow-hidden`)
containing:

- The map container, `absolute inset-0`, `z-0`.
- The panel slot, `absolute top-4 right-4 w-96 max-h-[calc(100dvh-2rem)] z-10`. It holds exactly
  one child chosen by `selection.kind`:
  - `none` → `WelcomeCard`: a `PanelFrame` without a close button whose body reads
    "Click on the map to start a chat".
  - `draft` → `NewRoomPopup`, keyed with `draftPanelKey(handoff)`. Ordinary moves preserve
    the revision and key; a create failure increments the revision and restores a fresh popup.
  - `room` → `RoomPanel`, keyed with `roomPanelKey(handoff, selection.room)`. A different room
    changes the key normally; every created or conflict outcome increments the revision so an
    outcome for the already-selected room still mounts a fresh panel.
- `MapStatus`, `absolute top-4 left-1/2 -translate-x-1/2 z-10`: a small pill that shows
  "Zoom in to see more rooms" when `truncated` is true, or "Couldn't refresh rooms" when the
  last refresh failed. Truncation wins if both apply. Hidden otherwise.

The panel and the status pill are siblings of the Leaflet container, not children, so pointer
events inside them never reach the map and Leaflet's own z-indexes (up to 1000, scoped to its
container) are irrelevant.

## 4. Leaflet integration

Packages: `leaflet@^1.9.4`, `react-leaflet@^5.0.0`, dev `@types/leaflet`. react-leaflet 5 peers
on Leaflet ^1.9 and React 19, which matches `package.json`.

`MapView` is a client component that imports `leaflet/dist/leaflet.css` and react-leaflet.
`MapShell` loads it with `next/dynamic(() => import("./MapView"), { ssr: false, loading })`,
which Next 16 permits because the importer is a client component. The loading placeholder is a
neutral `bg-muted` box so the panel slot is positioned correctly before the map bundle arrives.

Props:

```ts
export type LatLng = { lat: number; lng: number };
/** Raw Leaflet bounds in degrees; longitudes are unwrapped and may exceed ±180. */
export type Viewport = { west: number; south: number; east: number; north: number };

export type MapViewProps = {
  center: LatLng;
  zoom: number;
  rooms: Room[];                 // pins to draw (already includes the selected room)
  selectedRoomId?: string;
  draft?: LatLng;
  onViewportChange(v: Viewport): void;   // once after mount, then on every moveend
  onEmptyClick(p: LatLng): void;         // map click not consumed by a marker
  onPinClick(room: Room): void;
};
```

Map options:

| Option | Value | Why |
| --- | --- | --- |
| `center`, `zoom` | props | world view by default, room view for chunk 12 |
| `minZoom` / `maxZoom` | 2 / 19 | OSM raster limits; zoom 2 shows the world |
| `maxBounds` | `[[-90,-180],[90,180]]`, `maxBoundsViscosity: 1` | one world copy; pins never need wrapping |
| `doubleClickZoom` | `false` | Leaflet fires `click` on the first click of a double-click, which would place a stray draft pin |
| `worldCopyJump` | `false` | no wrapped copies |
| TileLayer `url` | `https://tile.openstreetmap.org/{z}/{x}/{y}.png` | PRD 5 |
| TileLayer `attribution` | `&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors` | PRD 5 |
| TileLayer `noWrap` | `true` | matches `maxBounds` |
| TileLayer `maxZoom` | 19 | |

Referer, caching and crossOrigin stay at browser defaults (OSM tile policy, PRD 5).

Events are attached in an inner `MapEvents` component using `useMapEvents`:

- `moveend` → `onViewportChange(boundsToViewport(map.getBounds()))`. Also called once after
  mount from the same component's effect. Leaflet emits one `moveend` per completed pan, zoom or
  inertia glide; coalescing bursts is the shell's job (section 5).
- `click` → `onEmptyClick({ lat: e.latlng.lat, lng: e.latlng.lng })`. No click-versus-drag
  code: Leaflet does not fire `click` after a drag, and marker clicks do not bubble to the map
  (`bubblingMouseEvents` is false on markers by default).

Pin icons (`src/components/map/pinIcon.ts`) are `L.divIcon`s with an inline SVG marker
(24 × 36 px, `iconAnchor: [12, 36]`, `className` cleared so Leaflet adds no white box):

| Variant | Look |
| --- | --- |
| `room` | blue fill, white dot, like the classic Leaflet marker |
| `selected` | amber fill, 28 × 42 px |
| `draft` | grey fill at 70 % opacity |

Using `divIcon` avoids Leaflet's broken default PNG paths under bundlers, so no icon assets are
copied to `public/` and no `L.Icon.Default` patch is needed.

## 5. Viewport, query boxes and pin refresh

### 5.1 Pure viewport maths — `src/lib/map/viewport.ts`

```ts
/** Same value as chunk 4's server-side ROOMS_BBOX_LIMIT; kept separate so the browser never imports lib/db. */
export const PIN_LIMIT = 500;
export function toQueryBoxes(v: Viewport): Bbox[];
export function mergeBoxResults(
  results: { rooms: Room[]; truncated: boolean }[],
  limit = PIN_LIMIT,
): { rooms: Room[]; truncated: boolean };
```

`toQueryBoxes` implements the chunk 3 handoff:

1. Clamp `south`/`north` to [-90, 90]. Latitude beyond the poles contains nothing.
2. Measure `span = east - west` before any normalisation. If `span >= 360`, return one box
   `[-180, 180]`.
3. Otherwise shift both longitudes by the same multiple of 360 so `west` lies in [-180, 180).
4. If the shifted `east` exceeds 180, return `[west, 180]` and `[-180, east - 360]`, both with
   the same latitudes. Otherwise return the single shifted box.
5. Never clamp a longitude endpoint on its own.

`mergeBoxResults` deduplicates by `id`, sorts with `compareCreatedAtId(b, a)` from
`@/lib/time/ordering` (chunk 4; microsecond precision, ties by id), slices to `limit`, and sets
`truncated` when any input was truncated or the distinct count exceeded `limit`.

### 5.2 Fetch lifecycle — `src/lib/map/useRoomPins.ts`

```ts
export type PinsStatus = "idle" | "loading" | "ready" | "error";
export type RoomPins = {
  rooms: Room[];
  truncated: boolean;
  status: PinsStatus;
  setViewport(v: Viewport): void;   // debounced 250 ms, then refresh
  refresh(): void;                  // immediate refresh of the last viewport
  insertRoom(room: Room): void;     // merge one room locally, no request
};
export function useRoomPins(deps?: { api?: typeof api; intervalMs?: number; debounceMs?: number }): RoomPins;
```

Behaviour:

- **Debounce.** `setViewport` stores the viewport and schedules a refresh 250 ms later; a newer
  call resets the timer. The first viewport after mount is not debounced.
- **One refresh, all boxes.** A refresh takes a sequence number, calls `api.rooms.list` for every
  box from `toQueryBoxes` concurrently, and on success of all of them publishes
  `mergeBoxResults(...)` with `status: "ready"`, but only if its sequence number is still the
  latest. Older responses, complete or partial, are discarded.
- **Failure.** If any box request rejects, the previous `rooms` and `truncated` stay, and
  `status` becomes `"error"`. The next viewport change or tick retries; a later success clears it.
- **Periodic refresh.** While `document.visibilityState === "visible"`, a timer calls `refresh`
  every `intervalMs`, defaulting to `getClientConfig().pollIntervalMs` (30 000 ms). On
  `visibilitychange` to hidden the timer stops; on visible it refreshes at once and restarts.
  No new environment variable: the PRD's 30 s map refresh reuses the polling interval.
- **Local insert.** `insertRoom` merges the room into `rooms` by id (replacing an existing entry
  with the same id) and re-sorts; `truncated` is unchanged. Chunk 10 calls it after a successful
  create so the creator's pin replaces the draft in the same render.
- On unmount all timers are cleared and any in-flight response is ignored.

### 5.3 What the map shows

`MapShell` computes `pinsToRender = rooms` plus the selected room when `selection.kind ===
"room"` and no room with that id is in `rooms`. This keeps the selected pin visible when the
capped response omits it (PRD 4).

## 6. Selection state — `src/lib/page/selection.ts`

```ts
export type Prefill = { author: string; text: string };
export type Selection =
  | { kind: "none" }
  | { kind: "draft"; lat: number; lng: number }
  | { kind: "room"; room: Room; prefill?: Prefill };
export type SelectionAction =
  | { type: "clickEmpty"; lat: number; lng: number }
  | { type: "clickPin"; room: Room }
  | { type: "roomCreated"; room: Room }
  | { type: "movedToExisting"; room: Room; prefill: Prefill }
  | { type: "close" };
export function selectionReducer(s: Selection, a: SelectionAction): Selection;
```

| From | Action | To |
| --- | --- | --- |
| any | `clickEmpty` | `draft(lat, lng)` (an open room is replaced by the new-room form) |
| any | `clickPin(room)` | `room(room)`; if `room.id` already selected, return the same state object |
| any | `roomCreated(room)` | `room(room)` |
| any | `movedToExisting(room, prefill)` | `room(room, prefill)` |
| any | `close` | `none` |

Chunk 9 extends this contract: the room selection gains `seed?: Message` and `roomCreated`
carries the first `message` (see `2026-09-17-room-panel-design.md` §3.1).

Chunk 10 keeps `selectionReducer` as the public pure selection transition table and wraps it in
`handoffReducer` inside `MapShell`. The wrapper owns `{ selection, revision, recovery }`. Ordinary
empty-map, pin, and close actions delegate to `selectionReducer`; `created`, `conflict`, and
`failed` update selection and handoff metadata atomically. Draft panels use `draft:<revision>` and
room panels use `<room.id>:<revision>`. The revision changes only for those three outcomes, so an
ordinary repeat click on the selected pin preserves the mounted panel while an outcome targeting
that same room mounts a fresh one.

`MapShell` props:

```ts
export type MapShellProps = { initialSelection: Selection; initialCenter: LatLng; initialZoom: number };
```

Wiring:

- `onViewportChange` → `pins.setViewport`
- empty map click → dispatch the handoff `clickEmpty` action
- pin click → dispatch the handoff `clickPin` action
- panel close → dispatch the handoff `close` action
- `NewRoomPopup.onCreated` → `pins.insertRoom(room)` and dispatch `created(room, message)`
- `NewRoomPopup.onConflict` → `pins.insertRoom(room)` and dispatch `conflict(room, prefill)`
- `NewRoomPopup.onFailed` → dispatch `failed(input, error)`

## 7. Pins and click handling

- `RoomPins({ rooms, selectedRoomId, onPinClick })` renders one `<Marker>` per room, keyed by
  id, icon `selected` when `room.id === selectedRoomId` else `room`, `title={room.name}` for the
  native tooltip, and `eventHandlers` for `click` and `keydown`. Leaflet markers are keyboard
  focusable (`role="button"`), but Leaflet only opens popups on Enter, so `RoomPins` calls
  `onPinClick` itself for Enter and Space (corrected in chunk 9).
- `DraftPin({ lat, lng })` renders one `<Marker interactive={false}>` with the `draft` icon. A
  click on it falls through to the map and moves the draft.
- The draft pin is rendered only while `selection.kind === "draft"`.
- No auto-pan on selection.

## 8. Panel frame and scroll behaviour (contract for chunks 9 and 10)

`src/components/panel/PanelFrame.tsx` wraps shadcn `Card` (added in this chunk):

```ts
export type PanelFrameProps = {
  title: ReactNode;
  titleAdornment?: ReactNode;   // chunk 10's info icon
  onClose?(): void;             // renders a close button (react-icons FaTimes) when given
  children: ReactNode;          // body, flex-1 min-h-0
  footer?: ReactNode;
};
```

Layout: a flex column filling the slot's max height. Header row: title, adornment, close button
at the right. Body: `flex-1 min-h-0`; the child provides its own scroll container. Footer: fixed
at the bottom, no shrink.

Usage by later chunks:

| Component | Header | Body | Footer |
| --- | --- | --- | --- |
| `WelcomeCard` (chunk 6) | "Map Chat", no close | "Click on the map to start a chat" | none |
| `NewRoomPopup` (chunk 10) | "New chatroom" + info icon | one-line hint | `ComposeForm` "Create" |
| `RoomPanel` (chunk 9) | `room.name` (no `RoomTitle`, new-room design decision 5) | `MessageList` | moved notice, fetch alert, backlog notice + `ComposeForm` "Send" |

Message list rules for chunk 9:

- The list is the only scroll container (`overflow-y-auto`).
- Row: author in `font-medium`, then the text with `whitespace-pre-wrap break-words`, then the
  local time in `text-xs text-muted-foreground` right-aligned under the text.
- Initial history scrolls to the bottom. "Load older" is the first element in the list and is
  hidden when `hasMore` is false.
- Prepending older messages preserves the reader's position: record `scrollHeight` before the
  update and add the difference to `scrollTop` after it, in a layout effect.
- Incoming messages auto-scroll only when the reader is within 32 px of the bottom. Otherwise a
  "New messages" pill appears at the bottom edge of the list and scrolls to the bottom on click.
- The backlog notice "More messages are available" with "Load more messages" renders between the
  list and the compose form (footer top).

## 9. Error handling

| Situation | Behaviour |
| --- | --- |
| A box request fails | keep previous pins, status pill "Couldn't refresh rooms", retry on next viewport change or tick, clear on success |
| Response for a superseded refresh | discarded by sequence number, including partial two-box results |
| Tiles fail or are blocked | Leaflet shows blank tiles; accepted as best effort (PRD 5, Known limitations) |
| Map bundle fails to load | dynamic import rejects; Next's error boundary; out of scope |

## 10. Testing

Unit (Vitest, Node):

- `viewport.test.ts`: `[170, 190]` → `[170, 180]` + `[-180, -170]`, retaining rooms at 175 and
  -175; `[530, 550]` → same two boxes; `[190, 210]` → `[-170, -150]`; span ≥ 360 → one world
  box; latitudes clamped; dedupe by id; ties on `createdAt` ordered by id, and two rooms in the
  same millisecond with adversarial UUIDs keep SQL order; 501 distinct → 500 + `truncated`; a
  per-box `truncated` propagates.
- `selection.test.ts`: every row of the table in section 6, including `close` from each state and
  `clickPin` on the already-selected room returning the same object.
- `useRoomPins.test.ts` (fake timers, fake `api`): debounce collapses rapid `setViewport` calls
  into one refresh; a slow first response resolving after a fast second one is ignored; a
  rejected box keeps old pins and sets `error`, and the next success clears it; the interval
  runs only while visible; a visibility restore refreshes immediately; `insertRoom` dedupes.

Component (Vitest, jsdom, `react-leaflet` mocked; superseded by chunks 9-10's own component
suites once `NewRoomPopup` and `RoomPanel` replaced the placeholders these describe):

- `RoomPins` renders one marker per room and gives the selected room the `selected` icon.
- `MapShell` shows the greeting first; the "New chatroom" placeholder after `onEmptyClick`; the
  room placeholder after `onPinClick`; the greeting again after close; and passes a pin for a
  selected room that is absent from the fetched rooms.

Manual: `pnpm db:reset` loads `seed.sql`; pins appear for the seeded rooms; pan/zoom refreshes
them; a click places a draft pin and the "New chatroom" placeholder; clicking a pin swaps the
panel; with more than 500 rooms in view the truncation pill shows.

## 11. Files and dependencies

New:

```
src/app/page.tsx                       (replaced)
src/components/map/MapShell.tsx        (+ MapShell.test.tsx)
src/components/map/MapView.tsx
src/components/map/MapEvents.tsx
src/components/map/RoomPins.tsx        (+ RoomPins.test.tsx)
src/components/map/DraftPin.tsx
src/components/map/MapStatus.tsx
src/components/map/pinIcon.ts
src/components/map/mapDefaults.ts
src/components/panel/PanelFrame.tsx
src/components/panel/WelcomeCard.tsx
src/components/ui/card.tsx             (shadcn add card)
src/lib/map/viewport.ts                (+ .test.ts)
src/lib/map/useRoomPins.ts             (+ .test.ts)
src/lib/page/selection.ts              (+ .test.ts)
supabase/seed.sql
```

Packages: `leaflet`, `react-leaflet`, dev `@types/leaflet`.

Depends on chunk 4 merged: `api.rooms.list(bbox): Promise<{ rooms: Room[]; truncated: boolean }>`
from `@/lib/api/client` and `compareCreatedAtId` from `@/lib/time/ordering`. Parallel with chunks 7 and 8.
Consumed by chunks 9, 10 and 12.
