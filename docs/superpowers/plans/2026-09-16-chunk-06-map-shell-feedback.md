# Chunk 6: Map Shell and Map View — Plan Review

Plan: [2026-09-16-chunk-06-map-shell.md](2026-09-16-chunk-06-map-shell.md)

## Approval follow-up — 2026-09-17

All seven findings were accepted by the user and are now **Implemented in plan**. Tasks 3 and 6 include revised implementations and executable regression tests; Task 8, the README instructions, and the specification reconciliations now agree with those changes. Product implementation remains a separate step.

Choices applied: periodic ticks coalesce with pending work; explicit refreshes still supersede requests. Viewport changes invalidate results before debounce. Hidden tabs retain the latest viewport but start no requests. Map clicks reject invalid coordinates and use a documented 500 ms arbitration window for double-click suppression. The map retains one unwrapped world, and the seed remains repeatable via database reset rather than standalone idempotent inserts.

The prerequisite changed during this follow-up: `main` is now `784c2ee`, which merges chunk 4 and contains the required API/ordering modules. The plan's prerequisite note has been refreshed. The earlier missing-prerequisite observation below is historical.

Validation of the revised plan examples (temporary directory `/private/tmp/chunk06-plan-validation`):

- Extracted the viewport, selection, pin hook, and map-event source/test blocks into the temporary directory; used the plan's Testing Library/Leaflet dependencies and the repository's React-compatible toolchain. No implementation files or dependency manifests were changed in the project.
- `vitest run --config /private/tmp/chunk06-plan-validation/vitest.config.ts`: **4 files, 64 tests passed** (17 viewport, 17 selection, 21 hook, 9 real-Leaflet event tests).
- Regression check: substituting the original hook and event implementations made **17 of the 30 hook/event tests fail**. The original event implementation was given only the exported 500 ms constant needed by the new tests; its behavior was unchanged. Restoring the revised examples returned all 64 tests to passing.
- `tsc --noEmit -p /private/tmp/chunk06-plan-validation/tsconfig.json`: exit 0 for the extracted examples and their copied prerequisites.
- Repository `ESLint.lintText` and TypeScript syntax checks: **20 proposed TS/TSX blocks, zero diagnostics**.
- Task step numbering and the companion records were checked. These results validate plan examples only; no full application build, browser smoke test, or database reset was performed. Finding statuses therefore remain **Implemented in plan**, not **Verified**.

The original findings, reproduction results, and recommendations below are preserved. Their evidence line numbers refer to the pre-revision plan; each finding's implementation evidence points to the revised plan.

## Original review summary — 2026-09-17

Revise before execution: six Important findings and one optional Improvement. No additional Blocker finding. All decisions are pending; this review changes only this companion and the plan's feedback link.

The plan covers the intended modules, selection transitions, API handoff, panel states, selected-pin preservation, result merging, and client-only Leaflet loading. The principal gaps are refresh scheduling and real map events that the mocked component tests do not exercise. Two incorrect Leaflet assumptions are inherited from the design; the plan should explicitly reconcile them.

The declared prerequisite still applies: `main` is at `cc985c8` and does not contain `src/lib/api/client.ts`. The `chunk-04-rooms-api` branch contains the advertised API and ordering exports. This is already handled by the plan's prerequisite gate, rather than a new finding.

### Incomplete functionality and scope attribution

The current checkout does not yet contain the chunk 6 map components or hook. Findings below concern the plan's proposed implementation and acceptance checks, not defects observed in a completed application. Missing planned files alone are not findings.

| Aspect | Why it is incomplete | Effect on this review |
| --- | --- | --- |
| Live room-pin API integration | Chunk 4 must be merged before this plan runs (`2026-09-16-chunk-06-map-shell.md:39`). | An unmet prerequisite, already documented. Isolated hook probes use a fake API; end-to-end fetching remains unverified. |
| Creating rooms and handling coordinate conflicts | Chunk 10 replaces the new-room placeholder and wires `roomCreated`, `insertRoom`, and `movedToExisting` (`:1697`, `:2017`). | Intentionally incomplete here. The unused reducer actions and insertion hook are handoff interfaces, not missing chunk 6 functionality. |
| Room history, composing messages, and message-list scrolling | Chunk 9 replaces the room placeholder (`:2025`–`:2027`); chunk 6 supplies panel chrome and its layout contract (`:2239`). | Intentionally incomplete. The review does not establish that a populated room panel scrolls or sends correctly. |
| Realtime updates | Assigned to chunk 11 and explicitly out of scope (`:31`). | Its absence is not a chunk 6 defect. Map pin polling is separate and is required in this chunk. |
| Shared room URLs | Chunk 12 supplies the route using the shell's initial-selection props (`:1697`). | The shell prepares the interface; full shared-link navigation is not implemented or verified here. |
| Mobile layout, clustering, and auto-pan | Explicit exclusions (`:31`). | These are scope decisions, not unfinished implementation to flag against this plan. |

None of F-001 through F-007 is explained solely by an intentionally deferred feature:

- **F-001, F-003, F-006:** incomplete handling of timing/visibility cases inside the proposed chunk 6 hook. Later room-panel or realtime work does not resolve them automatically.
- **F-002:** invalid draft coordinates are reproducible in the proposed map event path now. The later room-creation rejection is an inferred integration consequence of the existing coordinate schema; it has not been observed through the unfinished creation UI. The defect belongs at the map's input boundary.
- **F-004, F-005:** incorrect assumptions or contradictory acceptance checks in the map plan/design. They are not consequences of the placeholder panel contents. F-005 does not require implementing world wrapping if the single-world scope is retained; the acceptance check can be corrected instead.
- **F-007:** an inaccurate claim about the proposed seed's repeatability, not a missing product feature.

### Review evidence and limits

- Read the complete plan and map-shell design, the relevant parent chunk requirements and chunk 3 viewport handoff, PRD and known limitations, current configuration and migrations, and chunk 4's API/ordering source.
- Checked the installed Next.js lazy-loading guide: the proposed client-component `next/dynamic` boundary is supported.
- Passed all 19 proposed TypeScript/TSX `Create` blocks through the repository's ESLint configuration using `ESLint.lintText`; no diagnostics. This does not establish typecheck, build, or product correctness.
- Ran `node /private/tmp/chunk06-review.cjs` against the extracted, unmodified `useRoomPins` and viewport snippets, installed React 19.2.8/jsdom 30.0.1, controlled timers, and Leaflet 1.9.4 downloaded into `/private/tmp`. This isolated review probe made no API calls or database changes. Results:
  - Old viewport A resolved after `setViewport(B)` but before B's debounce: A's rooms and `truncated: true` were published with `status: ready`.
  - Hiding with a pending debounce still started a second request while `visibilityState` was `hidden`.
  - Resolving each response after the next periodic tick produced four requests, three completed responses, zero rooms, and `status: loading`.
  - Dispatching the desktop `click`, `click`, `dblclick` sequence with `doubleClickZoom: false` produced two click callbacks and unchanged zoom.
  - At 1440 × 900, zoom 2, the map's left blank margin mapped to longitude `-249.60937500000003`.
  - Centering toward Fiji at zoom 9 yielded bounds approximately `[176.047668, 180.002747]`: the +179.9 room was inside, the -179.9 room was outside. The second query covered only `[-180, -179.997253]`, excluding the western seed.
- These are reproductions of defects in proposed snippets, not verification of fixes or of an implemented map. The full planned application suite/build and database reset were not run. The probe is temporary; the scenarios and observed results above are the durable evidence.

## F-001: Invalidate old responses when the viewport changes, before the debounce

- Severity: Important
- Finding: `setViewport` changes `viewportRef` but leaves the active sequence valid until the delayed `refresh` begins. A pending request for viewport A that succeeds or fails during the 250 ms delay after a move to B can still overwrite pins, truncation, or error state. These are responses for an obsolete viewport even though no newer HTTP request has started. The existing stale-response tests call `refresh()` directly and miss this interval.
- Evidence: `docs/superpowers/plans/2026-09-16-chunk-06-map-shell.md:965` increments the sequence only in `refresh`; `:982`–`:996` schedules the next refresh without invalidation. `docs/PRD.md:106`–`:107` requires ignoring obsolete-viewport responses; the chunk 3 viewport handoff requires publishing only results for the current viewport. The isolated probe published A's result after B was selected.
- Recommendation: Advance a viewport generation synchronously when accepting a changed viewport and require both viewport generation and request validity when publishing success or failure. Keep request debouncing separate. Add deferred-response tests where A resolves and rejects during B's debounce, before B's request begins; neither may change the displayed state.
- Decision: Accepted
- Implementation status: Implemented in plan
- Implementation evidence: `docs/superpowers/plans/2026-09-16-chunk-06-map-shell.md:75` defines immediate viewport invalidation; `:1142` advances the generation before scheduling; `:1115` guards publication; `:870` adds both success/failure regressions during debounce. These cases passed in the temporary example suite.
- History: Initially Pending / Not started / None yet. User approval changed the decision to Accepted; this follow-up changes the status to Implemented in plan. Original review evidence is retained above.

## F-002: Reject clicks outside the single rendered world

- Severity: Important
- Finding: `MapEvents` forwards raw click coordinates without validating them. At zoom 2, a desktop viewport wider than the 1024 px projected world necessarily includes blank margins even with `maxBounds`. Clicking there creates a draft with longitude outside [-180, 180], which later cannot pass the room-creation schema. Limiting map panning does not guarantee that every container pixel maps to a valid longitude.
- Evidence: `docs/superpowers/plans/2026-09-16-chunk-06-map-shell.md:1573` forwards `event.latlng` unchanged; `:1653`–`:1660` combines world bounds and `noWrap`. `src/lib/schemas/room.ts:18`–`:19` rejects out-of-range longitudes, as required by `docs/PRD.md:81`. The 1440 × 900 Leaflet probe returned longitude `-249.60937500000003` for a margin click. Leaflet's [map source](https://raw.githubusercontent.com/Leaflet/Leaflet/v1.9.4/src/map/Map.js) derives click coordinates from the container position.
- Recommendation: For the chosen single-world/no-wrap design, ignore clicks outside the rendered world's valid coordinate range before emitting `onEmptyClick`. Do not wrap a blank-margin click to an unrelated location. Add a real-Leaflet or browser check on a viewport wider than the projected world: margin clicks preserve selection, while clicks on the map produce valid draft coordinates.
- Decision: Accepted
- Implementation status: Implemented in plan
- Implementation evidence: `docs/superpowers/plans/2026-09-16-chunk-06-map-shell.md:1899` rejects invalid coordinates; `:1795` tests a real Leaflet blank-margin click; reconciliation `:77` and manual check `:2557` document the behavior. The isolated margin-click test passed; the downstream creation UI is still deferred.
- History: Initially Pending / Not started / None yet. User approval changed the decision to Accepted; this follow-up changes the status to Implemented in plan. Original review evidence is retained above.

## F-003: Periodic refreshes can permanently supersede every slow response

- Severity: Important
- Finding: The interval starts a new request and advances the sequence regardless of whether the same viewport already has an in-flight refresh. If requests consistently take longer than `intervalMs`, each response becomes stale before it finishes. The map can remain loading forever, or retain old pins forever, despite successful HTTP responses. The injected interval makes this easy to reproduce, and the production API has no timeout in its fetch wrapper.
- Evidence: `docs/superpowers/plans/2026-09-16-chunk-06-map-shell.md:965`–`:980` and `:1011`; the hook tests at `:835` use immediately resolved interval requests. PRD map refresh (`docs/PRD.md:106`) and the design's fetch lifecycle (`docs/superpowers/specs/2026-09-16-map-shell-design.md:207`–`:215`) require results to become visible. The probe completed three responses after successive ticks and remained at zero rooms/`loading`.
- Recommendation: Coalesce periodic refreshes while one is outstanding for the same viewport, or schedule the next periodic refresh after settlement. Allow a changed viewport to invalidate and replace old work promptly, with ownership checks so an old completion cannot unlock a newer request. Add a test with response latency greater than the interval and verify that successful current-viewport results are published without accumulating same-viewport requests.
- Decision: Accepted
- Implementation status: Implemented in plan
- Implementation evidence: `docs/superpowers/plans/2026-09-16-chunk-06-map-shell.md:1109` coalesces periodic work; `:1115` protects ownership; `:894` tests a slow successful refresh and `:912` tests obsolete completion ownership. The hook example tests passed, including new-viewport replacement and periodic/debounce coordination.
- History: Initially Pending / Not started / None yet. User approval changed the decision to Accepted; this follow-up changes the status to Implemented in plan. Original review evidence is retained above.

## F-004: Disabling double-click zoom does not prevent double-click draft placement

- Severity: Important
- Finding: The plan promises that a double-click does not place a draft, but `doubleClickZoom: false` only disables the zoom handler. Both preceding click events still invoke `onEmptyClick`. The manual acceptance check therefore fails, and a double-click can replace an existing room selection with a draft. The design contains the same mistaken rationale.
- Evidence: `docs/superpowers/plans/2026-09-16-chunk-06-map-shell.md:1573`, `:1655`–`:1656`, and manual check `:2202`; `docs/superpowers/specs/2026-09-16-map-shell-design.md:129`. The isolated Leaflet probe produced two click callbacks. Leaflet's [DoubleClickZoom handler](https://raw.githubusercontent.com/Leaflet/Leaflet/v1.9.4/src/map/handler/Map.DoubleClickZoom.js) controls the `dblclick` zoom listener; it does not suppress ordinary clicks.
- Recommendation: Explicitly reconcile the interaction contract. If the stated acceptance remains, defer single-click selection long enough to cancel it when a double-click is detected, clear pending work on teardown, and test the complete event sequence from both greeting and selected-room states. If ordinary draft placement on a double-click is intended, revise the rationale and acceptance check explicitly instead of claiming the zoom option prevents it.
- Decision: Accepted
- Implementation status: Implemented in plan
- Implementation evidence: `docs/superpowers/plans/2026-09-16-chunk-06-map-shell.md:77` defines the 500 ms application window and its OS-setting limitation; `:1881`–`:1920` implement delayed clicks and cancellation; `:1811` tests real DOM double-click sequences from greeting/room selections; `:2559` revises manual acceptance. Both selection cases and cancellation tests passed in the isolated example suite.
- History: Initially Pending / Not started / None yet. User approval changed the decision to Accepted; this follow-up changes the status to Implemented in plan. Original review evidence is retained above.

## F-005: The Fiji acceptance check conflicts with a single unwrapped world

- Severity: Important
- Finding: Manual verification expects the +179.9 and -179.9 Fiji pins to appear together in a local antimeridian view. The implementation constrains the map to one world and renders each marker at its canonical longitude. In that representation the pins lie near opposite map edges, almost a world-width apart. Splitting the query does not reposition the western marker into an eastern world copy. A small bounds overshoot can generate a second request, but it does not make the promised view possible.
- Evidence: `docs/superpowers/plans/2026-09-16-chunk-06-map-shell.md:1484` renders canonical marker coordinates; `:1653`–`:1660` constrains the world/tiles; manual check `:2203` requires both Fiji pins. The one-world decision is also explicit in `docs/superpowers/specs/2026-09-16-map-shell-design.md:128`–`:133`. At zoom 9 the probe included only the eastern seed, with the western seed outside both the viewport and its tiny wrapped query slice. Leaflet's [map source](https://raw.githubusercontent.com/Leaflet/Leaflet/v1.9.4/src/map/Map.js) applies bounds restrictions to the viewport center.
- Recommendation: Preserve the approved single-world behavior and rewrite the browser check to visit and select the two boundary rooms separately; keep antimeridian split/merge cases as adapter tests. If a continuous Fiji view is required instead, first reconcile the design and then plan world wrapping consistently for bounds, tiles, marker positions, and click coordinates. Do not leave an impossible manual gate for the implementer to fix ad hoc.
- Decision: Accepted
- Implementation status: Implemented in plan
- Implementation evidence: `docs/superpowers/plans/2026-09-16-chunk-06-map-shell.md:78` explicitly preserves single-world rendering; `:2560` replaces the impossible paired Fiji view with two separate boundary-room visits. Query splitting remains covered by the viewport/hook tests; the revised browser check is not yet performed.
- History: Initially Pending / Not started / None yet. User approval changed the decision to Accepted; this follow-up changes the status to Implemented in plan. Original review evidence is retained above.

## F-006: Hiding the tab leaves a scheduled viewport request active

- Severity: Important
- Finding: The visibility handler stops only the periodic interval. A pending viewport debounce still calls `refresh` while hidden because that function has no visibility guard. Restoring visibility before the debounce fires can also cause an immediate refresh followed by a duplicate debounce request. The visibility test waits until viewport work has settled, so neither transition is covered.
- Evidence: `docs/superpowers/plans/2026-09-16-chunk-06-map-shell.md:991`–`:994` and `:1017`–`:1023`; manual check `:2204` expects no requests while hidden. `docs/PRD.md:106` ties automatic map refresh to visibility. The probe started a second request after hiding with the debounce still pending.
- Recommendation: Coordinate the debounce and visibility lifecycle: cancel pending scheduled work on hide, retain the latest viewport, prevent automatic request starts while hidden, and consume/cancel pending debounce work when the foreground refresh runs. Add hide-before-debounce and restore-before-debounce tests, asserting zero hidden request starts and one foreground refresh. No cancellation of already-started requests is required by this finding.
- Decision: Accepted
- Implementation status: Implemented in plan
- Implementation evidence: `docs/superpowers/plans/2026-09-16-chunk-06-map-shell.md:1107` guards request starts by visibility; `:1175`–`:1182` coordinate foreground refresh and hidden debounce cleanup; `:960` and `:980` cover initially hidden/latest-view behavior and short/long hide intervals. The isolated visibility tests passed; manual acceptance is updated at `:2561`.
- History: Initially Pending / Not started / None yet. User approval changed the decision to Accepted; this follow-up changes the status to Implemented in plan. Original review evidence is retained above.

## F-007: The seed is reset-repeatable, not independently re-runnable

- Severity: Improvement
- Finding: Fixed room IDs do not make these unconditional inserts idempotent. Running the seed again against the same database fails on room primary-key/unique constraints, and message IDs are generated rather than fixed. The documented reset workflow still works because it recreates the tables first; the stronger re-runnable claim is misleading.
- Evidence: `docs/superpowers/plans/2026-09-16-chunk-06-map-shell.md:73` and `:2091` claim re-runnability; inserts beginning at `:2094`, `:2104`, and `:2127` have no conflict handling. `supabase/migrations/20260916000100_create_chatrooms.sql:8` defines the primary key. Supabase's [seed documentation](https://supabase.com/docs/guides/local-development/seeding-your-database) describes execution after migrations during reset.
- Recommendation: Describe the fixture as repeatable through `pnpm db:reset`, removing the claim that fixed IDs make the SQL itself re-runnable. Only add idempotent room/message insertion and a repeat-execution check if standalone re-execution is actually required.
- Decision: Accepted
- Implementation status: Implemented in plan
- Implementation evidence: `docs/superpowers/plans/2026-09-16-chunk-06-map-shell.md:73`, `:2440`, and `:2546` describe reset-based repeatability and explicitly exclude idempotent replay on populated tables. SQL behavior is unchanged; no seed or reset was executed.
- History: Initially Pending / Not started / None yet. User approval changed the decision to Accepted; this follow-up changes the status to Implemented in plan. Original review evidence is retained above.
