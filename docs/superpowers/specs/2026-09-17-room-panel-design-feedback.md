# Map Chat — Room panel design review feedback

**Spec:** [2026-09-17-room-panel-design.md](2026-09-17-room-panel-design.md)

## Current summary — approved revision, 2026-09-17

**Ready for implementation planning on the reviewed scope.** F-001–F-004 are Accepted and
Implemented in spec following the user's “approved” response. Unresolved findings: none.
No application implementation or behavioral verification is claimed.

The revision detects added IDs throughout the list, preserves a visible row through mixed
updates, and ties manual holds to request completion. It bounds the desktop composer and fixes
the e2e viewport and fixture coordinate region. The manual completion promise is mirrored in
the room-feed store/hook contract so the two specifications agree; reducer behavior is unchanged.
The existing APIs for own-send scrolling are also made commit-aware as part of the scroll
priority contract. Changes are confined to the room-panel spec, its companion, and this small
room-feed contract extension.

Revision validation: inspected the revised contracts, acceptance cases and feedback lifecycle
fields, and checked document whitespace. A fresh installed-Leaflet probe at 1280 × 720 checked
all four corners of lat [40, 50], lng [0, 10]: all are inside the opening bounds, with container
coordinates x = 640 or 668 and y = 346 or 387, safely away from viewport edges. These are
document and coordinate checks only. Browser layout, mixed-update behavior, completion-promise
lifecycle and the proposed end-to-end scenarios still require implementation and execution.

## Initial review — 2026-09-17 (preserved history)

**Revise before implementation planning: four Important findings, no Blockers.** Unresolved: F-001, F-002, F-003, F-004. All decisions are Pending and implementation statuses are Not started. Only this companion and the spec's metadata link were added; no proposed correction was implemented.

The seed handoff, readiness/error adapter, read-retry surfaces, and local-time contract align with the linked feed and compose requirements. The remaining risks concern scroll behavior when chronological merges do more than append, bounded composer layout, and deterministic discovery of test rooms.

Review scope: the complete room-panel spec; PRD flows, display/history/compose, client-state and testing requirements; Known limitations; room-feed design and its existing feedback; map-shell design; implementation-chunks global contracts and chunk 9; chunk 7's compose contract and downstream handoff; current API DTOs/client, feed types and merge transitions, ComposeForm/useDisplayName, textarea, PanelFrame, selection, and map shell/defaults. Deferred realtime implementation, mobile layout, virtualization, offline recovery, and accepted synchronization limitations were not reopened.

Limitations: no completed RoomPanel, MessageList, feed store/hook, or Playwright harness is available to exercise. No live application, database, Supbuddy startup, or browser layout test was run. F-003 is an integration risk inferred from the delivered CSS/component contracts, not an observed browser failure. Chunk 7/8 source files are now present in this checkout; their exports were inspected, but their branch/merge status and test results were not audited. The spec's plan-time dependency and startup checks remain necessary.

## Review checks

- An in-memory Node probe implementing the specified endpoint classifier returned `none` for `[A, C] → [A, B, C]`. This is a check of the proposed rule, not a test of a delivered component.
- Arithmetic check of the prescribed `both` action: starting at `scrollTop = 200`, adding 100 px above and 100 px below produces 400, whereas preserving the existing visible row requires 300.
- A Node/jsdom probe instantiated the installed Leaflet map with the current center, zoom, bounds and an explicit 1280 × 720 container. `getBounds()` returned south latitude `-58.99531118795094`; `bounds.contains([-59, 0])` and `bounds.contains([-60, 0])` were both false. No tiles or network requests were used. Playwright documents that [1280 × 720 is its default viewport](https://playwright.dev/docs/api/class-testoptions#test-options-viewport).
- Inspected the existing textarea's `field-sizing-content` and lack of a height cap, the form's unqualified use of that textarea, and the frame's nonshrinking footer. Tailwind documents [content-based field sizing](https://tailwindcss.com/docs/field-sizing); actual panel geometry still needs browser verification.

Original Evidence line numbers below refer to the initially reviewed spec after insertion of its feedback link. Current revision locations are recorded separately in Implementation evidence.

## F-001: Endpoint-only change detection misses newly loaded backlog rows

- Severity: Important
- Finding: The classifier explicitly treats a merge into the middle as `none`, and the layout effect only watches first/last IDs. This is a normal supported feed sequence: after an own send displays C ahead of the synchronization cursor, a later catch-up inserts B into `[A, C]`. A manual backlog page can likewise add many rows before an already displayed newest message without changing either endpoint. No new-message pill is produced, and the hold flag is cleared as though the batch were empty. This contradicts the decision that a manual batch preserves the reader's position and shows the pill, and leaves incoming middle inserts outside the stated scroll behavior.
- Evidence: `docs/superpowers/specs/2026-09-17-room-panel-design.md:41`, `:252`, `:254`, `:270`; `docs/superpowers/specs/2026-09-16-room-feed-design.md:170`, `:235`, `:251`, `:293`; `src/lib/feed/reducer.ts:228` and `:262` merge pages and own responses without advancing the same cursor. The classifier probe above returned `none` despite a new row.
- Recommendation: Detect added message IDs independently of endpoint changes and define scroll/pill behavior for interior additions. Distinguish an actually empty/deduplicated batch from one that adds interior rows; associate manual hold behavior with the requested batch rather than merely the next endpoint change. Add cases for A/C followed by B, and a manual backlog page wholly before an already displayed own post, asserting the reading anchor and pill behavior. Include a real-browser interior-merge scenario.
- Decision: Accepted (2026-09-17; user: “approved”). Previously Pending.
- Implementation status: Implemented in spec. Previously Not started.
- Implementation evidence: `docs/superpowers/specs/2026-09-17-room-panel-design.md:273` specifies full-ID change detection; `docs/superpowers/specs/2026-09-17-room-panel-design.md:313` ties hold lifetime to the accepted request and final committed snapshot; `docs/superpowers/specs/2026-09-16-room-feed-design.md:361` and `docs/superpowers/specs/2026-09-16-room-feed-design.md:449` define the store/hook completion promise; `docs/superpowers/specs/2026-09-17-room-panel-design.md:381` and `docs/superpowers/specs/2026-09-17-room-panel-design.md:459` add interior-merge and lifecycle acceptance cases. Initial evidence: None yet. Product behavior remains unverified.

## F-002: Combined prepend and append overcompensates the reading position

- Severity: Important
- Finding: For `both`, the spec first adds the entire scroll-height difference to scrollTop and then applies the append rule. The difference includes rows added below the reader, so a reader who is scrolled up is moved too far: 100 px prepended plus 100 px appended shifts by 200 px instead of 100 px. The append step then only shows the pill and leaves that incorrect position. The single-fetch restriction does not exclude an own POST response during older loading, and future realtime messages can also interleave with history. Even apart from scheduling, the explicitly specified `both` rule fails its position-preservation contract.
- Evidence: `docs/superpowers/specs/2026-09-17-room-panel-design.md:259` and `:261`; `docs/superpowers/specs/2026-09-16-map-shell-design.md:316`; `docs/superpowers/specs/2026-09-16-room-feed-design.md:244` and `:251`. The arithmetic check above demonstrates the excess adjustment. Section 7 tests the classifier's `both` result but does not require a mixed-update geometry assertion.
- Recommendation: Specify preservation of a visible message and its viewport offset for mixed updates, or otherwise compensate only for changes above that anchor. Keep the chosen own-send and incoming-at-bottom policies. Add a component geometry test and browser case where older rows and an incoming row appear in the same committed update while the reader is scrolled up; assert that the previously visible row retains its position.
- Decision: Accepted (2026-09-17; user: “approved”). Previously Pending.
- Implementation status: Implemented in spec. Previously Not started.
- Implementation evidence: `docs/superpowers/specs/2026-09-17-room-panel-design.md:288` defines visible-row displacement and the 100 px mixed-update example; `docs/superpowers/specs/2026-09-17-room-panel-design.md:296` preserves own-send/near-bottom priorities; `docs/superpowers/specs/2026-09-17-room-panel-design.md:384` and `docs/superpowers/specs/2026-09-17-room-panel-design.md:465` require component and browser geometry coverage. Initial evidence: None yet. Product behavior remains unverified.

## F-003: The fixed footer has no bound for the delivered content-sized composer

- Severity: Important
- Finding: The panel places ComposeForm in a nonshrinking footer and makes MessageList the only scroll container, but the delivered textarea grows with content and has no maximum height. A valid long multiline draft can consume the list's available space and push Send or other footer content beyond the viewport-clipped shell. `rows={3}` is not a height cap for a content-sized field. The spec only exercises a two-line message and supplies no constraint that keeps all controls usable for supported input sizes. This is a source-based integration risk awaiting a browser check.
- Evidence: `docs/superpowers/specs/2026-09-17-room-panel-design.md:161`, `:172`, `:225`, `:368`; `docs/PRD.md:78` permits up to 3000 characters; `src/components/ui/textarea.tsx:9` uses `field-sizing-content` without a height cap; `src/components/compose/ComposeForm.tsx:122` supplies no sizing override; `src/components/panel/PanelFrame.tsx:48` makes the footer `shrink-0`; `src/components/map/MapShell.tsx:54` clips page overflow and `:68` bounds the panel slot. See Tailwind's [field-sizing contract](https://tailwindcss.com/docs/field-sizing).
- Recommendation: Define a bounded composer layout that keeps Send, errors, backlog controls, and a usable message viewport reachable at the supported desktop size. Clarify that the textarea may scroll internally and assign any needed ComposeForm sizing change to this integration. Add a browser acceptance case with a valid many-line draft and footer notices, checking that controls remain visible/reachable and the draft can be submitted. Mobile support need not be added.
- Decision: Accepted (2026-09-17; user: “approved”). Previously Pending.
- Implementation status: Implemented in spec. Previously Not started.
- Implementation evidence: `docs/superpowers/specs/2026-09-17-room-panel-design.md:94` assigns the ComposeForm sizing prop to chunk 9; `docs/superpowers/specs/2026-09-17-room-panel-design.md:221` defines bounded input sizing, textarea scrolling and a minimum message viewport with simultaneous notices; `docs/superpowers/specs/2026-09-17-room-panel-design.md:470` requires long-draft browser acceptance. Initial evidence: None yet. Product behavior remains unverified.

## F-004: Random test-room coordinates can lie outside the opening viewport

- Severity: Important
- Finding: The harness creates rooms anywhere within latitude ±60 and then waits for their marker on `/` without moving the map. The current map starts at latitude 46.7712 and zoom 2; it does not show that entire latitude range at the default test viewport. The installed Leaflet probe excludes latitude −59, which the generator permits. Since pins are fetched only within the viewport, keyboard focus cannot recover a marker that was never fetched, and otherwise correct scenarios can intermittently time out before opening their room.
- Evidence: `docs/superpowers/specs/2026-09-17-room-panel-design.md:351` and `:352`; `src/components/map/mapDefaults.ts:4`; `docs/superpowers/specs/2026-09-16-map-shell-design.md:206` describes viewport-scoped requests. Playwright's [default viewport](https://playwright.dev/docs/api/class-testoptions#test-options-viewport) and the Leaflet bounds probe above establish a concrete permitted-but-invisible coordinate.
- Recommendation: Specify a fixed desktop viewport and generate unique room coordinates inside a safely visible region for that viewport, or make openRoom navigate the map to the supplied coordinates before waiting for its pin. Preserve API-only setup and test isolation. Check the generator's boundary coordinates against the chosen viewport so room discovery does not depend on random latitude.
- Decision: Accepted (2026-09-17; user: “approved”). Previously Pending.
- Implementation status: Implemented in spec. Previously Not started.
- Implementation evidence: `docs/superpowers/specs/2026-09-17-room-panel-design.md:423` fixes 1280 × 720; `docs/superpowers/specs/2026-09-17-room-panel-design.md:427` restricts randomized coordinates to the safe region and handles coordinate conflicts; `docs/superpowers/specs/2026-09-17-room-panel-design.md:432` requires boundary checks. The fresh Leaflet probe described above confirms all four corners lie inside those opening bounds; the full helper/browser path remains untested. Initial evidence: None yet. Product behavior remains unverified.
