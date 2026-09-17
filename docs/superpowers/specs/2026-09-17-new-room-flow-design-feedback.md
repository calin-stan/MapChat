# Map Chat — New chatroom flow design review feedback

**Spec:** [2026-09-17-new-room-flow-design.md](2026-09-17-new-room-flow-design.md)

## Current summary — approved revision, 2026-09-17

**Ready for implementation planning on the reviewed scope.** F-001–F-004 are Accepted and
Implemented in spec following the user's “approved” response. Unresolved findings: none.

Each create/conflict outcome starts a fresh panel lifetime even for the same room. Every
create rejection restores its submitted coordinates, trimmed author/text and mapped error
in a fresh popup. The retry guidance distinguishes the original spot from a deliberate move.
Pin retention is explicitly immediate and guaranteed while selected; normal refresh/cap
behavior applies after close. Acceptance cases cover these transitions and recovered-error layout.

The shell owns handoff identity and recovery metadata. ComposeForm gains an initial-errors
prop alongside the two original additions; the public selection reducer and pin hook remain
unchanged. The spec explicitly supersedes chunk 9's room-ID-only panel key for chunk 10.
The take-over policy also specifies settlement order and replacement of intervening unsent edits.

Revision validation: checked the revised interfaces, ownership rules, error/retry copy,
acceptance cases and document whitespace. No application code changed or behavioral tests ran.
Product behavior remains unverified; chunk 9's delivered exports and the browser checks still
need validation during implementation. The initial review's limitations remain applicable.

## Initial review — 2026-09-17 (preserved history)

**Revise before implementation planning: four Important findings, no Blockers.**
Unresolved: F-001, F-002, F-003, F-004. All decisions are Pending and implementation
statuses are Not started. This review adds only this companion and the spec's metadata link.

The normal created/conflict paths, trimmed input transfer, seed ownership, validation mapping,
bounded composer, and downstream test obligations are clear. The gaps concern request outcomes
after intervening navigation, retry coordinates, and the lifetime of locally inserted pins.
The explicit take-over decision, desktop-only scope, deferred touch support and realtime,
and accepted lack of idempotency were not reopened.

Review scope: the complete new-room spec; PRD and Known limitations; map-shell and room-panel
designs, including the room-panel feedback history; room-feed store/hook and testing contracts;
implementation-chunks global requirements and chunk 10; chunk 7's compose handoff; current
ComposeForm, fieldErrors, useDisplayName, selection reducer, MapShell, and useRoomPins.
React's [state preservation and key semantics](https://react.dev/learn/preserving-and-resetting-state)
were also checked against the proposed panel identity.

Limitations: chunk 9's panel/store/hook and Playwright harness are not delivered in this
checkout, as the reviewed spec acknowledges. Findings are source/contract deductions, not
observed end-to-end failures. No app, database, Supbuddy startup, or browser layout tests were
run; dependency merge status was not independently audited. The local sources needed for this
review were available. Tooltip behavior, the 96 px layout budget, and actual browser timing
remain implementation-time verification obligations. No implementation or approval to
implement is implied by this review.

Original Evidence line numbers below refer to the initial reviewed spec. Current revision
locations are recorded separately in Implementation evidence.

## F-001: A late outcome for the already-open room does not reset the handoff state

- Severity: Important
- Finding: Submit a create, open room R while it is pending, edit or send in R, then receive a conflict for R. The unchanged room ID key preserves the existing panel and form. ComposeForm's edited drafts override new initial props, and a previous send leaves `sentOnce` true, hiding the new notice. The promised prefill and notice are therefore not guaranteed. A delayed created response has the analogous seed problem if its room was discovered and opened through a pin before the response arrived: the hook ignores a seed supplied after that room identity mounted.
- Evidence: `docs/superpowers/specs/2026-09-17-new-room-flow-design.md:36` requires unconditional take-over; `:197` assumes replacing the selection remounts the panel; `:218` scopes notice flags to room identity. `src/components/compose/ComposeForm.tsx:66` gives edited drafts precedence over initial props. `docs/superpowers/specs/2026-09-17-room-panel-design.md:98` keys the panel by room ID, and `docs/superpowers/specs/2026-09-16-room-feed-design.md:448` captures seed once per room identity. React's [key semantics](https://react.dev/learn/preserving-and-resetting-state) preserve state when that identity stays the same.
- Recommendation: Specify how each create outcome establishes a fresh handoff even when its room is already selected, including draft replacement, notice reset, focus and seed/history handling. Assign any required identity/contract change to this chunk while preserving the existing same-pin-click behavior. Add deferred-response cases targeting the already-open room after an edit and after a send, plus a created room opened before its create response arrives.
- Decision: Accepted (2026-09-17; user: “approved”). Previously Pending.
- Implementation status: Implemented in spec. Previously Not started.
- Implementation evidence: `docs/superpowers/specs/2026-09-17-new-room-flow-design.md:185` defines atomic handoff revision and fresh same-room panel lifetimes; `docs/superpowers/specs/2026-09-17-new-room-flow-design.md:380` and `docs/superpowers/specs/2026-09-17-new-room-flow-design.md:384` require prefill/notice/focus reset, seed initialization and disposal checks. Initial evidence: None yet. Product behavior remains unverified.

## F-002: Rejections after navigation have no draft recovery or error owner

- Severity: Important
- Finding: The visitor may close the popup or open a room during a pending create. Success and conflict deliberately survive that unmount, but rejection is handled only by the old ComposeForm's local error state. The submitted draft and failure message then have no visible owner or recovery path. This conflicts with the promise that unsent text is not lost and that errors keep the popup and draft pin present. The failure policy after navigation is a missing behavior decision, not merely a choice of effect cleanup.
- Evidence: `docs/superpowers/specs/2026-09-17-new-room-flow-design.md:36` permits navigation and promises preservation; `:146` sends rejections only to ComposeForm; `:150` preserves callbacks after unmount only for resolved outcomes; `:285` promises that error rows keep the popup and drafts open. `src/components/compose/ComposeForm.tsx:62` stores draft text locally and `:86` handles rejection through local state.
- Recommendation: Define who retains the submitted coordinates, author and text and how a rejection is surfaced after close or room selection. Either provide an explicit recovery path consistent with preservation, or explicitly accept and document discard-on-navigation and narrow the preservation claim. Keep the accepted successful-outcome take-over policy. Add deferred rejection tests after close, after opening a room, and after opening a replacement draft, asserting the chosen visible result and draft ownership.
- Decision: Accepted (2026-09-17; user: “approved”). Previously Pending.
- Implementation status: Implemented in spec. Previously Not started.
- Implementation evidence: `docs/superpowers/specs/2026-09-17-new-room-flow-design.md:112` adds the failure/recovery interface; `docs/superpowers/specs/2026-09-17-new-room-flow-design.md:216` restores the submitted snapshot after navigation; `docs/superpowers/specs/2026-09-17-new-room-flow-design.md:312` defines restored error initialization; `docs/superpowers/specs/2026-09-17-new-room-flow-design.md:389` requires rejection recovery and no-write/name-persistence checks. Initial evidence: None yet. Product behavior remains unverified.

## F-003: Moving the draft invalidates the promised safe retry

- Severity: Important
- Finding: A create at A can commit while its response is lost; meanwhile the visitor moves the unkeyed draft to B. The failure copy says trying again will move the visitor to the room if it exists, but the next submit explicitly uses B. Coordinate uniqueness at A cannot prevent a new room and first message at B. This is separate from the accepted same-coordinate 409/idempotency limitation: the guidance misidentifies a request at a different location as recovery of the original request.
- Evidence: `docs/superpowers/specs/2026-09-17-new-room-flow-design.md:50` preserves form state while moving coordinates; `:152` fixes each request's coordinates but makes the next submit use the new ones; `:265` supplies the retry copy and `:268` claims coordinate uniqueness makes retries safe. `docs/KNOWN_LIMITATIONS.md:14` describes uncertain writes and checking the room before resending.
- Recommendation: Define recovery at the original submitted coordinates separately from creating at the current draft location. Retain enough request context to offer recovery at A, or make the copy explicitly conditional on retrying at the same spot and disclose that Create at B starts a separate room. No idempotency key or own-room detection is required. Add a test for submit at A, move to B, uncertain rejection, then retry, asserting both the destination and guidance.
- Decision: Accepted (2026-09-17; user: “approved”). Previously Pending.
- Implementation status: Implemented in spec. Previously Not started.
- Implementation evidence: `docs/superpowers/specs/2026-09-17-new-room-flow-design.md:168` fixes immediate retry to the restored submitted spot; `docs/superpowers/specs/2026-09-17-new-room-flow-design.md:304` distinguishes same-coordinate recovery from a moved draft; `docs/superpowers/specs/2026-09-17-new-room-flow-design.md:392` requires destination and guidance acceptance. Initial evidence: None yet. Product behavior remains unverified.

## F-004: Local insertion does not guarantee the pin survives closing the panel

- Severity: Important
- Finding: The conflict path says inserting the existing room keeps its pin after closing without waiting for refresh. The delivered pin hook instead replaces its collection on every accepted viewport response; insertRoom neither invalidates a pending response nor retains inserted rooms separately. A viewport request whose snapshot predates the concurrent room can resolve after the conflict insertion and remove that room from the collection. Selected-room augmentation masks this until close, when the pin disappears. Later capped responses can also omit an older conflict room under the already accepted 500-pin limit.
- Evidence: `docs/superpowers/specs/2026-09-17-new-room-flow-design.md:194` promises post-close retention. `src/lib/map/useRoomPins.ts:83` replaces the collection on refresh; `src/lib/map/useRoomPins.ts:116` only merges into current state. `src/components/map/MapShell.tsx:32` augments pins only for a room selection. `docs/superpowers/specs/2026-09-16-map-shell-design.md:223` guarantees retention for the selected pin, rather than all locally inserted rooms.
- Recommendation: Define the intended retention boundary. If insertion must survive an already-pending refresh, assign the required pin-hook integration change and test to this chunk. Otherwise narrow the promise to immediate insertion plus selected-pin retention and document normal refresh/cap behavior. Add a controlled refresh-before-create response that settles after insertion, then close the panel and assert the selected policy; retain the accepted viewport cap.
- Decision: Accepted (2026-09-17; user: “approved”). Previously Pending.
- Implementation status: Implemented in spec. Previously Not started.
- Implementation evidence: `docs/superpowers/specs/2026-09-17-new-room-flow-design.md:227` narrows retention to immediate insertion and selected-room augmentation; `docs/superpowers/specs/2026-09-17-new-room-flow-design.md:397` requires an older refresh to settle after insertion, then checks close and later rediscovery. Initial evidence: None yet. Product behavior remains unverified.
