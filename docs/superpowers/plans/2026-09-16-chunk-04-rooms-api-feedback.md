# Chunk 4: Rooms API — Review feedback

**Plan:** [2026-09-16-chunk-04-rooms-api.md](2026-09-16-chunk-04-rooms-api.md)

## Current summary — 2026-09-16

**Both findings accepted and implemented in the plan; no pending findings in this companion.** F-001 defines canonical microsecond timestamps and the shared comparator at their first owner, chunk 4. It is the same underlying precision issue as [chunk 5 F-004](2026-09-16-chunk-05-messages-api-feedback.md#f-004-timestamp-truncation-can-prevent-older-history-pagination-from-advancing); that finding retains its separate downstream SQL/feed acceptance work and lifecycle record. F-002 validates error envelopes and variant payloads before returning typed client outcomes. The rooms routes, atomic creation, conflict responses, name retries, and per-box cap remain within the approved scope.

The initial review created this companion and its metadata link only. The approved follow-up revises Tasks 2 and 3, dependent timestamp expectations, verification counts, and handoffs. Product files remain unchanged.

## Approved follow-up — 2026-09-16

- User approved both findings and pointed out the duplicate precision finding in chunk 5. The two IDs remain stable and cross-linked; this change does not claim that chunk 5's independent work is complete.
- Extracted the revised Tasks 1–6 TypeScript blocks into a disposable `/private/tmp/chunk04-plan-check-4ja2qd1p` copy alongside the current baseline. `vitest run --config vitest.config.ts` passed **14 files / 222 tests**. The suite includes 20 ordering cases and 24 client cases, including the new regressions.
- `tsc --noEmit` with the probe configuration scoped to `src/lib/**/*.ts` and `src/app/api/**/*.ts` passed; ESLint passed for the six changed helper/mapper/client implementation and test snippets. An initial whole-source probe lacked Next-generated `LayoutProps`; the scoped check validates proposed library/API code, not a complete Next build.
- No database integration suite was run. Temporary snippet checks support plan consistency; statuses remain **Implemented in plan**, not product verification.

## Initial review evidence and limits

- Read the complete rooms plan, PRD v4, known limitations, applicable chunk-spec sections and viewport handoff, related review records, and relevant schemas, name helper, configuration, Supabase client, migrations, and database test helpers. Checked the installed Next.js route-handler documentation for asynchronous params.
- Repository HEAD: `021a72a`. The chunk 3 prerequisite modules exist; chunk 4 implementation files are absent in this checkout. `pnpm test` completed with exit 0: **8 files, 133 tests passed**. This verifies the existing baseline, not the proposed rooms implementation or its historical self-review claims.
- Executed the exact proposed `rows.ts` and `client.ts` blocks in memory after TypeScript transpilation, with the installed dependencies. The probes reproduced the ordering reversal and malformed-error behavior described below. Transpilation is not a full TypeScript type check.
- No database connection, migration, reset, truncation, or integration suite was run. The plan's reported earlier integration results were not independently repeated.
- Database-plan F-001 was explicitly declined by the user; this review does not reopen the generic `DATABASE_URL` override concern. Chunk 5's pending interface findings remain in its own companion. F-001 below records the shared timestamp issue at its source in this plan and cross-references that review.

## F-001: Preserve timestamp precision needed by downstream ordering

- Severity: Important
- Finding: The shared row mapper collapses distinct PostgreSQL timestamps to milliseconds and labels the resulting order discrepancy accepted for the POC. That loses information required by the accepted viewport handoff: chunk 6 must merge two boxes in the same `created_at desc, id desc` order as SQL before taking 500 rooms. With distinct creation times in one millisecond and adversarial UUID order, the client reverses the rooms and can select the wrong room at the cap boundary. The same shared mapper also feeds message ordering and the older-history continuation problem already recorded as chunk 5 F-004. The accepted limitations do not authorize this additional loss of chronology; the DTO spec gives a timestamp example, not a requirement to discard microseconds.
- Evidence: `docs/superpowers/plans/2026-09-16-chunk-04-rooms-api.md:85`, `:338`, `:458`–`:465`, `:493`, and `:2295`; `docs/superpowers/plans/2026-09-16-chunk-03-shared-domain-layer.md:69`–`:71` requires preserving SQL ordering across boxes; PRD §4 requires deterministic map order and chronological messages; `docs/superpowers/plans/2026-09-16-chunk-05-messages-api-feedback.md` F-004 records the pagination consequence. An in-memory probe of the proposed mapper used a newer room at `.123900+00:00` with UUID ending `001` and an older room at `.123100+00:00` with UUID ending `002`. Both became `.123Z`; descending timestamp/UUID sorting returned `[older, newer]` instead of SQL's `[newer, older]`.
- Recommendation: Define a shared full-precision UTC ordering representation for both Room and Message DTOs before implementing the mapper, and specify a comparator that preserves that precision instead of passing it through millisecond-only `Date` values. Align HTTP and realtime conversion and coordinate the handoffs to chunks 5, 6, and 8/9. Update mapper expectations and the exact-three-fractional-digits integration assertion. Add deterministic cases with differing microseconds inside one millisecond and UUIDs ordered against time; verify cross-box ordering/cap selection and older-page progress downstream. If a lossy display representation is retained, provide a separate precise ordering key and SQL page continuation rather than declaring the discrepancy harmless.
- Decision: Accepted (2026-09-16; user: "approved"). Previously Pending.
- Implementation status: Implemented in plan. Previously Not started.
- Implementation evidence: `docs/superpowers/plans/2026-09-16-chunk-04-rooms-api.md:85` defines the full-precision cross-chunk contract; `:325`–`:667` adds the ordering module, regression tests, shared mapper integration, and DTO documentation; `:2116` changes integration timestamps to six fractional digits; `:2456` records the viewport/message handoff and chunk 5 F-004 relationship. Temporary snippet validation is recorded above. Actual SQL continuation and viewport adapter behavior remain downstream implementation checks. Initial evidence: None yet.

## F-002: Validate error payload fields before narrowing the client union

- Severity: Improvement
- Finding: `isApiErrorBody` checks only that `error.code` is a string but claims the entire discriminated union is valid. Consequently a 400 body `{ error: { code: "validation" } }` throws a raw `TypeError` inside `fields.map`, while a 409 body `{ error: { code: "conflict" } }` resolves as `{ status: "conflict", room: undefined }`. The documented routes produce valid bodies, so this is optional resilience for malformed responses or future server drift, rather than a blocker for the current endpoints.
- Evidence: `docs/superpowers/plans/2026-09-16-chunk-04-rooms-api.md:808`–`:825` and `:857`–`:862`; Task 3 promises typed failure mapping at `:570` and already tests non-JSON failures. In-memory execution of the exact proposed client block reproduced `TypeError: Cannot read properties of undefined (reading 'map')` for the malformed validation body and the undefined-room conflict result.
- Recommendation: Narrow an error envelope separately from its variants. Require a valid field-issue array before constructing `ApiValidationError`, a valid Room before returning a conflict outcome, and a string before accepting an error message. Fall back to `ApiRequestError` with the HTTP status for malformed variants. Add fake-fetch cases for malformed validation and conflict JSON alongside the existing non-JSON tests.
- Decision: Accepted (2026-09-16; user: "approved"). Previously Pending.
- Implementation status: Implemented in plan. Previously Not started.
- Implementation evidence: `docs/superpowers/plans/2026-09-16-chunk-04-rooms-api.md:761`, `:853`, and `:860` add malformed-payload regressions; `:957`–`:1022` separates envelope parsing from field-array/Room validation and ignores non-string messages; `:1047` records 24 client tests. Temporary snippet validation is recorded above. Initial evidence: None yet.
