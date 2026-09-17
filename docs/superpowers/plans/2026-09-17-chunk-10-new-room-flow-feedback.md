# Chunk 10: New Chatroom Flow implementation plan review feedback

**Plan:** [2026-09-17-chunk-10-new-room-flow.md](2026-09-17-chunk-10-new-room-flow.md)

## Current summary — 2026-09-17

**Ready for execution on the approved scope: F-001 is Accepted and Implemented in plan; F-002 remains Pending; no Blockers.**

Chunk 9 is now merged at `e1b7f90`, and every Task 1 export/helper count matches the plan.
The delivered baseline is 36 Vitest files / 695 tests and 18 listed Playwright tests;
`pnpm test`, `pnpm lint`, and `pnpm typecheck` pass. The current shadcn registry still returns
the one-file Base UI tooltip described by the plan. No required feature is missing.

The implementation sequencing, state ownership, recovery semantics, failure paths, generated
component assumptions, Supbuddy restrictions, and unit/browser coverage are otherwise coherent.
The approved Important finding is resolved in the plan: Task 8 now reconciles every linked
handoff-key contract. The remaining Improvement is to replace the now-stale pre-merge prerequisite
narrative with the delivered baseline while retaining the execution gate; it remains Pending.

Review limitations: the write-heavy Playwright suite and manual two-browser scenarios were not
run during this review because they create persistent local rooms. `pnpm test:e2e --list`
confirmed the 18-test baseline without writes. The local Supabase API/database stack reports
available; stopped optional services do not affect this chunk. No application or database files
were changed.

## F-001: Documentation task leaves the handoff-key architecture contradictory

- Severity: Important
- Finding: Task 8 updates only the `RoomPanel` row in the map-shell design's panel table. The same linked design still says the draft is a placeholder, the room panel is keyed only by `room.id`, and Chunk 10 will dispatch directly through the selection reducer. The linked room-panel design also retains the room-ID-only JSX. After this plan replaces those contracts with `handoffReducer`, `draftPanelKey`, and `roomPanelKey`, future chunks can follow the older documents and accidentally remove the fresh-mount guarantee for same-room outcomes.
- Original evidence (before implementation): Task 8 updated only the §8 table; `docs/superpowers/specs/2026-09-16-map-shell-design.md:81`, `docs/superpowers/specs/2026-09-16-map-shell-design.md:255`, and `docs/superpowers/specs/2026-09-16-map-shell-design.md:264` retain the superseded placeholder/key/dispatch wiring; `docs/superpowers/specs/2026-09-17-room-panel-design.md:97` retains `<RoomPanel key={selection.room.id} ...>`; the plan's replacement wiring is at `docs/superpowers/plans/2026-09-17-chunk-10-new-room-flow.md:2301` and `docs/superpowers/plans/2026-09-17-chunk-10-new-room-flow.md:2357`.
- Recommendation: Expand Task 8's architecture-document edits. Update map-shell design §3 to name `NewRoomPopup` and both revision-aware keys, and §6 to explain that `handoffReducer` wraps the unchanged selection reducer and owns revision/recovery plus the three outcome callbacks. Update the room-panel design's MapShell snippet, or add an explicit adjacent supersession note pointing to the new-room design and `roomPanelKey`. Keep the historical selection-reducer transition table intact.
- Decision: Accepted — approved by the user on 2026-09-17 ("F-001 is approved."). Previously Pending.
- Implementation status: Implemented in plan. Previously Not started.
- Implementation evidence: Reconciliation decision 14 now covers all superseded documents and contracts at `docs/superpowers/plans/2026-09-17-chunk-10-new-room-flow.md:109`; the Task 8 file inventory includes both architecture documents at `docs/superpowers/plans/2026-09-17-chunk-10-new-room-flow.md:128` and `docs/superpowers/plans/2026-09-17-chunk-10-new-room-flow.md:2852`; Task 8 Step 3 specifies the §3 keys, §6 wrapper/wiring while preserving the historical selection table, §8 row, and room-panel snippet/supersession note at `docs/superpowers/plans/2026-09-17-chunk-10-new-room-flow.md:2920`; the documentation commit stages the room-panel design at `docs/superpowers/plans/2026-09-17-chunk-10-new-room-flow.md:3009`.

## F-002: The prerequisite narrative still describes the pre-merge repository

- Severity: Improvement
- Finding: The plan still states that Chunk 9 is unimplemented and describes its validation numbers as predictions from extracted planned files. Chunk 9 is now merged and the predicted baseline is the delivered baseline. Task 1 prevents execution errors, but the stale opening narrative makes a reviewed plan internally inconsistent and obscures which evidence is now real.
- Evidence: `docs/superpowers/plans/2026-09-17-chunk-10-new-room-flow.md:44` says Chunk 9 is not implemented; `docs/superpowers/plans/2026-09-17-chunk-10-new-room-flow.md:48` describes a scratch extraction and predicted counts. Current `main` is `e1b7f90` (`Merge branch 'chunk-09-room-panel'`); all eight gate files exist; the thirteen Task 1 counts are exactly `2, 6, 1, 3, 2, 7, 1, 3, 3, 1, 8, 1, 1`; `pnpm test` reports 36 files / 695 tests and `pnpm test:e2e --list` reports 18 tests.
- Recommendation: Rewrite the prerequisite bullet as merged-and-verified, record `B-files = 36`, `B-tests = 695`, and `B-e2e = 18` as the current baseline, and update the prototype paragraph to distinguish its historical evidence from the delivered Chunk 9 verification. Keep Task 1 as a fresh branch/drift gate and keep its instruction to stop if the delivered contracts differ.
- Decision: Pending
- Implementation status: Not started
- Implementation evidence: None yet.
