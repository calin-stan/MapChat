# Chunk 12: Shareable Room URL and Polish — Review Feedback

Plan: [2026-09-17-chunk-12-shareable-room-url.md](2026-09-17-chunk-12-shareable-room-url.md)

## Current summary — approved corrections, 2026-09-17

The user approved F-001, F-002 and F-003. All three are now **Accepted / Implemented in plan**. Their original findings and review evidence remain below; original line references describe the pre-correction plan. The initial decisions were Pending and implementation statuses were Not started, with no implementation evidence.

The plan now requires proof of the browser server's worktree and scoped cleanup, observes both selection paths while retaining map identity from both entry routes, includes deliberate navigation/remount regression checks, and guards `onGone` with tests for changed props and a callback supplied later. Revised expected totals are 870 unit tests and 38 browser tests; the original prototype counts remain historical.

Validation of the plan revision: `supbuddy run --help` confirmed the supported `--print` option; `supbuddy run --print -- next dev` reported `framework=next ip=127.0.0.4` and `next dev -H 127.0.0.4`, without starting a server. The complete planned Playwright spec passed a TypeScript compiler check as a virtual file against the installed project dependencies. An isolated React/jsdom probe of the exact revised effect observed one notification across equivalent room/new callback rerenders and one notification when a callback was supplied after terminal failure. These checks validate the proposed snippets only. No application implementation, live browser mutation run, server startup, or database write was performed.

## Initial review summary — 2026-09-17

Reviewed against `main` at `e79d7be`, the chunk 12 requirements and global constraints, PRD §3/§6.5, the linked map-shell, room-panel and feed contracts, known limitations, and the relevant implementation and test harness.

No blockers found. Two Important findings concern the reliability of the execution/acceptance checks; one Improvement concerns the callback's claimed once-only behavior. All decisions are Pending. The route/loader interfaces, task ordering, reducer wiring, server-only boundary, and reuse of the existing shell are consistent with the inspected code. The documented scope exclusions are explicit.

Review evidence: inspected the installed Next 16.3.5 guides for native history and not-found behavior, current source and configuration, and the official documentation linked below. Ran an isolated React 19/jsdom probe of the exact proposed `onGone` effect, described in F-003. Did not apply the implementation, rerun its prototype, start a server, or modify database data. Prototype pass counts remain the plan author's reported evidence, not fresh verification by this review. Only this companion and the plan's feedback link were changed.

## F-001: Identify the worktree served by Playwright before accepting browser results

- Severity: Important
- Finding: Execution moves into a new worktree, but the browser commands use the existing harness's shared Supbuddy URL without establishing which checkout serves it. With a dev server from the original checkout already running, Playwright reuses that server and never starts the worktree's `pnpm dev`. Task 2's existing creation scenario can pass against old code, while Task 4 can fail for an unrelated missing route. Results against a previously implemented checkout could also falsely validate the current worktree. The prototype explicitly did not exercise this startup path.
- Evidence: `docs/superpowers/plans/2026-09-17-chunk-12-shareable-room-url.md:50` records the alternate prototype server and untested Supbuddy path; `:57` requires a separate worktree; `:728` starts the first browser verification without a server-ownership check. `playwright.config.ts:4` fixes the default shared URL and `:30` checks only `/api/health` with `reuseExistingServer: true`. Room-panel design §8 (`docs/superpowers/specs/2026-09-17-room-panel-design.md:441`) requires verifying startup. Playwright documents reuse by URL/port, not checkout identity: [web server configuration](https://playwright.dev/docs/test-webserver#configuration).
- Recommendation: Add a prerequisite before the first browser command that establishes the running server's working directory and checkout, starts `pnpm dev` from this worktree through Supbuddy when necessary, and verifies that the tested URL reaches that process. Specify ownership and cleanup for any server started by the executor. Reuse only a server proven to serve this worktree; if using `E2E_BASE_URL`, document how its matching worktree server is started through the supported Supbuddy workflow. Apply the same check to final manual verification. No harness redesign is required.
- Decision: Accepted
- Implementation status: Implemented in plan
- Implementation evidence: `docs/superpowers/plans/2026-09-17-chunk-12-shareable-room-url.md:114` adds the endpoint/PID/working-directory prerequisite, supported Supbuddy startup, reuse rules, override handling and cleanup; `:741` gates the first browser run; `:1423` gates the new spec; `:1603` gates final browser/manual checks and `:1605` requires cleanup. The read-only CLI checks are recorded in the current summary. Live worktree-server verification remains for execution. Initial implementation evidence: None yet.

## F-002: The no-navigation test misses closing-route requests and shell remounts

- Severity: Important
- Finding: Scenario 2 watches only `/room/<id>`, then claims that neither opening nor closing fetched a page. A closing transition that requests `/` is invisible to this watcher. Its sentinel is attached to `document.documentElement`, which survives a Next client transition and a shell remount; unchanged history length also permits `router.replace`. Consequently the proposed acceptance test does not establish the explicit requirement that both address changes preserve the shell. Cached transitions or a local remount can also occur without a room-page request.
- Evidence: `docs/superpowers/plans/2026-09-17-chunk-12-shareable-room-url.md:30` requires no page fetch or shell remount; `:53` treats absence of room-page requests as proof; `:1181` filters requests to the room path only; `:1229` puts the sentinel on the document; `:1247` draws the broader conclusion. The installed guide `node_modules/next/dist/docs/01-app/01-getting-started/04-linking-and-navigating.md:152` explains that client transitions update page content without reloading the document; see also [Next client-side transitions](https://nextjs.org/docs/app/getting-started/linking-and-navigating#client-side-transitions).
- Recommendation: Arm request observation after initial navigation and cover document/RSC requests for both `/` and the selected room path. Add a shell/map identity or retained-state assertion across opening and closing, such as retaining an element handle for the map container and asserting it stays connected and identical after each transition, with a changed viewport retained as a user-visible check. Include the shared-URL entry path as well as `/`, because their Next route trees differ. Keep the Strict Mode caveat; absolute message-history request counts are unnecessary. Validate the test by deliberately making close navigate to `/` and by forcing a shell remount, and require it to fail for both regressions.
- Decision: Accepted
- Implementation status: Implemented in plan
- Implementation evidence: `docs/superpowers/plans/2026-09-17-chunk-12-shareable-room-url.md:1223` observes both `/` and the room path; `:1276` runs scenario 2 from both entry routes with retained control identity, changed viewport, history checks and observer cleanup; `:1428` requires navigation and remount mutations plus an unmutated rerun; `:1526` updates the README instructions. The full planned browser snippet passed the virtual-file TypeScript check described above. Browser behavior and mutation sensitivity remain unverified until execution. Initial implementation evidence: None yet.

## F-003: Narrow or enforce the once-only onGone contract

- Severity: Improvement
- Finding: A terminal `gone` value changes to true once, but that does not make the proposed effect run once: `onGone` and `room` are dependencies too. A host that retains the panel and rerenders with an equivalent room object or a fresh callback reports the same disappearance again. The proposed test's second `settle()` does not cause either dependency to change. The planned MapShell immediately unmounts the panel and uses a stable callback, so this is not a blocker for that host.
- Evidence: `docs/superpowers/plans/2026-09-17-chunk-12-shareable-room-url.md:900` names a once-only reporting test; `:908` relies on another settle; `:949` explains the effect using terminality, while `:952` includes object/function dependencies. An isolated `node --input-type=module` probe using the installed React, react-dom and jsdom ran the exact effect, transitioned `gone` from false to true, then rerendered with `room: { ...room }` and the same callback. Output: `After terminal transition: 1`; `After equivalent room prop rerender: 2`. No product files or server were involved.
- Recommendation: Either define the callback as repeatable/idempotent and narrow the test/comment accordingly, or guard reporting per panel/feed identity and add an actual rerender case with changed callback/room identity. Preserve the intended behavior when a host initially omits `onGone` and later supplies it.
- Decision: Accepted
- Implementation status: Implemented in plan
- Implementation evidence: `docs/superpowers/plans/2026-09-17-chunk-12-shareable-room-url.md:135` specifies the guarded once-per-terminal-feed contract; `:910` adds the actual rerender helper; `:921` tests changed room/callback identities; `:940` tests supplying a callback later; `:990` implements the ref guard in the plan snippet. The isolated exact-snippet probe passed as described above; the product component is unchanged. Initial implementation evidence: None yet.

## Execution evidence — Task 4 (2026-09-17)

Task 4 (`tests/e2e/shared-room.spec.ts`) implemented and run from worktree `/Users/calin/dev/other/wp-worktrees/chunk-12-shareable-url`, branch `chunk-12-shareable-url`. Tasks 1–3 were already committed and reviewed; no product files were touched except for the two temporary, fully-reverted mutations in Step 2a below.

**Server ownership (F-001).** Before the run batch: `lsof -nP -iTCP:3000 -sTCP:LISTEN -t` → PID 51179; `lsof -a -p 51179 -d cwd -Fn` → `n/Users/calin/dev/other/wp-worktrees/chunk-12-shareable-url`; `ps -o pid,ppid,command -p 51179` → `next-server (v16.3.5)`, parent PID 51172 = `node .../chunk-12-shareable-url/node_modules/.bin/../next/dist/bin/next dev -H 127.0.0.4`; `https://map-chat.map-chat.test/api/health` returned 200. Re-checked (same PID/cwd) immediately before the full-suite run in Step 3. `E2E_BASE_URL` was left unset throughout. No `pnpm test:api` / `pnpm test:db` process was running or run at any point.

**Baseline.** The pre-Task-4 total of 30 tests in 4 files comes from the brief and prior task reports, not from an `pnpm exec playwright test --list` run in this task against a pre-Task-4 tree (the new file was additive only, so no such run was made here). `pnpm exec playwright test --list | tail -1` run after writing the spec showed `Total: 38 tests in 5 files`, consistent with +8 tests in +1 file.

**Spec written verbatim.** The spec text in the brief was used exactly as given (no deviation). `pnpm lint` and `pnpm typecheck` both passed against the verbatim text on the first try, including the inline `import("@playwright/test").Request` parameter type in `watchSelectionPageRequests` — no minimal-equivalent substitution was needed.

**Step 2 — repeated run.** `pnpm test:e2e tests/e2e/shared-room.spec.ts --repeat-each=3` → **24 passed** (8 tests × 3 repeats), ~15.4s, no flakes.

**Step 2a — mutation 1 (`useSelectionUrl` routes room→none through `useRouter().replace("/")`).**
Edited `src/lib/page/selectionUrl.ts` to track the previous path in a `useRef` and call `router.replace("/")` on a room-to-none transition (opening still uses `replaceState`). After editing, warmed the dev server with two `curl` GETs to `https://map-chat.map-chat.test/` to let the hot reload land, then ran `pnpm test:e2e tests/e2e/shared-room.spec.ts -g "2. selection"`.
Result: **2 failed** (both entries).
- Entry "map": `expect(pageRequests.seen).toHaveLength(0)` failed — received `["https://map-chat.map-chat.test/?_rsc=..."]`, i.e. an RSC request to `/` was observed, exactly the request-based regression the finding (F-002) targets.
- Entry "shared URL": `expect(pathOf(page)).toBe("/")` failed — received `/room/<id>` still in the URL right after the close click, because `router.replace` resolves asynchronously and had not yet committed when the (non-retrying) assertion ran. At the time of the initial round this was recorded as a sufficient rejection of the regression; **that characterization was incomplete** — this single-read assertion firing first only proves the test caught the mutation via timing, and leaves open whether the deeper request/identity checks (`:97–104`/`:109` at the time) would themselves have caught a router navigation into a different route tree, which is the specific case the brief's "two animation frames alone are not proof" warning is about. See "Fix round 1" below for the diagnostic that resolves this.
Restored `src/lib/page/selectionUrl.ts` to its original content; `git diff --stat src/` was empty afterward.

**Step 2a — mutation 2 (`MapView` keyed by selection room id / "none" in `MapShell`).**
Edited `src/components/map/MapShell.tsx` to add `key={selection.kind === "room" ? selection.room.id : "none"}` to the `<MapView>` element (the `useSelectionUrl` call was untouched). Warmed the dev server the same way, then ran the same scenario-2-only command.
Result: **2 failed** (both entries), both on `expect(await originalControl.evaluate((element) => element.isConnected)).toBe(true)` → `Expected: true, Received: false` — the original zoom-control element handle was disconnected from the DOM after the keyed remount, exactly the "original map control disconnects with no page request" regression the finding calls for.
Restored `src/components/map/MapShell.tsx` to its original content; `git diff --stat src/` was empty afterward.

Both required mutations made scenario 2 fail on the first attempt for both entry routes (four failures total, one per entry per mutation), so no test strengthening was necessary and the two animation-frame wait plus the retained-identity/request-set assertions were not loosened.

**Step 2a.3 — restored re-runs.** After restoring both files and re-warming the server: `pnpm test:e2e tests/e2e/shared-room.spec.ts -g "2. selection"` → **2 passed**; `pnpm test:e2e tests/e2e/shared-room.spec.ts` (full new spec, unmutated) → **8 passed**.

**Step 3 — full suite.**
- `pnpm exec playwright test --list | tail -1` → `Total: 38 tests in 5 files`.
- Server ownership re-checked immediately before this run: same PID 51179, same cwd.
- `pnpm test:e2e` → **38 passed** (26.2s), 0 failures, no test skipped.
- `pnpm lint` → exit 0, no output (zero errors/warnings).
- `pnpm typecheck` → `next typegen && tsc --noEmit`, "Types generated successfully", exit 0.

**Files changed.** Only `tests/e2e/shared-room.spec.ts` (new file) and this feedback companion are part of the Task 4 commit. `git status --porcelain` at commit time showed no other modified or untracked files; the two Step 2a mutations were made and reverted in `src/`, confirmed clean via `git diff --stat src/` after each restore.

**Self-review / concerns.** The spec matches the brief's text verbatim, so there is no independent-design risk to review beyond confirming the mutation checks actually exercise the intended failure paths. Mutation 1's "shared URL" entry originally failed on the `pathOf(page)` assertion rather than on `pageRequests.seen`/control-identity, because `router.replace` is asynchronous and the URL had not yet updated at assertion time. The initial round's writeup called this "cosmetic" and said "no test strengthening was necessary" — on review that overstated what had been proven, since it was not yet established that the deeper checks would themselves reject a completed router navigation. See "Fix round 1" below, which runs the missing diagnostic and confirms the identity check does reject it. No other deviations, no flakes observed across the repeated run, the two mutation attempts, or the full suite.

## Fix round 1 — Task 4 (2026-09-17)

Addressing reviewer findings on the Task 4 evidence above.

**IMPORTANT 1 — diagnostic for the shared-URL entry's F-002 evidence.** As recommended, mutation 1 was reapplied to `src/lib/page/selectionUrl.ts` (same `useRouter().replace("/")`-on-room-to-none-transition change as before) together with a temporary `console.log("MUTATION-1-ACTIVE")` in the branch that calls `router.replace`, as live-mutation proof. In `tests/e2e/shared-room.spec.ts`, two temporary, uncommitted diagnostic edits were made to the "2. selection …" test: (1) a `page.on("console", ...)` listener that prints `DIAG saw: MUTATION-1-ACTIVE` when the mutation's log line is observed in the browser console, confirming the mutated code is actually the code under test rather than a stale HMR bundle; (2) for the shared-URL entry only, the first close's address check was changed from the single-read `expect(pathOf(page)).toBe("/")` to the retrying `await expect(page).toHaveURL(/\/$/)`, so the async `router.replace` has time to finish before `expectSameMap()` runs.

Before running: re-confirmed server ownership (`lsof -nP -iTCP:3000 -sTCP:LISTEN -t` → PID 51179; `lsof -a -p 51179 -d cwd -Fn` → this worktree's cwd), warmed the dev server with two `curl` GETs, then ran:

```
$ pnpm test:e2e tests/e2e/shared-room.spec.ts -g "2. selection preserves the map without navigation, entering from shared URL"
DIAG saw: MUTATION-1-ACTIVE
1 failed

Error: expect(received).toBe(expected) // Object.is equality
Expected: true
Received: false
    > 104 |       expect(await originalControl.evaluate((element) => element.isConnected)).toBe(true);
        at expectSameMap (tests/e2e/shared-room.spec.ts:104:80)
        at tests/e2e/shared-room.spec.ts:126:9
```

The `DIAG saw: MUTATION-1-ACTIVE` line confirms the mutated `useSelectionUrl` was live in the browser for this run. With the address check now retrying, the test passed that check (the navigation had time to complete) and failed instead inside `expectSameMap()`, on the identity check `originalControl.evaluate((element) => element.isConnected)` (the `:97–104`-range check the reviewer named) — not on the request-count check. This resolves IMPORTANT 1: the identity check, not just assertion-ordering timing, does reject a `router`-driven navigation into a different route tree for the shared-URL entry. Because the diagnostic failed on the first run, no further test strengthening was required by the brief's "if both still pass" branch.

Both diagnostic edits (the console-log mutation in `src/lib/page/selectionUrl.ts` and the two temporary edits in `tests/e2e/shared-room.spec.ts`) were then reverted with `git checkout -- src/lib/page/selectionUrl.ts tests/e2e/shared-room.spec.ts`; `git status --porcelain` and `git diff --stat` were both empty afterward, i.e. the committed spec text is unchanged from `e6c9790` and no strengthening commit was needed for this finding.

**MINOR — Baseline wording.** Reworded above: the 30-tests/4-files figure is now explicitly attributed to the brief/prior task reports rather than presented as an observed result of a run in this task.

**HMR-liveness note.** Per the review's general point that warming via `curl` is not itself evidence a mutation loaded, the diagnostic run above added a temporary `console.log` plus a `page.on("console")` listener specifically to make the loaded code observable, and confirmed it printed before trusting the failing/passing result. The original Step 2a mutation runs (mutation 1's `/` request assertion, mutation 1's original stale-URL failure, and mutation 2's disconnected-control failure) were not re-verified with an explicit liveness log; those three results are corroborated by their failure content itself (each failure message names a symptom — an observed `/`-request URL, a stale `/room/<id>` path, a disconnected element handle — that only the corresponding mutated code path can produce; unmutated code cannot produce any of the three), and by the fact that the restored/unmutated re-runs immediately after each reverted mutation passed again. No further reruns of mutation 2 or the full spec were required by the reviewer's findings, so none were repeated here.
