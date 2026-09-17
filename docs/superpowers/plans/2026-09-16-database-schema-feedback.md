# Database Schema Plan Review

**Plan:** [2026-09-16-database-schema.md](2026-09-16-database-schema.md)

**Reviewed:** 2026-09-16

## Current summary

F-001 is declined by the user and no longer blocks execution. F-002 and F-003 are accepted and implemented in the plan. No review findings remain pending. Live database and RPC verification is still required during implementation; the prerequisite observations below are historical snapshots. No optional improvements recorded.

The proposed tables, index, coordinate and Unicode length constraints, RLS policies, grants, atomic insertion function, and publication membership match the database requirements in PRD sections 4 and 6. Deferring server-side trimming/rounding, name generation, route handlers, concurrency integration tests, and realtime delivery tests is consistent with the stated task boundaries. Accepted limitations in `docs/KNOWN_LIMITATIONS.md` are not reopened here.

The initial review added only the feedback companion and its link in the plan. Follow-ups correct the six targeted Vitest commands under F-003 and define the RPC error contract and live contract tests under F-002. No application code changes or migrations were made.

## Review evidence and limits

- Read the full plan, `docs/PRD.md`, `docs/KNOWN_LIMITATIONS.md`, the scaffolding prerequisite and its existing feedback, and relevant repository configuration.
- Confirmed the test-filter behavior with the installed pnpm 10.9.0 and Vitest 5.0.1: `pnpm test -- deliberately-absent-review-filter` ran all 19 existing tests successfully; `pnpm test deliberately-absent-review-filter` reported no test files and exited 1. This checks argument forwarding, not the proposed database tests.
- Checked the RPC error representation against [PostgREST's official error documentation](https://docs.postgrest.org/en/stable/references/errors.html#errors-from-postgresql).
- The plan's prerequisite snapshot needs refreshing before execution: HEAD is now `25ceaee`, `next.config.ts` is modified, and untracked `supabase/config.toml` exists with `project_id = "wp"` and the stock ports. `.supbuddy/` and `.env.local` are absent. These observations do not establish a healthy Supbuddy-managed stack.
- The installed Supabase CLI failed attempting to write telemetry outside the workspace sandbox, so its status/version could not be verified here. No database connection, reset, migration, or truncation was performed. The proposed SQL and database tests have not been runtime-verified by this review.

## F-001: Prevent destructive tests from following an unrelated DATABASE_URL

- Severity: Blocker
- Finding: `resolveDatabaseUrl()` immediately accepts any inherited `DATABASE_URL`. The table suites then run `TRUNCATE public.chatrooms CASCADE` before every test. A shell configured for another database can therefore erase its rooms and messages, while `db:migrate` and `db:reset` still target the CLI's local project. Checking the local stack once in Task 1 does not constrain later `pnpm test:db` runs or the override. The README also omits that the tests delete existing data.
- Evidence: `docs/superpowers/plans/2026-09-16-database-schema.md:189`–`191` accepts the override without validation; `:241`–`:243` truncates the tables; `:132`–`:133` fixes migration/reset commands to `--local`; `:1398`–`:1399` documents the override without the destructive behavior. This contradicts the plan's local, disposable database assumption at `:69`–`:71`.
- Recommendation: For this local-only suite, resolve the target from this project's `supabase status` on every run and remove the unrestricted generic override. If an override is retained, require it to identify that same local instance, checking host, port and database before opening any connection or running setup; a loopback-host check alone cannot distinguish other local projects. Add database-free tests proving that a mismatched target is rejected before connection/truncation, and explicitly document that `pnpm test:db` deletes the local chat data.
- Decision: Declined (2026-09-16; user: "don't worry about an unrelated DATABASE_URL"). Previously Pending at initial review.
- Implementation status: Not applicable. Previously Not started.
- Implementation evidence: No changes made for this finding, as requested. Initial evidence: None yet.

## F-002: Define the conflict contract at the PostgREST boundary

- Severity: Important
- Finding: Task 4 promises downstream route handlers an RPC error containing `constraint_name`, but tests call the function over the PostgreSQL wire protocol using postgres.js. PostgREST's documented error body contains `code`, `message`, `details`, and `hint`, without a separate `constraint_name` field. The constraint can appear in the message, but the plan does not define how the HTTP caller extracts it. A route implemented against the stated field can fail to distinguish name retries from coordinate conflicts even though all database tests pass.
- Evidence: `docs/superpowers/plans/2026-09-16-database-schema.md:1052` combines the `constraint_name` promise with the Supabase `rpc(...)` interface; `:1109`–`:1121` tests direct SQL instead; `:1187`–`:1208` checks postgres.js diagnostics. `docs/PRD.md:156`–`:158` selects the Supabase service-role API, and `:207`–`:208` requires distinguishing the two conflicts. See [PostgREST error representation](https://docs.postgrest.org/en/stable/references/errors.html#errors-from-postgresql).
- Recommendation: Separate the direct-SQL diagnostic contract from the HTTP contract. Specify a supported way for the route to recognize each named constraint in the actual RPC error, such as exact extraction from the constraint-bearing message, or deliberately structured error details. Add a local PostgREST RPC contract check for both collisions and atomic rollback. The route implementation may remain in the later API plan, but its input contract should be defined and checked here; do not require a field that PostgREST does not expose.
- Decision: Accepted (2026-09-16; user: "f-002 is approved"). Previously Pending at initial review and while awaiting the requested explanation.
- Implementation status: Implemented in plan. Previously Not started.
- Implementation evidence: `docs/superpowers/plans/2026-09-16-database-schema.md:1056` and `:1058` separate direct SQL diagnostics from the HTTP error contract, including exact constraint matching and unknown-error handling. Task 4 Step 5 at `:1354` specifies the Supabase client dependency, local API credentials, classifier, and five contract tests covering success, both collisions, rollback, and unrecognized errors. The five-file suite expectations are at `:1411` and `:1486`; README instructions at `:1464` explain the HTTP contract. The SQL function remains unchanged. These are plan edits only, not observed RPC behavior. Initial evidence: None yet.

## F-003: Remove the extra separator from targeted Vitest commands

- Severity: Important
- Finding: The examples use `pnpm test:db -- tests/db/<file>.test.ts`. With the installed tooling, pnpm forwards the literal `--` to Vitest, and Vitest ignores the following filename as a test filter. These commands run every included database file instead of the intended task's file. This makes the per-file verification claims inaccurate, unnecessarily reruns destructive setup, and can report success even if the intended filename is wrong or missing.
- Evidence: `docs/superpowers/plans/2026-09-16-database-schema.md:597`, `:653`, `:937`, `:1005`, `:1272`, and `:1341` use the extra separator. The command comparison in this review's evidence section reproduced the ignored filter on the existing `test` script, which also invokes `vitest run`.
- Recommendation: Use `pnpm test:db tests/db/chatrooms.test.ts` and the equivalent direct filename arguments for the other tasks. Verify file selection with `pnpm exec vitest list --config vitest.db.config.ts --filesOnly tests/db/chatrooms.test.ts`; require exactly the requested file. Keep `pnpm test:db` for the intentional whole-suite checks.
- Decision: Accepted (2026-09-16; user: "do it"). Previously Pending at initial review.
- Implementation status: Implemented in plan. Previously Not started.
- Implementation evidence: Removed the extra `--` from all six targeted commands in `docs/superpowers/plans/2026-09-16-database-schema.md:597`, `:653`, `:937`, `:1005`, `:1272`, and `:1341`. Whole-suite commands are unchanged. These are plan edits only; the database suite and its config do not yet exist, so database file selection remains to be checked during implementation. Initial evidence: None yet.
- Location update after F-002: the six corrected commands are now at `docs/superpowers/plans/2026-09-16-database-schema.md:598`, `:654`, `:938`, `:1006`, `:1278`, and `:1347`. The added RPC command at `:1397` also uses the corrected syntax.
