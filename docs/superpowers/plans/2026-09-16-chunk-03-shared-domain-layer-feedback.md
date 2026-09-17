# Chunk 3: Shared Domain Layer — Review Feedback

**Plan:** [2026-09-16-chunk-03-shared-domain-layer.md](2026-09-16-chunk-03-shared-domain-layer.md)

## Current summary — 2026-09-16, after approval

The user approved all three findings. F-001, F-002, and F-003 are now **Accepted / Implemented in plan**. The plan corrects the whitespace fixture, defines the viewport handoff for chunks 4 and 6, and validates retry budgets with six additional test cases. Application code remains unchanged; downstream viewport behavior has not been implemented or observed.

Follow-up validation: refreshed all 16 extracted snippets in `/private/tmp/chunk03-review-tn5gyrax` from the amended plan. `node node_modules/vitest/vitest.mjs run --config vitest.config.ts` passed **133 tests in 8 files**; `node node_modules/typescript/bin/tsc --noEmit --project tsconfig.json` exited 0; ESLint over the extracted schemas, names, and Supabase modules exited 0 with the same missing-pages-directory warning. These checks validate the plan's snippets, not an implemented application.

Lifecycle history for all three findings: initial decision **Pending**, implementation status **Not started**, implementation evidence **None yet**. User approval changed the decisions to **Accepted**; the changes below advance the statuses only to **Implemented in plan**.

## Initial review — 2026-09-16

Reviewed the complete plan against PRD v4, `docs/KNOWN_LIMITATIONS.md`, the chunk specification's global constraints and shared interfaces, existing configuration modules, compiler/test configuration, and the database plan's RPC handoff.

**Result:** One blocker (F-001), one important cross-chunk correction (F-002), and one optional improvement (F-003). All decisions are pending. The schemas, DTOs, naming sequence, and client factories otherwise cover chunk 3's interfaces. No implementation changes were made; the plan received only its feedback link.

### Review evidence

- Extracted all 16 TypeScript source/test snippets verbatim into `/private/tmp/chunk03-review-tn5gyrax`, copied the existing config modules/tests, and used the repository's installed packages. The two missing name packages were extracted from integrity-checked npm cache archives: `unique-names-generator` 4.7.1 and `nanoid` 6.0.1. No repository dependencies or lockfiles were changed.
- With a temporary Vitest config reproducing the Node environment, source test include, and `@` alias, `node node_modules/vitest/vitest.mjs run --config vitest.config.ts` reported **126 passed, 1 failed, 8 files**. The sole failure is F-001. Both Supabase client test files and all 14 name tests passed. This was a snippet probe, not execution of the implementation plan.
- `node node_modules/typescript/bin/tsc --noEmit --project tsconfig.json` passed using the repository's compiler settings with the include narrowed to the probe sources and incremental output disabled. In particular, the proposed Unicode property regex is accepted by the installed compiler with the existing target; no target change is warranted by this check.
- ESLint over the extracted schemas, names, and Supabase modules using the repository's configuration exited 0. It emitted the expected missing-pages-directory warning because the probe contains no Next.js pages. No Next.js production build or database tests were run.
- Checked the installed Next.js data-security guide, current [Supabase client initialization documentation](https://supabase.com/docs/reference/javascript/initializing), and [Supabase changelog](https://supabase.com/changelog). The installed SDK and [retry release note](https://supabase.com/changelog/45071-automatic-postgrest-retries-for-transient-errors) restrict automatic transport retries to GET/HEAD, so the proposed factory does not introduce automatic write retries.
- Original finding line references below refer to the initially reviewed plan, including its two-line review-link insertion. Implementation evidence records current locations after the approved amendments.

## F-001: The whitespace-preservation test exceeds its own length limit

- Severity: Blocker
- Finding: Task 1 defines `schema = trimmedText(1, 5)` but expects parsing `"a  \n b"` to succeed. That string has six code points and no surrounding whitespace to trim, so the implementation correctly rejects it. Task 1's green-test gate and Task 6's all-tests-pass gate cannot pass as written. Changing validation to satisfy this fixture would violate the input-length contract.
- Evidence: `docs/superpowers/plans/2026-09-16-chunk-03-shared-domain-layer.md:169` defines the five-character limit; `:176`–`:177` contain the failing test; `:303` and `:1425` promise passing results. `docs/PRD.md:77`–`:80` define code-point limits after trimming. The verbatim snippet run failed only `trimmedText > keeps inner whitespace and line breaks`, with `must be between 1 and 5 characters`.
- Recommendation: Keep validation unchanged. Use a fixture of at most five code points that still exercises repeated spaces and an internal newline, such as `"a  \nb"`, or give this specific test a larger schema limit. Update both input and expected output, then rerun the suite.
- Decision: Accepted
- Implementation status: Implemented in plan
- Implementation evidence: `docs/superpowers/plans/2026-09-16-chunk-03-shared-domain-layer.md:186` now uses `"a  \nb"` for both input and output, preserving repeated internal spaces and a newline within five code points. The refreshed snippet suite passes all 18 common-schema tests (133 total).

## F-002: Clamping wrapped viewports loses visible rooms

- Severity: Important
- Finding: The reconciliation and bbox documentation direct chunk 6 to clamp Leaflet longitudes to `[-180, 180]` as the solution for wrapped bounds. A visible longitude span of `[170, 190]` becomes `[170, 180]`, silently excluding visible locations represented by `[-180, -170]`; a viewport wholly in an adjacent world copy can collapse to a zero-width box. The single non-crossing `Bbox` contract can be retained, but clamping alone is not a correct viewport adapter. No accepted limitation currently permits this omission.
- Evidence: `docs/superpowers/plans/2026-09-16-chunk-03-shared-domain-layer.md:59` mandates clamping, and `:798`–`:801` repeat it in the proposed module documentation. `docs/PRD.md:51` requires viewport pins and `:104`–`:109` require world-view discovery and refresh. [Leaflet 1.9's bounds documentation](https://leafletjs.com/reference.html#latlngbounds) explicitly represents antimeridian-crossing areas with longitudes outside `[-180, 180]`. A numeric probe confirmed that clamping `[170, 190]` excludes a visible room at longitude `-175`.
- Recommendation: Replace the unconditional clamping instruction with an explicit handoff requirement for chunk 6's map design. Normalize whole-world offsets and split a crossing viewport into two valid non-crossing boxes, with defined merging, ordering, and the combined 500-room/truncation behavior across chunks 4 and 6. If the intended POC instead displays only one non-wrapping world, specify that map restriction explicitly. Add acceptance cases for a crossing viewport, an adjacent world copy, and a view at least 360 degrees wide. The map implementation itself remains outside this chunk.
- Decision: Accepted
- Implementation status: Implemented in plan
- Implementation evidence: `docs/superpowers/plans/2026-09-16-chunk-03-shared-domain-layer.md:59` removes the clamping directive; `:64`–`:71` specify normalization, split boxes, full-world handling, combined ordering/cap/truncation, and downstream acceptance cases; `:807`–`:811` align the bbox module documentation. This is a handoff requirement only; implementation and behavioral verification remain for chunks 4 and 6.

## F-003: Validate the retry-budget override

- Severity: Improvement
- Finding: `maxRetries` accepts any number, but the loop assumes a finite nonnegative integer. `Infinity` permits unlimited plain-name attempts, `NaN` or a negative value skips the initial plain attempt, and fractions produce an undocumented retry count. The default of five is safe, and no current request exposes this option, so this is optional hardening of the exported helper.
- Evidence: `docs/superpowers/plans/2026-09-16-chunk-03-shared-domain-layer.md:1122` exposes `maxRetries?: number`; `:1140`–`:1150` consume it without validation. The naming requirement at `docs/PRD.md:205` forbids indefinite retries. A bounded probe of the extracted implementation with `maxRetries: Infinity` reached eight plain attempts and zero suffix calls before a deliberately injected non-collision error stopped it.
- Recommendation: Require `Number.isSafeInteger(maxRetries) && maxRetries >= 0` before invoking the callback and throw a descriptive `RangeError` otherwise, or remove the override if production callers do not need it. Add focused cases for negative, fractional, NaN, and infinite values while retaining the existing zero/default behavior tests.
- Decision: Accepted
- Implementation status: Implemented in plan
- Implementation evidence: `docs/superpowers/plans/2026-09-16-chunk-03-shared-domain-layer.md:889` specifies rejection before callbacks; `:1061`–`:1075` add six invalid-budget cases; `:1168`–`:1170` add the safe-integer/nonnegative guard and `RangeError`; `:1187` and `:1455` update expected counts to 20 name tests and 133 total. All amended snippet tests pass, including unchanged zero/default retry behavior. No production helper has been added.
