# Chunk 6: Map Shell and Map View Implementation Plan

**Review feedback:** [2026-09-16-chunk-06-map-shell-feedback.md](2026-09-16-chunk-06-map-shell-feedback.md)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A full-page Leaflet map whose pins refresh on pan, zoom and a timer, a draft pin on empty clicks, room selection on pin clicks, and one floating top-right panel that shows a greeting, a "New chatroom" placeholder or a room placeholder depending on the selection.

**Architecture:** `MapShell` (client component) owns all state: a `useReducer` over the pure `selectionReducer` and a `useRoomPins` hook that debounces viewport changes, splits antimeridian-crossing viewports into non-crossing boxes, fetches every box through `api.rooms.list`, and guards publication with viewport generations and request ownership. Visible-tab ticks refresh every 30 s unless a debounce or current-viewport request is already pending. `MapView` is loaded with `next/dynamic` (`ssr: false`), receives data as props and emits three events; it holds no application state. Pure logic is unit-tested in Node; shell/pin component tests use mocks, while `MapEvents` tests exercise real Leaflet DOM events in jsdom without fetching tiles.

**Tech Stack:** TypeScript 5 (strict), Next.js 16.3.5 App Router, React 19.2, Tailwind 4, shadcn/ui (`base-nova` style, `@base-ui/react`), `react-icons`, Leaflet 1.9.4, react-leaflet 5.0.0, Vitest 5 with jsdom 30, `@testing-library/react` 16, pnpm 10, Node 22.

**Spec:** `docs/superpowers/specs/2026-09-16-map-shell-design.md` (chunk 6 design, approved). Parent: `docs/superpowers/specs/2026-09-16-map-chat-implementation-chunks.md` §0 (global constraints), §0.1 (layout), §0.2 (DTOs), "Chunk 6". PRD: `docs/PRD.md` v4 §3 (Flow A step 1, Flow B step 1), §4 (Map behavior), §5 (map, tiles), §7 (browsers). Chunk 3 handoff: `docs/superpowers/plans/2026-09-16-chunk-03-shared-domain-layer.md`, "Viewport handoff to chunks 4 and 6".

## Global Constraints

Copied from the chunks document §0 and the chunk 6 spec where they apply here:

- Language: TypeScript, `strict: true`, no `any` in committed code.
- Package manager: pnpm (`packageManager: pnpm@10.9.0`). Node 22 LTS.
- Framework: Next.js 16, App Router. `src/app/page.tsx` stays a server component; `MapShell` is the client boundary.
- UI: React 19, Tailwind, shadcn/ui components wherever one fits (this chunk adds `card`); icons from `react-icons` (`FaTimes` for the close button).
- Map: `leaflet@^1.9.4` + `react-leaflet@^5.0.0`, dev `@types/leaflet`. OpenStreetMap raster tiles, URL `https://tile.openstreetmap.org/{z}/{x}/{y}.png`, attribution `&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors`. Referer, caching and crossOrigin stay at browser defaults.
- Map options: `minZoom` 2, `maxZoom` 19, `maxBounds` `[[-90,-180],[90,180]]` with `maxBoundsViscosity: 1`, `doubleClickZoom: false`, `worldCopyJump: false`, TileLayer `noWrap: true`, `maxZoom: 19`.
- Defaults: `DEFAULT_CENTER = { lat: 46.7712, lng: 23.6236 }` (Cluj-Napoca), `WORLD_ZOOM = 2`, `ROOM_ZOOM = 16`, `MIN_ZOOM = 2`, `MAX_ZOOM = 19`.
- Sizes: bbox result cap 500 (`PIN_LIMIT = 500`, same value as the server's `ROOMS_BBOX_LIMIT`). Viewport debounce 250 ms. Periodic pin refresh ticks every `getClientConfig().pollIntervalMs` (30 000 ms by default), skipping pending debounce/current-viewport work; no new environment variable. Map single-click placement waits 500 ms to arbitrate double-clicks; invalid world-margin clicks are ignored.
- Copy (exact strings): panel greeting title "Map Chat", body "Click on the map to start a chat"; draft panel title "New chatroom"; status pill "Zoom in to see more rooms" (truncation) and "Couldn't refresh rooms" (last refresh failed); truncation wins if both apply.
- Layout: desktop only. Shell `relative h-dvh w-full overflow-hidden`; map container `absolute inset-0 z-0`; panel slot `absolute top-4 right-4 w-96 max-h-[calc(100dvh-2rem)] z-10`; status pill `absolute top-4 left-1/2 -translate-x-1/2 z-10`. Panel and pill are siblings of the Leaflet container, never children.
- Pins: `L.divIcon` with inline SVG. `room` 24 × 36 px blue with a white dot, `selected` 28 × 42 px amber, `draft` 24 × 36 px grey at 70 % opacity. `iconAnchor` at the bottom centre. No icon assets in `public/`, no `L.Icon.Default` patch.
- Selection: the `room` selection carries the whole `Room`. The room panel is rendered with `key={room.id}`. No auto-pan on selection.
- Out of scope: mobile layout, clustering, auto-pan, the new-room form (chunk 10), the room panel (chunk 9), realtime (chunk 11).
- Tests: Vitest, TDD (failing test first). Unit tests colocated as `*.test.ts(x)`; `pnpm test` stays database-free. Component tests opt into jsdom with `// @vitest-environment jsdom` on the first line.
- Lint: `eslint-config-next` 16 enables the full `eslint-plugin-react-hooks` 7 recommended set, including the React Compiler rules `set-state-in-effect`, `refs`, `immutability` and `purity`. Do not call a state setter synchronously in an effect body and do not read `ref.current` during render. `pnpm lint` must pass with zero errors after every task.
- One commit per task, conventional commit messages, plain `git` (this repository has no GitButler workspace; if the user has switched to GitButler, use the `commit` skill with the same messages).

## Prerequisites (chunk 4 merge rechecked on 2026-09-17)

- `main` is now at `784c2ee` (merge of chunk 4), with chunks 1–4 merged. Run the baseline suite when creating the implementation worktree; the earlier 133-test count predates chunk 4.
- **Chunk 4 must be merged into `main` before Task 1.** This chunk imports `api` and `Api` from `@/lib/api/client` (which needs `Bbox` from `@/lib/schemas/query`, already on main) and `compareCreatedAtId` from `@/lib/time/ordering`. This prerequisite is satisfied at `784c2ee`; retain the check for other checkouts before starting:

  ```bash
  cd /Users/calin/dev/other/wp
  git show main:src/lib/api/client.ts > /dev/null && git show main:src/lib/time/ordering.ts > /dev/null && echo "chunk 4 merged"
  ```

  Expected: `chunk 4 merged`. If either file is missing, stop and report that chunk 4 is not merged in that checkout; do not use an unmerged prerequisite branch or re-implement those modules.
- Verified against the merged chunk 4 source, the shapes this plan relies on:
  - `api.rooms.list(bbox: Bbox): Promise<{ rooms: Room[]; truncated: boolean }>` where `Bbox = { minLng; minLat; maxLng; maxLat }`. `export type Api = ReturnType<typeof createApi>`; `export const api: Api`.
  - `compareCreatedAtId(a: { createdAt; id }, b: { createdAt; id }): number` gives ascending SQL tuple order on canonical timestamps (six fractional digits, `Z`) and lowercase UUIDs. Newest first is `compareCreatedAtId(b, a)`.
  - `Room = { id: string; name: string; lat: number; lng: number; createdAt: string }` from `@/lib/schemas/types`.
- `getClientConfig().pollIntervalMs` exists (`src/lib/config/parse.ts:72`). Calling `getClientConfig()` throws if `NEXT_PUBLIC_SUPABASE_URL` and friends are unset, so the hook reads it only when no `intervalMs` is injected; tests always inject one.
- `components.json`: style `base-nova`, `ui` alias `@/components/ui`, so `pnpm exec shadcn add card -y` writes `src/components/ui/card.tsx` exporting `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardAction`, `CardContent`, `CardFooter` (verified with `pnpm exec shadcn view card`). `Card` is already `flex flex-col overflow-hidden`; `CardAction` sits in the header's right column.
- `vitest.config.ts` has `environment: "node"`, the `@` alias and `@vitejs/plugin-react`, so `.tsx` tests work once a file opts into jsdom. Vitest's jsdom environment sets `pretendToBeVisual`, so `document.visibilityState` starts as `"visible"`.
- Registry versions on 2026-09-16: `leaflet` 1.9.4, `react-leaflet` 5.0.0 (peers `leaflet ^1.9.0`, `react ^19.0.0`, `react-dom ^19.0.0`), `@types/leaflet` 1.9.22, `@testing-library/react` 16.3.3 (peer `@testing-library/dom ^10`), `@testing-library/dom` 10.4.2.
- Next 16 docs (`node_modules/next/dist/docs/01-app/02-guides/lazy-loading.md`): "`ssr: false` option will only work for Client Components"; `MapShell` is one.
- `supabase/config.toml` already has `[db.seed] enabled = true` and `sql_paths = ["./seed.sql"]`; the file does not exist yet. `supabase db reset --local` needs the Supbuddy-managed stack running.
- Target one test file with `pnpm test <path>` (no `--`). `pnpm typecheck` runs `next typegen && tsc --noEmit`; `pnpm lint` runs `eslint`.

## Spec reconciliation

Decisions where this plan refines or departs from the spec text; the spec wins on everything else.

1. **Paths** are under `src/` with `@/` imports, as in every earlier chunk.
2. **Test tooling.** The spec lists only `leaflet`, `react-leaflet` and `@types/leaflet`. Hook and component tests need `@testing-library/react` and its peer `@testing-library/dom` as dev dependencies (Task 3 installs them). No `jest-dom` matchers; assertions use plain DOM queries.
3. **`useRoomPins.test.ts` runs in jsdom**, not Node as the spec's heading says, because the hook reads `document.visibilityState`. Timers are still faked.
4. **`boundsToViewport` lives in `src/lib/map/viewport.ts`** (typed against a structural `BoundsLike`) rather than in `MapEvents.tsx`, so it is unit-tested without Leaflet. `MapEvents` imports it.
5. **Pin icon class.** The spec says the `divIcon` `className` is "cleared". The white box comes from Leaflet's default `leaflet-div-icon` class; replacing it with `map-pin map-pin-<variant>` has the same effect and lets tests and DevTools identify variants. The class carries no styles.
6. **`status: "loading"` means "before the first result".** Background refreshes keep `ready` or `error` until they settle, so the "Couldn't refresh rooms" pill does not blink on every 30 s retry. `error` clears only on a later success.
7. **`pinsToRender(rooms, selection)`** is an exported pure function in `MapShell.tsx` (spec §5.3 describes it inline).
8. **`MapView` is the default export** of `MapView.tsx` because `next/dynamic` loads a module's default. `MapViewProps` is a named type export.
9. **Panel slot is also `flex flex-col`** so the card, a flex item with `min-h-0`, is capped by the slot's `max-h`; a percentage `max-height` on the card alone would not resolve against an auto-height parent.
10. **`MapShell.test.tsx` mocks `next/dynamic`** (returning a fake `MapView`) and `@/lib/map/useRoomPins`, so no Leaflet code and no network run in tests. `RoomPins.test.tsx` mocks only `react-leaflet` and uses the real `leaflet` `divIcon`, which works in jsdom.
11. **Seed (F-007).** `supabase/seed.sql` contains 8 hand-written rooms with messages (Cluj, Bucharest, Budapest, both sides of the antimeridian, New York) plus a 600-room grid so the 500 cap and the truncation pill can be seen locally. Fixed room IDs support message references. The fixture is repeatable through `pnpm db:reset`, which recreates the tables first; running the SQL twice against the same populated database is not supported.
12. **README** gains a "Map" section listing the new modules, the same way earlier chunks documented theirs.
13. **Refresh ownership (F-001, F-003).** Each viewport report advances a generation immediately, before debounce, invalidating both successes and failures from older viewports. Explicit `refresh()` replaces pending work and gets a new request sequence. Periodic ticks skip a pending debounce or in-flight refresh for the current generation, so successful slow requests can publish. Only the current request owner may publish or release ownership; a new viewport need not wait for obsolete requests to finish.
14. **Visibility (F-006).** Hiding clears the interval and debounce; viewport reports still retain the latest bounds without requesting data. All request-start paths check visibility. Foreground restoration consumes pending debounce work and starts exactly one explicit refresh, then restarts the interval. Already-started requests may settle while hidden if still current; transport cancellation is not required.
15. **Map clicks (F-002, F-004).** `maxBounds` does not make every pixel's longitude valid in a viewport wider than the projected world. Reject invalid coordinates before dispatching a draft. `doubleClickZoom: false` disables zoom only; `MapEvents` defers single clicks by `MAP_CLICK_DELAY_MS = 500`, cancels a pending click on `dblclick`/a repeated click, movement, a later pointer/keyboard interaction, or teardown, and never wraps blank-margin coordinates. This defines a 500 ms application arbitration window, not the OS's configurable double-click interval; clicks farther apart may commit separate draft actions. Test a standard double-click within this window from both greeting and selected-room states.
16. **Antimeridian verification (F-005).** Retain the spec's single-world/no-wrap rendering. The Fiji rooms are visited separately at opposite world edges; they are not adjacent in one local viewport. Crossing-box tests remain required for the query adapter, including raw bounds overshoot. Query splitting alone does not wrap markers or tiles.

**Branching.** Work on a branch created from `main` in its own worktree:

```bash
cd /Users/calin/dev/other/wp
git worktree add ../wp-worktrees/chunk-06-map-shell -b chunk-06-map-shell main
cd ../wp-worktrees/chunk-06-map-shell
pnpm install
pnpm test
```

Expected: all tests pass (133 on `main` before chunk 4; more after). Every command below runs from this worktree root.

## File structure

| File | Responsibility |
| --- | --- |
| `src/lib/map/viewport.ts` (+ `.test.ts`) | Pure viewport maths: `Viewport`, `LatLng`, `BoundsLike`, `PIN_LIMIT`, `boundsToViewport`, `toQueryBoxes`, `sortRoomsNewestFirst`, `mergeBoxResults` |
| `src/lib/page/selection.ts` (+ `.test.ts`) | `Selection`, `SelectionAction`, `Prefill`, `selectionReducer` |
| `src/lib/map/useRoomPins.ts` (+ `.test.ts`) | Fetch lifecycle hook: debounce, sequencing, failure handling, visibility-aware interval, local insert |
| `src/components/ui/card.tsx` | shadcn `card` (generated) |
| `src/components/panel/PanelFrame.tsx` (+ `.test.tsx`) | Header / body / footer chrome shared by every panel |
| `src/components/panel/WelcomeCard.tsx` | The greeting panel |
| `src/components/map/mapDefaults.ts` | Centre and zoom constants |
| `src/components/map/pinIcon.ts` | `pinSvg`, `pinIcon` (memoised `DivIcon` per variant) |
| `src/components/map/RoomPins.tsx` (+ `.test.tsx`) | One `Marker` per room |
| `src/components/map/DraftPin.tsx` | The non-interactive draft `Marker` |
| `src/components/map/MapEvents.tsx` (+ `.test.tsx`) | Viewport events, valid-coordinate clicks, double-click arbitration and cleanup |
| `src/components/map/MapView.tsx` | `MapContainer` + `TileLayer` + pins; props in, events out |
| `src/components/map/MapStatus.tsx` | Truncation / refresh-failure pill |
| `src/components/map/MapShell.tsx` (+ `.test.tsx`) | State owner: selection, pins, panel slot, dynamic `MapView` |
| `src/app/page.tsx` | Server component rendering `MapShell` with defaults |
| `supabase/seed.sql` | Dev data |
| `README.md` | "Map" section |

---

### Task 1: Viewport maths

**Files:**
- Create: `src/lib/map/viewport.ts`
- Test: `src/lib/map/viewport.test.ts`

**Interfaces:**
- Consumes: `Bbox` from `@/lib/schemas/query`, `Room` from `@/lib/schemas/types`, `compareCreatedAtId` from `@/lib/time/ordering` (chunk 4).
- Produces:
  - `type LatLng = { lat: number; lng: number }`
  - `type Viewport = { west: number; south: number; east: number; north: number }`
  - `type BoundsLike = { getWest(): number; getSouth(): number; getEast(): number; getNorth(): number }`
  - `const PIN_LIMIT = 500`
  - `boundsToViewport(b: BoundsLike): Viewport`
  - `toQueryBoxes(v: Viewport): Bbox[]`
  - `sortRoomsNewestFirst(rooms: Room[]): Room[]` (returns a new array)
  - `mergeBoxResults(results: { rooms: Room[]; truncated: boolean }[], limit = PIN_LIMIT): { rooms: Room[]; truncated: boolean }`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/map/viewport.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  boundsToViewport,
  mergeBoxResults,
  PIN_LIMIT,
  sortRoomsNewestFirst,
  toQueryBoxes,
} from "@/lib/map/viewport";
import type { Bbox } from "@/lib/schemas/query";
import type { Room } from "@/lib/schemas/types";

/** A canonical lowercase UUID whose last 12 digits are `n`, zero-padded. */
function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

function room(overrides: Partial<Room> & { id: string }): Room {
  return {
    name: `room-${overrides.id.slice(-4)}`,
    lat: 46.77,
    lng: 23.62,
    createdAt: "2026-09-16T15:00:00.000000Z",
    ...overrides,
  };
}

const LATS = { minLat: 40, maxLat: 50 };
const visibleIn = (boxes: Bbox[], lng: number) =>
  boxes.some((box) => box.minLng <= lng && lng <= box.maxLng);

describe("boundsToViewport", () => {
  it("reads the four edges of a Leaflet-like bounds object", () => {
    const bounds = {
      getWest: () => 170,
      getSouth: () => 40,
      getEast: () => 190,
      getNorth: () => 50,
    };
    expect(boundsToViewport(bounds)).toEqual({ west: 170, south: 40, east: 190, north: 50 });
  });
});

describe("toQueryBoxes", () => {
  it("splits a viewport crossing the antimeridian into two boxes", () => {
    const boxes = toQueryBoxes({ west: 170, south: 40, east: 190, north: 50 });

    expect(boxes).toEqual([
      { minLng: 170, maxLng: 180, ...LATS },
      { minLng: -180, maxLng: -170, ...LATS },
    ]);
    expect(visibleIn(boxes, 175)).toBe(true);
    expect(visibleIn(boxes, -175)).toBe(true);
    expect(visibleIn(boxes, 0)).toBe(false);
  });

  it("normalises a viewport one world copy to the east before splitting", () => {
    expect(toQueryBoxes({ west: 530, south: 40, east: 550, north: 50 })).toEqual([
      { minLng: 170, maxLng: 180, ...LATS },
      { minLng: -180, maxLng: -170, ...LATS },
    ]);
  });

  it("normalises a viewport one world copy to the west before splitting", () => {
    expect(toQueryBoxes({ west: -190, south: 40, east: -170, north: 50 })).toEqual([
      { minLng: 170, maxLng: 180, ...LATS },
      { minLng: -180, maxLng: -170, ...LATS },
    ]);
  });

  it("shifts a fully offset viewport into one box without splitting", () => {
    expect(toQueryBoxes({ west: 190, south: 40, east: 210, north: 50 })).toEqual([
      { minLng: -170, maxLng: -150, ...LATS },
    ]);
  });

  it("returns one world box when the span is 360 degrees or more", () => {
    expect(toQueryBoxes({ west: -200, south: 40, east: 200, north: 50 })).toEqual([
      { minLng: -180, maxLng: 180, ...LATS },
    ]);
    expect(toQueryBoxes({ west: 0, south: 40, east: 360, north: 50 })).toEqual([
      { minLng: -180, maxLng: 180, ...LATS },
    ]);
  });

  it("clamps latitudes to the poles, in every box", () => {
    expect(toQueryBoxes({ west: 10, south: -95, east: 20, north: 95 })).toEqual([
      { minLng: 10, minLat: -90, maxLng: 20, maxLat: 90 },
    ]);
    expect(toQueryBoxes({ west: 170, south: -95, east: 190, north: 95 })).toEqual([
      { minLng: 170, minLat: -90, maxLng: 180, maxLat: 90 },
      { minLng: -180, minLat: -90, maxLng: -170, maxLat: 90 },
    ]);
  });

  it("keeps a viewport that touches ±180 as a single box", () => {
    expect(toQueryBoxes({ west: -180, south: 40, east: -100, north: 50 })).toEqual([
      { minLng: -180, maxLng: -100, ...LATS },
    ]);
    expect(toQueryBoxes({ west: 100, south: 40, east: 180, north: 50 })).toEqual([
      { minLng: 100, maxLng: 180, ...LATS },
    ]);
  });

  it("maps a west edge of exactly 180 to -180", () => {
    expect(toQueryBoxes({ west: 180, south: 40, east: 200, north: 50 })).toEqual([
      { minLng: -180, maxLng: -160, ...LATS },
    ]);
  });
});

describe("sortRoomsNewestFirst", () => {
  it("orders by createdAt descending without mutating the input", () => {
    const older = room({ id: uuid(1), createdAt: "2026-09-16T15:00:00.000000Z" });
    const newer = room({ id: uuid(2), createdAt: "2026-09-16T15:00:01.000000Z" });
    const input = [older, newer];

    expect(sortRoomsNewestFirst(input)).toEqual([newer, older]);
    expect(input).toEqual([older, newer]);
  });
});

describe("mergeBoxResults", () => {
  it("deduplicates rooms that appear in more than one box by id", () => {
    const shared = room({ id: uuid(1) });
    const result = mergeBoxResults([
      { rooms: [shared], truncated: false },
      { rooms: [shared, room({ id: uuid(2) })], truncated: false },
    ]);

    expect(result.rooms.map((r) => r.id)).toEqual([uuid(2), uuid(1)]);
    expect(result.truncated).toBe(false);
  });

  it("orders newest first at microsecond precision", () => {
    const a = room({ id: uuid(1), createdAt: "2026-09-16T15:00:00.123000Z" });
    const b = room({ id: uuid(2), createdAt: "2026-09-16T15:00:00.123001Z" });

    expect(mergeBoxResults([{ rooms: [a, b], truncated: false }]).rooms).toEqual([b, a]);
  });

  it("breaks createdAt ties by id descending, in Postgres byte order", () => {
    // parseInt-style or locale comparisons would put "…09" after "…0a"; SQL puts "…0a" first.
    const nine = room({ id: "00000000-0000-4000-8000-000000000009" });
    const letterA = room({ id: "00000000-0000-4000-8000-00000000000a" });

    expect(mergeBoxResults([{ rooms: [nine, letterA], truncated: false }]).rooms).toEqual([
      letterA,
      nine,
    ]);
  });

  it("slices to the limit and reports truncation when more rooms were distinct", () => {
    // Microsecond `i` makes room `i` newer than room `i - 1`.
    const rooms = Array.from({ length: PIN_LIMIT + 1 }, (_, i) =>
      room({ id: uuid(i), createdAt: `2026-09-16T15:00:00.${String(i).padStart(6, "0")}Z` }),
    );

    const result = mergeBoxResults([
      { rooms: rooms.slice(0, 300), truncated: false },
      { rooms: rooms.slice(300), truncated: false },
    ]);

    expect(result.rooms).toHaveLength(PIN_LIMIT);
    expect(result.truncated).toBe(true);
    expect(result.rooms[0].id).toBe(uuid(PIN_LIMIT)); // the newest survives the slice
  });

  it("propagates a per-box truncated flag even when the merged count is small", () => {
    const result = mergeBoxResults([
      { rooms: [room({ id: uuid(1) })], truncated: true },
      { rooms: [room({ id: uuid(2) })], truncated: false },
    ]);

    expect(result.rooms).toHaveLength(2);
    expect(result.truncated).toBe(true);
  });

  it("honours an explicit limit", () => {
    const rooms = [uuid(1), uuid(2), uuid(3)].map((id) => room({ id }));

    const result = mergeBoxResults([{ rooms, truncated: false }], 2);

    expect(result.rooms.map((r) => r.id)).toEqual([uuid(3), uuid(2)]);
    expect(result.truncated).toBe(true);
  });

  it("returns no rooms and no truncation for no boxes", () => {
    expect(mergeBoxResults([])).toEqual({ rooms: [], truncated: false });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test src/lib/map/viewport.test.ts`
Expected: FAIL, "Failed to resolve import "@/lib/map/viewport"".

- [ ] **Step 3: Write the implementation**

Create `src/lib/map/viewport.ts`:

```ts
import type { Bbox } from "@/lib/schemas/query";
import type { Room } from "@/lib/schemas/types";
import { compareCreatedAtId } from "@/lib/time/ordering";

export type LatLng = { lat: number; lng: number };

/** Raw Leaflet bounds in degrees; longitudes are unwrapped and may exceed ±180. */
export type Viewport = { west: number; south: number; east: number; north: number };

/**
 * Most pins the map shows at once. Same value as the server's
 * `ROOMS_BBOX_LIMIT` (src/lib/db/rooms.ts), kept separate so the browser
 * never imports lib/db.
 */
export const PIN_LIMIT = 500;

/** The four accessors of Leaflet's `LatLngBounds` this module needs; no leaflet import. */
export type BoundsLike = {
  getWest(): number;
  getSouth(): number;
  getEast(): number;
  getNorth(): number;
};

export function boundsToViewport(bounds: BoundsLike): Viewport {
  return {
    west: bounds.getWest(),
    south: bounds.getSouth(),
    east: bounds.getEast(),
    north: bounds.getNorth(),
  };
}

function clampLat(lat: number): number {
  return Math.min(90, Math.max(-90, lat));
}

/**
 * The non-crossing query boxes for a viewport (chunk 3 handoff, PRD 6.5):
 * latitudes clamped to the poles, a span of 360° or more queries the whole
 * world, otherwise both longitudes shift by the same multiple of 360 so
 * `west` lies in [-180, 180) and a viewport crossing the antimeridian splits
 * into two boxes. Longitude endpoints are never clamped on their own.
 */
export function toQueryBoxes(viewport: Viewport): Bbox[] {
  const minLat = clampLat(viewport.south);
  const maxLat = clampLat(viewport.north);
  if (viewport.east - viewport.west >= 360) {
    return [{ minLng: -180, minLat, maxLng: 180, maxLat }];
  }
  const shift = Math.floor((viewport.west + 180) / 360) * 360;
  const west = viewport.west - shift;
  const east = viewport.east - shift;
  if (east > 180) {
    return [
      { minLng: west, minLat, maxLng: 180, maxLat },
      { minLng: -180, minLat, maxLng: east - 360, maxLat },
    ];
  }
  return [{ minLng: west, minLat, maxLng: east, maxLat }];
}

/** `created_at desc, id desc`, the server's order (PRD 4). Returns a new array. */
export function sortRoomsNewestFirst(rooms: Room[]): Room[] {
  return [...rooms].sort((a, b) => compareCreatedAtId(b, a));
}

/**
 * Combines the responses of one refresh: deduplicates by id, orders newest
 * first, caps at `limit`, and reports truncation when any box was truncated
 * or the distinct count exceeded the cap.
 */
export function mergeBoxResults(
  results: { rooms: Room[]; truncated: boolean }[],
  limit = PIN_LIMIT,
): { rooms: Room[]; truncated: boolean } {
  const byId = new Map<string, Room>();
  for (const result of results) {
    for (const room of result.rooms) byId.set(room.id, room);
  }
  const sorted = sortRoomsNewestFirst([...byId.values()]);
  const truncated = results.some((result) => result.truncated) || sorted.length > limit;
  return { rooms: sorted.slice(0, limit), truncated };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test src/lib/map/viewport.test.ts`
Expected: PASS, 17 tests.

- [ ] **Step 5: Typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: both exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/lib/map/viewport.ts src/lib/map/viewport.test.ts
git commit -m "feat(map): add viewport box splitting and pin result merging"
```

---

### Task 2: Selection reducer

**Files:**
- Create: `src/lib/page/selection.ts`
- Test: `src/lib/page/selection.test.ts`

**Interfaces:**
- Consumes: `Room` from `@/lib/schemas/types`.
- Produces:
  - `type Prefill = { author: string; text: string }`
  - `type Selection = { kind: "none" } | { kind: "draft"; lat: number; lng: number } | { kind: "room"; room: Room; prefill?: Prefill }`
  - `type SelectionAction = { type: "clickEmpty"; lat; lng } | { type: "clickPin"; room } | { type: "roomCreated"; room } | { type: "movedToExisting"; room; prefill } | { type: "close" }`
  - `selectionReducer(s: Selection, a: SelectionAction): Selection`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/page/selection.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { type Selection, selectionReducer } from "@/lib/page/selection";
import type { Room } from "@/lib/schemas/types";

const roomA: Room = {
  id: "00000000-0000-4000-8000-00000000000a",
  name: "brave-crimson-otter",
  lat: 46.7712,
  lng: 23.6236,
  createdAt: "2026-09-16T15:00:00.000000Z",
};
const roomB: Room = { ...roomA, id: "00000000-0000-4000-8000-00000000000b", name: "calm-amber-heron" };
const prefill = { author: "ana", text: "hello" };

const none: Selection = { kind: "none" };
const draft: Selection = { kind: "draft", lat: 1, lng: 2 };
const selectedA: Selection = { kind: "room", room: roomA, prefill };

const everyState: [string, Selection][] = [
  ["none", none],
  ["draft", draft],
  ["room", selectedA],
];

describe("selectionReducer", () => {
  it.each(everyState)("clickEmpty from %s places a draft", (_, state) => {
    expect(selectionReducer(state, { type: "clickEmpty", lat: 10, lng: 20 })).toEqual({
      kind: "draft",
      lat: 10,
      lng: 20,
    });
  });

  it.each(everyState)("clickPin from %s selects the room without prefill", (_, state) => {
    expect(selectionReducer(state, { type: "clickPin", room: roomB })).toEqual({
      kind: "room",
      room: roomB,
    });
  });

  it("clickPin on the already selected room returns the same state object", () => {
    const next = selectionReducer(selectedA, { type: "clickPin", room: { ...roomA } });

    expect(next).toBe(selectedA);
  });

  it.each(everyState)("roomCreated from %s selects the new room", (_, state) => {
    expect(selectionReducer(state, { type: "roomCreated", room: roomB })).toEqual({
      kind: "room",
      room: roomB,
    });
  });

  it.each(everyState)("movedToExisting from %s selects the room and carries the prefill", (_, state) => {
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
Expected: FAIL, "Failed to resolve import "@/lib/page/selection"".

- [ ] **Step 3: Write the implementation**

Create `src/lib/page/selection.ts`:

```ts
import type { Room } from "@/lib/schemas/types";

/** Text chunk 10 carries into the room panel when a create lands on an existing room. */
export type Prefill = { author: string; text: string };

/** What the map page shows in its panel (spec §6). */
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

/**
 * Pure transition table (spec §6). `clickPin` on the already selected room
 * returns the same object so the keyed room panel is not remounted and its
 * prefill survives.
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
      return { kind: "room", room: action.room };
    case "movedToExisting":
      return { kind: "room", room: action.room, prefill: action.prefill };
    case "close":
      return { kind: "none" };
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test src/lib/page/selection.test.ts`
Expected: PASS, 17 tests.

- [ ] **Step 5: Typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: both exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/lib/page/selection.ts src/lib/page/selection.test.ts
git commit -m "feat(page): add map selection reducer"
```

---

### Task 3: `useRoomPins` fetch lifecycle hook

**Files:**
- Modify: `package.json`, `pnpm-lock.yaml` (dev dependencies `@testing-library/react`, `@testing-library/dom`)
- Create: `src/lib/map/useRoomPins.ts`
- Test: `src/lib/map/useRoomPins.test.ts`

**Interfaces:**
- Consumes: `api`, `Api` from `@/lib/api/client`; `getClientConfig` from `@/lib/config/client`; `toQueryBoxes`, `mergeBoxResults`, `sortRoomsNewestFirst`, `Viewport` from Task 1; `Room`.
- Produces:
  - `const DEFAULT_DEBOUNCE_MS = 250`
  - `type PinsStatus = "idle" | "loading" | "ready" | "error"`
  - `type RoomPins = { rooms: Room[]; truncated: boolean; status: PinsStatus; setViewport(v: Viewport): void; refresh(): void; insertRoom(room: Room): void }`
  - `type UseRoomPinsDeps = { api?: Api; intervalMs?: number; debounceMs?: number }`
  - `useRoomPins(deps?: UseRoomPinsDeps): RoomPins`. `setViewport`, `refresh` and `insertRoom` are referentially stable across renders (for fixed dependencies). `setViewport` invalidates old results immediately; explicit refreshes supersede older work, periodic ticks coalesce, and hidden tabs start no requests (reconciliations 13–14).

- [ ] **Step 1: Install the test library**

Run:

```bash
pnpm add -D @testing-library/react@^16.3.3 @testing-library/dom@^10.4.2
```

Expected: `package.json` `devDependencies` gains both entries; `pnpm test` still passes.

- [ ] **Step 2: Write the failing tests**

Create `src/lib/map/useRoomPins.test.ts`:

```ts
// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Api } from "@/lib/api/client";
import { useRoomPins } from "@/lib/map/useRoomPins";
import type { Room } from "@/lib/schemas/types";

type ListResult = { rooms: Room[]; truncated: boolean };

function room(id: string, createdAt: string): Room {
  return { id, name: `room-${id.slice(-4)}`, lat: 46.77, lng: 23.62, createdAt };
}
const A = room("00000000-0000-4000-8000-00000000000a", "2026-09-16T15:00:01.000000Z");
const B = room("00000000-0000-4000-8000-00000000000b", "2026-09-16T15:00:02.000000Z");

const SINGLE = { west: 20, south: 40, east: 30, north: 50 };
const CROSSING = { west: 170, south: 40, east: 190, north: 50 };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const ok = (rooms: Room[], truncated = false): Promise<ListResult> =>
  Promise.resolve({ rooms, truncated });

/** An `Api` whose `rooms.list` is a spy; other members are never called by the hook. */
function fakeApi() {
  const list = vi.fn<(bbox: unknown) => Promise<ListResult>>();
  return { api: { rooms: { list } } as unknown as Api, list };
}

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
}

/** Lets settled promises deliver their callbacks. */
async function flush() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function renderPins(api: Api, deps: { intervalMs?: number; debounceMs?: number } = {}) {
  return renderHook(() =>
    useRoomPins({ api, intervalMs: deps.intervalMs ?? 30_000, debounceMs: deps.debounceMs ?? 250 }),
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useRoomPins", () => {
  it("starts idle with no rooms and no truncation", () => {
    const { api } = fakeApi();

    const { result } = renderPins(api);

    expect(result.current).toMatchObject({ rooms: [], truncated: false, status: "idle" });
  });

  it("refreshes the first viewport at once and debounces later ones into one refresh", async () => {
    const { api, list } = fakeApi();
    list.mockImplementation(() => ok([A]));
    const { result } = renderPins(api);

    act(() => result.current.setViewport(SINGLE));
    expect(list).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe("loading");
    await flush();
    expect(result.current.status).toBe("ready");
    expect(result.current.rooms).toEqual([A]);

    act(() => {
      result.current.setViewport({ ...SINGLE, east: 31 });
      result.current.setViewport({ ...SINGLE, east: 32 });
      result.current.setViewport({ ...SINGLE, east: 33 });
    });
    expect(list).toHaveBeenCalledTimes(1);
    await advance(249);
    expect(list).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(list).toHaveBeenCalledTimes(2);
    expect(list.mock.calls[1][0]).toEqual({ minLng: 20, minLat: 40, maxLng: 33, maxLat: 50 });
  });

  it("queries every box of a crossing viewport and merges the results", async () => {
    const { api, list } = fakeApi();
    list.mockImplementationOnce(() => ok([A])).mockImplementationOnce(() => ok([B]));
    const { result } = renderPins(api);

    act(() => result.current.setViewport(CROSSING));
    await flush();

    expect(list).toHaveBeenCalledTimes(2);
    expect(list.mock.calls[0][0]).toEqual({ minLng: 170, minLat: 40, maxLng: 180, maxLat: 50 });
    expect(list.mock.calls[1][0]).toEqual({ minLng: -180, minLat: 40, maxLng: -170, maxLat: 50 });
    expect(result.current.rooms).toEqual([B, A]);
  });

  it("ignores a slow first response that resolves after a fast second one", async () => {
    const { api, list } = fakeApi();
    const first = deferred<ListResult>();
    const second = deferred<ListResult>();
    list.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result } = renderPins(api);

    act(() => result.current.setViewport(SINGLE));
    act(() => result.current.refresh());
    second.resolve({ rooms: [B], truncated: false });
    await flush();
    expect(result.current.rooms).toEqual([B]);

    first.resolve({ rooms: [A], truncated: false });
    await flush();
    expect(result.current.rooms).toEqual([B]);
  });

  it("discards a partial two-box result of a superseded refresh", async () => {
    const { api, list } = fakeApi();
    const d = [deferred<ListResult>(), deferred<ListResult>(), deferred<ListResult>(), deferred<ListResult>()];
    list
      .mockReturnValueOnce(d[0].promise)
      .mockReturnValueOnce(d[1].promise)
      .mockReturnValueOnce(d[2].promise)
      .mockReturnValueOnce(d[3].promise);
    const { result } = renderPins(api);

    act(() => result.current.setViewport(CROSSING));
    d[0].resolve({ rooms: [A], truncated: false }); // first refresh, box 1 only
    act(() => result.current.refresh());
    d[2].resolve({ rooms: [B], truncated: false });
    d[3].resolve({ rooms: [], truncated: false });
    await flush();
    expect(result.current.rooms).toEqual([B]);

    d[1].resolve({ rooms: [A], truncated: false }); // first refresh, box 2, too late
    await flush();
    expect(result.current.rooms).toEqual([B]);
  });

  it("keeps old pins and reports error when a box fails, until the next success", async () => {
    const { api, list } = fakeApi();
    list.mockImplementationOnce(() => ok([A], true));
    const { result } = renderPins(api);
    act(() => result.current.setViewport(SINGLE));
    await flush();
    expect(result.current).toMatchObject({ rooms: [A], truncated: true, status: "ready" });

    list.mockImplementationOnce(() => Promise.reject(new Error("boom")));
    act(() => result.current.refresh());
    await flush();
    expect(result.current).toMatchObject({ rooms: [A], truncated: true, status: "error" });

    const pending = deferred<ListResult>();
    list.mockReturnValueOnce(pending.promise);
    act(() => result.current.refresh());
    expect(result.current.status).toBe("error"); // no loading flicker while retrying

    pending.resolve({ rooms: [B], truncated: false });
    await flush();
    expect(result.current).toMatchObject({ rooms: [B], truncated: false, status: "ready" });
  });

  it("stays ready during a background refresh", async () => {
    const { api, list } = fakeApi();
    list.mockImplementationOnce(() => ok([A]));
    const { result } = renderPins(api);
    act(() => result.current.setViewport(SINGLE));
    await flush();

    list.mockReturnValueOnce(deferred<ListResult>().promise);
    act(() => result.current.refresh());

    expect(result.current.status).toBe("ready");
  });

  it("refreshes on the interval only while the tab is visible", async () => {
    const { api, list } = fakeApi();
    list.mockImplementation(() => ok([A]));
    const { result } = renderPins(api, { intervalMs: 1000 });
    act(() => result.current.setViewport(SINGLE));
    expect(list).toHaveBeenCalledTimes(1);

    await advance(1000);
    expect(list).toHaveBeenCalledTimes(2);
    await advance(1000);
    expect(list).toHaveBeenCalledTimes(3);

    act(() => setVisibility("hidden"));
    await advance(5000);
    expect(list).toHaveBeenCalledTimes(3);

    act(() => setVisibility("visible"));
    expect(list).toHaveBeenCalledTimes(4); // immediate refresh on restore
    await advance(1000);
    expect(list).toHaveBeenCalledTimes(5);
  });

  it("does not tick before a viewport is known", async () => {
    const { api, list } = fakeApi();
    renderPins(api, { intervalMs: 1000 });

    await advance(3000);

    expect(list).not.toHaveBeenCalled();
  });

  it.each(["resolve", "reject"] as const)(
    "ignores an obsolete viewport's %s during the next viewport's debounce",
    async (settle) => {
      const { api, list } = fakeApi();
      const old = deferred<ListResult>();
      list.mockImplementationOnce(() => ok([A], true)).mockReturnValueOnce(old.promise);
      const { result } = renderPins(api);
      act(() => result.current.setViewport(SINGLE));
      await flush();
      act(() => result.current.refresh());
      act(() => result.current.setViewport({ ...SINGLE, west: 21 }));

      if (settle === "resolve") old.resolve({ rooms: [B], truncated: false });
      else old.reject(new Error("obsolete failure"));
      await flush();

      expect(list).toHaveBeenCalledTimes(2); // the new viewport has not fetched yet
      expect(result.current).toMatchObject({ rooms: [A], truncated: true, status: "ready" });
      list.mockImplementationOnce(() => ok([B]));
      await advance(250);
      expect(result.current).toMatchObject({ rooms: [B], truncated: false, status: "ready" });
    },
  );

  it("publishes a slow success without periodic ticks superseding it", async () => {
    const { api, list } = fakeApi();
    const slow = deferred<ListResult>();
    list.mockReturnValueOnce(slow.promise).mockImplementation(() => ok([B]));
    const { result } = renderPins(api, { intervalMs: 1000 });
    act(() => result.current.setViewport(SINGLE));

    await advance(3500);
    expect(list).toHaveBeenCalledTimes(1);
    slow.resolve({ rooms: [A], truncated: false });
    await flush();
    expect(result.current).toMatchObject({ rooms: [A], status: "ready" });
    await advance(500);
    expect(list).toHaveBeenCalledTimes(2);
    expect(result.current.rooms).toEqual([B]);
  });

  it.each(["resolve", "reject"] as const)(
    "an older request's %s cannot release the newer request's ownership",
    async (settle) => {
      const { api, list } = fakeApi();
      const old = deferred<ListResult>();
      const current = deferred<ListResult>();
      list.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
      const { result } = renderPins(api, { intervalMs: 1000 });
      act(() => result.current.setViewport(SINGLE));
      act(() => result.current.refresh()); // explicit replacement is still supported
      if (settle === "resolve") old.resolve({ rooms: [A], truncated: false });
      else old.reject(new Error("obsolete failure"));
      await flush();

      await advance(2000);
      expect(list).toHaveBeenCalledTimes(2);
      current.resolve({ rooms: [B], truncated: false });
      await flush();
      expect(result.current).toMatchObject({ rooms: [B], status: "ready" });
    },
  );

  it("starts the new viewport without waiting for the old viewport's slow request", async () => {
    const { api, list } = fakeApi();
    list.mockReturnValueOnce(deferred<ListResult>().promise).mockImplementation(() => ok([B]));
    const { result } = renderPins(api);
    act(() => result.current.setViewport(SINGLE));
    act(() => result.current.setViewport({ ...SINGLE, west: 21 }));

    await advance(250);

    expect(list).toHaveBeenCalledTimes(2);
    expect(result.current.rooms).toEqual([B]);
  });

  it("does not let a periodic tick bypass the viewport debounce", async () => {
    const { api, list } = fakeApi();
    list.mockImplementation(() => ok([A]));
    const { result } = renderPins(api, { intervalMs: 1000 });
    act(() => result.current.setViewport(SINGLE));
    await advance(900);
    act(() => result.current.setViewport({ ...SINGLE, west: 21 }));

    await advance(100); // interval tick, with 150 ms of debounce left
    expect(list).toHaveBeenCalledTimes(1);
    await advance(150);
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("keeps the latest hidden viewport without starting requests until foregrounded", async () => {
    const { api, list } = fakeApi();
    list.mockImplementation(() => ok([A]));
    setVisibility("hidden");
    const { result } = renderPins(api, { intervalMs: 1000 });
    act(() => {
      result.current.setViewport(SINGLE);
      result.current.setViewport({ ...SINGLE, west: 21 });
      result.current.refresh();
    });
    await advance(5000);
    expect(list).not.toHaveBeenCalled();

    act(() => setVisibility("visible"));
    expect(list).toHaveBeenCalledTimes(1);
    expect(list.mock.calls[0][0]).toEqual({ minLng: 21, minLat: 40, maxLng: 30, maxLat: 50 });
    await advance(250);
    expect(list).toHaveBeenCalledTimes(1);
  });

  it.each([100, 1000])("cancels debounce when hidden for %i ms and refreshes once on restore", async (hiddenMs) => {
    const { api, list } = fakeApi();
    list.mockImplementation(() => ok([A]));
    const { result } = renderPins(api);
    act(() => result.current.setViewport(SINGLE));
    await flush();
    act(() => result.current.setViewport({ ...SINGLE, west: 21 }));
    act(() => setVisibility("hidden"));
    await advance(hiddenMs);
    expect(list).toHaveBeenCalledTimes(1);

    act(() => setVisibility("visible"));
    expect(list).toHaveBeenCalledTimes(2);
    await advance(250);
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("insertRoom merges by id, keeps newest-first order and leaves truncated alone", async () => {
    const { api, list } = fakeApi();
    list.mockImplementationOnce(() => ok([A], true));
    const { result } = renderPins(api);
    act(() => result.current.setViewport(SINGLE));
    await flush();

    act(() => result.current.insertRoom(B));
    expect(result.current.rooms).toEqual([B, A]);

    const renamed = { ...A, name: "renamed" };
    act(() => result.current.insertRoom(renamed));
    expect(result.current.rooms).toEqual([B, renamed]);
    expect(result.current.truncated).toBe(true);
    expect(list).toHaveBeenCalledTimes(1);
  });

  it("cancels the pending debounce and ignores in-flight responses after unmount", async () => {
    const { api, list } = fakeApi();
    const inFlight = deferred<ListResult>();
    list.mockReturnValueOnce(inFlight.promise).mockImplementation(() => ok([A]));
    const { result, unmount } = renderPins(api);
    act(() => result.current.setViewport(SINGLE));
    act(() => result.current.setViewport({ ...SINGLE, east: 31 }));

    unmount();
    inFlight.resolve({ rooms: [A], truncated: false });
    await flush();
    await advance(1000);

    expect(list).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm test src/lib/map/useRoomPins.test.ts`
Expected: FAIL, "Failed to resolve import "@/lib/map/useRoomPins"".

- [ ] **Step 4: Write the implementation**

Create `src/lib/map/useRoomPins.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from "react";

import { type Api, api as defaultApi } from "@/lib/api/client";
import { getClientConfig } from "@/lib/config/client";
import {
  mergeBoxResults,
  sortRoomsNewestFirst,
  toQueryBoxes,
  type Viewport,
} from "@/lib/map/viewport";
import type { Room } from "@/lib/schemas/types";

/** How long the map must be still before a viewport change fetches pins (spec §5.2). */
export const DEFAULT_DEBOUNCE_MS = 250;

/** `loading` only before the first result; background refreshes keep `ready` or `error`. */
export type PinsStatus = "idle" | "loading" | "ready" | "error";

export type RoomPins = {
  rooms: Room[];
  truncated: boolean;
  status: PinsStatus;
  /** Invalidates old results immediately; debounced except for the first visible viewport. */
  setViewport(viewport: Viewport): void;
  /** Explicit refresh; replaces pending work, no-op before a viewport or while hidden. */
  refresh(): void;
  /** Merge one room locally by id and re-sort; no request, `truncated` unchanged. */
  insertRoom(room: Room): void;
};

export type UseRoomPinsDeps = { api?: Api; intervalMs?: number; debounceMs?: number };

type PinsState = { rooms: Room[]; truncated: boolean; status: PinsStatus };
type RequestOwner = { generation: number; sequence: number };

const INITIAL: PinsState = { rooms: [], truncated: false, status: "idle" };

/**
 * Pins for the current viewport (spec §5.2, reconciliations 13–14).
 * Viewport generations invalidate results before debounce; request ownership
 * also guards explicit refreshes. Periodic ticks coalesce with an in-flight
 * request for the current generation and never bypass a pending debounce.
 * A failed box keeps previous pins. Hidden tabs start no new requests.
 */
export function useRoomPins(deps: UseRoomPinsDeps = {}): RoomPins {
  const roomsApi = deps.api ?? defaultApi;
  const intervalMs = deps.intervalMs ?? getClientConfig().pollIntervalMs;
  const debounceMs = deps.debounceMs ?? DEFAULT_DEBOUNCE_MS;

  const [state, setState] = useState<PinsState>(INITIAL);
  const viewportRef = useRef<Viewport | null>(null);
  const generationRef = useRef(0);
  const sequenceRef = useRef(0);
  const activeRef = useRef<RequestOwner | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearDebounce = useCallback(() => {
    if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    debounceRef.current = null;
  }, []);

  const runRefresh = useCallback(
    (explicit: boolean) => {
      if (explicit) clearDebounce();
      const viewport = viewportRef.current;
      if (viewport === null || document.visibilityState !== "visible") return;
      const generation = generationRef.current;
      if (!explicit && (debounceRef.current !== null || activeRef.current?.generation === generation)) {
        return;
      }

      const owner: RequestOwner = { generation, sequence: ++sequenceRef.current };
      activeRef.current = owner;
      const isCurrent = () =>
        owner.generation === generationRef.current &&
        owner.sequence === sequenceRef.current &&
        activeRef.current === owner;
      setState((s) => (s.status === "idle" ? { ...s, status: "loading" } : s));
      Promise.all(toQueryBoxes(viewport).map((box) => roomsApi.rooms.list(box))).then(
        (results) => {
          if (!isCurrent()) return;
          activeRef.current = null;
          setState({ ...mergeBoxResults(results), status: "ready" });
        },
        () => {
          if (!isCurrent()) return;
          activeRef.current = null;
          setState((s) => ({ ...s, status: "error" }));
        },
      );
    },
    [roomsApi, clearDebounce],
  );

  const refresh = useCallback(() => runRefresh(true), [runRefresh]);

  const setViewport = useCallback(
    (viewport: Viewport) => {
      const first = viewportRef.current === null;
      viewportRef.current = viewport;
      generationRef.current += 1;
      clearDebounce();
      if (document.visibilityState !== "visible") return;
      if (first) {
        refresh();
        return;
      }
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        refresh();
      }, debounceMs);
    },
    [refresh, debounceMs, clearDebounce],
  );

  const insertRoom = useCallback((room: Room) => {
    setState((s) => ({
      ...s,
      rooms: sortRoomsNewestFirst([room, ...s.rooms.filter((r) => r.id !== room.id)]),
    }));
  }, []);

  // Periodic refresh while visible (PRD 4). `refresh` is only ever called from
  // the timer or the event handler, never synchronously in the effect body.
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer === null) timer = setInterval(() => runRefresh(false), intervalMs);
    };
    const stop = () => {
      if (timer !== null) clearInterval(timer);
      timer = null;
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refresh();
        start();
      } else {
        stop();
        clearDebounce();
      }
    };
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [refresh, runRefresh, intervalMs, clearDebounce]);

  // On unmount: drop the pending debounce and make every in-flight response stale.
  useEffect(
    () => () => {
      clearDebounce();
      generationRef.current += 1;
      sequenceRef.current += 1;
      activeRef.current = null;
    },
    [clearDebounce],
  );

  return {
    rooms: state.rooms,
    truncated: state.truncated,
    status: state.status,
    setViewport,
    refresh,
    insertRoom,
  };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm test src/lib/map/useRoomPins.test.ts`
Expected: PASS, 21 tests, including obsolete results during debounce, slow periodic requests, ownership, and visibility transitions.

- [ ] **Step 6: Typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: both exit 0. If `react-hooks/set-state-in-effect` fires, a state setter is being called synchronously inside an effect body; move that call into a callback or timer as the code above does.

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-lock.yaml src/lib/map/useRoomPins.ts src/lib/map/useRoomPins.test.ts
git commit -m "feat(map): add useRoomPins with debounce, sequencing and visibility-aware refresh"
```

---

### Task 4: `PanelFrame` and `WelcomeCard`

**Files:**
- Create: `src/components/ui/card.tsx` (generated by shadcn)
- Create: `src/components/panel/PanelFrame.tsx`
- Create: `src/components/panel/WelcomeCard.tsx`
- Test: `src/components/panel/PanelFrame.test.tsx`

**Interfaces:**
- Consumes: `Button` from `@/components/ui/button` (variant `ghost`, size `icon-sm`); `Card*` from `@/components/ui/card`; `FaTimes` from `react-icons/fa`.
- Produces:
  - `type PanelFrameProps = { title: ReactNode; titleAdornment?: ReactNode; onClose?(): void; children: ReactNode; footer?: ReactNode }`
  - `PanelFrame(props: PanelFrameProps)`. The close button has `aria-label="Close"`. The body is `flex-1 min-h-0` and the child provides its own scroll container (chunks 9 and 10).
  - `WelcomeCard()`: title "Map Chat", body "Click on the map to start a chat", no close button.

- [ ] **Step 1: Add the shadcn card**

Run:

```bash
pnpm exec shadcn add card -y
```

Expected: `src/components/ui/card.tsx` created, exporting `Card`, `CardHeader`, `CardFooter`, `CardTitle`, `CardAction`, `CardDescription`, `CardContent`. Verify with `grep -c "export" src/components/ui/card.tsx` (1 export block) and `pnpm typecheck`.

- [ ] **Step 2: Write the failing tests**

Create `src/components/panel/PanelFrame.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PanelFrame } from "@/components/panel/PanelFrame";
import { WelcomeCard } from "@/components/panel/WelcomeCard";

afterEach(cleanup);

describe("PanelFrame", () => {
  it("renders the title, body and footer", () => {
    render(
      <PanelFrame title="Hello" footer={<span>footer here</span>}>
        <p>body here</p>
      </PanelFrame>,
    );

    expect(screen.getByText("Hello")).toBeTruthy();
    expect(screen.getByText("body here")).toBeTruthy();
    expect(screen.getByText("footer here")).toBeTruthy();
  });

  it("has no close button unless onClose is given", () => {
    render(
      <PanelFrame title="Hello">
        <p>body</p>
      </PanelFrame>,
    );

    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  });

  it("renders a close button that calls onClose", () => {
    const onClose = vi.fn();
    render(
      <PanelFrame title="Hello" onClose={onClose}>
        <p>body</p>
      </PanelFrame>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders the title adornment next to the title", () => {
    render(
      <PanelFrame title="Hello" titleAdornment={<span data-testid="adornment">i</span>}>
        <p>body</p>
      </PanelFrame>,
    );

    expect(screen.getByTestId("adornment")).toBeTruthy();
  });
});

describe("WelcomeCard", () => {
  it("greets without a close button", () => {
    render(<WelcomeCard />);

    expect(screen.getByText("Map Chat")).toBeTruthy();
    expect(screen.getByText("Click on the map to start a chat")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm test src/components/panel/PanelFrame.test.tsx`
Expected: FAIL, "Failed to resolve import "@/components/panel/PanelFrame"".

- [ ] **Step 4: Write the implementation**

Create `src/components/panel/PanelFrame.tsx`:

```tsx
import type { ReactNode } from "react";
import { FaTimes } from "react-icons/fa";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export type PanelFrameProps = {
  title: ReactNode;
  /** Chunk 10's info icon, rendered after the title. */
  titleAdornment?: ReactNode;
  /** When given, a close button renders at the right of the header. */
  onClose?(): void;
  /** The body: `flex-1 min-h-0`; the child provides its own scroll container. */
  children: ReactNode;
  /** Pinned to the bottom, never shrinks. */
  footer?: ReactNode;
};

/**
 * The chrome of the one floating panel (spec §8): a flex column capped by the
 * panel slot's max height. The slot is `flex flex-col`, so `min-h-0` on the
 * card lets it shrink to the slot and the body scrolls instead of the page.
 */
export function PanelFrame({ title, titleAdornment, onClose, children, footer }: PanelFrameProps) {
  return (
    <Card className="min-h-0 w-full">
      <CardHeader className="shrink-0">
        <CardTitle className="flex min-w-0 items-center gap-2">
          <span className="truncate">{title}</span>
          {titleAdornment}
        </CardTitle>
        {onClose ? (
          <CardAction>
            <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={onClose}>
              <FaTimes aria-hidden />
            </Button>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col">{children}</CardContent>
      {footer ? <CardFooter className="shrink-0">{footer}</CardFooter> : null}
    </Card>
  );
}
```

Create `src/components/panel/WelcomeCard.tsx`:

```tsx
import { PanelFrame } from "@/components/panel/PanelFrame";

/** Shown while nothing is selected (spec §3, PRD 3 Flow A step 1). */
export function WelcomeCard() {
  return (
    <PanelFrame title="Map Chat">
      <p className="text-muted-foreground">Click on the map to start a chat</p>
    </PanelFrame>
  );
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm test src/components/panel/PanelFrame.test.tsx`
Expected: PASS, 5 tests.

- [ ] **Step 6: Typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: both exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/components/ui/card.tsx src/components/panel/PanelFrame.tsx src/components/panel/WelcomeCard.tsx src/components/panel/PanelFrame.test.tsx
git commit -m "feat(panel): add PanelFrame on shadcn card and the welcome card"
```

---

### Task 5: Leaflet packages, pin icons, `RoomPins` and `DraftPin`

**Files:**
- Modify: `package.json`, `pnpm-lock.yaml` (`leaflet`, `react-leaflet`, dev `@types/leaflet`)
- Create: `src/components/map/mapDefaults.ts`
- Create: `src/components/map/pinIcon.ts`
- Create: `src/components/map/RoomPins.tsx`
- Create: `src/components/map/DraftPin.tsx`
- Test: `src/components/map/RoomPins.test.tsx`

**Interfaces:**
- Consumes: `divIcon`, `DivIcon` from `leaflet`; `Marker` from `react-leaflet`; `Room`.
- Produces:
  - `mapDefaults.ts`: `DEFAULT_CENTER: LatLng`, `WORLD_ZOOM = 2`, `ROOM_ZOOM = 16`, `MIN_ZOOM = 2`, `MAX_ZOOM = 19`
  - `pinIcon.ts`: `type PinVariant = "room" | "selected" | "draft"`, `pinSvg(variant): string`, `pinIcon(variant): DivIcon` (one shared instance per variant; `options.className` is `map-pin map-pin-<variant>`)
  - `RoomPins({ rooms: Room[]; selectedRoomId?: string; onPinClick(room: Room): void })`
  - `DraftPin({ lat: number; lng: number })`

- [ ] **Step 1: Install Leaflet**

Run:

```bash
pnpm add leaflet@^1.9.4 react-leaflet@^5.0.0
pnpm add -D @types/leaflet@^1.9.22
```

Expected: `dependencies` gain `leaflet` and `react-leaflet`; `devDependencies` gain `@types/leaflet`; no peer-dependency warnings for `react` or `leaflet`.

- [ ] **Step 2: Write the failing tests**

Create `src/components/map/RoomPins.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DraftPin } from "@/components/map/DraftPin";
import { RoomPins } from "@/components/map/RoomPins";
import type { Room } from "@/lib/schemas/types";

type FakeMarkerProps = {
  position: [number, number];
  icon: { options: { className?: string } };
  title?: string;
  interactive?: boolean;
  eventHandlers?: { click?: () => void };
};

// The real `leaflet` runs in jsdom, so `pinIcon` builds genuine DivIcons; only
// react-leaflet's Marker is replaced by a button that exposes its props.
vi.mock("react-leaflet", () => ({
  Marker: ({ position, icon, title, interactive, eventHandlers }: FakeMarkerProps) => (
    <button
      type="button"
      data-testid="marker"
      data-position={position.join(",")}
      data-icon={icon.options.className}
      data-interactive={String(interactive ?? true)}
      title={title}
      onClick={() => eventHandlers?.click?.()}
    />
  ),
}));

const roomA: Room = {
  id: "00000000-0000-4000-8000-00000000000a",
  name: "brave-crimson-otter",
  lat: 46.7712,
  lng: 23.6236,
  createdAt: "2026-09-16T15:00:00.000000Z",
};
const roomB: Room = { ...roomA, id: "00000000-0000-4000-8000-00000000000b", name: "calm-amber-heron", lat: 44.4268, lng: 26.1025 };

afterEach(cleanup);

describe("RoomPins", () => {
  it("renders one marker per room with its name as the native tooltip", () => {
    render(<RoomPins rooms={[roomA, roomB]} onPinClick={vi.fn()} />);

    const markers = screen.getAllByTestId("marker");
    expect(markers).toHaveLength(2);
    expect(markers[0].getAttribute("title")).toBe("brave-crimson-otter");
    expect(markers[0].getAttribute("data-position")).toBe("46.7712,23.6236");
    expect(markers[1].getAttribute("title")).toBe("calm-amber-heron");
  });

  it("gives the selected room the selected icon and the others the room icon", () => {
    render(<RoomPins rooms={[roomA, roomB]} selectedRoomId={roomB.id} onPinClick={vi.fn()} />);

    const [a, b] = screen.getAllByTestId("marker");
    expect(a.getAttribute("data-icon")).toBe("map-pin map-pin-room");
    expect(b.getAttribute("data-icon")).toBe("map-pin map-pin-selected");
  });

  it("calls onPinClick with the clicked room", () => {
    const onPinClick = vi.fn();
    render(<RoomPins rooms={[roomA, roomB]} onPinClick={onPinClick} />);

    fireEvent.click(screen.getAllByTestId("marker")[1]);

    expect(onPinClick).toHaveBeenCalledWith(roomB);
  });
});

describe("DraftPin", () => {
  it("renders a non-interactive marker with the draft icon", () => {
    render(<DraftPin lat={1.5} lng={2.5} />);

    const marker = screen.getByTestId("marker");
    expect(marker.getAttribute("data-position")).toBe("1.5,2.5");
    expect(marker.getAttribute("data-icon")).toBe("map-pin map-pin-draft");
    expect(marker.getAttribute("data-interactive")).toBe("false");
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm test src/components/map/RoomPins.test.tsx`
Expected: FAIL, "Failed to resolve import "@/components/map/DraftPin"".

- [ ] **Step 4: Write the implementation**

Create `src/components/map/mapDefaults.ts`:

```ts
import type { LatLng } from "@/lib/map/viewport";

/** Cluj-Napoca; the world view is centred here (spec §3). */
export const DEFAULT_CENTER: LatLng = { lat: 46.7712, lng: 23.6236 };
export const WORLD_ZOOM = 2;
/** Used by chunk 12 for `/room/<id>`. */
export const ROOM_ZOOM = 16;
/** OSM raster limits; zoom 2 shows the whole world. */
export const MIN_ZOOM = 2;
export const MAX_ZOOM = 19;
```

Create `src/components/map/pinIcon.ts`:

```ts
import { divIcon, type DivIcon } from "leaflet";

export type PinVariant = "room" | "selected" | "draft";

type PinSpec = { width: number; height: number; fill: string; opacity: number; dot: boolean };

const SPECS: Record<PinVariant, PinSpec> = {
  room: { width: 24, height: 36, fill: "#2563eb", opacity: 1, dot: true },
  selected: { width: 28, height: 42, fill: "#f59e0b", opacity: 1, dot: true },
  draft: { width: 24, height: 36, fill: "#6b7280", opacity: 0.7, dot: false },
};

/** Inline SVG for one pin: a classic marker drawn in a 24 × 36 box, scaled to the variant's size. */
export function pinSvg(variant: PinVariant): string {
  const { width, height, fill, opacity, dot } = SPECS[variant];
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 24 36" style="opacity:${opacity}">` +
    `<path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 24 12 24s12-15 12-24C24 5.4 18.6 0 12 0z" fill="${fill}" stroke="#ffffff" stroke-width="1.5"/>` +
    (dot ? `<circle cx="12" cy="12" r="4.5" fill="#ffffff"/>` : "") +
    `</svg>`
  );
}

const cache = new Map<PinVariant, DivIcon>();

/**
 * One shared `DivIcon` per variant, anchored at the tip. The class replaces
 * Leaflet's default `leaflet-div-icon`, so no white box is drawn, and it
 * carries no styles of its own. Using `divIcon` avoids Leaflet's broken
 * default PNG paths under bundlers (spec §4).
 */
export function pinIcon(variant: PinVariant): DivIcon {
  let icon = cache.get(variant);
  if (icon === undefined) {
    const { width, height } = SPECS[variant];
    icon = divIcon({
      html: pinSvg(variant),
      className: `map-pin map-pin-${variant}`,
      iconSize: [width, height],
      iconAnchor: [width / 2, height],
    });
    cache.set(variant, icon);
  }
  return icon;
}
```

Create `src/components/map/RoomPins.tsx`:

```tsx
"use client";

import { Marker } from "react-leaflet";

import { pinIcon } from "@/components/map/pinIcon";
import type { Room } from "@/lib/schemas/types";

export type RoomPinsProps = {
  rooms: Room[];
  selectedRoomId?: string;
  onPinClick(room: Room): void;
};

/**
 * One marker per room (spec §7). `title` gives the native tooltip; Leaflet
 * markers are keyboard focusable and Enter fires `click`. Marker clicks do
 * not bubble to the map, so they never place a draft pin.
 */
export function RoomPins({ rooms, selectedRoomId, onPinClick }: RoomPinsProps) {
  return (
    <>
      {rooms.map((room) => (
        <Marker
          key={room.id}
          position={[room.lat, room.lng]}
          icon={pinIcon(room.id === selectedRoomId ? "selected" : "room")}
          title={room.name}
          eventHandlers={{ click: () => onPinClick(room) }}
        />
      ))}
    </>
  );
}
```

Create `src/components/map/DraftPin.tsx`:

```tsx
"use client";

import { Marker } from "react-leaflet";

import { pinIcon } from "@/components/map/pinIcon";

export type DraftPinProps = { lat: number; lng: number };

/** The grey pin under a "New chatroom" draft. Not interactive: a click on it reaches the map and moves the draft (spec §7). */
export function DraftPin({ lat, lng }: DraftPinProps) {
  return <Marker position={[lat, lng]} icon={pinIcon("draft")} interactive={false} keyboard={false} />;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm test src/components/map/RoomPins.test.tsx`
Expected: PASS, 4 tests.

- [ ] **Step 6: Typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: both exit 0.

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-lock.yaml src/components/map/mapDefaults.ts src/components/map/pinIcon.ts src/components/map/RoomPins.tsx src/components/map/DraftPin.tsx src/components/map/RoomPins.test.tsx
git commit -m "feat(map): add Leaflet pin icons, RoomPins and DraftPin"
```

---

### Task 6: `MapEvents` and `MapView`

**Files:**
- Create: `src/components/map/MapEvents.tsx`
- Create: `src/components/map/MapView.tsx`
- Test: `src/components/map/MapEvents.test.tsx`

**Interfaces:**
- Consumes: `MapContainer`, `TileLayer`, `useMapEvents` from `react-leaflet`; `boundsToViewport`, `LatLng`, `Viewport` from Task 1; `MIN_ZOOM`, `MAX_ZOOM` from Task 5; `RoomPins`, `DraftPin` from Task 5; `Room`.
- Produces:
  - `const MAP_CLICK_DELAY_MS = 500`: the explicit map double-click arbitration window; slower clicks are separate actions.
  - `MapEvents({ onViewportChange(v: Viewport): void; onEmptyClick(p: LatLng): void })`: renders nothing; reports the viewport after mount and on every `moveend`; rejects invalid coordinates and delays single-click draft placement to suppress double-clicks within the arbitration window.
  - `MapView` (default export) with `type MapViewProps = { center: LatLng; zoom: number; rooms: Room[]; selectedRoomId?: string; draft?: LatLng; onViewportChange(v: Viewport): void; onEmptyClick(p: LatLng): void; onPinClick(room: Room): void }`.

The event tests use real Leaflet maps and DOM events without a tile layer (no tile network traffic). Only the react-leaflet context adapter is mocked. This covers interactions that the shell's fake map cannot exercise.

- [ ] **Step 1: Write the failing event tests**

Create `src/components/map/MapEvents.test.tsx`:

```tsx
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { map as createMap, type LeafletEventHandlerFnMap, type Map as LeafletMap } from "leaflet";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MAP_CLICK_DELAY_MS, MapEvents } from "@/components/map/MapEvents";
import { type Selection, selectionReducer } from "@/lib/page/selection";

const context = vi.hoisted(() => ({ map: null as LeafletMap | null }));
vi.mock("react-leaflet", async () => {
  const { useEffect } = await import("react");
  function useMap() {
    if (context.map === null) throw new Error("test map not ready");
    return context.map;
  }
  return {
    useMap,
    useMapEvents: (handlers: LeafletEventHandlerFnMap) => {
      const map = useMap();
      useEffect(() => {
        map.on(handlers);
        return () => { map.off(handlers); };
      }, [map, handlers]);
      return map;
    },
  };
});

let container: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers();
  container = document.createElement("div");
  document.body.append(container);
  Object.defineProperties(container, {
    clientWidth: { value: 1440 },
    clientHeight: { value: 900 },
  });
  context.map = createMap(container, {
    center: [46.7712, 23.6236], zoom: 2, minZoom: 2, maxZoom: 19,
    maxBounds: [[-90, -180], [90, 180]], maxBoundsViscosity: 1,
    worldCopyJump: false, doubleClickZoom: false,
    zoomAnimation: false, fadeAnimation: false,
  });
});
afterEach(() => {
  cleanup();
  context.map?.remove();
  context.map = null;
  container.remove();
  vi.useRealTimers();
});

function advance(ms: number) {
  act(() => { vi.advanceTimersByTime(ms); });
}
function click(detail = 1, clientX = 720) {
  fireEvent.click(container, { clientX, clientY: 450, detail });
}

describe("MapEvents", () => {
  it("reports the initial viewport and completed moves", () => {
    const onViewportChange = vi.fn();
    render(<MapEvents onViewportChange={onViewportChange} onEmptyClick={vi.fn()} />);
    expect(onViewportChange).toHaveBeenCalledTimes(1);
    act(() => { context.map?.fire("moveend"); });
    expect(onViewportChange).toHaveBeenCalledTimes(2);
  });

  it("emits a valid single click once after the arbitration window", () => {
    const onEmptyClick = vi.fn();
    render(<MapEvents onViewportChange={vi.fn()} onEmptyClick={onEmptyClick} />);
    click();
    advance(MAP_CLICK_DELAY_MS - 1);
    expect(onEmptyClick).not.toHaveBeenCalled();
    advance(1);
    expect(onEmptyClick).toHaveBeenCalledTimes(1);
    const point = onEmptyClick.mock.calls[0][0];
    expect(point.lat).toBeGreaterThanOrEqual(-90);
    expect(point.lat).toBeLessThanOrEqual(90);
    expect(point.lng).toBeGreaterThanOrEqual(-180);
    expect(point.lng).toBeLessThanOrEqual(180);
  });

  it("ignores a real Leaflet click on the blank world margin", () => {
    const onEmptyClick = vi.fn();
    render(<MapEvents onViewportChange={vi.fn()} onEmptyClick={onEmptyClick} />);
    expect(context.map?.containerPointToLatLng([10, 450]).lng).toBeLessThan(-180);
    click(1, 10);
    advance(MAP_CLICK_DELAY_MS);
    expect(onEmptyClick).not.toHaveBeenCalled();
  });

  const states: Selection[] = [
    { kind: "none" },
    { kind: "room", room: {
      id: "00000000-0000-4000-8000-00000000000a", name: "brave-crimson-otter",
      lat: 46.7712, lng: 23.6236, createdAt: "2026-09-16T15:00:00.000000Z",
    } },
  ];
  it.each(states)("a double-click preserves the $kind selection without zooming", (initial) => {
    let selection = initial;
    const onEmptyClick = vi.fn((point: { lat: number; lng: number }) => {
      selection = selectionReducer(selection, { type: "clickEmpty", ...point });
    });
    render(<MapEvents onViewportChange={vi.fn()} onEmptyClick={onEmptyClick} />);
    click(1);
    advance(250);
    click(2);
    fireEvent.doubleClick(container, { clientX: 720, clientY: 450, detail: 2 });
    advance(MAP_CLICK_DELAY_MS);
    expect(onEmptyClick).not.toHaveBeenCalled();
    expect(selection).toBe(initial);
    expect(context.map?.getZoom()).toBe(2);
  });

  it("cancels draft placement when map movement starts", () => {
    const onEmptyClick = vi.fn();
    render(<MapEvents onViewportChange={vi.fn()} onEmptyClick={onEmptyClick} />);
    click();
    act(() => { context.map?.fire("movestart"); });
    advance(MAP_CLICK_DELAY_MS);
    expect(onEmptyClick).not.toHaveBeenCalled();
  });

  it.each(["pointerdown", "keydown"])("cancels pending placement on a later %s interaction", (type) => {
    const onEmptyClick = vi.fn();
    render(<MapEvents onViewportChange={vi.fn()} onEmptyClick={onEmptyClick} />);
    click();
    fireEvent(document.body, new Event(type, { bubbles: true }));
    advance(MAP_CLICK_DELAY_MS);
    expect(onEmptyClick).not.toHaveBeenCalled();
  });

  it("clears pending draft placement on unmount", () => {
    const onEmptyClick = vi.fn();
    const { unmount } = render(<MapEvents onViewportChange={vi.fn()} onEmptyClick={onEmptyClick} />);
    click();
    unmount();
    advance(MAP_CLICK_DELAY_MS);
    expect(onEmptyClick).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test src/components/map/MapEvents.test.tsx`
Expected: FAIL, missing `@/components/map/MapEvents`.

- [ ] **Step 3: Write `MapEvents`**

Create `src/components/map/MapEvents.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useRef } from "react";
import { useMap, useMapEvents } from "react-leaflet";

import { boundsToViewport, type LatLng, type Viewport } from "@/lib/map/viewport";

export type MapEventsProps = {
  /** Once after mount, then after every completed pan, zoom or inertia glide. */
  onViewportChange(viewport: Viewport): void;
  /** A valid single map click, after the double-click arbitration window. */
  onEmptyClick(point: LatLng): void;
};

/** Application click arbitration window; not a claim about the OS double-click setting. */
export const MAP_CLICK_DELAY_MS = 500;

/** Bridges map events and cancels pending draft placement on competing interactions. */
export function MapEvents({ onViewportChange, onEmptyClick }: MapEventsProps) {
  const map = useMap();
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelClick = useCallback(() => {
    if (clickTimer.current !== null) clearTimeout(clickTimer.current);
    clickTimer.current = null;
  }, []);
  useMapEvents({
    moveend: () => onViewportChange(boundsToViewport(map.getBounds())),
    movestart: cancelClick,
    dblclick: cancelClick,
    click: (event) => {
      cancelClick();
      const { lat, lng } = event.latlng;
      // maxBounds limits panning, not every pixel in a wide container.
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) return;
      if (event.originalEvent.detail > 1) return;
      clickTimer.current = setTimeout(() => {
        clickTimer.current = null;
        onEmptyClick({ lat, lng });
      }, MAP_CLICK_DELAY_MS);
    },
  });

  // A later marker/panel interaction must not be overwritten by the delayed
  // map click. Capture phase also cancels before a second map click arrives.
  useEffect(() => {
    document.addEventListener("pointerdown", cancelClick, true);
    document.addEventListener("keydown", cancelClick, true);
    return () => {
      document.removeEventListener("pointerdown", cancelClick, true);
      document.removeEventListener("keydown", cancelClick, true);
      cancelClick();
    };
  }, [cancelClick, onEmptyClick]);

  // The initial report runs once per map instance. A ref holds the latest
  // callback so a new prop identity does not repeat the initial report.
  const latestViewportChange = useRef(onViewportChange);
  useEffect(() => {
    latestViewportChange.current = onViewportChange;
  }, [onViewportChange]);
  useEffect(() => {
    latestViewportChange.current(boundsToViewport(map.getBounds()));
  }, [map]);

  return null;
}
```

- [ ] **Step 4: Run the event tests**

Run: `pnpm test src/components/map/MapEvents.test.tsx`
Expected: PASS, 9 tests. Real Leaflet handles the DOM click sequence; no tiles are requested.

- [ ] **Step 5: Write `MapView`**

Create `src/components/map/MapView.tsx`:

```tsx
"use client";

import "leaflet/dist/leaflet.css";

import { MapContainer, TileLayer } from "react-leaflet";

import { DraftPin } from "@/components/map/DraftPin";
import { MapEvents } from "@/components/map/MapEvents";
import { MAX_ZOOM, MIN_ZOOM } from "@/components/map/mapDefaults";
import { RoomPins } from "@/components/map/RoomPins";
import type { LatLng, Viewport } from "@/lib/map/viewport";
import type { Room } from "@/lib/schemas/types";

export type MapViewProps = {
  center: LatLng;
  zoom: number;
  /** Pins to draw; already includes the selected room. */
  rooms: Room[];
  selectedRoomId?: string;
  draft?: LatLng;
  /** Once after mount, then on every `moveend`. */
  onViewportChange(viewport: Viewport): void;
  /** Map click not consumed by a marker. */
  onEmptyClick(point: LatLng): void;
  onPinClick(room: Room): void;
};

/** One world copy; pins never need wrapping (spec §4). */
const WORLD_BOUNDS: [[number, number], [number, number]] = [
  [-90, -180],
  [90, 180],
];
const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/**
 * The Leaflet map: data in through props, three events out, no application
 * state (spec §2). Loaded by `MapShell` with `next/dynamic` and `ssr: false`,
 * which is why this module owns the Leaflet CSS import. `center` and `zoom`
 * are the initial view only; the user moves the map afterwards.
 */
export default function MapView({
  center,
  zoom,
  rooms,
  selectedRoomId,
  draft,
  onViewportChange,
  onEmptyClick,
  onPinClick,
}: MapViewProps) {
  return (
    <MapContainer
      center={[center.lat, center.lng]}
      zoom={zoom}
      minZoom={MIN_ZOOM}
      maxZoom={MAX_ZOOM}
      maxBounds={WORLD_BOUNDS}
      maxBoundsViscosity={1}
      // This disables zoom only. MapEvents arbitrates click/double-click draft placement.
      doubleClickZoom={false}
      worldCopyJump={false}
      className="h-full w-full"
    >
      <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} noWrap maxZoom={MAX_ZOOM} />
      <MapEvents onViewportChange={onViewportChange} onEmptyClick={onEmptyClick} />
      <RoomPins rooms={rooms} selectedRoomId={selectedRoomId} onPinClick={onPinClick} />
      {draft ? <DraftPin lat={draft.lat} lng={draft.lng} /> : null}
    </MapContainer>
  );
}
```

- [ ] **Step 6: Typecheck, lint and run the whole suite**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: all exit 0; every test still passes. If `tsc` rejects a `MapContainer` or `TileLayer` prop name, check `node_modules/react-leaflet/lib/MapContainer.d.ts` and `node_modules/@types/leaflet/index.d.ts` (`MapOptions`, `TileLayerOptions`); every option above is a Leaflet 1.9 option and react-leaflet 5 forwards them.

- [ ] **Step 7: Commit**

```bash
git add src/components/map/MapEvents.tsx src/components/map/MapEvents.test.tsx src/components/map/MapView.tsx
git commit -m "feat(map): add MapView with OSM tiles and MapEvents bridge"
```

---

### Task 7: `MapStatus`, `MapShell` and the home page

**Files:**
- Create: `src/components/map/MapStatus.tsx`
- Create: `src/components/map/MapShell.tsx`
- Modify: `src/app/page.tsx` (replace the scaffold page)
- Test: `src/components/map/MapShell.test.tsx`

**Interfaces:**
- Consumes: `dynamic` from `next/dynamic`; `MapViewProps` (type) from Task 6; `PanelFrame`, `WelcomeCard` from Task 4; `useRoomPins`, `RoomPins` type from Task 3; `selectionReducer`, `Selection` from Task 2; `LatLng` from Task 1; `DEFAULT_CENTER`, `WORLD_ZOOM` from Task 5; `Room`.
- Produces:
  - `MapStatus({ truncated: boolean; refreshFailed: boolean })`: `role="status"` pill or `null`.
  - `pinsToRender(rooms: Room[], selection: Selection): Room[]`
  - `type MapShellProps = { initialSelection: Selection; initialCenter: LatLng; initialZoom: number }`
  - `MapShell(props: MapShellProps)`. Chunk 10 will add `roomCreated` + `pins.insertRoom` and `movedToExisting`; chunk 9 replaces the room placeholder; chunk 12 renders `MapShell` from `/room/[id]` with a `room` selection.

- [ ] **Step 1: Write the failing tests**

Create `src/components/map/MapShell.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MapShell, pinsToRender } from "@/components/map/MapShell";
import type { MapViewProps } from "@/components/map/MapView";
import type { RoomPins } from "@/lib/map/useRoomPins";
import type { Selection } from "@/lib/page/selection";
import type { Room } from "@/lib/schemas/types";

const fakePins = vi.hoisted(() => ({ current: null as RoomPins | null }));

vi.mock("@/lib/map/useRoomPins", () => ({
  useRoomPins: () => {
    if (fakePins.current === null) throw new Error("test did not set fakePins");
    return fakePins.current;
  },
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

  it("shows the room placeholder and marks the pin selected after a pin click", () => {
    renderShell(pinsWith({ rooms: [roomA, roomB] }));

    fireEvent.click(screen.getByRole("button", { name: roomB.name }));

    expect(screen.getByText("Room panel arrives in chunk 9.")).toBeTruthy();
    expect(screen.getAllByText(roomB.name)).toHaveLength(2); // pin and panel title
    expect(screen.getByRole("button", { name: roomB.name }).getAttribute("data-selected")).toBe("true");
    expect(screen.getByRole("button", { name: roomA.name }).getAttribute("data-selected")).toBe("false");
    expect(screen.queryByTestId("draft")).toBeNull();
  });

  it("returns to the greeting after close", () => {
    renderShell(pinsWith({ rooms: [roomA] }));
    fireEvent.click(screen.getByRole("button", { name: roomA.name }));

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(greeting()).toBeTruthy();
    expect(closeButton()).toBeNull();
  });

  it("replaces an open room with the new-room form on an empty click", () => {
    renderShell(pinsWith({ rooms: [roomA] }));
    fireEvent.click(screen.getByRole("button", { name: roomA.name }));

    fireEvent.click(screen.getByTestId("empty"));

    expect(screen.getByText("New chatroom")).toBeTruthy();
    expect(screen.queryByText("Room panel arrives in chunk 9.")).toBeNull();
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
Expected: FAIL, "Failed to resolve import "@/components/map/MapShell"".

- [ ] **Step 3: Write `MapStatus`**

Create `src/components/map/MapStatus.tsx`:

```tsx
export type MapStatusProps = {
  truncated: boolean;
  refreshFailed: boolean;
};

/** Top-centre pill (spec §3): truncation wins over a failed refresh; nothing when neither applies. */
export function MapStatus({ truncated, refreshFailed }: MapStatusProps) {
  const text = truncated
    ? "Zoom in to see more rooms"
    : refreshFailed
      ? "Couldn't refresh rooms"
      : null;
  if (text === null) return null;
  return (
    <div
      role="status"
      className="absolute top-4 left-1/2 z-10 -translate-x-1/2 rounded-full bg-background/90 px-3 py-1 text-sm shadow-sm ring-1 ring-foreground/10"
    >
      {text}
    </div>
  );
}
```

- [ ] **Step 4: Write `MapShell`**

Create `src/components/map/MapShell.tsx`:

```tsx
"use client";

import dynamic from "next/dynamic";
import { useCallback, useMemo, useReducer } from "react";

import { MapStatus } from "@/components/map/MapStatus";
import type { MapViewProps } from "@/components/map/MapView";
import { PanelFrame } from "@/components/panel/PanelFrame";
import { WelcomeCard } from "@/components/panel/WelcomeCard";
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
      <div className="absolute top-4 right-4 z-10 flex max-h-[calc(100dvh-2rem)] w-96 flex-col">
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
          // Keyed by room id so selecting another room remounts the panel (chunk 9's feed hook resets).
          <PanelFrame key={selection.room.id} title={selection.room.name} onClose={close}>
            <p className="text-muted-foreground">Room panel arrives in chunk 9.</p>
          </PanelFrame>
        ) : null}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Replace the home page**

Replace the whole content of `src/app/page.tsx` with:

```tsx
import { DEFAULT_CENTER, WORLD_ZOOM } from "@/components/map/mapDefaults";
import { MapShell } from "@/components/map/MapShell";

export default function Home() {
  return (
    <MapShell
      initialSelection={{ kind: "none" }}
      initialCenter={DEFAULT_CENTER}
      initialZoom={WORLD_ZOOM}
    />
  );
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm test src/components/map/MapShell.test.tsx`
Expected: PASS, 13 tests.

- [ ] **Step 7: Typecheck, lint, full suite and a production build**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all exit 0. The build proves `next/dynamic` with `ssr: false` is accepted (the importer is a client component) and that the Leaflet CSS import bundles. `pnpm build` needs the `NEXT_PUBLIC_*` variables in `.env.local` (`pnpm db:env` writes them from the running stack).

- [ ] **Step 8: Commit**

```bash
git add src/components/map/MapStatus.tsx src/components/map/MapShell.tsx src/components/map/MapShell.test.tsx src/app/page.tsx
git commit -m "feat(map): add MapShell, status pill and replace the home page"
```

---

### Task 8: Dev seed, README and manual verification

**Files:**
- Create: `supabase/seed.sql`
- Modify: `README.md` (add a "Map" section after "Shared domain layer"; extend the "Database" command table)

**Interfaces:**
- Consumes: `public.chatrooms(id, name, lat, lng, created_at)` and `public.messages(chatroom_id, author, text, created_at)` from the chunk 2 migrations; `[db.seed]` in `supabase/config.toml`.
- Produces: a database with 608 rooms, each with at least one message, after `pnpm db:reset`.

- [ ] **Step 1: Write the seed**

Create `supabase/seed.sql`:

```sql
-- Development data, loaded by `pnpm db:reset` (supabase/config.toml, [db.seed]).
-- Local only: the reset command never runs against a hosted project.
-- Room ids are fixed so messages can reference them. Repeat via `pnpm db:reset`,
-- which recreates the tables; this SQL is not idempotent on populated tables.
-- Every room has at least one message, as the create flow guarantees (PRD 6.3).

insert into public.chatrooms (id, name, lat, lng, created_at) values
  ('00000000-0000-4000-8000-000000000001', 'brave-crimson-otter',  46.771200,  23.623600, now() - interval '5 days'),   -- Cluj-Napoca, Piața Unirii
  ('00000000-0000-4000-8000-000000000002', 'calm-amber-heron',     46.769500,  23.589700, now() - interval '4 days'),   -- Cluj-Napoca, Central Park
  ('00000000-0000-4000-8000-000000000003', 'quiet-teal-badger',    46.780100,  23.601200, now() - interval '3 days'),   -- Cluj-Napoca, Cetățuia
  ('00000000-0000-4000-8000-000000000004', 'witty-violet-lynx',    44.426800,  26.102500, now() - interval '2 days'),   -- Bucharest
  ('00000000-0000-4000-8000-000000000005', 'sunny-coral-puffin',   47.497900,  19.040200, now() - interval '1 day'),    -- Budapest
  ('00000000-0000-4000-8000-000000000006', 'eager-golden-kiwi',   -16.578400, 179.900000, now() - interval '12 hours'), -- Fiji, east of the antimeridian
  ('00000000-0000-4000-8000-000000000007', 'gentle-silver-seal',  -16.600000, -179.900000, now() - interval '6 hours'), -- Fiji, west of the antimeridian
  ('00000000-0000-4000-8000-000000000008', 'bold-ivory-condor',    40.712800, -74.006000, now() - interval '1 hour');   -- New York

insert into public.messages (chatroom_id, author, text, created_at) values
  ('00000000-0000-4000-8000-000000000001', 'ana',    'Anyone around Piața Unirii tonight?',      now() - interval '5 days'),
  ('00000000-0000-4000-8000-000000000001', 'mihai',  'Yes, near the fountain.',                  now() - interval '5 days' + interval '3 minutes'),
  ('00000000-0000-4000-8000-000000000001', 'ana',    'See you there 👋',                          now() - interval '5 days' + interval '4 minutes'),
  ('00000000-0000-4000-8000-000000000002', 'radu',   'The park is great for a run this morning.', now() - interval '4 days'),
  ('00000000-0000-4000-8000-000000000003', 'ioana',  'Best view of the city from up here.',      now() - interval '3 days'),
  ('00000000-0000-4000-8000-000000000004', 'andrei', 'Coffee recommendations near Universitate?', now() - interval '2 days'),
  ('00000000-0000-4000-8000-000000000005', 'zsófia', 'Thermal baths open late today.',           now() - interval '1 day'),
  ('00000000-0000-4000-8000-000000000006', 'sione',  'First room east of the date line!',        now() - interval '12 hours'),
  ('00000000-0000-4000-8000-000000000007', 'mere',   'And the first one west of it.',            now() - interval '6 hours'),
  ('00000000-0000-4000-8000-000000000008', 'sam',    'Hello from downtown.',                     now() - interval '1 hour');

-- 600 rooms in a 30 × 20 grid, about 110 m apart, south of Bucharest, so the
-- 500-pin cap and the "Zoom in to see more rooms" pill can be seen locally
-- (PRD 4). Coordinates are computed in numeric so they are exact to 6 decimals.
with grid as (
  select
    gx,
    gy,
    ('00000000-0000-4000-8000-' || lpad(to_hex(1000 + gx * 100 + gy), 12, '0'))::uuid as id
  from generate_series(0, 29) as gx, generate_series(0, 19) as gy
),
grid_rooms as (
  insert into public.chatrooms (id, name, lat, lng, created_at)
  select
    id,
    format('grid-%s-%s', gx, gy),
    (44.300 + gy * 0.001)::double precision,
    (26.000 + gx * 0.001)::double precision,
    now() - (gx * 20 + gy) * interval '1 minute'
  from grid
  returning id, created_at
)
insert into public.messages (chatroom_id, author, text, created_at)
select id, 'seed', 'Hello from the grid.', created_at
from grid_rooms;
```

- [ ] **Step 2: Load it and check the counts**

Run (the Supbuddy-managed stack must be running):

```bash
pnpm db:reset
psql "$(supabase status -o env | sed -n 's/^DB_URL="\(.*\)"$/\1/p')" -c "select (select count(*) from public.chatrooms) as rooms, (select count(*) from public.messages) as messages, (select count(*) from public.chatrooms where lat between 44.3 and 44.32 and lng between 26.0 and 26.03) as grid;"
```

Expected: `pnpm db:reset` ends with "Seeding data from seed.sql..." and no error; the query prints `rooms = 608`, `messages = 610`, `grid = 600`. If `psql` is not installed, run the same query with the Supabase MCP `execute_sql` tool or Supabase Studio.

- [ ] **Step 3: Document the map in the README**

In `README.md`, insert this section directly after the "Shared domain layer" section (before "## Tests"):

```markdown
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
```

In the "Database" command table, change the `pnpm db:reset` row to:

```markdown
| `pnpm db:reset`   | Drops and rebuilds the local database from all migrations, then loads `supabase/seed.sql` |
```

and add this sentence after the table's paragraph about `pnpm test:db` truncating tables:

```markdown
Run `pnpm db:reset` again to get the seed data back. The seed is repeatable through this reset;
its inserts are not idempotent against an already populated database.
```

- [ ] **Step 4: Manual verification in the browser**

Run `pnpm dev` and open the app at the Supbuddy origin (`https://map-chat.map-chat.test`, see `next.config.ts` `allowedDevOrigins`; `pnpm db:env` writes `.env.local` if it is missing). Check each item:

1. The map fills the window at zoom 2 with the greeting card top-right reading "Map Chat" / "Click on the map to start a chat". The status pill reads "Zoom in to see more rooms" (608 rooms are in view).
2. Zoom into Cluj-Napoca: three pins appear, the pill disappears; hovering a pin shows its name.
3. Pan and zoom repeatedly: viewport-triggered requests start 250 ms after the last `moveend` (one request per non-crossing viewport, two only when the raw bounds require splitting). The periodic timer can independently refresh its last reported viewport; it must not bypass a pending debounce. Throttle an old request, move elsewhere, and let the old response finish during that debounce: it must not change pins, truncation or failure status.
4. Click an empty spot and wait 500 ms: a grey draft pin appears and the panel reads "New chatroom" with the coordinates to six decimals; another single click moves it after the same delay; the close button restores the greeting. At zoom 2 in a window wider than 1024 px, clicking a blank horizontal world margin must leave selection unchanged.
5. Click a pin: it turns amber and larger, the panel title is the room name; clicking another pin swaps the panel; clicking an empty spot replaces it with "New chatroom".
6. From both the greeting and an open room, double-click an empty spot within the 500 ms arbitration window: no zoom, no draft, and the prior selection stays. A later marker click, panel interaction, or map movement before a pending single-click timer expires cancels that pending draft. Clicks farther apart are separate actions; the app does not detect the OS's configured double-click interval.
7. Visit Fiji's eastern seed at (-16.5784, 179.9), then separately its western seed at (-16.6, -179.9), using a local zoom such as 9. Each pin appears and is selectable on its own side of the world. Do not expect an adjacent pair across the date line with `maxBounds`/`noWrap`; Tasks 1 and 3 cover splitting and merging synthetic crossing viewports. Small bounds overshoot may cause a second query without bringing the opposite Fiji pin into view.
8. Wait 30 s with the tab visible: a new `GET /api/rooms` fires if no current-viewport refresh is pending. Throttle a response beyond that interval: ticks must not keep replacing it, and it must publish when it completes. Change the viewport and hide the tab before its 250 ms debounce expires: no new requests start while hidden. Come back: exactly one immediate refresh uses the latest viewport, with no leftover debounce request 250 ms later. Requests already started before hiding may finish.
9. In DevTools set the network to Offline and wait for the next tick (or pan): pins stay, the pill reads "Couldn't refresh rooms". Go back online and pan: the pill disappears.
10. Zoom into the grid south of Bucharest (lat 44.31, lng 26.015) until fewer than 500 rooms are in view: the pill disappears.

Fix anything that fails before committing; the fix belongs in the task whose file is wrong.

- [ ] **Step 5: Full suite**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add supabase/seed.sql README.md
git commit -m "chore(db): add dev seed and document the map shell"
```

---

## Self-review

**Spec coverage.**

| Spec section | Task |
| --- | --- |
| §1 scope decisions (periodic refresh, truncation notice, obsolete-response guard, selected pin visible, `insertRoom`, `MapShell` props, whole `Room` in selection, refresh failure indicator, `seed.sql`) | 3, 7, 2, 8 |
| §3 page shell, layout classes, three panel states, `MapStatus` precedence, siblings of the Leaflet container | 7 |
| §3 `mapDefaults.ts` constants | 5 |
| §4 packages, dynamic import with `loading`, props, map options, tile layer, events, `divIcon` variants; reconciliations 15–16 correct click/bounds assumptions | 5, 6, 7 |
| §5.1 `PIN_LIMIT`, `toQueryBoxes` steps 1–5, `mergeBoxResults` | 1 |
| §5.2 `useRoomPins` debounce, generations/request ownership, slow-request coalescing, failure, visibility timer/debounce cleanup, `insertRoom`, unmount (reconciliations 13–14) | 3 |
| §5.3 `pinsToRender` | 7 |
| §6 selection types, transition table, `MapShell` wiring | 2, 7 |
| §7 `RoomPins`, `DraftPin`, draft only while `kind === "draft"`, no auto-pan | 5, 7 |
| §8 `PanelFrame` props and layout, `WelcomeCard`; message-list rules are a contract for chunk 9 (no code here) | 4 |
| §9 error handling table (box failure, superseded refresh) | 3, 7; tiles and bundle failure are accepted as out of scope |
| §10 unit tests (`viewport`, `selection`, `useRoomPins`), component tests (`RoomPins`, `MapShell`), real-Leaflet event tests (`MapEvents`), manual checks | 1, 2, 3, 5, 6, 7, 8 |
| §11 file list and packages | all; `MapEvents.tsx` in 6, `card.tsx` in 4 |

**Placeholder scan.** No "TBD", "add error handling", "similar to Task N" or code-free code steps. Every function referenced is defined in the task that first uses it or in an earlier one.

**Type consistency.** `Viewport`, `LatLng`, `BoundsLike` (Task 1) are used with the same names in Tasks 3, 6, 7. `RoomPins` type (Task 3) is what Task 7's test fakes. `pinIcon` class strings (`map-pin map-pin-<variant>`) match between Task 5's implementation and test. `MapViewProps` (Task 6) is imported as a type by Task 7's shell and test. `Selection` (Task 2) is `MapShell`'s `initialSelection` and `pinsToRender`'s argument. The status-pill strings in Task 7's `MapStatus` match its test and the README in Task 8.
