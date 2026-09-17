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

**Baseline.** `pnpm exec playwright test --list` before writing the spec: 30 tests in 4 files (verified via git history/prior task reports; not re-run against a pre-Task-4 tree since the file was additive only).

**Spec written verbatim.** The spec text in the brief was used exactly as given (no deviation). `pnpm lint` and `pnpm typecheck` both passed against the verbatim text on the first try, including the inline `import("@playwright/test").Request` parameter type in `watchSelectionPageRequests` — no minimal-equivalent substitution was needed.

**Step 2 — repeated run.** `pnpm test:e2e tests/e2e/shared-room.spec.ts --repeat-each=3` → **24 passed** (8 tests × 3 repeats), ~15.4s, no flakes.

**Step 2a — mutation 1 (`useSelectionUrl` routes room→none through `useRouter().replace("/")`).**
Edited `src/lib/page/selectionUrl.ts` to track the previous path in a `useRef` and call `router.replace("/")` on a room-to-none transition (opening still uses `replaceState`). After editing, warmed the dev server with two `curl` GETs to `https://map-chat.map-chat.test/` to let the hot reload land, then ran `pnpm test:e2e tests/e2e/shared-room.spec.ts -g "2. selection"`.
Result: **2 failed** (both entries).
- Entry "map": `expect(pageRequests.seen).toHaveLength(0)` failed — received `["https://map-chat.map-chat.test/?_rsc=..."]`, i.e. an RSC request to `/` was observed, exactly the request-based regression the finding (F-002) targets.
- Entry "shared URL": `expect(pathOf(page)).toBe("/")` failed — received `/room/<id>` still in the URL right after the close click, because `router.replace` resolves asynchronously and had not yet committed when the assertion ran; this is a different failure line than entry "map" but is still caused by the mutation (routing through the router instead of a synchronous `replaceState`), and it still demonstrates the test rejects the regression for the shared-URL entry (the transition to a different route tree that the brief calls out).
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

**Self-review / concerns.** The spec matches the brief's text verbatim, so there is no independent-design risk to review beyond confirming the mutation checks actually exercise the intended failure paths, which they did. The one deviation from the brief's expected wording is cosmetic: mutation 1's "shared URL" entry failed on the `pathOf(page)` assertion rather than on `pageRequests.seen`/control-identity, because `router.replace` is asynchronous and the URL had not yet updated at assertion time; this is still a correct rejection of the reviewed regression and required no test changes. No other deviations, no flakes observed across the repeated run, the two mutation attempts, or the full suite.
