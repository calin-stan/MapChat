# Chunk 5: Messages API — Review feedback

**Plan:** [2026-09-16-chunk-05-messages-api.md](2026-09-16-chunk-05-messages-api.md)

## Current summary — 2026-09-16

**All five findings are accepted and implemented in the plan.** The revision aligns the helper/client contracts with chunk 4, bounds history sizes below the API cap, consumes chunk 4's now-approved precise timestamp helpers, adds real API boundary/continuation regressions, and includes both integration suites in final verification. No product implementation is claimed complete.

Chunk 4's independently updated [F-001](2026-09-16-chunk-04-rooms-api-feedback.md#f-001-preserve-timestamp-precision-needed-by-downstream-ordering) now owns the shared normalizer/comparator. This plan reuses that contract; F-004 retains the downstream SQL regression and history-cursor handoff. Dependency instructions reflect that chunk 3 is merged and chunk 4 implementation files are currently absent here. Tasks 1/1b can proceed; Task 2 waits for the shared mapper/precision helpers.

Revision checks:

- `node /tmp/check_chunk05.cjs --test-fixture` composed 17 virtual TypeScript files from the revised plan, chunk 4's current snippets, and installed dependencies: **0 diagnostics**. Pure snippet probes passed for UTC rollover/precision, both config bounds, injected fetch and typed 404 errors.
- `pnpm exec vitest run --config /tmp/chunk05-plan-check-qDqrwF/vitest.config.mjs` ran the extracted config, repository and client unit tests in a temporary directory: **3 files, 64 tests passed**. These validate proposed snippets, not an installed feature.
- No application files, migrations, database contents, or chunk 4 review records were changed by this revision. The two new database-backed API regressions remain required execution checks. Findings therefore stay at **Implemented in plan**, not Verified.

## Initial review — 2026-09-16 (preserved history)

Evidence line numbers in the findings below refer to the original reviewed plan. Current revision locations are recorded separately under Implementation evidence.

Not ready to execute unchanged: **2 Blockers and 3 Important findings**, all pending. The SQL tuple comparisons, bounded catch-up, cursor error mapping, and 250-message backlog coverage follow PRD v4. The main gaps are integration with the now-present chunk 4 contracts and pagination boundary assumptions.

Reviewed the complete plan, applicable chunk-spec sections, PRD v4 and its known limitations, current schemas/configuration/migrations/test helpers, chunk 4's relevant contracts, and installed Next.js route documentation. Repository HEAD was `021a72a` (chunk 3 merged); chunk 4 files were present as untracked work, not evidence that chunk 4 was merged. Preserve those files and verify dependency availability in the execution checkout.

Validation was read-only: an in-memory TypeScript compiler check combined the proposed snippets with current dependencies and reproduced the errors below; a Node probe confirmed timestamp order reversal. PostgREST's documented row cap was checked against local configuration. No migrations, database resets, or integration suites were run for this review. Only this companion and the plan's review link were written.

## F-001: Route validation uses the wrong shared helper contract

- Severity: Blocker
- Finding: Task 3 passes `ZodError` directly to `validationError` and imports `fieldErrors`. Chunk 4 now exports `validationError(FieldIssue[])` and `fieldIssues(ZodError)`. Its existing array helper already covers malformed JSON and unknown cursors, so the fallback condition for adding `fieldErrors` is false. Following the snippets causes missing-export and argument-type errors; bypassing type checking would also put a ZodError into the response's `fields` instead of the required array. Checking export names alone does not resolve this signature mismatch.
- Evidence: `docs/superpowers/plans/2026-09-16-chunk-05-messages-api.md:61`, `:1497`, `:1926`, `:1954`, `:1959`, `:1992`, `:2001`; actual contracts in `src/lib/api/errors.ts:19` and `:32`; chunk 4 reconciliation in `docs/superpowers/plans/2026-09-16-chunk-04-rooms-api.md:81`. The in-memory TypeScript check reported TS2305 for `fieldErrors` and four TS2345 errors for the ZodError arguments.
- Recommendation: Import `fieldIssues`; use `validationError(fieldIssues(result.error))` at each schema failure and `validationError([{ path, message }])` for explicit errors. Update the dependency table, expected signature, fallback instructions, and route snippet together. Keep chunk 4's helper intact and retain the exact 400-body assertions.
- Decision: Accepted (2026-09-16; user: "approved"). Previously Pending.
- Implementation status: Implemented in plan. Previously Not started.
- Implementation evidence: `docs/superpowers/plans/2026-09-16-chunk-05-messages-api.md:62` defines the delivered field-array contract; `:1568` checks the helpers/harness; `:2083` imports `fieldIssues` and the route maps every Zod failure through it. Explicit body/cursor errors use `validationError(fields)`. In-memory integration type checking reports zero diagnostics. Initial evidence: None yet.

## F-002: Client extension conflicts with the actual factory and shared error type

- Severity: Blocker
- Finding: Task 4 assumes an exported `api` object literal, but the client now exports `api = createApi()` with `Api` inferred from that factory. Adding a sibling to the assumed literal is not an applicable edit. Moving the proposed singleton into the factory without further changes would still bypass injected `fetchImpl`. The fallback snippet also declares `ApiErrorBody`, which already exists as an import, breaking type checking and the rooms client's discriminated error handling.
- Evidence: `docs/superpowers/plans/2026-09-16-chunk-05-messages-api.md:65`, `:2210`, `:2219`, `:2243`, `:2267`; `src/lib/api/client.ts:1`, `:70`, `:127`, `:133`; the explicit chunk 5 extension contract in `docs/superpowers/plans/2026-09-16-chunk-04-rooms-api.md:567`. An in-memory compile of the additive snippet reported TS2440 for `ApiErrorBody` and secondary errors in the existing rooms error handling.
- Recommendation: Define `MessagesApi` and `createMessagesApi(fetchImpl: FetchLike)`, then return it beside `rooms` from `createApi`. Reuse the imported error-body type and existing parsing/error helpers. Specify whether message 404s use `ApiRequestError.status === 404` or a compatible subclass, then align the handoff and tests. Test `createApi(fakeFetch).messages` so injected transport is covered, alongside the exported singleton.
- Decision: Accepted (2026-09-16; user: "approved"). Previously Pending.
- Implementation status: Implemented in plan. Previously Not started.
- Implementation evidence: `docs/superpowers/plans/2026-09-16-chunk-05-messages-api.md:2369` defines `MessagesApi` and `createMessagesApi(fetchImpl)` and extends the existing factory without redeclaring the error union; `:2274` covers the default singleton alongside injected-transport cases. Temporary execution passed all 9 proposed client tests. Initial evidence: None yet.

## F-003: Configurable history sizes can silently defeat hasMore

- Severity: Important
- Finding: History sizes accept positive integers without a maximum, while the RPC returns a row set subject to PostgREST's 1,000-row cap. With `HISTORY_INITIAL_SIZE=1000` and 1,001 matching messages, the repository requests 1,001 but receives only 1,000; `rows.length > limit` becomes false. The UI hides “Load older” despite remaining history. `HISTORY_PAGE_SIZE` has the same problem. Default-size tests cannot detect it.
- Evidence: `docs/superpowers/plans/2026-09-16-chunk-05-messages-api.md:1246`, `:1227`, `:1961`; `src/lib/config/parse.ts:35`; `supabase/config.toml:18`; configurable history and `hasMore` requirements in PRD §§6.5–6.6. [PostgREST db-max-rows documentation](https://docs.postgrest.org/en/stable/references/configuration.html#db-max-rows) confirms that the hard cap applies to function results as well as tables.
- Recommendation: Specify an enforced relationship between allowed history sizes and the API row cap, ensuring `limit + 1` is deliverable (at most 999 under the current cap), or change the RPC result contract to return page metadata without relying on an externally capped sentinel row. Coordinate any config-parser change explicitly. Add coverage at the cap boundary and for a nondefault valid history size; invalid configurations must fail clearly rather than truncate silently.
- Decision: Accepted (2026-09-16; user: "approved"). Previously Pending.
- Implementation status: Implemented in plan. Previously Not started.
- Implementation evidence: `docs/superpowers/plans/2026-09-16-chunk-05-messages-api.md:869` adds Task 1b with 1..999 config bounds and tests for both history keys; `:1320` applies the same guard in the repository; `:2014` adds the actual initial/before 999+1 row-cap regression. Temporary config/repository unit tests passed; the database-backed sentinel test is specified, not run. Initial evidence: None yet.

## F-004: Timestamp truncation can prevent older-history pagination from advancing

- Severity: Important
- Finding: Reconciliation item 8 recognizes client/server order differences but concludes that overlap plus deduplication is sufficient. The handoff then uses `oldestDisplayedId` as the next `before` cursor. Distinct microsecond timestamps collapse to one millisecond, allowing UUID sorting to choose a later SQL row as the oldest displayed row. A full older page can consist entirely of already-displayed rows; deduplication leaves the displayed oldest ID unchanged, so every click repeats the same page with `hasMore: true`.
- Evidence: `docs/superpowers/plans/2026-09-16-chunk-05-messages-api.md:95`, `:116`, `:1206`, `:1216`; PRD §4 ordering and §6.4 chronological merging. A Node probe mapped `.123100`/ID ending `002` and `.123900`/ID ending `001` to the same `.123Z`, reversing their order under the prescribed client comparator. Concrete continuation case: initial history contains A/B/C in increasing microseconds but IDs ending `003`/`001`/`002`; an older X exists. With history page size 1, displayed order is B/C/A, `before=B` returns A with `hasMore: true`, and merging A leaves B as the next cursor forever. Chunk 4 also truncates timestamps (`src/lib/db/rows.ts:6`), so a local duplicate mapper fix would be insufficient.
- Recommendation: Preserve a consistent, full-precision ordering key across HTTP and realtime, using a shared mapper/comparator, or explicitly retain older-history continuation from each server page's SQL boundary independently of display order. The latter still requires documenting the accepted display-order discrepancy and reconciling it with the PRD. Add a same-millisecond/different-microsecond test with adversarial UUID order that demonstrates actual continuation progress; identical-timestamp tie tests do not cover this case. Coordinate the handoff with chunks 4 and 8/9.
- Decision: Accepted (2026-09-16; user: "approved"). Previously Pending.
- Implementation status: Implemented in plan. Previously Not started.
- Implementation evidence: `docs/superpowers/plans/2026-09-16-chunk-05-messages-api.md:979` gates on and reuses chunk 4's precise helpers; `:111` retains older-history continuation independently of displayed/live messages; `:2034` adds a real route/SQL test with adversarial UUIDs and distinct microseconds, checking display order and progress to X. Repository timestamp expectations now retain six digits. The shared source fix is linked to chunk 4 F-001 rather than duplicated; actual SQL continuation remains an execution check. Initial evidence: None yet.

## F-005: Final verification omits chunk 4's route integration suite

- Severity: Important
- Finding: The plan still describes chunk 4 as having no plan/code and routes all integration work through `tests/db`. Chunk 4 now has a separate `tests/api` harness and plans the rooms route suite there. Task 5's “Full verification” runs only `test:db` and unit tests, so it never exercises those routes after shared API helpers and client integration change. The separate suites also share destructive fixture cleanup, but the concurrency note mentions only competing `test:db` runs.
- Evidence: `docs/superpowers/plans/2026-09-16-chunk-05-messages-api.md:35`, `:90`, `:110`, `:2337`; `vitest.api.config.ts:5`, `:17`; chunk 4 harness and downstream messages-test contract in `docs/superpowers/plans/2026-09-16-chunk-04-rooms-api.md:902` and `:911`. At review time the API harness files existed untracked, while the `test:api` package script had not yet been added; this is a dependency to reconcile, not a claim that its suite already passes.
- Recommendation: Refresh prerequisite status without treating untracked files as merged dependencies. Reuse the route harness for messages tests once chunk 4 lands, or document why a separate harness remains necessary. Include `pnpm test:api` in final verification after its script lands and run it sequentially with `test:db`; update the shared-database warning and expected suite counts accordingly.
- Decision: Accepted (2026-09-16; user: "approved"). Previously Pending.
- Implementation status: Implemented in plan. Previously Not started.
- Implementation evidence: `docs/superpowers/plans/2026-09-16-chunk-05-messages-api.md:1568` requires chunk 4's API harness; the route tests now live in `tests/api` and use its setup/helpers. `:2489` runs `test:db` then `test:api`, followed by unit/lint/type/build checks. Prerequisites and the shared-database concurrency warning were refreshed. Initial evidence: None yet.
