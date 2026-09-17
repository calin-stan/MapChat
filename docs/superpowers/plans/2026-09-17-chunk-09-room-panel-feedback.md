# Chunk 9: Room Panel — Implementation plan review

**Plan:** [2026-09-17-chunk-09-room-panel.md](2026-09-17-chunk-09-room-panel.md)

## Current summary — approved revision, 2026-09-17

**Accepted findings incorporated into the plan.** F-001–F-004 are Accepted following the user's “approve” response and are now Implemented in plan. No accepted correction remains unaddressed in the plan; implementation and real-browser verification remain outstanding.

The revised harness settles startup catch-up, pauses the clock before scenario writes, and observes real fetch/JSON consumption. The send scenario requires a new API message to reach the DOM; backlog checks count attempted requests. A dev-only real-map fixture checks corner geometry with 501 newer synthetic rooms, independently of omitted corner pins. Final verification leaves the shared local database intact. The historical prototype claim is explicitly limited to the earlier plan revision.

Document validation: 13 TypeScript/TSX blocks from Tasks 11–13 passed TypeScript syntax parsing. An isolated in-memory probe of the planned fetch observer preserved JSON and reported settlement after the consumer promise chain; this is helper evidence only, not a browser/product test. Checked the seven controlled-open call sites, single Next configuration replacement, removal of obsolete fixture/reset instructions, lifecycle fields, exact implementation references and whitespace. No product files, database data or specification feedback histories were changed. The prescribed full e2e, slow-setup and mutation runs have not been executed.

Original Finding/Evidence/Recommendation text is preserved below. Original Evidence locations refer to the reviewed pre-approval plan; current locations are recorded in each Implementation evidence field.

## Initial review — 2026-09-17 (preserved history)

**Revise before execution: four Important findings, no Blockers.** F-001–F-004 are Pending and Not started. The remaining issues concern deterministic browser setup, assertions that can pass before the behavior being tested, persistent fixture discovery, and destructive cleanup.

The proposed store/hook interfaces, readiness rejection, seed handoff, terminal channel cleanup, full-ID scroll classification and request-scoped holds align with the reviewed requirements. No additional product implementation defect is asserted by this review. The plan's reported prototype results do not close the verification gaps below.

Scope: the complete plan, room-panel requirements and feedback, relevant room-feed and map-shell contracts and existing feedback, implementation-chunks global constraints and chunk 9, chunk 7's handoff, relevant PRD requirements and Known limitations. Repository checks covered the current reducer/types, API client and room-list query, composer/storage/frame integration, package/test configuration, Supbuddy project instructions and installed Next.js/Leaflet sources. `git rev-parse --short main` returned the stated prerequisite `f8577a3`.

Validation limits: this was a document/source review with official Playwright and Supabase documentation checks. No application test suite, browser scenario, live database mutation, reset or Supbuddy server startup was run; the scratch prototype's results were not independently reproduced. Only this companion and the plan's metadata link were changed. Evidence line numbers below refer to the plan after that link was inserted.

## F-001: Polling setup does not freeze time or settle the initial catch-up

- Severity: Important
- Finding: The polling scenarios install the clock but leave it running, and `openRoom` returns as soon as initial history makes the log visible. That does not establish that the stub has failed and the immediate catch-up has completed. Scenario 6 then creates 105 messages through sequential real requests; scenario 8 similarly creates B/backlog before C. An initial catch-up overlapping those writes, or a normal 30-second tick during slower setup, can consume part of the intended batch before `pollNow`. Correct product code can therefore miss the expected backlog or already display B when the scenario requires it to be absent. Three quick prototype runs do not establish deterministic ordering.
- Evidence: `docs/superpowers/plans/2026-09-17-chunk-09-room-panel.md:4486` returns after log visibility; `:4795` installs the clock before the 105-message setup; `:4886` begins the manual-backlog scenario. The stub schedules failure on a macrotask at `:205`, and `src/lib/feed/reducer.ts:104` immediately requests catch-up on entering polling. Room-panel design §8 requires controlled poll advancement and real-HTTP A/B/C setup. Playwright's [clock lifecycle](https://playwright.dev/docs/api/class-clock#clock-pause-at) explains that timers run naturally after installation and that `pauseAt` explicitly pauses them.
- Recommendation: Give polling scenarios an explicit setup barrier: observe completion of the room's initial catch-up, pause the installed clock before creating B/backlog or sending C, and then advance only the intended ticks. Keep HTTP real and retain the normal poll interval. Account for startup timers and browser rendering when implementing the pause helper. Verify the scenarios with setup delayed beyond one real poll interval; their batches and preconditions must remain unchanged.
- Decision: Accepted (2026-09-17; user: “approve”). Previously Pending.
- Implementation status: Implemented in plan. Previously Not started.
- Implementation evidence: `docs/superpowers/plans/2026-09-17-chunk-09-room-panel.md:4561` settles startup and pauses the clock before scenario writes; `docs/superpowers/plans/2026-09-17-chunk-09-room-panel.md:4513` observes real fetch/JSON consumption; `docs/superpowers/plans/2026-09-17-chunk-09-room-panel.md:5177` requires the 31-second adverse setup run. All seven timer-dependent scenarios now call openPollingRoom. Initial evidence: None yet. Product behavior remains unverified.

## F-002: Unchanged-row assertions do not prove polling deduplication or backlog suspension

- Severity: Important
- Finding: `pollNow` awaits only clock advancement, not completion and publication of the resulting HTTP response. Scenario 5 checks the same three rows and one own message already present before the tick, then reloads. Those assertions can pass while the poll is pending or even if no poll occurred. Scenario 6 similarly checks an already-true count of 105 to claim periodic catch-up was paused; it can proceed before an erroneous automatic request finishes. These browser checks can report success without exercising the claimed behavior.
- Evidence: `docs/superpowers/plans/2026-09-17-chunk-09-room-panel.md:4498` implements `pollNow`; `:4771` advances then immediately asserts unchanged counts and reloads; `:4804` uses the same pattern for backlog suspension. Room-panel design §8 scenarios 5 and 6 require deduplication after a poll and no periodic backlog draining. Playwright's [assertion semantics](https://playwright.dev/docs/test-assertions#auto-retrying-assertions) retry until a condition passes; an already-true condition is not a completion barrier.
- Recommendation: For scenario 5, post a distinct additional message through the API after the own send, observe the intended catch-up response, wait for that new row to commit, and then assert that the echoed own message still appears once. For backlog suspension, record room-specific `after` requests around a controlled tick and assert that none starts, in addition to the unchanged UI. Add mutation checks showing these tests fail when periodic polling is disabled, deduplication is broken, or backlog ticks are allowed. Keep these checks independent of arbitrary sleeps.
- Decision: Accepted (2026-09-17; user: “approve”). Previously Pending.
- Implementation status: Implemented in plan. Previously Not started.
- Implementation evidence: `docs/superpowers/plans/2026-09-17-chunk-09-room-panel.md:4583` waits for an observed catch-up; `docs/superpowers/plans/2026-09-17-chunk-09-room-panel.md:4592` asserts no room-specific request starts; `docs/superpowers/plans/2026-09-17-chunk-09-room-panel.md:4973` adds the fresh DOM witness before asserting one own message. `docs/superpowers/plans/2026-09-17-chunk-09-room-panel.md:5177` specifies three concrete mutations and restoration followed by a clean rerun. Initial evidence: None yet. Product behavior remains unverified.

## F-003: Persistent corner fixtures eventually disappear behind the 500-pin cap

- Severity: Important
- Finding: The region acceptance test reuses rooms at four fixed coordinates forever, while every suite run adds newer rooms in the same visible region. The real viewport endpoint returns only the newest 500 rooms. Once 500 newer rooms exist, a reused corner room is legitimately omitted and its marker cannot be measured, although the opening map bounds remain correct. This makes repeated no-reset runs eventually fail and also relies on shared pre-existing rooms despite the harness's isolation contract.
- Evidence: `docs/superpowers/plans/2026-09-17-chunk-09-room-panel.md:4559` creates/reuses the fixed corners and `:4576` looks up their markers; `:5319` documents accumulating rooms without resets. `src/lib/db/rooms.ts:15` sets the cap to 500 and `:81` orders newest-first before applying it. Room-panel design §8 requires an actual opening-bounds corner check and API-only isolated data; PRD §4 explicitly permits omitted pins in capped responses.
- Recommendation: Make the exact corner check independent of whether database rooms survive the viewport cap—for example, measure the actual initial Leaflet bounds/projection in a focused dev-only map fixture, while keeping fresh API-created rooms for the HTTP opening scenarios. Do not reset the database or raise the product pin limit to make the test pass. Verify the corner check with more than 500 newer visible rooms represented in the test environment.
- Decision: Accepted (2026-09-17; user: “approve”). Previously Pending.
- Implementation status: Implemented in plan. Previously Not started.
- Implementation evidence: `docs/superpowers/plans/2026-09-17-chunk-09-room-panel.md:4655` checks projected corners and omission from the 500 pins; `docs/superpowers/plans/2026-09-17-chunk-09-room-panel.md:4685` defines the full real-MapView fixture with 501 newer synthetic rooms, shares ROOM_REGION with helpers, and moves the dev-only extension prerequisite into Task 11. Production-route checks remain required. Initial evidence: None yet. Product behavior remains unverified.

## F-004: Final verification presents a full database reset as test-room cleanup

- Severity: Important
- Finding: The final verification step includes `pnpm db:reset` afterwards and describes its effect as removing the e2e rooms. That script resets the entire local database and reloads migrations/seed, discarding unrelated development rooms/messages and any other unrecorded data or schema changes. A Git worktree does not isolate this shared local stack. This is unnecessary for the chunk and contradicts the plan's no-reset verification approach.
- Evidence: `docs/superpowers/plans/2026-09-17-chunk-09-room-panel.md:5341` includes the reset in the final verification text; `package.json:16` expands it to `supabase db reset --local`. The plan's Global Constraints at `:32` and room-panel design §8 specify no database reset for e2e setup. Supabase documents the full destructive scope of [db reset](https://supabase.com/docs/reference/cli/supabase-db-reset).
- Recommendation: Remove the reset from the execution/final-verification step. Keep accumulation documented, with any full reset described separately as an optional operator action that discards all disposable local development data. Do not make successful completion depend on deleting unrelated data, and do not add a service-role cleanup path to the browser suite.
- Decision: Accepted (2026-09-17; user: “approve”). Previously Pending.
- Implementation status: Implemented in plan. Previously Not started.
- Implementation evidence: `docs/superpowers/plans/2026-09-17-chunk-09-room-panel.md:5579` removes reset from final verification; `docs/superpowers/plans/2026-09-17-chunk-09-room-panel.md:5553` describes a full reset only as a separate optional operator action and explicitly states its whole-database scope. Initial evidence: None yet. Product behavior remains unverified.
