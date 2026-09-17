# Chunk 11 — Realtime with idle fallback: plan review feedback

**Plan:** [2026-09-17-chunk-11-realtime-idle-fallback.md](2026-09-17-chunk-11-realtime-idle-fallback.md)

## Current summary — 2026-09-17 (approved revision)

**F-001 and F-002 are Accepted and Implemented in plan.** The user approved both findings.
The plan and its two owning specs now require actual Postgres subscription readiness and
exclude automatic MessageList scrolling from user activity. No product source files were
changed. Product implementation and full browser verification remain the executor's work.

F-001 uses the existing server `system` acknowledgement with a bounded 20-second deadline,
not the unsupported SDK `wait` option. A read-only `docker ps --format '{{.Names}} {{.Image}}'`
identified map-chat's Realtime image as `v2.124.2`. Its
[versioned server source](https://github.com/supabase/realtime/blob/v2.124.2/lib/realtime_web/channels/realtime_channel.ex)
and a read-only anon-key subscription established the available handshake. The probe
observed `SUBSCRIBED → system(postgres_changes, ok, "Subscribed to PostgreSQL") → CLOSED`;
it removed its channel afterward and wrote no data. This existing alternative satisfies the
approved recommendation without requiring a server upgrade or assuming absent support.

F-002 delegates the list element's scroll classification to MessageList's existing
`ownScrollTop` check. The panel ignores that element in its root capture listener and wires
`onUserScroll` back to the feed. Other descendant scrolling remains tracked. The revised plan
includes automatic-follow/anchor unit cases and browser scenarios for incoming traffic across
the idle deadline and real reader scrolling.

Revision validation (temporary copies only):

- Extracted the plan's adapter/activity implementations and tests, and applied its MessageList,
  panel and test-helper edits to copies under `/private/tmp/chunk11-plan-revision/check`.
  `pnpm exec vitest run --config /private/tmp/chunk11-plan-revision/check/vitest.config.mts`
  passed **4 files / 89 tests**: adapter 26, activity 10, MessageList 31, panel 22.
- `pnpm exec tsc --noEmit -p /private/tmp/chunk11-plan-revision/check/tsconfig.json` passed,
  including the revised e2e examples. This checks the examples against current project types;
  it is not a production build or proof of browser behavior.
- Removing the Postgres-readiness guard from the temporary adapter caused **6** adapter tests
  to fail, including the join-to-readiness catch-up case. Reporting activity for every temporary
  MessageList scroll caused its automatic-positioning regression to fail. The combined mutation
  run returned **7 failed / 50 passed**; both mutations were restored before the final green run.
- Full e2e, the two new browser scenarios, and the two-browser smoke were not run. Historical
  prototype results are explicitly labeled as predating these corrections. Expected full-suite
  totals are updated to baseline + 51 unit tests and baseline + 6 e2e tests, not claimed as observed.

The current chunk 9 baseline has all needed product prerequisites. The original limitation
on conditional integration with unmerged chunk 10 remains: check its actual files if it lands
before execution. Original findings, evidence, and review limitations are preserved below.

## Initial review — 2026-09-17 (preserved history)

**Not ready to execute unchanged: 1 Blocker and 1 Important finding.** F-001 and F-002 are Pending. Only this companion and the plan's review-feedback link were added; no substantive plan or product changes were made.

Reviewed against the current checkout at `e1b7f90` (chunk 9 merged): the complete plan, room-feed design and its accepted feedback, room-panel design, relevant PRD and implementation-chunks requirements, Known limitations, current feed/panel/harness code, database publication migration, and installed SDK lifecycle sources. The chunk 8/9 prerequisites used by this execution path exist. `subscribeToRoom` and activity tracking are this chunk's intended deliverables, not missing prerequisites.

Chunk 10 is not merged in this checkout. Its conditional Task 6 Step 5 and later hand-off are **not validated against implemented chunk 10 files**; no interfaces or behavior were assumed from that future implementation. Chunk 11's current-baseline path does not require them. Re-review that conditional integration if chunk 10 lands before execution.

Validation:

- `pnpm test src/lib/feed/store.test.ts src/lib/feed/useRoomFeed.test.tsx src/components/room/RoomPanel.test.tsx` → exit 0, **3 files / 69 tests passed**. These are existing prerequisite tests, not verification of the proposed adapter or fixes.
- An isolated Playwright/Chromium probe used an in-memory page with a passive capture-phase scroll listener on a parent and assigned a descendant's `scrollTop = scrollHeight`. After rendering frames it recorded `{ programmaticScrollActivity: [{ isTrusted: true, scrollTop: 400 }] }` without user input. The initial sandboxed browser launch was denied by macOS; the same probe succeeded with approved escalation. No website, application server, or database was touched by this probe.
- Installed `@supabase/realtime-js` 2.116.0 source explicitly documents the early-confirmation behavior in F-001, corroborated by the [official SDK source](https://github.com/supabase/supabase-js/blob/master/packages/core/realtime-js/src/RealtimeChannel.ts). Official Supabase subscription/Postgres Changes documentation, changelog, and Playwright clock documentation were also consulted. The Markdown changelog endpoint could not be fetched; its HTML equivalent was read.

No application e2e run, full build, two-browser smoke, live database/publication inspection, or reproduction of the author's prototype was performed. Server support for a readiness option has not been established by this review and must be verified before selecting that correction. Evidence line numbers below refer to the plan after its feedback link was inserted.

## F-001: Channel join is treated as proof that Postgres Changes is ready

- Severity: Blocker
- Finding: Task 1 calls `client.channel(name)` with default configuration and immediately forwards `SUBSCRIBED` to the store. The installed SDK explicitly warns that this callback can precede establishment of the Postgres Changes subscription. The existing reducer then stops polling and performs its confirmation catch-up. If that fetch completes before replication is ready, a subsequent insert in the remaining setup interval is covered by neither transport. The room can display `realtime` while missing messages until a later fallback/reopen; user activity can postpone that fallback indefinitely. The fake channel and happy-path e2e scenarios do not exercise delayed replication readiness. This is separate from the accepted transaction commit-order limitation.
- Evidence: `docs/superpowers/plans/2026-09-17-chunk-11-realtime-idle-fallback.md:452` creates the default channel; `:475` forwards the status; `:1340` treats that connection state and one catch-up as ready. Installed `node_modules/.pnpm/@supabase+realtime-js@2.116.0/node_modules/@supabase/realtime-js/src/RealtimeChannel.ts:74` documents early confirmation and `:93` exposes `config.postgres_changes_options.wait`; `:463` computes the extended join timeout when waiting. `docs/superpowers/specs/2026-09-16-room-feed-design.md:211` stops polling on confirmation. `docs/PRD.md:249` requires the confirmation catch-up to cover the subscription interval, and `docs/PRD.md:351` requires coverage of writes between history and confirmation.
- Recommendation: Make `onSubscribed` mean that Postgres Changes delivery is active. Verify support in the actual local/target Realtime server, then specify `client.channel(name, { config: { postgres_changes_options: { wait: true } } })` if supported, or another verified readiness handshake with bounded failure-to-polling behavior. Do not assume SDK option availability proves server support. Update the channel-call assertions and add a deterministic delayed-readiness case: initial history, channel join, an insert before Postgres readiness, readiness confirmation, and catch-up must display that insert; readiness rejection/timeout must enter polling. Reconcile this with the spec's status mapping explicitly.
- Decision: Accepted (2026-09-17; user: “approved”). Previously Pending.
- Implementation status: Implemented in plan. Previously Not started.
- Implementation evidence: `docs/superpowers/plans/2026-09-17-chunk-11-realtime-idle-fallback.md:52` records actual server compatibility; `:139` fixes confirmation semantics; `:303` and `:493` specify delayed-readiness and adapter/store regression tests; `:580` and `:633` implement the bounded handshake in the plan example. `docs/superpowers/specs/2026-09-16-room-feed-design.md:493` reconciles the owning contract. Temporary snippet validation and the live read-only compatibility probe are recorded in the current summary; the product adapter remains unimplemented. Initial implementation evidence: None yet.

## F-002: Automatic message scrolling is counted as user activity

- Severity: Important
- Finding: Task 2 forwards every captured `scroll` to `feed.activity`. The existing MessageList changes `scrollTop` to follow incoming messages and preserve anchors, and those writes generate real scroll events. Consequently, an untouched visible panel at the bottom of a busy room repeatedly restarts its idle timer whenever incoming rows move the list. Messages arriving less than three minutes apart can prevent the required idle fallback indefinitely. The plan's idle e2e starts with one message and no incoming traffic before the timeout, so it misses this integration failure. The plan follows the room-feed spec's raw event list, but that list needs reconciliation with the PRD's user-inactivity requirement.
- Evidence: `docs/superpowers/plans/2026-09-17-chunk-11-realtime-idle-fallback.md:631` includes captured scroll; `:644` unconditionally reports activity; `:990` attaches it to the panel root; `:1421` tests idle before incoming traffic. `src/components/room/MessageList.tsx:94` writes scrollTop, `:103` follows the bottom, and `:180` already distinguishes its own scroll events internally for pill behavior. `src/lib/feed/store.ts:291` restarts the idle timer on activity. `docs/PRD.md:234` requires fallback after no user activity. The Chromium probe above confirms that a programmatic scroll reaches the capture listener, with `isTrusted: true`.
- Recommendation: Specify how activity tracking excludes application-originated scroll changes while retaining real pointer, keyboard, wheel, touch, and scrollbar interaction. Coordinate with MessageList's existing distinction between its own scroll and reader scroll; a capture listener cannot rely on a later child handler to filter the event. Do not use `isTrusted` alone. Add the necessary component/interface changes to the plan and reconcile the activity contract in the owning spec. Add browser coverage with an overflowing list and repeated incoming inserts across the idle deadline but no user input: the room must still leave realtime at the user-idle deadline. Separately verify that actual user scrolling postpones it.
- Decision: Accepted (2026-09-17; user: “approved”). Previously Pending.
- Implementation status: Implemented in plan. Previously Not started.
- Implementation evidence: `docs/superpowers/plans/2026-09-17-chunk-11-realtime-idle-fallback.md:140` defines scroll ownership; `:784` tests the root filter; `:1063` adds MessageList ownership regressions; `:1123` and `:1281` specify the handle and panel wiring; `:1757` and `:1777` add browser acceptance cases. `docs/superpowers/specs/2026-09-16-room-feed-design.md:521` and `docs/superpowers/specs/2026-09-17-room-panel-design.md:318` reconcile both owning contracts. Temporary tests exercise the proposed examples; the product and full-browser behavior are not yet verified. Initial implementation evidence: None yet.
