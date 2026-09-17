# Chunk 8: Room Feed Reducer — Plan Review Feedback

**Plan:** [2026-09-17-chunk-08-feed-reducer.md](2026-09-17-chunk-08-feed-reducer.md)

## Current summary — 2026-09-17 (approved revision)

**Ready for implementation on the reviewed scope.** The user's “approved” response accepted
F-001–F-003. All three are now **Implemented in plan**; no accepted finding remains outstanding
in the plan. Product implementation and end-to-end verification remain future work.

Task 1 now checks both page declarations independently against a pinned source revision and
preserves unrelated DTOs. The worktree preflight copies and tracks only the nine named review
inputs, with conflicting existing copies requiring reconciliation. The transition-test helper
snapshots state, actions and expected results before reduction and checks for mutation on every
row, including ignored actions and paging.

Revision validation: all nine handoff source documents exist; the revised temporary-copy suite
passes 133 tests, TypeScript checking exits 0, and focused ESLint exits 0 (the same fixture-only
pages-directory diagnostic remains). Reviewed the scoped document diff and handoff commands.
These checks do not execute the proposed Git handoff or deliver application code. Only the plan
and this companion were changed in the repository. The initial review and evidence below are
preserved as history; their dependency observations describe that review's snapshot.

## Initial review — 2026-09-17 (preserved history)

**No reducer behavior blocker found. Address two Important execution findings before following the plan unchanged; one optional test improvement.** F-001–F-003 are Pending and Not started. Only this companion and the plan's metadata link were added; no substantive plan or application changes were made.

The proposed reducer follows the approved feed design's opening, separate cursors, manual backlog, hidden-tab handling, deferred catch-up, failure recovery and terminal-404 rules. Its complete proposed suite runs successfully in isolation: 133 tests. This is evidence about the plan snippets, not delivery or end-to-end verification of the feed.

## Unfinished features and dependency impact

| Dependency | Observed state | Effect on chunk 8 |
| --- | --- | --- |
| Chunks 1–4 | `main` is `784c2ee`; `Message` and `compareCreatedAtId` exist. The current unit suite passes 14 files / 222 tests. | Required existing runtime/type dependencies are available. |
| Chunk 5 message API | Not merged into `main`. The local branch is now `f558052`, rather than the plan's `92ce2f0`. Its committed `MessagePage`, `CatchUpPage` and `MessagesApi.list/listAfter/post` match the feed design. | The reducer only needs the two page types. Task 1's appended type block matches the branch; chunk 8 need not wait for the route/client implementation to merge. Replace the unsafe whole-file fallback in F-001. Type presence alone does not prove chunk 5 is merged. |
| Chunk 6 map shell | Local worktree/branch exists at `b34ad6d`; not merged into `main`. | No reducer imports depend on it. It is an integration prerequisite for the later panel, not for these unit tests. |
| Chunk 7 compose form | No local branch/worktree listed; `src/components/compose` is absent from `main`. | No effect on reducer implementation. Compose readiness and draft behavior remain chunk 9 integration work. |
| Chunk 9 store, hook and panel | `src/lib/feed` and `src/components/room` are absent from `main`. | Expected future consumers. Chunk 8 emits effect data only: no actual fetching, timers, visibility listeners or send-readiness enforcement is delivered here. Chunk 9 must implement the approved store lifecycle, reentrancy queue, subscription-attempt guards and readiness checks. |
| Chunk 11 realtime/activity | No feed adapter/activity implementation on `main`. | Does not block the reducer. Chunk 9's specified failure stub enables polling before chunk 11. SDK cleanup, callback suppression and browser activity behavior require later interpreter/adapter tests. |
| Review/design documents | The chunk 8 plan, feed design, design feedback and parent chunks document are untracked in the main checkout. | The prescribed new worktree will omit them. F-002 must make these review inputs available to the implementer and subsequent reviewers. |

The older parent chunk sketches use names such as `subscribeFailed`, `hasMore` and `loading`; the approved feed design explicitly finalizes their replacements. The plan correctly uses that design. Deferred offline handling, backoff, foreground catch-up, request cancellation and commit-order-safe recovery are not missing chunk 8 requirements.

## Review scope and validation

- Read the complete plan and approved feed design, its existing F-001–F-005 feedback history, relevant PRD sections, Known limitations, parent global/DTO/chunk contracts, and chunk 5 feedback. Inspected current package/configuration files, shared types, ordering code, branch DTO/client exports and Git tracking/worktree state.
- `pnpm test` in the main checkout: exit 0; 14 files / 222 tests passed.
- Assembled the plan's TypeScript blocks in `/private/tmp/feed-plan-review-zs0m0qw8`, with the prescribed import updates and case/helper insertions. Copied the existing shared ordering/types and configuration, and reused installed dependencies. No product files were created in the repository.
- Temporary-copy `pnpm test src/lib/feed`: exit 0; 1 file / 133 tests passed. `pnpm exec tsc --noEmit --incremental false`: exit 0. `pnpm exec eslint src/lib/feed src/lib/schemas/types.ts`: exit 0, with a pages-directory diagnostic because the temporary fixture contains no application routes. Vitest also emitted the existing configuration-loader warning seen on the baseline.
- These checks cover the final assembled snippets, not every intermediate TDD step, a full application build, API/database integration, live subscriptions or browser behavior. No dependency feature was marked implemented or verified by this review.

Finding Evidence below retains the initial review line numbers, after insertion of the review-feedback link and before the approved revision. Current locations are recorded separately in Implementation evidence.

## F-001: DTO drift fallback overwrites the entire shared types file

- Severity: Important
- Finding: Task 1 starts with a properly scoped addition of two page types, but if the whole-file comparison differs it directs the implementer to replace `src/lib/schemas/types.ts` with the version from the moving chunk 5 branch. Differences elsewhere are precisely when replacement is unsafe: types or contract changes already on the implementation base can be removed, or unrelated changes from the other branch imported. This exceeds the stated two-type dependency adjustment. The current branch happens to match the proposed append, so the dangerous path is conditional on the drift the plan explicitly anticipates.
- Evidence: `docs/superpowers/plans/2026-09-17-chunk-08-feed-reducer.md:110` scopes the addition; `docs/superpowers/plans/2026-09-17-chunk-08-feed-reducer.md:137` compares the whole file; `docs/superpowers/plans/2026-09-17-chunk-08-feed-reducer.md:140` prescribes whole-file overwrite on unrelated differences. Current `git diff main chunk-05-messages-api -- src/lib/schemas/types.ts` shows only the expected two declarations, while `git worktree list` confirms the branch has already advanced from the hash recorded in the plan.
- Recommendation: Check each exported declaration and its shape independently. Add only missing `MessagePage`/`CatchUpPage` declarations, preserving every existing declaration. Compare that block against a recorded source revision; if it differs, reconcile the page contract explicitly instead of replacing the file. Also replace “matching grep means chunk 5 is merged” with “both required declarations are present and compatible.”
- Decision: Accepted (2026-09-17; user: “approved”). Previously Pending.
- Implementation status: Implemented in plan. Previously Not started.
- Implementation evidence: `docs/superpowers/plans/2026-09-17-chunk-08-feed-reducer.md:146` checks each declaration separately; `:185` compares against pinned revision `f558052b691289b18aa1f4680f9e4f63d235fe6d`, limits changes to missing declarations and forbids whole-file replacement. Initial evidence: None yet. Product behavior remains unverified.

## F-002: The prescribed worktree omits the required plan and design documents

- Severity: Important
- Finding: The plan creates its implementation worktree from `main`, makes subsequent paths relative to it, and repeatedly requires consulting the approved feed design. Those documents are untracked in the original checkout and therefore absent from the new worktree. The final clean-tree expectation even relies on leaving them behind. An independent implementer cannot follow the required relative references, and the planned README would point to a design document absent from the resulting branch. This is a reproducibility and handoff gap, rather than a missing reducer dependency.
- Evidence: `docs/superpowers/plans/2026-09-17-chunk-08-feed-reducer.md:13` names the required documents; `docs/superpowers/plans/2026-09-17-chunk-08-feed-reducer.md:50` starts the worktree setup and `:58` makes paths relative to it; `:2054` adds the README design reference; `:2091` expressly leaves untracked documents in the main checkout. `git status --short` reports the plan, parent chunks document, feed design and its feedback as `??`; `git ls-files docs/superpowers/specs docs/superpowers/plans` does not list them.
- Recommendation: Add an explicit documentation handoff before execution: preferably commit the required plan/design/feedback documents to the base before branching, or copy the specific files into the new worktree and include them in an explicit documentation commit. If intentionally reading from the original checkout instead, give exact source paths and still specify how the README's design reference becomes available in the delivered branch. Adjust the final clean-tree expectation accordingly; do not sweep up unrelated untracked plans.
- Decision: Accepted (2026-09-17; user: “approved”). Previously Pending.
- Implementation status: Implemented in plan. Previously Not started.
- Implementation evidence: `docs/superpowers/plans/2026-09-17-chunk-08-feed-reducer.md:42` adds the worktree documentation handoff; `:59` lists the nine files and the copy/conflict-check/scoped-commit commands; `:2159` updates the final clean-tree expectation. All listed source documents exist. The handoff has not been executed. Initial evidence: None yet.

## F-003: Transition assertions can miss mutation of the previous state

- Severity: Improvement
- Finding: The table helper calls the reducer before constructing its expected state from `before`. If a future implementation mutates `before` and then returns it, the expected object can inherit the same mutation; even an “ignored” row checks identity without checking preserved contents. The separate merge test only checks array contents. The proposed reducer is immutable on inspection, but this suite does not independently enforce the no-mutation contract on which the future snapshot store relies.
- Evidence: `docs/superpowers/plans/2026-09-17-chunk-08-feed-reducer.md:467` calls the reducer before spreading `before` into the expected value at `:474`; the merge-only mutation test begins at `:329`. The handoff promises no input mutation at `:2099`; `docs/superpowers/specs/2026-09-16-room-feed-design.md:420` requires cached snapshots until changed.
- Recommendation: Capture an independent snapshot of `before` and `action` before reduction and assert they are unchanged afterward, or freeze state, message arrays/objects and page/action inputs before invoking the reducer. Keep the current exact next-state/effect assertions. Include at least a paging transition and an ignored action in this check.
- Decision: Accepted (2026-09-17; user: “approved”). Previously Pending.
- Implementation status: Implemented in plan. Previously Not started.
- Implementation evidence: `docs/superpowers/plans/2026-09-17-chunk-08-feed-reducer.md:510` applies immutability checks to every table row; `:530` snapshots inputs and expected output before reduction and asserts unchanged state/action afterward. Temporary-copy `pnpm test src/lib/feed`: 133 passed; `pnpm exec tsc --noEmit --incremental false` and focused ESLint exit 0. This validates proposed snippets, not a committed product test suite. Initial evidence: None yet.
