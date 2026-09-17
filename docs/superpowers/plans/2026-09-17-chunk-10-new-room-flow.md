# Chunk 10: New Chatroom Flow Implementation Plan

**Review feedback:** [2026-09-17-chunk-10-new-room-flow-feedback.md](2026-09-17-chunk-10-new-room-flow-feedback.md)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the draft pin into a room: click an empty spot, name yourself, write a message, press Create and land in a live room that already shows that message; when somebody else's room is already at that spot, land in it with a notice and the unsent draft; when the request fails, get the submitted draft back at the submitted spot.

**Architecture:** `NewRoomPopup` owns the create call and reports `created`, `conflict` or `failed` to `MapShell`; it never posts a message. `MapShell` keeps a small pure `handoffReducer` around the unchanged `selectionReducer`: it adds a monotonically increasing **revision**, which is part of both panel keys, and the **recovery** payload of a rejected create. Every outcome updates selection, revision and recovery in one state update, so the panel it opens is always a fresh mount, even for a room that is already open. `RoomPanel` derives the 409 notice from `prefill`, and `ComposeForm` gains three optional props (`autoFocusField`, `submitFailedMessage`, `initialErrors`).

**Tech Stack:** TypeScript 5 (`strict`), Next.js 16.3.5 App Router, React 19.2.8, Tailwind CSS 4, shadcn/ui (style `base-nova`, Base UI; this chunk adds `tooltip`), `react-icons`, Vitest 5 with jsdom 30 and Testing Library, `@playwright/test` on chunk 9's harness (Chromium only), pnpm 10, Node 22.

**Spec:** `docs/superpowers/specs/2026-09-17-new-room-flow-design.md` (approved revision of 2026-09-17; its companion `2026-09-17-new-room-flow-design-feedback.md` records the accepted findings F-001–F-004). Read together with `docs/superpowers/specs/2026-09-17-room-panel-design.md` §3, §4, §4.1, §8 and `docs/superpowers/specs/2026-09-16-map-shell-design.md` §3, §5.2, §6, §8. Parent: `docs/superpowers/specs/2026-09-16-map-chat-implementation-chunks.md` §0 and "Chunk 10". PRD (`docs/PRD.md`): §3 Flow A, §4 (Compose behavior), §6.5 (409), §6.7. Executors read the new-room spec before Task 1; this plan argues from it and does not restate it.

## Global Constraints

Copied from the chunks document §0 and the specs where they apply to this chunk:

- Language: TypeScript, `strict: true`, no `any` in committed code.
- Package manager: pnpm (`packageManager: pnpm@10.9.0`). Node 22 LTS.
- Framework: Next.js 16, App Router. `AGENTS.md`: this Next.js has breaking changes; read the relevant guide under `node_modules/next/dist/docs/` before writing Next-specific code. This plan writes no Next-specific code except one more `page.dev.tsx` fixture under the dev-only page extension chunk 9 configured.
- UI: React 19, Tailwind, shadcn/ui components wherever one fits; icons from `react-icons`.
- Supbuddy manages the local stack. Never edit `/etc/resolver/` files or a `Caddyfile`; start the dev server with `pnpm dev` (`supbuddy run -- next dev`); do not run a bare `supabase start`.
- Desktop only. The draft form lives in the one floating panel (`PanelFrame` in the top-right slot), not in a Leaflet popup.
- Copy, verbatim:
  - Title `New chatroom` · submit label `Create` · info button `aria-label="About new chatrooms"`.
  - Info text: `This chatroom will receive a name after the first message is sent.`
  - Hint: `Your first message creates a chatroom at 46.771200, 23.623600.` The numbers are `roundCoord(lat).toFixed(6)` and `roundCoord(lng).toFixed(6)`, latitude first.
  - `MOVED_NOTICE_TEXT`: `A chatroom already exists here, you have been moved to it. Your message has not been sent.` Dismiss button `aria-label="Dismiss"`, `role="status"`.
  - `CREATE_FAILED_MESSAGE`: `Couldn't confirm creation. A chatroom may already exist at the submitted spot. Retry at the same spot to open it if it exists. Moving the pin starts a separate creation at the new spot.`
- The raw click coordinates are sent to the server; the server rounds them and is the source of truth.
- A create outcome always takes over the panel, whatever is selected when it settles. Outcome callbacks are never guarded behind an "is mounted" check. No automatic retry of any write. The popup never posts a message; on a conflict nothing is written.
- `src/lib/page/selection.ts` and `src/lib/map/useRoomPins.ts` are **not modified**.
- The map is not locked and shows no busy state while a create is pending; `ComposeForm`'s disabled controls are the only pending indicator.
- Info bubble: stock shadcn `Tooltip`, hover and keyboard focus only; no controlled state, no click handler, no provider in `app/layout.tsx`.
- Layout: at 1280 × 720 CSS pixels the room panel keeps at least 96 px of message viewport with `MovedNotice`, the fetch alert, the backlog notice and a compose error together; the popup's Create and close buttons stay inside the viewport with a draft close to 3000 code points; the page never gets a scrollbar. Both message fields use the same bounded class (`field-sizing-fixed h-16 resize-none overflow-y-auto`).
- Tests: Vitest, TDD (failing test first). Unit tests colocated as `*.test.ts(x)`; component files opt in with `// @vitest-environment jsdom` on the first line. Target one path with `pnpm test <path>` **without** `--`.
- End-to-end: chunk 9's harness with its rules unchanged: Chromium, explicit 1280 × 720 viewport, real dev server and local Supabase, data through the real API, role and visible-text selectors only, `page.clock` for poll timing, no database reset. Never run `pnpm test:api` or `pnpm test:db` while `pnpm test:e2e` runs (they truncate tables).
- Lint: `pnpm lint` must pass with zero errors and zero warnings after every task. Typecheck: `pnpm typecheck` (`next typegen && tsc --noEmit`) must exit 0.
- Commits: conventional commits, one commit per task. This repository has no GitButler workspace, so the steps use plain `git`; if GitButler is active when you execute, use the `commit` skill with the same messages.

## Prerequisites (verified on 2026-09-17)

- **Chunk 9 is not implemented.** On 2026-09-17 `main` is at `f8577a3` (merge of `chunk-08-feed-reducer`); the branch `chunk-09-room-panel` holds one documentation commit and no code. This plan **must not be executed until chunk 9 is merged into `main`**. Task 1 is a gate that checks chunk 9's real exports against the names used here.
- What this chunk consumes from chunk 9, by the names in `docs/superpowers/plans/2026-09-17-chunk-09-room-panel.md`: the `seed` field on the room selection and `roomCreated.message` (its Task 6); `ComposeForm.textareaClassName` (Task 7); `RoomPanel`, `RoomPanelProps`, the private `TEXTAREA_CLASS`, the panel's `submit` adapter, shadcn `alert` with `AlertAction`, `src/lib/feed/test-helpers.ts` (`deferred`, `Deferred`, `fakeMessages`, `msg`, `page`), and the `setup` / `openPolling` / `settle` helpers of `RoomPanel.test.tsx` (Task 8); `PanelSlot` and the `MapShell` that renders `RoomPanel` (Task 9); keyboard-operable pins (Task 10); the Playwright harness, `tests/e2e/helpers.ts`, the dev-only `dev.tsx` page extension (Task 11); `tests/e2e/room-panel.spec.ts` (Task 12); the `/e2e/room-panel-layout` fixture and its layout test (Task 13).
- Present on `main` today, with the names this plan uses: `api.rooms.create`, `RoomsApi`, `CreateRoomOutcome`, `ApiValidationError`, `ApiRequestError` (`src/lib/api/client.ts`); `CreateRoomInput`, `roundCoord` (`src/lib/schemas/room.ts`); `PanelFrame` with `titleAdornment` (`src/components/panel/PanelFrame.tsx`); `useRoomPins().insertRoom` (`src/lib/map/useRoomPins.ts`); `selectionReducer`, `Prefill` (`src/lib/page/selection.ts`); `ComposeForm`, `submitErrors`, `toComposeErrors`, `SUBMIT_FAILED_MESSAGE` (`src/components/compose/`); `useDisplayName`, `DISPLAY_NAME_KEY` (`src/lib/storage/`); `FaInfoCircle` in the installed `react-icons`.
- `pnpm exec shadcn view tooltip` (project CLI, style `base-nova`) returns one file, `src/components/ui/tooltip.tsx`, built on `@base-ui/react/tooltip` and exporting `Tooltip`, `TooltipTrigger`, `TooltipContent`, `TooltipProvider`. Base UI's tooltip works without a provider. The CLI lists `cn` as a dependency; it is already installed.
- **Prototype.** On 2026-09-17 the code of this plan was prototyped in a scratch worktree of `main` into which chunk 9's planned source files were extracted from its plan (chunk 9's own 695 tests passed there, less five from two of its edit-in-place steps that were not applied). Results with this plan's code added: `pnpm test` 40 files / 771 tests (776 with those five), `pnpm lint` and `pnpm typecheck` clean, `pnpm build` route list without `/e2e`, and `tests/e2e/new-room.spec.ts` 5 tests × 6 repeats passing in Chromium (`@playwright/test` 1.63.0) against `next dev -p 3100 -H 127.0.0.1` and the local stack. The extended layout fixture left **123 px** of message viewport with all four footer notices (requirement: 96 px). The `pnpm dev`/Supbuddy start-up path was not exercised. Because chunk 9's delivered code may differ from its plan, treat every "Expected" number below as an execution requirement: where your run disagrees, stop and investigate rather than adjust a test.

## Before you start: worktree and documents

Execute this plan in its own worktree, following the sibling convention in use, **after chunk 9 is merged into `main`**:

```bash
cd /Users/calin/dev/other/wp
git log --oneline -1 main        # must be at or after the merge of chunk-09-room-panel
git worktree add -b chunk-10-new-room /Users/calin/dev/other/wp-worktrees/chunk-10-new-room main
cd /Users/calin/dev/other/wp-worktrees/chunk-10-new-room
```

The spec set of this chunk is not committed on `main` at writing time. Bring exactly these files into the worktree and commit them first. The script copies the named files from the main checkout over the worktree's copies and commits only them; if they were committed on `main` in the meantime it commits nothing.

```bash
chunk_docs=(
  docs/superpowers/plans/2026-09-17-chunk-10-new-room-flow.md
  docs/superpowers/specs/2026-09-17-new-room-flow-design.md
  docs/superpowers/specs/2026-09-17-new-room-flow-design-feedback.md
  docs/superpowers/specs/2026-09-16-map-chat-implementation-chunks.md
)
for chunk_doc in "${chunk_docs[@]}"; do
  test -f "/Users/calin/dev/other/wp/$chunk_doc" || exit 1
  mkdir -p "$(dirname "$chunk_doc")" || exit 1
  cp "/Users/calin/dev/other/wp/$chunk_doc" "$chunk_doc" || exit 1
done
git add -- "${chunk_docs[@]}"
if ! git diff --cached --quiet -- "${chunk_docs[@]}"; then
  git commit --only -m "docs(room): add the new chatroom flow design, its review and the chunk 10 plan" -- "${chunk_docs[@]}"
fi
git ls-files --error-unmatch -- "${chunk_docs[@]}"
grep -c "2026-09-17-new-room-flow-design.md" docs/superpowers/specs/2026-09-16-map-chat-implementation-chunks.md
```

Expected: all four files are tracked; the last command prints `1` or more (the chunks document points chunk 10 at the spec). If this plan has a review companion (`2026-09-17-chunk-10-new-room-flow-feedback.md`) when you execute, add it to the list.

```bash
pnpm install
pnpm db:env          # writes .env.local from the running stack (needed by the e2e task)
```

Every path below is relative to this worktree.

## Spec reconciliation and design decisions

The spec wins on everything not listed here. These are the points where the plan pins down something the spec leaves open, or departs from its wording.

1. **The shell-local arrangement is a pure reducer in its own module**, `src/lib/page/handoff.ts`: `handoffReducer` wraps `selectionReducer` and holds `{ selection, revision, recovery }`. The spec (§6) leaves the arrangement to this plan and only requires that the selection reducer and its actions stay unchanged and that every outcome updates metadata and selection atomically; one `useReducer` dispatch does that. The module is not in the spec's file list. `src/lib/page/selection.ts` is not touched.
2. **Panel keys** are `draft:<revision>` and `<room.id>:<revision>` (`draftPanelKey`, `roomPanelKey`). Ordinary draft moves, close and pin clicks never change the revision; `created`, `conflict` and `failed` each increment it.
3. **Recovery lives as long as the draft it restored.** Moving the recovered draft keeps it (the form's restored values are its `initial*` props, so dropping the recovery would blank an untouched form); close and selecting a room clear it; every outcome replaces or clears it.
4. **The bounded textarea class moves next to `ComposeForm`** as the exported `BOUNDED_TEXTAREA_CLASS`, because chunk 9's plan keeps it private to `RoomPanel` (spec §4 asks for this in that case). `RoomPanel` imports it.
5. **`submitFailedMessage` is threaded through `submitErrors(error, fallback)`**, a second optional parameter with the old message as default, so every existing caller is unchanged. `NewRoomPopup` uses the same function to turn a recovery's error into `initialErrors`.
6. **`createRoom` defaults at call time** (`createRoom ?? api.rooms.create` inside `submit`), so a module-level mock of `api` installed per test is honoured.
7. **`NEW_ROOM_INFO_TEXT` is exported** from `NewRoomPopup.tsx` next to `CREATE_FAILED_MESSAGE`, so tests import the copy instead of retyping it.
8. **New shell tests live in two new files**, not in `MapShell.test.tsx`: `MapShell.newRoom.test.tsx` (mocked `useRoomPins`, real popup and real room panel against a scripted API) and `MapShell.pins.test.tsx` (the real `useRoomPins`, which the first file mocks at module level). `MapShell.test.tsx` keeps chunk 9's cases and gets one assertion updated. The spec lists these cases under `MapShell.test.tsx`; separate files keep each mock set small.
9. **The tooltip is generated with the project's CLI** (`pnpm exec shadcn add tooltip -y`), as chunk 9 generates `alert`, instead of `pnpm dlx shadcn@latest`: the pinned CLI is the one the prototype used.
10. **`clickEmptySpot(page)` uses `page.request`** for its `GET /api/rooms?bbox=` check, so its signature stays the spec's. It also retries a click that produced nothing: the map's click handler attaches just after the zoom control becomes visible, and under parallel workers a first click can land in that gap (seen once in 15 prototype runs before the retry, never in 30 after).
11. **Panel titles are asserted by visible text**, not by a heading role: shadcn's `CardTitle` is a `div`. The room name comes from the `POST /api/rooms` response and is matched against the name pattern; the pin is found by its `title` attribute (`getByTitle`), which `getByText` never matches.
12. **Scenario 1's request assertions** collect every request to `/api/rooms/<id>/messages` from page load. A seeded room polls at once (the stand-in realtime adapter refuses on the next macrotask), so the test waits for that first catch-up, then fast-forwards 30 s and expects one more; every `after` value must equal the first message's id and no request may lack `after`.
13. **The recovered-popup layout fixture is its own dev-only page**, `/e2e/new-room-layout`. The room-panel layout fixture gains a `prefill`, and chunk 9's existing layout test is renamed and extended instead of duplicated.
14. **Documentation.** Besides the spec's README and known-limitations entries, the linked architecture documents still describe the pre-Chunk-10 placeholder, room-ID-only panel key, and direct `selectionReducer` wiring. Task 8 updates map-shell design §§3, 6, and 8 plus the room-panel design's MapShell snippet so every linked contract names `NewRoomPopup`, `handoffReducer`, and the revision-aware keys. It keeps the historical selection-reducer transition table intact and also corrects the §8 header cell to `room.name` (spec decision 5 removes `RoomTitle` from the target layout).

## File structure

| Path | Responsibility | Task |
| --- | --- | --- |
| `src/components/compose/ComposeForm.tsx`, `ComposeForm.test.tsx` (modify) | `autoFocusField`, `submitFailedMessage`, `initialErrors`; `BOUNDED_TEXTAREA_CLASS` | 2 |
| `src/components/compose/fieldErrors.ts`, `fieldErrors.test.ts` (modify) | `submitErrors(error, fallback?)` | 2 |
| `src/components/room/RoomPanel.tsx` (modify) | Imports `BOUNDED_TEXTAREA_CLASS` (2); `MovedNotice`, `sentOnce`, focus rule (4) | 2, 4 |
| `src/components/ui/tooltip.tsx` | shadcn `tooltip` (generated) | 3 |
| `src/components/room/NewRoomPopup.tsx`, `NewRoomPopup.test.tsx` | The draft panel, its info bubble, the create call | 3 |
| `src/components/room/MovedNotice.tsx` | The 409 notice | 4 |
| `src/components/room/RoomPanel.test.tsx` (modify) | Notice and focus cases | 4 |
| `src/lib/page/handoff.ts`, `handoff.test.ts` | `handoffReducer`, `initialHandoff`, panel keys | 5 |
| `src/components/map/MapShell.tsx`, `MapShell.test.tsx` (modify) | Renders `NewRoomPopup`; outcome callbacks; keyed panels | 6 |
| `src/components/map/MapShell.newRoom.test.tsx`, `MapShell.pins.test.tsx` | Hand-off, take-over, recovery, settlement order; pin retention | 6 |
| `tests/e2e/helpers.ts` (modify), `tests/e2e/new-room.spec.ts` | `clickEmptySpot`; scenarios 1–3 | 7 |
| `src/app/e2e/new-room-layout/page.dev.tsx` | Dev-only recovered-popup fixture | 7 |
| `src/app/e2e/room-panel-layout/page.dev.tsx`, `tests/e2e/room-panel.spec.ts` (modify) | The layout fixture gains the notice | 7 |
| `README.md`, `docs/KNOWN_LIMITATIONS.md`, `docs/superpowers/specs/2026-09-16-map-shell-design.md`, `docs/superpowers/specs/2026-09-17-room-panel-design.md` (modify) | Documentation | 8 |

Dependency order: 1 → 2 → 3 → 6; 2 → 4 → 6; 5 → 6; 6 → 7 → 8. Tasks 3, 4 and 5 are independent of each other.

---

### Task 1: Gate: chunk 9 is merged and matches its contracts

No code is written in this task. It decides whether the rest of the plan can run as written.

**Files:** none.

**Interfaces:**
- Consumes: chunk 9's delivered source.
- Produces: a recorded baseline (`pnpm test` file and test counts, `pnpm test:e2e` test count) that later "Expected" lines add to. This plan calls them **B-files**, **B-tests** and **B-e2e**; chunk 9's plan predicts 36, 695 and 18.

- [ ] **Step 1: Check that chunk 9 is on this branch**

```bash
git log --oneline | grep -c "chunk-09\|room panel\|feat(room)"
ls src/components/room/RoomPanel.tsx src/lib/feed/useRoomFeed.ts src/components/panel/PanelSlot.tsx \
   src/components/ui/alert.tsx playwright.config.ts tests/e2e/helpers.ts tests/e2e/room-panel.spec.ts \
   src/app/e2e/room-panel-layout/page.dev.tsx
```

Expected: the first command prints a number greater than 0 and `ls` lists all eight files. If any file is missing, **stop**: chunk 9 is not merged. Report that to the user and do not continue; do not create stand-ins for chunk 9's files.

- [ ] **Step 2: Verify the exports and helpers this plan names**

```bash
grep -c 'seed?: Message\|type: "roomCreated"; room: Room; message: Message' src/lib/page/selection.ts
grep -c "export type RoomPanelProps\|export function RoomPanel\|seed?: Message;\|prefill?: Prefill;\|feedDeps?: Partial<FeedDeps>;\|async function submit(input: PostMessageInput)" src/components/room/RoomPanel.tsx
grep -c 'const TEXTAREA_CLASS = "field-sizing-fixed h-16 resize-none overflow-y-auto";' src/components/room/RoomPanel.tsx
grep -c "textareaClassName" src/components/compose/ComposeForm.tsx
grep -c "export function useRoomFeed\|export type RoomFeedOptions" src/lib/feed/useRoomFeed.ts
grep -c "export function \(msg\|deferred\|fakeMessages\|fakeRealtime\|manualTimers\)\|export const page\|export type Deferred" src/lib/feed/test-helpers.ts
grep -c "export function PanelSlot" src/components/panel/PanelSlot.tsx
grep -c "^function AlertAction\|^function AlertDescription\|^function Alert(" src/components/ui/alert.tsx
grep -c "^function setup\|^async function openPolling\|^const settle" src/components/room/RoomPanel.test.tsx
grep -c "key={selection.room.id}" src/components/map/MapShell.tsx
grep -c "export async function \(createRoom\|openRoom\|fillCompose\)\|export const rows\|export const POLL_INTERVAL_MS\|export { ROOM_REGION }\|export type \(Room\|Message\) " tests/e2e/helpers.ts
grep -c '"dev.tsx"' next.config.ts
grep -c "fit together with the long draft" tests/e2e/room-panel.spec.ts
```

Expected, in order: `2`, `6`, `1`, `3`, `2`, `7`, `1`, `3`, `3`, `1`, `8`, `1`, `1`.

If a count differs, open that file and read the real name or signature. A renamed symbol or a moved helper is drift to carry through every later task before writing code (spec §2 makes this the plan's first obligation). Two cases change a task's content rather than a name:
- `TEXTAREA_CLASS` count `0` because chunk 9 already exported a bounded-class constant: in Task 2 skip the constant's definition and the `RoomPanel` edit, and use chunk 9's exported name wherever this plan says `BOUNDED_TEXTAREA_CLASS`.
- `RoomPanel`'s `submit` adapter or footer differs from chunk 9's plan: Task 4's edits are described by intent as well as by text; apply the intent.

Anything you cannot resolve by reading the source is a question for the user, not an assumption.

- [ ] **Step 3: Record the baseline**

```bash
pnpm test && pnpm lint && pnpm typecheck
```

Expected: everything passes; lint and typecheck are clean. Record **B-files** and **B-tests** from the `Test Files` and `Tests` lines (chunk 9's plan predicts 36 and 695).

With the local Supabase stack running (`pnpm db:status`; start it from Supbuddy if not):

```bash
pnpm test:e2e
```

Expected: all pass. Record **B-e2e** (chunk 9's plan predicts `18 passed`). If the web server step times out, follow chunk 9's README section "End-to-end tests" (run `pnpm dev` in a second terminal, make `/api/health` answer 200, or use `E2E_BASE_URL` with `pnpm exec next dev -p 3100 -H 127.0.0.1`). Do not edit resolver files or a `Caddyfile`.

No commit in this task.

---

### Task 2: `ComposeForm` additions

**Files:**
- Modify: `src/components/compose/ComposeForm.tsx`, `src/components/compose/fieldErrors.ts`, `src/components/room/RoomPanel.tsx`
- Test: `src/components/compose/ComposeForm.test.tsx`, `src/components/compose/fieldErrors.test.ts` (modify)

**Interfaces:**
- Consumes: `ComposeFormProps` with chunk 9's `textareaClassName`; `submitErrors(error)`, `ComposeErrors`, `SUBMIT_FAILED_MESSAGE` from `@/components/compose/fieldErrors`.
- Produces:
  - `ComposeFormProps.autoFocusField?: "author" | "text"`: focuses that field once, the first time the form is enabled after mount.
  - `ComposeFormProps.submitFailedMessage?: string` (default `SUBMIT_FAILED_MESSAGE`): the form-level line for a rejection that is neither a validation error nor `unavailable`.
  - `ComposeFormProps.initialErrors?: ComposeErrors`: the form's errors at mount; later values are ignored.
  - `export const BOUNDED_TEXTAREA_CLASS = "field-sizing-fixed h-16 resize-none overflow-y-auto"` from `@/components/compose/ComposeForm`.
  - `submitErrors(error: unknown, fallback: string = SUBMIT_FAILED_MESSAGE): ComposeErrors`.

- [ ] **Step 1: Add the failing `submitErrors` tests**

Append to the end of `src/components/compose/fieldErrors.test.ts` (the file already defines `validationError` and `requestError`):

```ts
describe("submitErrors with a fallback", () => {
  const FALLBACK = "Couldn't confirm creation.";

  it("uses the fallback only for a lost response", () => {
    expect(submitErrors(new TypeError("Failed to fetch"), FALLBACK)).toEqual({ form: FALLBACK });
    expect(submitErrors(requestError(502, undefined, "Request failed with status 502"), FALLBACK)).toEqual({
      form: FALLBACK,
    });
  });

  it("keeps validation fields and the unavailable message", () => {
    expect(submitErrors(validationError([{ path: "lat", message: "must be between -90 and 90" }]), FALLBACK)).toEqual({
      form: "lat must be between -90 and 90",
    });
    expect(submitErrors(requestError(503, "unavailable", "try again"), FALLBACK)).toEqual({ form: "try again" });
  });
});
```

- [ ] **Step 2: Add the failing `ComposeForm` tests**

Append to the end of `src/components/compose/ComposeForm.test.tsx` (the file already defines `setup`, `validationError`, `AUTHOR_ERROR` and imports `SUBMIT_FAILED_MESSAGE`, `waitFor`, `screen`):

```tsx
describe("ComposeForm autoFocusField", () => {
  it("focuses the named field on mount when the form is enabled", () => {
    const { text } = setup({ autoFocusField: "text" });
    expect(text()).toHaveFocus();
  });

  it("can focus the name field instead", () => {
    const { author } = setup({ autoFocusField: "author" });
    expect(author()).toHaveFocus();
  });

  it("waits for the first enable when mounted disabled, then never focuses again", async () => {
    const { user, onSubmit, rerender, author, text } = setup({ autoFocusField: "text", disabled: true });
    expect(text()).not.toHaveFocus();

    rerender(<ComposeForm initialAuthor="" onSubmit={onSubmit} autoFocusField="text" />);
    expect(text()).toHaveFocus();

    await user.click(author());
    rerender(<ComposeForm initialAuthor="" onSubmit={onSubmit} autoFocusField="text" disabled />);
    rerender(<ComposeForm initialAuthor="" onSubmit={onSubmit} autoFocusField="text" />);
    expect(text()).not.toHaveFocus();
  });

  it("does not select the prefilled text", () => {
    const { text } = setup({ autoFocusField: "text", initialText: "unsent draft" });
    const field = text() as HTMLTextAreaElement;
    expect(field).toHaveFocus();
    expect(field.selectionEnd - field.selectionStart).toBe(0);
    expect(field).toHaveValue("unsent draft");
  });

  it("leaves focus alone when omitted", () => {
    setup();
    expect(document.body).toHaveFocus();
  });
});

describe("ComposeForm submitFailedMessage", () => {
  const CUSTOM = "Couldn't confirm creation.";

  it("replaces the lost-response message", async () => {
    const { user, onSubmit, author, text, submit } = setup({ submitFailedMessage: CUSTOM });
    onSubmit.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await user.type(author(), "ann");
    await user.type(text(), "hello");

    await user.click(submit());

    expect(await screen.findByRole("alert")).toHaveTextContent(CUSTOM);
    expect(screen.queryByText(SUBMIT_FAILED_MESSAGE)).not.toBeInTheDocument();
  });

  it("does not replace field errors", async () => {
    const { user, onSubmit, author, text, submit } = setup({ submitFailedMessage: CUSTOM });
    onSubmit.mockRejectedValueOnce(validationError([{ path: "text", message: "is required" }]));
    await user.type(author(), "ann");
    await user.type(text(), "hello");

    await user.click(submit());

    expect(await screen.findByText("Message is required")).toBeInTheDocument();
    expect(screen.queryByText(CUSTOM)).not.toBeInTheDocument();
  });

  it("does not replace the server's unavailable message", async () => {
    const message = "Could not find a free room name, please try again";
    const { user, onSubmit, author, text, submit } = setup({ submitFailedMessage: CUSTOM });
    onSubmit.mockRejectedValueOnce(
      Object.assign(new Error(message), { name: "ApiRequestError", status: 503, code: "unavailable" }),
    );
    await user.type(author(), "ann");
    await user.type(text(), "hello");

    await user.click(submit());

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.queryByText(CUSTOM)).not.toBeInTheDocument();
  });
});

describe("ComposeForm initialErrors", () => {
  it("shows field and form errors on mount, tied to their fields", () => {
    const { author, text } = setup({
      initialErrors: { author: "is required", text: "is required", form: "lat must be between -90 and 90" },
    });

    expect(screen.getByText("Display name is required")).toBeInTheDocument();
    expect(screen.getByText("Message is required")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("lat must be between -90 and 90");
    expect(author()).toHaveAttribute("aria-invalid", "true");
    expect(text()).toHaveAttribute("aria-invalid", "true");
  });

  it("ignores later values of the prop", () => {
    const { onSubmit, rerender } = setup({ initialErrors: { form: "first" } });

    rerender(<ComposeForm initialAuthor="" onSubmit={onSubmit} initialErrors={{ form: "second" }} />);

    expect(screen.getByRole("alert")).toHaveTextContent("first");
  });

  it("is replaced by client validation on the next submit", async () => {
    const { user, submit } = setup({ initialErrors: { form: "restored error" } });
    expect(screen.getByText("restored error")).toBeInTheDocument();

    await user.click(submit());

    expect(await screen.findByText(AUTHOR_ERROR)).toBeInTheDocument();
    expect(screen.queryByText("restored error")).not.toBeInTheDocument();
  });

  it("is cleared by a valid submit while the request is pending", async () => {
    const { user, onSubmit, submit } = setup({
      initialAuthor: "ann",
      initialText: "hello",
      initialErrors: { form: "restored error" },
    });
    onSubmit.mockImplementation(() => new Promise<void>(() => {}));
    expect(screen.getByText("restored error")).toBeInTheDocument();

    await user.click(submit());

    await waitFor(() => expect(screen.queryByText("restored error")).not.toBeInTheDocument());
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm test src/components/compose`
Expected: FAIL, 10 tests. In `fieldErrors.test.ts` "uses the fallback only for a lost response" fails (the generic message comes back). In `ComposeForm.test.tsx` nine fail: the four `autoFocusField` cases that expect focus, "replaces the lost-response message" and the four `initialErrors` cases. The four cases that assert an absence pass already and guard against regressions. TypeScript also reports the three unknown props.

- [ ] **Step 4: Give `submitErrors` its fallback**

In `src/components/compose/fieldErrors.ts` replace

```ts
/** Errors to show after `onSubmit` rejected. Never empty. */
export function submitErrors(error: unknown): ComposeErrors {
```

with

```ts
/**
 * Errors to show after `onSubmit` rejected. Never empty. `fallback` is the
 * form-level line for a rejection that is neither a validation error nor
 * `unavailable`: the write may or may not have happened.
 */
export function submitErrors(error: unknown, fallback: string = SUBMIT_FAILED_MESSAGE): ComposeErrors {
```

and the function's last line `return { form: SUBMIT_FAILED_MESSAGE };` with

```ts
  return { form: fallback };
```

- [ ] **Step 5: Add the three props and the shared class to `ComposeForm`**

In `src/components/compose/ComposeForm.tsx` make these edits.

Replace the React import and the `fieldErrors` import with:

```ts
import { useEffect, useId, useRef, useState, type FormEvent } from "react";

import {
  SUBMIT_FAILED_MESSAGE,
  submitErrors,
  toComposeErrors,
  type ComposeErrors,
} from "@/components/compose/fieldErrors";
```

After `export const TEXT_MAX = TEXT_MAX_CHARS;` add:

```ts

/**
 * A fixed 64 px message field that scrolls inside itself (room-panel design
 * §4.1), so a long draft never pushes the submit button out of the panel slot.
 * Pass it as `textareaClassName`; the room panel and the new-room popup both do.
 */
export const BOUNDED_TEXTAREA_CLASS = "field-sizing-fixed h-16 resize-none overflow-y-auto";
```

In `ComposeFormProps`, after the `textareaClassName?: string;` member:

```ts
  /** Focus this field once, the first time the form is enabled after mount. */
  autoFocusField?: "author" | "text";
  /** Replaces SUBMIT_FAILED_MESSAGE for rejections that are neither validation nor `unavailable`. */
  submitFailedMessage?: string;
  /** Errors for this form mount; used to restore a rejected create. Later values are ignored. */
  initialErrors?: ComposeErrors;
```

In the component's parameter list, between `textareaClassName,` and `onSubmit,`:

```ts
  autoFocusField,
  submitFailedMessage = SUBMIT_FAILED_MESSAGE,
  initialErrors,
```

Replace `const [errors, setErrors] = useState<ComposeErrors>({});` with the lazy initializer, and add the focus effect directly after the `pending` state:

```ts
  const [errors, setErrors] = useState<ComposeErrors>(() => initialErrors ?? {});
  const [pending, setPending] = useState(false);

  // Focus once, the first time the form is enabled. An effect rather than the
  // `autoFocus` attribute, which cannot wait for a form that mounts disabled.
  const authorRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const focused = useRef(false);
  useEffect(() => {
    if (autoFocusField === undefined || focused.current || disabled || pending) return;
    focused.current = true;
    (autoFocusField === "author" ? authorRef : textRef).current?.focus();
  }, [autoFocusField, disabled, pending]);
```

In `handleSubmit`'s `catch`, replace `setErrors(submitErrors(error));` with:

```ts
      setErrors(submitErrors(error, submitFailedMessage));
```

On the `<Input …>` element add `ref={authorRef}` as its first prop, and on the `<Textarea …>` element add `ref={textRef}` as its first prop (React 19 passes `ref` through as a prop; both shadcn primitives spread their props onto the element).

Points that are easy to get wrong:
- The `focused` ref, not state: Strict Mode replays the effect, and the second run must do nothing.
- `.focus()` only. Do not select the text or move the caret.
- `initialErrors` is read by the `useState` initializer only. Do not add an effect that copies later values into state; a recovered form gets a new key instead (Task 6).

- [ ] **Step 6: Make `RoomPanel` import the shared class**

In `src/components/room/RoomPanel.tsx` replace the import

```ts
import { ComposeForm } from "@/components/compose/ComposeForm";
```

with

```ts
import { BOUNDED_TEXTAREA_CLASS, ComposeForm } from "@/components/compose/ComposeForm";
```

delete the private constant and its comment:

```ts
/**
 * A fixed 64 px message field that scrolls inside itself (room-panel design
 * §4.1), so a long draft never pushes Send or the list out of the panel.
 */
const TEXTAREA_CLASS = "field-sizing-fixed h-16 resize-none overflow-y-auto";
```

and change the prop on `<ComposeForm …>` from `textareaClassName={TEXTAREA_CLASS}` to:

```tsx
              textareaClassName={BOUNDED_TEXTAREA_CLASS}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm test src/components/compose src/components/room/RoomPanel.test.tsx`
Expected: PASS. `ComposeForm.test.tsx` has 12 more tests than before this task, `fieldErrors.test.ts` 2 more; `RoomPanel.test.tsx` is unchanged and still asserts the four bounded classes.

- [ ] **Step 8: Run the whole suite, lint and typecheck**

Run: `pnpm test && pnpm lint && pnpm typecheck`
Expected: B-files files / B-tests + 14 tests passing; lint and typecheck clean.

- [ ] **Step 9: Commit**

```bash
git add src/components/compose/ComposeForm.tsx src/components/compose/ComposeForm.test.tsx src/components/compose/fieldErrors.ts src/components/compose/fieldErrors.test.ts src/components/room/RoomPanel.tsx
git commit -m "feat(compose): add autoFocusField, submitFailedMessage and initialErrors; share the bounded textarea class"
```

---

### Task 3: `NewRoomPopup` and the info bubble

**Files:**
- Create: `src/components/ui/tooltip.tsx` (generated by shadcn), `src/components/room/NewRoomPopup.tsx`
- Test: `src/components/room/NewRoomPopup.test.tsx`

**Interfaces:**
- Consumes: `ComposeForm` with `autoFocusField`, `submitFailedMessage`, `initialErrors`, `textareaClassName` and `BOUNDED_TEXTAREA_CLASS` (Task 2); `submitErrors(error, fallback)` (Task 2); `PanelFrame` (`title`, `titleAdornment`, `onClose`, `children`, `footer`); `api.rooms.create(input: CreateRoomInput): Promise<CreateRoomOutcome>` and `RoomsApi` from `@/lib/api/client`, where `CreateRoomOutcome = { status: "created"; room: Room; message: Message } | { status: "conflict"; room: Room }`; `CreateRoomInput = { lat; lng; author; text }` and `roundCoord` from `@/lib/schemas/room`; `PostMessageInput = { author; text }`; `Prefill = { author: string; text: string }` from `@/lib/page/selection`; `useDisplayName(): [name, setName]`.
- Produces:

```ts
export type NewRoomPopupProps = {
  lat: number;
  lng: number;
  onCreated(room: Room, message: Message): void;
  onConflict(room: Room, prefill: Prefill): void;
  onFailed(input: CreateRoomInput, error: unknown): void;
  recovery?: { input: CreateRoomInput; error: unknown };
  onClose(): void;
  createRoom?: RoomsApi["create"];
};
export const NEW_ROOM_INFO_TEXT: string;
export const CREATE_FAILED_MESSAGE: string;
export function NewRoomPopup(props: NewRoomPopupProps): JSX.Element;
```

- [ ] **Step 1: Add the shadcn tooltip**

```bash
pnpm exec shadcn add tooltip -y
git status --short
```

Expected: exactly one new file, `src/components/ui/tooltip.tsx`, importing `Tooltip as TooltipPrimitive` from `@base-ui/react/tooltip` and exporting `Tooltip`, `TooltipTrigger`, `TooltipContent`, `TooltipProvider`. `package.json` must not change (`cn` and `@base-ui/react` are installed). If the CLI rewrites `src/app/globals.css`, revert it with `git checkout src/app/globals.css`. Ignore the CLI's advice to wrap the app in `TooltipProvider`: Base UI's tooltip works without one, and the spec keeps `app/layout.tsx` untouched. `TooltipTrigger` takes Base UI's `render` prop, which is how the trigger becomes the project's `Button`.

- [ ] **Step 2: Write the failing popup tests**

Create `src/components/room/NewRoomPopup.test.tsx`:

```tsx
// @vitest-environment jsdom
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  CREATE_FAILED_MESSAGE,
  NEW_ROOM_INFO_TEXT,
  NewRoomPopup,
  type NewRoomPopupProps,
} from "@/components/room/NewRoomPopup";
import { ApiRequestError, ApiValidationError, type CreateRoomOutcome } from "@/lib/api/client";
import type { Message, Room } from "@/lib/schemas/types";
import { DISPLAY_NAME_KEY } from "@/lib/storage/displayName";

const LAT = 46.77120049;
const LNG = 23.6236;

const room: Room = {
  id: "00000000-0000-4000-8000-00000000000a",
  name: "brave-crimson-otter",
  lat: 46.7712,
  lng: 23.6236,
  createdAt: "2026-09-16T15:00:00.000000Z",
};
const message: Message = {
  id: "00000000-0000-4000-8000-0000000000f1",
  chatroomId: room.id,
  author: "ann",
  text: "hello",
  createdAt: "2026-09-16T15:00:00.000000Z",
};

type Create = NonNullable<NewRoomPopupProps["createRoom"]>;

function setup(props: Partial<NewRoomPopupProps> = {}) {
  const createRoom = vi.fn<Create>(async () => ({ status: "created", room, message }));
  const callbacks = { onCreated: vi.fn(), onConflict: vi.fn(), onFailed: vi.fn(), onClose: vi.fn() };
  const user = userEvent.setup();
  const view = render(
    <NewRoomPopup lat={LAT} lng={LNG} createRoom={createRoom} {...callbacks} {...props} />,
  );
  return {
    user,
    createRoom,
    ...callbacks,
    rerender: (next: Partial<NewRoomPopupProps>) =>
      view.rerender(
        <NewRoomPopup lat={LAT} lng={LNG} createRoom={createRoom} {...callbacks} {...props} {...next} />,
      ),
    unmount: view.unmount,
    author: () => screen.getByLabelText("Display name"),
    text: () => screen.getByLabelText("Message"),
    create: () => screen.getByRole("button", { name: "Create" }),
  };
}

/** A `createRoom` call the test settles by hand. */
function pendingCreate() {
  let resolve!: (outcome: CreateRoomOutcome) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<CreateRoomOutcome>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("fetch", vi.fn());
  return () => vi.unstubAllGlobals();
});

describe("NewRoomPopup rendering", () => {
  it("has the title, the close button and the Create button", async () => {
    const { user, onClose, create } = setup();

    expect(screen.getByText("New chatroom")).toBeInTheDocument();
    expect(create()).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows the PRD text when the info button gets keyboard focus", async () => {
    localStorage.setItem(DISPLAY_NAME_KEY, "ann"); // focus starts in the message field
    const { user } = setup();
    expect(screen.queryByText(NEW_ROOM_INFO_TEXT)).not.toBeInTheDocument();

    await user.tab({ shift: true }); // message → name
    await user.tab({ shift: true }); // name → close
    await user.tab({ shift: true }); // close → info

    expect(screen.getByRole("button", { name: "About new chatrooms" })).toHaveFocus();
    expect(await screen.findByText(NEW_ROOM_INFO_TEXT)).toBeInTheDocument();
  });

  it("shows both coordinates rounded to six decimals, latitude first", () => {
    setup();

    expect(
      screen.getByText("Your first message creates a chatroom at 46.771200, 23.623600."),
    ).toBeInTheDocument();
  });

  it("prefills the remembered name and bounds the message field", () => {
    localStorage.setItem(DISPLAY_NAME_KEY, "ann");
    const { author, text } = setup();

    expect(author()).toHaveValue("ann");
    expect(text()).toHaveClass("field-sizing-fixed", "h-16", "resize-none", "overflow-y-auto");
  });
});

describe("NewRoomPopup focus", () => {
  it("focuses the message field when a name is remembered", () => {
    localStorage.setItem(DISPLAY_NAME_KEY, "ann");
    const { text } = setup();

    expect(text()).toHaveFocus();
  });

  it("focuses the name field otherwise", () => {
    const { author } = setup();

    expect(author()).toHaveFocus();
  });
});

describe("NewRoomPopup submit", () => {
  it("creates with the trimmed input and the clicked coordinates, then reports created", async () => {
    const { user, createRoom, onCreated, onConflict, onFailed, author, text, create } = setup();
    await user.type(author(), "  ann ");
    await user.type(text(), " hello ");

    await user.click(create());

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(room, message));
    expect(createRoom).toHaveBeenCalledTimes(1);
    expect(createRoom).toHaveBeenCalledWith({ author: "ann", text: "hello", lat: LAT, lng: LNG });
    expect(onConflict).not.toHaveBeenCalled();
    expect(onFailed).not.toHaveBeenCalled();
    expect(localStorage.getItem(DISPLAY_NAME_KEY)).toBe("ann");
  });

  it("reports a conflict with the trimmed prefill and posts nothing", async () => {
    const { user, createRoom, onCreated, onConflict, author, text, create } = setup();
    createRoom.mockResolvedValueOnce({ status: "conflict", room });
    await user.type(author(), "  ann ");
    await user.type(text(), " hello ");

    await user.click(create());

    await waitFor(() => expect(onConflict).toHaveBeenCalledWith(room, { author: "ann", text: "hello" }));
    expect(onCreated).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(localStorage.getItem(DISPLAY_NAME_KEY)).toBe("ann");
  });

  it("makes no request for an invalid form", async () => {
    const { user, createRoom, onFailed, create } = setup();

    await user.click(create());

    expect(await screen.findByText("Message must be between 1 and 3000 characters")).toBeInTheDocument();
    expect(createRoom).not.toHaveBeenCalled();
    expect(onFailed).not.toHaveBeenCalled();
  });

  it("disables every control while the request is pending and ignores a second submit", async () => {
    const pending = pendingCreate();
    const { user, createRoom, author, text, create } = setup();
    createRoom.mockReturnValueOnce(pending.promise);
    await user.type(author(), "ann");
    await user.type(text(), "hello");

    await user.click(create());
    await waitFor(() => expect(create()).toBeDisabled());
    expect(author()).toBeDisabled();
    expect(text()).toBeDisabled();
    await user.click(create());

    expect(createRoom).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve({ status: "created", room, message }));
  });
});

describe("NewRoomPopup failures", () => {
  const latError = new ApiValidationError([{ path: "lat", message: "must be between -90 and 90" }]);
  const unavailable = new ApiRequestError(503, "unavailable", "Could not find a free room name, please try again");
  const lost = new TypeError("Failed to fetch");

  it.each([
    ["a validation error on lat", latError, "lat must be between -90 and 90"],
    ["a 503 unavailable", unavailable, "Could not find a free room name, please try again"],
    ["a lost response", lost, CREATE_FAILED_MESSAGE],
  ])("reports %s through onFailed only and keeps the draft", async (_label, error, shown) => {
    const { user, createRoom, onCreated, onConflict, onFailed, author, text, create } = setup();
    createRoom.mockRejectedValueOnce(error);
    await user.type(author(), "  ann ");
    await user.type(text(), " hello ");

    await user.click(create());

    await waitFor(() =>
      expect(onFailed).toHaveBeenCalledWith({ author: "ann", text: "hello", lat: LAT, lng: LNG }, error),
    );
    expect(onFailed).toHaveBeenCalledTimes(1);
    expect(onCreated).not.toHaveBeenCalled();
    expect(onConflict).not.toHaveBeenCalled();
    // The form saw the rejection: error shown, draft kept, name not remembered.
    expect(await screen.findByRole("alert")).toHaveTextContent(shown);
    expect(text()).toHaveValue(" hello ");
    expect(localStorage.getItem(DISPLAY_NAME_KEY)).toBeNull();
  });

  it.each([
    ["a validation error on lat", latError, "lat must be between -90 and 90"],
    ["a 503 unavailable", unavailable, "Could not find a free room name, please try again"],
    ["a lost response", lost, CREATE_FAILED_MESSAGE],
  ])("a recovered popup shows %s with the submitted draft", (_label, error, shown) => {
    localStorage.setItem(DISPLAY_NAME_KEY, "remembered");
    const { createRoom, author, text } = setup({
      recovery: { input: { author: "ann", text: "hello", lat: LAT, lng: LNG }, error },
    });

    expect(screen.getByRole("alert")).toHaveTextContent(shown);
    expect(author()).toHaveValue("ann"); // the submitted name wins over the remembered one
    expect(text()).toHaveValue("hello");
    expect(text()).toHaveFocus();
    expect(createRoom).not.toHaveBeenCalled();
    expect(localStorage.getItem(DISPLAY_NAME_KEY)).toBe("remembered");
  });

  it("a recovered popup ties a field error to its field", () => {
    const { text } = setup({
      recovery: {
        input: { author: "ann", text: "hello", lat: LAT, lng: LNG },
        error: new ApiValidationError([{ path: "text", message: "contains characters that cannot be stored" }]),
      },
    });

    expect(screen.getByText("Message contains characters that cannot be stored")).toBeInTheDocument();
    expect(text()).toHaveAttribute("aria-invalid", "true");
  });
});

describe("NewRoomPopup and a moving draft", () => {
  it("keeps the typed text, updates the hint and sends the new coordinates", async () => {
    const { user, createRoom, rerender, author, text, create } = setup();
    await user.type(author(), "ann");
    await user.type(text(), "hello");

    rerender({ lat: 10.25, lng: -20.5 });

    expect(text()).toHaveValue("hello");
    expect(
      screen.getByText("Your first message creates a chatroom at 10.250000, -20.500000."),
    ).toBeInTheDocument();
    await user.click(create());
    await waitFor(() =>
      expect(createRoom).toHaveBeenCalledWith({ author: "ann", text: "hello", lat: 10.25, lng: -20.5 }),
    );
  });

  it.each(["created", "conflict", "failed"] as const)(
    "a request in flight keeps its own coordinates and reports %s after the popup unmounts",
    async (kind) => {
      const pending = pendingCreate();
      const { user, createRoom, onCreated, onConflict, onFailed, rerender, unmount, author, text, create } = setup();
      createRoom.mockReturnValueOnce(pending.promise);
      await user.type(author(), "ann");
      await user.type(text(), "hello");
      await user.click(create());
      await waitFor(() => expect(createRoom).toHaveBeenCalledTimes(1));

      rerender({ lat: 10.25, lng: -20.5 });
      unmount();
      const error = new TypeError("Failed to fetch");
      await act(async () => {
        if (kind === "created") pending.resolve({ status: "created", room, message });
        else if (kind === "conflict") pending.resolve({ status: "conflict", room });
        else pending.reject(error);
      });

      if (kind === "created") expect(onCreated).toHaveBeenCalledWith(room, message);
      if (kind === "conflict") expect(onConflict).toHaveBeenCalledWith(room, { author: "ann", text: "hello" });
      if (kind === "failed") {
        expect(onFailed).toHaveBeenCalledWith({ author: "ann", text: "hello", lat: LAT, lng: LNG }, error);
      }
      expect(onCreated.mock.calls.length + onConflict.mock.calls.length + onFailed.mock.calls.length).toBe(1);
    },
  );
});
```

About these tests:
- `vi.stubGlobal("fetch", …)` proves the conflict path posts nothing: the fake `createRoom` never touches `fetch`, so any call would be the popup's own.
- In an isolated popup there is no shell to remount the form, so after a rejection the **same** form shows the error. That is how the test observes "the form submission was rejected": error shown, draft kept, name not remembered. The recovered-form cases pass `recovery` directly.
- The "in flight" cases rerender with new coordinates **and** unmount before settling: the callback must still be called, with the coordinates the request was sent with.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm test src/components/room/NewRoomPopup.test.tsx`
Expected: FAIL with `Failed to resolve import "@/components/room/NewRoomPopup"`.

- [ ] **Step 4: Implement the popup**

Create `src/components/room/NewRoomPopup.tsx`:

```tsx
"use client";

import { FaInfoCircle } from "react-icons/fa";

import { BOUNDED_TEXTAREA_CLASS, ComposeForm } from "@/components/compose/ComposeForm";
import { submitErrors } from "@/components/compose/fieldErrors";
import { PanelFrame } from "@/components/panel/PanelFrame";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { api, type RoomsApi } from "@/lib/api/client";
import type { Prefill } from "@/lib/page/selection";
import type { PostMessageInput } from "@/lib/schemas/message";
import { roundCoord, type CreateRoomInput } from "@/lib/schemas/room";
import type { Message, Room } from "@/lib/schemas/types";
import { useDisplayName } from "@/lib/storage/useDisplayName";

export type NewRoomPopupProps = {
  lat: number;
  lng: number;
  onCreated(room: Room, message: Message): void;
  onConflict(room: Room, prefill: Prefill): void;
  onFailed(input: CreateRoomInput, error: unknown): void;
  /** A rejected create restored by the shell: the form starts from it. */
  recovery?: { input: CreateRoomInput; error: unknown };
  onClose(): void;
  /** Defaults to `api.rooms.create`; tests inject a fake. */
  createRoom?: RoomsApi["create"];
};

/** PRD 3 Flow A, verbatim. */
export const NEW_ROOM_INFO_TEXT = "This chatroom will receive a name after the first message is sent.";

/**
 * Replaces the form's lost-response message: the popup has no room to check,
 * and only a retry at the same rounded coordinates is protected by the 409.
 */
export const CREATE_FAILED_MESSAGE =
  "Couldn't confirm creation. A chatroom may already exist at the submitted spot. Retry at the same spot to open it if it exists. Moving the pin starts a separate creation at the new spot.";

/** Stock tooltip: opens on hover and keyboard focus, not on tap (KNOWN_LIMITATIONS). */
function NewRoomInfo() {
  return (
    <Tooltip>
      <TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label="About new chatrooms" />}>
        <FaInfoCircle aria-hidden />
      </TooltipTrigger>
      <TooltipContent>{NEW_ROOM_INFO_TEXT}</TooltipContent>
    </Tooltip>
  );
}

/**
 * The draft panel (new-room design §4): names the spot, takes the first
 * message and owns the create call. It reports created, conflict or failure to
 * the shell and never posts a message itself. `lat` and `lng` may change while
 * it is mounted; typed text survives and the next submit uses the new spot.
 */
export function NewRoomPopup({
  lat,
  lng,
  onCreated,
  onConflict,
  onFailed,
  recovery,
  onClose,
  createRoom,
}: NewRoomPopupProps) {
  const [name] = useDisplayName();
  const initialAuthor = recovery?.input.author ?? name;

  async function submit(input: PostMessageInput): Promise<void> {
    const submitted: CreateRoomInput = { ...input, lat, lng }; // this request's snapshot
    let outcome;
    try {
      outcome = await (createRoom ?? api.rooms.create)(submitted);
    } catch (error) {
      // No "is mounted" guard here or below: the outcome takes over the panel
      // even after this popup has been closed or replaced (design decision 3).
      onFailed(submitted, error);
      throw error; // the form must not remember the name or clear the draft
    }
    if (outcome.status === "created") onCreated(outcome.room, outcome.message);
    else onConflict(outcome.room, { author: input.author, text: input.text });
  }

  return (
    <PanelFrame
      title="New chatroom"
      titleAdornment={<NewRoomInfo />}
      onClose={onClose}
      footer={
        // CardFooter is a row flexbox; the form needs the full width.
        <div className="w-full">
          <ComposeForm
            submitLabel="Create"
            initialAuthor={initialAuthor}
            initialText={recovery?.input.text}
            textareaClassName={BOUNDED_TEXTAREA_CLASS}
            autoFocusField={initialAuthor ? "text" : "author"}
            submitFailedMessage={CREATE_FAILED_MESSAGE}
            initialErrors={recovery ? submitErrors(recovery.error, CREATE_FAILED_MESSAGE) : undefined}
            onSubmit={submit}
          />
        </div>
      }
    >
      <p className="text-muted-foreground">
        Your first message creates a chatroom at {roundCoord(lat).toFixed(6)}, {roundCoord(lng).toFixed(6)}.
      </p>
    </PanelFrame>
  );
}
```

Points that are easy to get wrong:
- `submit` must rethrow after `onFailed`. Swallowing the error would resolve the form's promise, which remembers the display name and clears the draft as if the room had been created.
- `submitted` is built before the `await`: the props may change while the request is pending, and the rejection must report what was sent.
- No `useRef(true)`/"is mounted" guard anywhere. Calling a parent's callback after unmount is the required behaviour here.
- `initialAuthor` is derived at render, not copied into state: the form adopts a display name that arrives after hydration by itself.
- `PanelFrame`'s footer is a row flexbox (`CardFooter`), hence the `w-full` wrapper.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm test src/components/room/NewRoomPopup.test.tsx`
Expected: PASS, 21 tests.

- [ ] **Step 6: Run the whole suite, lint and typecheck**

Run: `pnpm test && pnpm lint && pnpm typecheck`
Expected: B-files + 1 files / B-tests + 35 tests (with Task 2 done); lint and typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add src/components/ui/tooltip.tsx src/components/room/NewRoomPopup.tsx src/components/room/NewRoomPopup.test.tsx
git commit -m "feat(room): add the new chatroom popup with its info bubble and create call"
```

---

### Task 4: The 409 notice and the hand-off focus in `RoomPanel`

**Files:**
- Create: `src/components/room/MovedNotice.tsx`
- Modify: `src/components/room/RoomPanel.tsx`
- Test: `src/components/room/RoomPanel.test.tsx` (modify)

**Interfaces:**
- Consumes: `Alert`, `AlertAction`, `AlertDescription` from `@/components/ui/alert` (chunk 9; `Alert` spreads its props after its own `role="alert"`, so a `role` prop replaces it); `RoomPanelProps` (`room`, `seed?`, `prefill?`, `onClose`, `feedDeps?`) and the panel's `submit` adapter (chunk 9); `ComposeForm.autoFocusField` (Task 2); the `setup`, `openPolling`, `settle` helpers and the imports of chunk 9's `RoomPanel.test.tsx` (`within`, `waitFor`, `msg`, `page`, `ApiRequestError`, `LOAD_FAILED_HINT`, `ROOM_GONE_HINT`, `NEWER_FAILED`, `SUBMIT_FAILED_MESSAGE`).
- Produces: `type MovedNoticeProps = { onDismiss(): void }`; `MOVED_NOTICE_TEXT`; `MovedNotice`. `RoomPanel` shows the notice while `prefill !== undefined && !noticeDismissed && !sentOnce` and the room is not gone, and passes `autoFocusField="text"` when `seed !== undefined || prefill !== undefined`. `RoomPanelProps` is unchanged.

- [ ] **Step 1: Add the failing panel tests**

In `src/components/room/RoomPanel.test.tsx` add this import after the `fieldErrors` import:

```ts
import { MOVED_NOTICE_TEXT } from "@/components/room/MovedNotice";
```

and append to the end of the file:

```tsx
describe("RoomPanel moved notice", () => {
  const prefill = { author: "ana", text: "unsent draft" };
  const notice = () => screen.queryByText(MOVED_NOTICE_TEXT);
  const dismissNotice = () =>
    within(screen.getByText(MOVED_NOTICE_TEXT).closest<HTMLElement>('[role="status"]')!).getByRole("button", {
      name: "Dismiss",
    });

  it("shows with a prefill while opening, as a status", () => {
    setup({ prefill });

    expect(notice()).toBeInTheDocument();
    expect(notice()!.closest('[role="status"]')).not.toBeNull();
    expect(screen.getByText("Loading messages…")).toBeInTheDocument();
  });

  it("stays with the initial-failure hint, above the disabled prefilled form", async () => {
    const { messages, text, send } = setup({ prefill });
    messages.list[0].reject(new Error("offline"));
    await settle();

    expect(screen.getByText(LOAD_FAILED_HINT)).toBeInTheDocument();
    expect(notice()).toBeInTheDocument();
    expect(text()).toHaveValue("unsent draft");
    expect(send()).toBeDisabled();
  });

  it("is absent without a prefill", async () => {
    await openPolling();

    expect(notice()).not.toBeInTheDocument();
  });

  it("is absent for a seeded room", () => {
    setup({ seed: msg(7) });

    expect(notice()).not.toBeInTheDocument();
  });

  it("is hidden by the room-gone hint", async () => {
    const { messages } = setup({ prefill });
    messages.list[0].reject(new ApiRequestError(404, "not_found", "Room not found"));
    await settle();

    expect(screen.getByText(ROOM_GONE_HINT)).toBeInTheDocument();
    expect(notice()).not.toBeInTheDocument();
  });

  it("is dismissed by its own button and keeps the prefilled fields", async () => {
    const { user, author, text } = await openPolling({ prefill });

    await user.click(dismissNotice());

    expect(notice()).not.toBeInTheDocument();
    expect(author()).toHaveValue("ana");
    expect(text()).toHaveValue("unsent draft");
  });

  it("goes away after a send that resolves", async () => {
    const { messages, user, send } = await openPolling({ prefill });

    await user.click(send());
    expect(notice()).toBeInTheDocument(); // still unsent while the request is pending
    messages.post[0].resolve(msg(3, prefill));
    await settle();

    expect(notice()).not.toBeInTheDocument();
  });

  it("stays after a send that is rejected", async () => {
    const { messages, user, send, text } = await openPolling({ prefill });

    await user.click(send());
    messages.post[0].reject(new TypeError("Failed to fetch"));
    await settle();

    await waitFor(() => expect(screen.getByText(SUBMIT_FAILED_MESSAGE)).toBeInTheDocument());
    expect(notice()).toBeInTheDocument();
    expect(text()).toHaveValue("unsent draft");
  });

  it("renders above the fetch alert, and each Dismiss closes its own", async () => {
    const { messages, tick, user } = await openPolling({ prefill });
    tick();
    messages.listAfter[1].reject(new Error("offline"));
    await settle();

    const fetchAlert = screen.getByText(NEWER_FAILED);
    expect(notice()!.compareDocumentPosition(fetchAlert) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await user.click(dismissNotice());
    expect(notice()).not.toBeInTheDocument();
    expect(fetchAlert).toBeInTheDocument();
  });
});

describe("RoomPanel focus after a hand-off", () => {
  it("focuses the message field of a seeded room at once", () => {
    const { text } = setup({ seed: msg(7) });

    expect(text()).toHaveFocus();
  });

  it("focuses the message field of a prefilled room when the form is first enabled", async () => {
    const { messages, text } = setup({ prefill: { author: "ana", text: "unsent draft" } });
    expect(text()).not.toHaveFocus();

    messages.list[0].resolve(page([msg(1)]));
    await settle();

    expect(text()).toHaveFocus();
  });

  it("leaves focus alone for a room opened from its pin", async () => {
    await openPolling();

    expect(document.body).toHaveFocus();
  });
});
```

Both the notice and chunk 9's fetch alert have a button named "Dismiss", and the loading row is also a `status`, so `dismissNotice` finds the notice by its text first.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test src/components/room/RoomPanel.test.tsx`
Expected: FAIL with `Failed to resolve import "@/components/room/MovedNotice"`.

- [ ] **Step 3: Create the notice**

Create `src/components/room/MovedNotice.tsx`:

```tsx
import { FaTimes } from "react-icons/fa";

import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export type MovedNoticeProps = { onDismiss(): void };

/** The first sentence is PRD 3 Flow A's wording; the second says why the form below is prefilled. */
export const MOVED_NOTICE_TEXT =
  "A chatroom already exists here, you have been moved to it. Your message has not been sent.";

/**
 * Shown at the top of the room panel's footer after a create landed on an
 * existing room (new-room design §7). `role="status"`: it informs, it is not an error.
 */
export function MovedNotice({ onDismiss }: MovedNoticeProps) {
  return (
    <Alert role="status" className="has-data-[slot=alert-action]:pr-10">
      <AlertDescription>{MOVED_NOTICE_TEXT}</AlertDescription>
      <AlertAction>
        <Button variant="ghost" size="icon-xs" aria-label="Dismiss" onClick={onDismiss}>
          <FaTimes aria-hidden />
        </Button>
      </AlertAction>
    </Alert>
  );
}
```

- [ ] **Step 4: Wire the notice and the focus rule into `RoomPanel`**

In `src/components/room/RoomPanel.tsx` make these edits.

Change the React import to include `useState`:

```ts
import { useEffect, useRef, useState } from "react";
```

Add after the `MessageList` import:

```ts
import { MovedNotice } from "@/components/room/MovedNotice";
```

Directly after `const listRef = useRef<MessageListHandle>(null);` add:

```ts
  // The 409 notice (new-room design §7). MapShell keys this panel by room id and
  // handoff revision, so both flags start false again for every hand-off.
  const [noticeDismissed, setNoticeDismissed] = useState(false);
  const [sentOnce, setSentOnce] = useState(false);
```

In `submit`, directly after `const message = await feed.send(input);` add:

```ts
      setSentOnce(true); // the prefilled draft is no longer unsent
```

Directly after the line that computes `fetchAlert` add:

```ts
  // Derived from `prefill`, which only `movedToExisting` sets. Not with the room-gone hint.
  const moved = prefill !== undefined && !noticeDismissed && !sentOnce && !gone;
```

In the footer column, make the notice the first child, directly before `{fetchAlert ? (`:

```tsx
            {moved ? <MovedNotice onDismiss={() => setNoticeDismissed(true)} /> : null}
```

On `<ComposeForm …>`, directly after the `textareaClassName` prop add:

```tsx
              // Reached through the new-room flow: the button that held focus is gone.
              autoFocusField={seed !== undefined || prefill !== undefined ? "text" : undefined}
```

The footer order is now `MovedNotice`, fetch alert, `BacklogNotice`, `ComposeForm`. The form stays the last child behind conditional slots that render `null` in place, so it still never remounts. If chunk 9's panel has a comment saying the form is "the third child", update it to "the last child".

Intent, in case chunk 9's code differs from its plan: `sentOnce` is set only after a send **resolved** (a rejected send keeps the notice); the notice shows with `ready`, while opening and with the initial-failure hint, and never with the room-gone hint.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm test src/components/room/RoomPanel.test.tsx`
Expected: PASS, 12 more tests than before this task (30 with chunk 9's 18).

- [ ] **Step 6: Run the whole suite, lint and typecheck**

Run: `pnpm test && pnpm lint && pnpm typecheck`
Expected: B-files + 1 files / B-tests + 47 tests (with Tasks 2 and 3 done); lint and typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add src/components/room/MovedNotice.tsx src/components/room/RoomPanel.tsx src/components/room/RoomPanel.test.tsx
git commit -m "feat(room): show the moved notice for a 409 hand-off and focus the message field after a hand-off"
```

---

### Task 5: Handoff reducer

**Files:**
- Create: `src/lib/page/handoff.ts`
- Test: `src/lib/page/handoff.test.ts`

**Interfaces:**
- Consumes: `selectionReducer`, `Selection`, `Prefill` from `@/lib/page/selection` (with chunk 9's `seed` and `roomCreated.message`); `CreateRoomInput` from `@/lib/schemas/room`; `Message`, `Room`.
- Produces:

```ts
export type Recovery = { input: CreateRoomInput; error: unknown };
export type Handoff = { selection: Selection; revision: number; recovery: Recovery | null };
export type HandoffAction =
  | { type: "clickEmpty"; lat: number; lng: number }
  | { type: "clickPin"; room: Room }
  | { type: "close" }
  | { type: "created"; room: Room; message: Message }
  | { type: "conflict"; room: Room; prefill: Prefill }
  | { type: "failed"; input: CreateRoomInput; error: unknown };
export function initialHandoff(selection: Selection): Handoff;
export function handoffReducer(state: Handoff, action: HandoffAction): Handoff;
export const draftPanelKey: (handoff: Handoff) => string;            // `draft:<revision>`
export const roomPanelKey: (handoff: Handoff, room: Room) => string; // `<room.id>:<revision>`
```

- [ ] **Step 1: Write the failing tests**

Create `src/lib/page/handoff.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  draftPanelKey,
  type Handoff,
  handoffReducer,
  initialHandoff,
  roomPanelKey,
} from "@/lib/page/handoff";
import type { Message, Room } from "@/lib/schemas/types";

const roomA: Room = {
  id: "00000000-0000-4000-8000-00000000000a",
  name: "brave-crimson-otter",
  lat: 46.7712,
  lng: 23.6236,
  createdAt: "2026-09-16T15:00:00.000000Z",
};
const roomB: Room = { ...roomA, id: "00000000-0000-4000-8000-00000000000b", name: "calm-amber-heron" };
const first: Message = {
  id: "00000000-0000-4000-8000-0000000000f1",
  chatroomId: roomA.id,
  author: "ana",
  text: "first!",
  createdAt: "2026-09-16T15:00:00.000000Z",
};
const prefill = { author: "ana", text: "hello" };
const input = { lat: 1.5, lng: 2.5, author: "ana", text: "hello" };
const error = new TypeError("Failed to fetch");

const start = initialHandoff({ kind: "none" });
const draft: Handoff = handoffReducer(start, { type: "clickEmpty", lat: 1.5, lng: 2.5 });
const recovered: Handoff = handoffReducer(start, { type: "failed", input, error });
const openA: Handoff = handoffReducer(start, { type: "clickPin", room: roomA });

describe("handoffReducer", () => {
  it("starts at revision 0 with no recovery", () => {
    expect(initialHandoff({ kind: "room", room: roomA })).toEqual({
      selection: { kind: "room", room: roomA },
      revision: 0,
      recovery: null,
    });
  });

  it("moves an open draft without changing the revision", () => {
    const moved = handoffReducer(draft, { type: "clickEmpty", lat: 9, lng: 8 });

    expect(moved).toEqual({ selection: { kind: "draft", lat: 9, lng: 8 }, revision: 0, recovery: null });
    expect(draftPanelKey(moved)).toBe(draftPanelKey(draft));
  });

  it("keeps the recovery while the recovered draft moves", () => {
    const moved = handoffReducer(recovered, { type: "clickEmpty", lat: 9, lng: 8 });

    expect(moved.recovery).toBe(recovered.recovery);
    expect(moved.revision).toBe(recovered.revision);
    expect(moved.selection).toEqual({ kind: "draft", lat: 9, lng: 8 });
  });

  it.each([
    ["close", { type: "close" } as const],
    ["selecting a room", { type: "clickPin", room: roomA } as const],
  ])("drops the recovery on %s, without a new revision", (_label, action) => {
    const next = handoffReducer(recovered, action);

    expect(next.recovery).toBeNull();
    expect(next.revision).toBe(recovered.revision);
  });

  it("returns the same state for a click on the already selected pin", () => {
    expect(handoffReducer(openA, { type: "clickPin", room: { ...roomA } })).toBe(openA);
  });

  it("created selects the room with its seed under a new revision", () => {
    const next = handoffReducer(draft, { type: "created", room: roomA, message: first });

    expect(next).toEqual({ selection: { kind: "room", room: roomA, seed: first }, revision: 1, recovery: null });
  });

  it("conflict selects the room with the prefill and no seed under a new revision", () => {
    const next = handoffReducer(draft, { type: "conflict", room: roomB, prefill });

    expect(next).toEqual({ selection: { kind: "room", room: roomB, prefill }, revision: 1, recovery: null });
  });

  it("gives an outcome for the already open room a new panel key", () => {
    const next = handoffReducer(openA, { type: "conflict", room: roomA, prefill });

    expect(roomPanelKey(next, roomA)).not.toBe(roomPanelKey(openA, roomA));
  });

  it("failed restores a draft at the submitted coordinates with the recovery, from any selection", () => {
    for (const from of [start, draft, openA, handoffReducer(draft, { type: "clickEmpty", lat: 9, lng: 8 })]) {
      const next = handoffReducer(from, { type: "failed", input, error });

      expect(next.selection).toEqual({ kind: "draft", lat: 1.5, lng: 2.5 });
      expect(next.recovery).toEqual({ input, error });
      expect(next.revision).toBe(from.revision + 1);
      expect(draftPanelKey(next)).not.toBe(draftPanelKey(from));
    }
  });

  it("a success after a recovery clears it", () => {
    const next = handoffReducer(recovered, { type: "created", room: roomA, message: first });

    expect(next.recovery).toBeNull();
    expect(next.revision).toBe(recovered.revision + 1);
  });

  it("applies outcomes in the order they arrive, each under its own revision", () => {
    const afterCreate = handoffReducer(draft, { type: "created", room: roomA, message: first });
    const afterFailure = handoffReducer(afterCreate, { type: "failed", input, error });

    expect(afterFailure.selection).toEqual({ kind: "draft", lat: 1.5, lng: 2.5 });
    expect(afterFailure.revision).toBe(2);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test src/lib/page/handoff.test.ts`
Expected: FAIL with `Failed to resolve import "@/lib/page/handoff"`.

- [ ] **Step 3: Implement the reducer**

Create `src/lib/page/handoff.ts`:

```ts
import { type Prefill, type Selection, selectionReducer } from "@/lib/page/selection";
import type { CreateRoomInput } from "@/lib/schemas/room";
import type { Message, Room } from "@/lib/schemas/types";

/** A rejected create: what was submitted and why it failed (new-room design §6). */
export type Recovery = { input: CreateRoomInput; error: unknown };

/**
 * What `MapShell` keeps next to the selection (new-room design §6).
 * `revision` is part of both panel keys: every create outcome increments it,
 * so the panel it opens is a fresh mount even when the same room, or a draft,
 * is already showing. `recovery` is non-null only while the draft it restored
 * is still open.
 */
export type Handoff = { selection: Selection; revision: number; recovery: Recovery | null };

export type HandoffAction =
  | { type: "clickEmpty"; lat: number; lng: number }
  | { type: "clickPin"; room: Room }
  | { type: "close" }
  | { type: "created"; room: Room; message: Message }
  | { type: "conflict"; room: Room; prefill: Prefill }
  | { type: "failed"; input: CreateRoomInput; error: unknown };

export function initialHandoff(selection: Selection): Handoff {
  return { selection, revision: 0, recovery: null };
}

/**
 * Wraps the pure selection reducer; its transitions and actions are unchanged.
 * Selection, revision and recovery change in one state update, so React never
 * commits a new selection under an old panel key.
 */
export function handoffReducer(state: Handoff, action: HandoffAction): Handoff {
  switch (action.type) {
    case "clickEmpty": {
      // Moving an open draft keeps its form, and with it a recovered error.
      const recovery = state.selection.kind === "draft" ? state.recovery : null;
      return { ...state, selection: selectionReducer(state.selection, action), recovery };
    }
    case "clickPin": {
      const selection = selectionReducer(state.selection, action);
      // The already selected pin: same object, so nothing re-renders or remounts.
      return selection === state.selection ? state : { ...state, selection, recovery: null };
    }
    case "close":
      return { ...state, selection: selectionReducer(state.selection, action), recovery: null };
    case "created":
      return {
        selection: selectionReducer(state.selection, {
          type: "roomCreated",
          room: action.room,
          message: action.message,
        }),
        revision: state.revision + 1,
        recovery: null,
      };
    case "conflict":
      return {
        selection: selectionReducer(state.selection, {
          type: "movedToExisting",
          room: action.room,
          prefill: action.prefill,
        }),
        revision: state.revision + 1,
        recovery: null,
      };
    case "failed":
      return {
        selection: selectionReducer(state.selection, {
          type: "clickEmpty",
          lat: action.input.lat,
          lng: action.input.lng,
        }),
        revision: state.revision + 1,
        recovery: { input: action.input, error: action.error },
      };
  }
}

/** Panel keys (new-room design §6): stable across draft moves, fresh after every outcome. */
export const draftPanelKey = (handoff: Handoff) => `draft:${handoff.revision}`;
export const roomPanelKey = (handoff: Handoff, room: Room) => `${room.id}:${handoff.revision}`;
```

This is the table of spec §6, row by row. `src/lib/page/selection.ts` is not edited.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test src/lib/page`
Expected: PASS; `handoff.test.ts` has 12 tests and `selection.test.ts` is unchanged.

- [ ] **Step 5: Lint, typecheck and commit**

Run: `pnpm lint && pnpm typecheck`
Expected: clean.

```bash
git add src/lib/page/handoff.ts src/lib/page/handoff.test.ts
git commit -m "feat(page): add the handoff reducer with panel revisions and create recovery"
```

---

### Task 6: `MapShell` wiring

**Files:**
- Modify: `src/components/map/MapShell.tsx`, `src/components/map/MapShell.test.tsx`
- Test: `src/components/map/MapShell.newRoom.test.tsx`, `src/components/map/MapShell.pins.test.tsx` (create)

**Interfaces:**
- Consumes: `NewRoomPopup`, `NewRoomPopupProps`, `CREATE_FAILED_MESSAGE` (Task 3); `MOVED_NOTICE_TEXT` and the panel's notice and focus behaviour (Task 4); `handoffReducer`, `initialHandoff`, `draftPanelKey`, `roomPanelKey` (Task 5); `RoomPanel`, `PanelSlot` (chunk 9); `useRoomPins().insertRoom(room)` (stable identity; merges one room locally, no request); `deferred`, `Deferred`, `fakeMessages`, `msg`, `page` from `@/lib/feed/test-helpers` (chunk 9).
- Produces: `MapShell` renders `<NewRoomPopup key={draftPanelKey(handoff)} …>` for a draft and `<RoomPanel key={roomPanelKey(handoff, selection.room)} …>` for a room. `MapShellProps` and `pinsToRender` are unchanged.

- [ ] **Step 1: Update the one assertion chunk 9's shell test makes about the placeholder**

In `src/components/map/MapShell.test.tsx` replace the test `"shows the New chatroom placeholder with the coordinates after an empty click"` up to and including its `46.500000, 23.500000` assertion:

```tsx
  it("shows the New chatroom placeholder with the coordinates after an empty click", () => {
    renderShell();

    fireEvent.click(screen.getByTestId("empty"));

    expect(screen.getByText("New chatroom")).toBeTruthy();
    expect(screen.getByText("46.500000, 23.500000")).toBeTruthy();
```

with

```tsx
  it("shows the New chatroom form with the coordinates after an empty click", () => {
    renderShell();

    fireEvent.click(screen.getByTestId("empty"));

    expect(screen.getByText("New chatroom")).toBeTruthy();
    expect(screen.getByText("Your first message creates a chatroom at 46.500000, 23.500000.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create" })).toBeTruthy();
```

The rest of that test and of the file stays. Its `api` mock has `rooms: {}`; that is fine, because the popup looks `api.rooms.create` up only when Create is pressed, which this file never does.

- [ ] **Step 2: Write the failing hand-off tests**

Create `src/components/map/MapShell.newRoom.test.tsx`:

```tsx
// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MapShell } from "@/components/map/MapShell";
import type { MapViewProps } from "@/components/map/MapView";
import { MOVED_NOTICE_TEXT } from "@/components/room/MovedNotice";
import { CREATE_FAILED_MESSAGE } from "@/components/room/NewRoomPopup";
import { ApiRequestError, ApiValidationError, type CreateRoomOutcome, type MessagesApi } from "@/lib/api/client";
import { type Deferred, deferred, fakeMessages, msg, page } from "@/lib/feed/test-helpers";
import type { RoomPins } from "@/lib/map/useRoomPins";
import type { CreateRoomInput } from "@/lib/schemas/room";
import type { Message, Room } from "@/lib/schemas/types";
import { DISPLAY_NAME_KEY } from "@/lib/storage/displayName";

const fakePins = vi.hoisted(() => ({ current: null as RoomPins | null }));
vi.mock("@/lib/map/useRoomPins", () => ({
  useRoomPins: () => {
    if (fakePins.current === null) throw new Error("test did not set fakePins");
    return fakePins.current;
  },
}));

vi.mock("@/lib/config/client", () => ({
  getClientConfig: () => ({
    supabaseUrl: "http://127.0.0.1:55021",
    supabaseAnonKey: "anon",
    pollIntervalMs: 30_000,
    realtimeIdleTimeoutMs: 180_000,
  }),
}));

// The popup and the room panel run for real, against an API each test scripts.
// The holder is read at call time, so every test installs a fresh fake.
type FakeApi = { rooms: { create(input: CreateRoomInput): Promise<CreateRoomOutcome> }; messages: MessagesApi };
const fakeApi = vi.hoisted(() => ({ current: null as FakeApi | null }));
vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  api: {
    get rooms() {
      return fakeApi.current!.rooms;
    },
    get messages() {
      return fakeApi.current!.messages;
    },
  },
}));

const A = { lat: 46.5, lng: 23.5 };
const B = { lat: 10.25, lng: -20.5 };
const HINT_A = "Your first message creates a chatroom at 46.500000, 23.500000.";
const HINT_B = "Your first message creates a chatroom at 10.250000, -20.500000.";

// The fake MapView renders pins as buttons and offers two empty spots, A and B.
vi.mock("next/dynamic", () => ({
  default: () =>
    function FakeMapView(props: MapViewProps) {
      return (
        <div data-testid="map">
          {props.rooms.map((room) => (
            <button
              key={room.id}
              type="button"
              data-testid="pin"
              data-selected={String(room.id === props.selectedRoomId)}
              onClick={() => props.onPinClick(room)}
            >
              {room.name}
            </button>
          ))}
          {props.draft ? (
            <span data-testid="draft">
              {props.draft.lat},{props.draft.lng}
            </span>
          ) : null}
          <button type="button" data-testid="empty-a" onClick={() => props.onEmptyClick(A)}>
            empty a
          </button>
          <button type="button" data-testid="empty-b" onClick={() => props.onEmptyClick(B)}>
            empty b
          </button>
        </div>
      );
    },
}));

const existing: Room = {
  id: "00000000-0000-4000-8000-00000000000a",
  name: "brave-crimson-otter",
  lat: A.lat,
  lng: A.lng,
  createdAt: "2026-09-16T15:00:00.000000Z",
};
const other: Room = { ...existing, id: "00000000-0000-4000-8000-00000000000b", name: "calm-amber-heron", lat: 1, lng: 2 };
const created: Room = { ...existing, id: "00000000-0000-4000-8000-00000000000c", name: "eager-violet-lynx" };
const first: Message = {
  id: "00000000-0000-4000-8000-0000000000f1",
  chatroomId: created.id,
  author: "ann",
  text: "first message here",
  createdAt: "2026-09-16T15:00:01.000000Z",
};

const lost = () => new TypeError("Failed to fetch");

function setup(rooms: Room[] = [existing, other]) {
  const messages = fakeMessages();
  const creates: (Deferred<CreateRoomOutcome> & { input: CreateRoomInput })[] = [];
  const create = vi.fn((input: CreateRoomInput) => {
    const call = { ...deferred<CreateRoomOutcome>(), input };
    creates.push(call);
    return call.promise;
  });
  fakeApi.current = { rooms: { create }, messages: messages.api };
  const insertRoom = vi.fn();
  fakePins.current = {
    rooms,
    truncated: false,
    status: "ready",
    setViewport: vi.fn(),
    refresh: vi.fn(),
    insertRoom,
  };
  const user = userEvent.setup();
  render(<MapShell initialSelection={{ kind: "none" }} initialCenter={{ lat: 0, lng: 0 }} initialZoom={2} />);

  const author = () => screen.getByLabelText("Display name");
  const text = () => screen.getByLabelText("Message");
  return {
    user,
    messages,
    creates,
    create,
    insertRoom,
    author,
    text,
    clickEmpty: (spot: "a" | "b" = "a") => fireEvent.click(screen.getByTestId(`empty-${spot}`)),
    clickPin: (room: Room) => fireEvent.click(screen.getByRole("button", { name: room.name })),
    close: () => fireEvent.click(screen.getByRole("button", { name: "Close" })),
    /** Fills the open draft and presses Create; the request stays pending in `creates`. */
    async submitDraft(name = "ann", body = "first message here") {
      await user.clear(author());
      await user.type(author(), name);
      await user.clear(text());
      await user.type(text(), body);
      const before = creates.length;
      await user.click(screen.getByRole("button", { name: "Create" }));
      await waitFor(() => expect(creates).toHaveLength(before + 1));
    },
  };
}

/** Settles a pending call inside `act`, so React commits what follows from it. */
const settle = (run: () => void) =>
  act(async () => {
    run();
  });

const heading = (name: string) => screen.queryByText(name, { selector: '[data-slot="card-title"] *' });
const notice = () => screen.queryByText(MOVED_NOTICE_TEXT);

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  return () => {
    vi.restoreAllMocks();
    fakePins.current = null;
    fakeApi.current = null;
  };
});

describe("MapShell draft", () => {
  it("renders the new-room popup with the draft's coordinates", () => {
    const { clickEmpty } = setup();

    clickEmpty();

    expect(screen.getByText(HINT_A)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "About new chatrooms" })).toBeInTheDocument();
    expect(screen.getByTestId("draft")).toHaveTextContent("46.5,23.5");
  });

  it("keeps the typed text and updates the hint when the draft moves", async () => {
    const { user, clickEmpty, author, text } = setup();
    clickEmpty();
    await user.type(author(), "ann");
    await user.type(text(), "half a thought");

    clickEmpty("b");

    expect(screen.getByText(HINT_B)).toBeInTheDocument();
    expect(author()).toHaveValue("ann");
    expect(text()).toHaveValue("half a thought");
  });
});

describe("MapShell create outcomes", () => {
  it("created: inserts the pin and opens the seeded room without a history request", async () => {
    const { clickEmpty, submitDraft, creates, insertRoom, messages, text } = setup();
    clickEmpty();
    await submitDraft();

    await settle(() => creates[0].resolve({ status: "created", room: created, message: first }));

    expect(creates[0].input).toEqual({ author: "ann", text: "first message here", ...A });
    expect(insertRoom).toHaveBeenCalledTimes(1);
    expect(insertRoom).toHaveBeenCalledWith(created);
    expect(heading(created.name)).toBeInTheDocument();
    expect(within(screen.getByRole("log")).getAllByText("first message here")).toHaveLength(1);
    expect(screen.queryByTestId("draft")).toBeNull();
    expect(screen.getByRole("button", { name: created.name })).toHaveAttribute("data-selected", "true");
    expect(notice()).not.toBeInTheDocument();
    expect(text()).toHaveValue("");
    expect(text()).toHaveFocus();
    expect(localStorage.getItem(DISPLAY_NAME_KEY)).toBe("ann");
    expect(messages.api.list).not.toHaveBeenCalled();
    // The stand-in realtime adapter refuses on the next macrotask; the first poll starts at the seed.
    await waitFor(() => expect(messages.api.listAfter).toHaveBeenCalledWith(created.id, first.id));
    expect(messages.api.list).not.toHaveBeenCalled();
    expect(within(screen.getByRole("log")).getAllByText("first message here")).toHaveLength(1);
  });

  it("conflict: opens the existing room with the notice and the unsent draft, and posts nothing", async () => {
    const { clickEmpty, submitDraft, creates, insertRoom, messages, author, text } = setup();
    clickEmpty();
    await submitDraft("  ann ", " my first words ");

    await settle(() => creates[0].resolve({ status: "conflict", room: existing }));

    expect(insertRoom).toHaveBeenCalledWith(existing);
    expect(heading(existing.name)).toBeInTheDocument();
    expect(notice()).toBeInTheDocument();
    expect(author()).toHaveValue("ann");
    expect(text()).toHaveValue("my first words");
    expect(messages.api.list).toHaveBeenCalledTimes(1);
    expect(messages.api.list).toHaveBeenCalledWith(existing.id);

    await settle(() => messages.list[0].resolve(page([msg(1)])));
    expect(text()).toHaveFocus();
    expect(within(screen.getByRole("log")).queryByText("my first words")).not.toBeInTheDocument();
    expect(messages.api.post).not.toHaveBeenCalled();
    expect(creates).toHaveLength(1);
  });
});

describe("MapShell take-over", () => {
  const away = [
    ["a pin was clicked", (ctx: ReturnType<typeof setup>) => ctx.clickPin(other)],
    ["the panel was closed", (ctx: ReturnType<typeof setup>) => ctx.close()],
  ] as const;

  it.each(away)("created takes over after %s", async (_label, leave) => {
    const ctx = setup();
    ctx.clickEmpty();
    await ctx.submitDraft();
    leave(ctx);

    await settle(() => ctx.creates[0].resolve({ status: "created", room: created, message: first }));

    expect(heading(created.name)).toBeInTheDocument();
    expect(within(screen.getByRole("log")).getAllByText("first message here")).toHaveLength(1);
    expect(ctx.messages.api.list).not.toHaveBeenCalledWith(created.id);
  });

  it.each(away)("conflict takes over after %s", async (_label, leave) => {
    const ctx = setup();
    ctx.clickEmpty();
    await ctx.submitDraft();
    leave(ctx);

    await settle(() => ctx.creates[0].resolve({ status: "conflict", room: existing }));

    expect(heading(existing.name)).toBeInTheDocument();
    expect(notice()).toBeInTheDocument();
    expect(ctx.text()).toHaveValue("first message here");
  });

  it("a click on the already selected pin keeps the panel, its edits and its notice", async () => {
    const { clickEmpty, submitDraft, creates, clickPin, messages, user, text } = setup();
    clickEmpty();
    await submitDraft();
    await settle(() => creates[0].resolve({ status: "conflict", room: existing }));
    await settle(() => messages.list[0].resolve(page([msg(1)])));
    await user.type(text(), " and more");

    clickPin(existing);

    expect(text()).toHaveValue("first message here and more");
    expect(notice()).toBeInTheDocument();
    expect(messages.api.list).toHaveBeenCalledTimes(1);
  });
});

describe("MapShell outcome for the room that is already open", () => {
  /** Create pending at A, then the eventual conflict room opened from its pin and loaded. */
  async function openExistingWhileCreating() {
    const ctx = setup();
    ctx.clickEmpty();
    await ctx.submitDraft("ann", "submitted words");
    ctx.clickPin(existing);
    await settle(() => ctx.messages.list[0].resolve(page([msg(1)])));
    return ctx;
  }

  it("conflict after an edit: a fresh panel with the submitted prefill, the notice and focus", async () => {
    const ctx = await openExistingWhileCreating();
    await ctx.user.clear(ctx.author());
    await ctx.user.type(ctx.author(), "someone else");
    await ctx.user.type(ctx.text(), "typed in the open room");

    await settle(() => ctx.creates[0].resolve({ status: "conflict", room: existing }));

    expect(ctx.author()).toHaveValue("ann");
    expect(ctx.text()).toHaveValue("submitted words");
    expect(notice()).toBeInTheDocument();
    expect(ctx.messages.api.list).toHaveBeenCalledTimes(2); // a fresh feed loads history again
    expect(ctx.text()).toBeDisabled();
    await settle(() => ctx.messages.list[1].resolve(page([msg(1)])));
    expect(ctx.text()).toHaveFocus();
  });

  it("conflict after a send: the notice shows again, and the old panel's pending send cannot touch the new one", async () => {
    const ctx = await openExistingWhileCreating();
    await ctx.user.type(ctx.author(), "ann");
    await ctx.user.type(ctx.text(), "sent from the open room");
    await ctx.user.click(screen.getByRole("button", { name: "Send" }));
    await settle(() => ctx.messages.post[0].resolve(msg(2, { text: "sent from the open room" })));
    await ctx.user.type(ctx.text(), "a second one");
    await ctx.user.click(screen.getByRole("button", { name: "Send" }));
    expect(ctx.messages.post).toHaveLength(2); // still pending when the conflict arrives

    await settle(() => ctx.creates[0].resolve({ status: "conflict", room: existing }));
    await settle(() => ctx.messages.list[1].resolve(page([msg(1), msg(2, { text: "sent from the open room" })])));
    expect(notice()).toBeInTheDocument();
    expect(ctx.text()).toHaveValue("submitted words");

    await settle(() => ctx.messages.post[1].resolve(msg(3, { text: "a second one" })));

    expect(notice()).toBeInTheDocument();
    expect(ctx.text()).toHaveValue("submitted words");
    expect(within(screen.getByRole("log")).queryByText("a second one")).not.toBeInTheDocument();
  });

  it("created: the feed opened from the pin is disposed and a seeded one takes its place", async () => {
    const ctx = setup([existing, other, created]); // the new room was already discovered by a refresh
    ctx.clickEmpty();
    await ctx.submitDraft();
    ctx.clickPin(created);
    expect(ctx.messages.api.list).toHaveBeenCalledTimes(1); // the pin's own history request, still pending

    await settle(() => ctx.creates[0].resolve({ status: "created", room: created, message: first }));

    expect(within(screen.getByRole("log")).getAllByText("first message here")).toHaveLength(1);
    expect(ctx.messages.api.list).toHaveBeenCalledTimes(1); // the seeded feed asks for no history
    await waitFor(() => expect(ctx.messages.api.listAfter).toHaveBeenCalledWith(created.id, first.id));

    // The disposed feed's late history is ignored.
    await settle(() => ctx.messages.list[0].resolve(page([msg(1, { text: "late history row" })])));
    expect(screen.queryByText("late history row")).not.toBeInTheDocument();
    expect(within(screen.getByRole("log")).getAllByText("first message here")).toHaveLength(1);
  });
});

describe("MapShell failure recovery", () => {
  const unavailable = new ApiRequestError(503, "unavailable", "Could not find a free room name, please try again");
  const badLat = new ApiValidationError([{ path: "lat", message: "must be between -90 and 90" }]);

  function expectRecoveredAtA(ctx: ReturnType<typeof setup>, shown: string) {
    expect(screen.getByText(HINT_A)).toBeInTheDocument();
    expect(screen.getByTestId("draft")).toHaveTextContent("46.5,23.5");
    expect(ctx.author()).toHaveValue("ann");
    expect(ctx.text()).toHaveValue("first message here");
    expect(ctx.text()).toBeEnabled();
    expect(screen.getByRole("alert")).toHaveTextContent(shown);
    expect(ctx.create).toHaveBeenCalledTimes(1);
    expect(ctx.messages.api.post).not.toHaveBeenCalled();
    expect(localStorage.getItem(DISPLAY_NAME_KEY)).toBeNull();
  }

  it("restores the draft in place when the popup is still open", async () => {
    const ctx = setup();
    ctx.clickEmpty();
    await ctx.submitDraft("  ann ", " first message here ");

    await settle(() => ctx.creates[0].reject(lost()));

    expectRecoveredAtA(ctx, CREATE_FAILED_MESSAGE); // trimmed, as submitted
  });

  it("restores it after the panel was closed", async () => {
    const ctx = setup();
    ctx.clickEmpty();
    await ctx.submitDraft();
    ctx.close();

    await settle(() => ctx.creates[0].reject(unavailable));

    expectRecoveredAtA(ctx, "Could not find a free room name, please try again");
  });

  it("restores it over a room that was opened meanwhile", async () => {
    const ctx = setup();
    ctx.clickEmpty();
    await ctx.submitDraft();
    ctx.clickPin(other);

    await settle(() => ctx.creates[0].reject(badLat));

    expectRecoveredAtA(ctx, "lat must be between -90 and 90");
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
  });

  it("restores it over a replacement draft, whose own edits are replaced", async () => {
    const ctx = setup();
    ctx.clickEmpty();
    await ctx.submitDraft();
    ctx.close();
    ctx.clickEmpty("b");
    await ctx.user.type(ctx.text(), "typed into the replacement");

    await settle(() => ctx.creates[0].reject(lost()));

    expectRecoveredAtA(ctx, CREATE_FAILED_MESSAGE);
  });

  it("submit at A, move to B, reject: A comes back and an immediate retry targets A", async () => {
    const ctx = setup();
    ctx.clickEmpty();
    await ctx.submitDraft();
    ctx.clickEmpty("b");
    expect(screen.getByText(HINT_B)).toBeInTheDocument();

    await settle(() => ctx.creates[0].reject(lost()));
    expectRecoveredAtA(ctx, CREATE_FAILED_MESSAGE);

    await ctx.user.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(ctx.creates).toHaveLength(2));
    expect(ctx.creates[1].input).toEqual({ author: "ann", text: "first message here", ...A });
    expect(screen.queryByText(CREATE_FAILED_MESSAGE)).not.toBeInTheDocument(); // cleared by the submit
  });

  it("moving the recovered draft keeps the guidance and makes the next create target B", async () => {
    const ctx = setup();
    ctx.clickEmpty();
    await ctx.submitDraft();
    await settle(() => ctx.creates[0].reject(lost()));

    ctx.clickEmpty("b");

    expect(screen.getByText(HINT_B)).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(CREATE_FAILED_MESSAGE);
    expect(ctx.text()).toHaveValue("first message here");
    await ctx.user.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(ctx.creates).toHaveLength(2));
    expect(ctx.creates[1].input).toEqual({ author: "ann", text: "first message here", ...B });
  });

  it("closing a recovered draft discards it", async () => {
    const ctx = setup();
    ctx.clickEmpty();
    await ctx.submitDraft();
    await settle(() => ctx.creates[0].reject(lost()));

    ctx.close();
    ctx.clickEmpty();

    expect(ctx.text()).toHaveValue("");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("MapShell with several creates pending", () => {
  it("applies outcomes in settlement order, each from its own snapshot", async () => {
    const ctx = setup();
    ctx.clickEmpty();
    await ctx.submitDraft("ann", "request one");
    ctx.close();
    ctx.clickEmpty("b");
    await ctx.submitDraft("bea", "request two");
    ctx.close();

    await settle(() =>
      ctx.creates[1].resolve({ status: "created", room: created, message: { ...first, author: "bea", text: "request two" } }),
    );
    expect(heading(created.name)).toBeInTheDocument();
    expect(within(screen.getByRole("log")).getAllByText("request two")).toHaveLength(1);

    await settle(() => ctx.creates[0].reject(lost()));
    expect(screen.getByText(HINT_A)).toBeInTheDocument();
    expect(ctx.author()).toHaveValue("ann");
    expect(ctx.text()).toHaveValue("request one");
    expect(screen.getByRole("alert")).toHaveTextContent(CREATE_FAILED_MESSAGE);
    expect(ctx.create).toHaveBeenCalledTimes(2);
  });

  it("a conflict that settles after a created outcome replaces that room's panel", async () => {
    const ctx = setup();
    ctx.clickEmpty();
    await ctx.submitDraft("ann", "request one");
    ctx.close();
    ctx.clickEmpty("b");
    await ctx.submitDraft("bea", "request two");

    await settle(() => ctx.creates[1].resolve({ status: "created", room: created, message: first }));
    await settle(() => ctx.creates[0].resolve({ status: "conflict", room: existing }));

    expect(heading(existing.name)).toBeInTheDocument();
    expect(notice()).toBeInTheDocument();
    expect(ctx.author()).toHaveValue("ann");
    expect(ctx.text()).toHaveValue("request one");
    expect(ctx.insertRoom.mock.calls).toEqual([[created], [existing]]);
  });
});
```

How these tests work:
- `useRoomPins` is mocked, so `insertRoom` is a spy and the selected room's pin appears through `pinsToRender`. The popup, the room panel, the feed hook and the store are real. `api` is a holder read at call time, so each test scripts its own `rooms.create` (every call stays pending in `creates` until the test settles it) and `fakeMessages()`.
- Realtime is chunk 9's default stand-in adapter, which refuses on the next macrotask and starts polling; that is why `listAfter` is awaited with `waitFor`.
- "Several creates pending" is reachable because closing a pending popup and clicking the map mounts a new, enabled popup.

- [ ] **Step 3: Write the failing pin-retention test**

Create `src/components/map/MapShell.pins.test.tsx`:

```tsx
// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";

import { MapShell } from "@/components/map/MapShell";
import type { MapViewProps } from "@/components/map/MapView";
import type { CreateRoomOutcome } from "@/lib/api/client";
import { type Deferred, deferred, fakeMessages } from "@/lib/feed/test-helpers";
import type { Room } from "@/lib/schemas/types";

// Unlike MapShell.newRoom.test.tsx, `useRoomPins` is real here: the point is how
// its refreshes interact with a room inserted by a create outcome (new-room design §6).
type RoomList = { rooms: Room[]; truncated: boolean };
const fakeApi = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  api: {
    get rooms() {
      return (fakeApi.current as { rooms: unknown }).rooms;
    },
    get messages() {
      return (fakeApi.current as { messages: unknown }).messages;
    },
  },
}));

vi.mock("@/lib/config/client", () => ({
  getClientConfig: () => ({
    supabaseUrl: "http://127.0.0.1:55021",
    supabaseAnonKey: "anon",
    pollIntervalMs: 3_600_000, // no periodic refresh during the test
    realtimeIdleTimeoutMs: 3_600_000,
  }),
}));

vi.mock("next/dynamic", () => ({
  default: () =>
    function FakeMapView(props: MapViewProps) {
      return (
        <div>
          {props.rooms.map((room) => (
            <button key={room.id} type="button" onClick={() => props.onPinClick(room)}>
              {room.name}
            </button>
          ))}
          <button type="button" onClick={() => props.onEmptyClick({ lat: 46.5, lng: 23.5 })}>
            empty
          </button>
          <button
            type="button"
            onClick={() => props.onViewportChange({ west: 1, south: 2, east: 3, north: 4 })}
          >
            move
          </button>
        </div>
      );
    },
}));

const existing: Room = {
  id: "00000000-0000-4000-8000-00000000000a",
  name: "brave-crimson-otter",
  lat: 46.5,
  lng: 23.5,
  createdAt: "2026-09-16T15:00:00.000000Z",
};
const other: Room = { ...existing, id: "00000000-0000-4000-8000-00000000000b", name: "calm-amber-heron", lat: 1, lng: 2 };

const pin = (room: Room) => screen.queryByRole("button", { name: room.name });

beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
  return () => {
    fakeApi.current = null;
  };
});

it("keeps an inserted pin while its room is selected, then follows the fetched rooms", async () => {
  const lists: Deferred<RoomList>[] = [];
  const create = deferred<CreateRoomOutcome>();
  fakeApi.current = {
    rooms: {
      list: vi.fn(() => {
        const call = deferred<RoomList>();
        lists.push(call);
        return call.promise;
      }),
      create: vi.fn(() => create.promise),
    },
    messages: fakeMessages().api, // history stays pending; this test is about pins
  };
  const user = userEvent.setup();
  render(<MapShell initialSelection={{ kind: "none" }} initialCenter={{ lat: 0, lng: 0 }} initialZoom={2} />);

  // A refresh whose snapshot predates the room is in flight…
  fireEvent.click(screen.getByRole("button", { name: "move" }));
  expect(lists).toHaveLength(1);

  // …when a create lands on that room.
  fireEvent.click(screen.getByRole("button", { name: "empty" }));
  await user.type(screen.getByLabelText("Display name"), "ann");
  await user.type(screen.getByLabelText("Message"), "hello");
  await user.click(screen.getByRole("button", { name: "Create" }));
  await act(async () => create.resolve({ status: "conflict", room: existing }));
  expect(pin(existing)).toBeInTheDocument(); // inserted at once

  // The older refresh settles without it: the selected room keeps its pin.
  await act(async () => lists[0].resolve({ rooms: [other], truncated: false }));
  expect(pin(other)).toBeInTheDocument();
  expect(pin(existing)).toBeInTheDocument();

  // Closed: no retention guarantee, the pin follows the fetched collection.
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(pin(existing)).not.toBeInTheDocument();

  // A later refresh that contains the room brings the pin back.
  fireEvent.click(screen.getByRole("button", { name: "move" }));
  await waitFor(() => expect(lists).toHaveLength(2)); // after the 250 ms debounce
  await act(async () => lists[1].resolve({ rooms: [existing, other], truncated: false }));
  expect(pin(existing)).toBeInTheDocument();
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `pnpm test src/components/map`
Expected: FAIL. In `MapShell.test.tsx` the updated test fails (the shell still renders the coordinates-only placeholder). Every test in `MapShell.newRoom.test.tsx` and the one in `MapShell.pins.test.tsx` fail, most of them at the first lookup of the "Display name" field or the "Create" button.

- [ ] **Step 5: Wire the shell**

Replace `src/components/map/MapShell.tsx` with:

```tsx
"use client";

import dynamic from "next/dynamic";
import { useCallback, useMemo, useReducer } from "react";

import { MapStatus } from "@/components/map/MapStatus";
import type { MapViewProps } from "@/components/map/MapView";
import { PanelSlot } from "@/components/panel/PanelSlot";
import { WelcomeCard } from "@/components/panel/WelcomeCard";
import { NewRoomPopup } from "@/components/room/NewRoomPopup";
import { RoomPanel } from "@/components/room/RoomPanel";
import { useRoomPins } from "@/lib/map/useRoomPins";
import type { LatLng } from "@/lib/map/viewport";
import { draftPanelKey, handoffReducer, initialHandoff, roomPanelKey } from "@/lib/page/handoff";
import type { Prefill, Selection } from "@/lib/page/selection";
import type { CreateRoomInput } from "@/lib/schemas/room";
import type { Message, Room } from "@/lib/schemas/types";

// Leaflet touches `window` at import time, so the map is a client-only bundle.
// The neutral placeholder keeps the panel slot positioned before it arrives.
const MapView = dynamic<MapViewProps>(() => import("@/components/map/MapView"), {
  ssr: false,
  loading: () => <div className="h-full w-full bg-muted" />,
});

export type MapShellProps = {
  initialSelection: Selection;
  initialCenter: LatLng;
  initialZoom: number;
};

/** The fetched rooms plus the selected room when the capped response omits it (spec §5.3, PRD 4). */
export function pinsToRender(rooms: Room[], selection: Selection): Room[] {
  if (selection.kind !== "room") return rooms;
  const selectedId = selection.room.id;
  return rooms.some((room) => room.id === selectedId) ? rooms : [...rooms, selection.room];
}

/**
 * The map page (spec §3): owns the selection and the pins, renders the map,
 * the status pill and the one floating panel. The panel and the pill are
 * siblings of the Leaflet container, so their pointer events never reach the
 * map and Leaflet's own z-indexes stay scoped to its container.
 *
 * It also owns the new-room hand-off (new-room design §6): a create outcome
 * always takes over the panel, whatever is selected by then, and the handoff
 * revision in the panel keys makes that panel a fresh mount.
 */
export function MapShell({ initialSelection, initialCenter, initialZoom }: MapShellProps) {
  const [handoff, dispatch] = useReducer(handoffReducer, initialSelection, initialHandoff);
  const { selection, recovery } = handoff;
  const pins = useRoomPins();
  const { insertRoom } = pins;
  const rooms = useMemo(() => pinsToRender(pins.rooms, selection), [pins.rooms, selection]);

  const onEmptyClick = useCallback(
    (point: LatLng) => dispatch({ type: "clickEmpty", lat: point.lat, lng: point.lng }),
    [],
  );
  const onPinClick = useCallback((room: Room) => dispatch({ type: "clickPin", room }), []);
  const close = useCallback(() => dispatch({ type: "close" }), []);

  // Called when a create request settles, possibly long after its popup
  // unmounted. They touch only `dispatch` and `insertRoom`, both stable, so a
  // callback captured by an old request is as good as the current one. The pin
  // insert and the selection land in one render.
  const onCreated = useCallback(
    (room: Room, message: Message) => {
      insertRoom(room);
      dispatch({ type: "created", room, message });
    },
    [insertRoom],
  );
  const onConflict = useCallback(
    (room: Room, prefill: Prefill) => {
      insertRoom(room);
      dispatch({ type: "conflict", room, prefill });
    },
    [insertRoom],
  );
  const onFailed = useCallback(
    (input: CreateRoomInput, error: unknown) => dispatch({ type: "failed", input, error }),
    [],
  );

  return (
    <div className="relative h-dvh w-full overflow-hidden">
      <div className="absolute inset-0 z-0">
        <MapView
          center={initialCenter}
          zoom={initialZoom}
          rooms={rooms}
          selectedRoomId={selection.kind === "room" ? selection.room.id : undefined}
          draft={selection.kind === "draft" ? { lat: selection.lat, lng: selection.lng } : undefined}
          onViewportChange={pins.setViewport}
          onEmptyClick={onEmptyClick}
          onPinClick={onPinClick}
        />
      </div>
      <MapStatus truncated={pins.truncated} refreshFailed={pins.status === "error"} />
      <PanelSlot>
        {selection.kind === "none" ? <WelcomeCard /> : null}
        {selection.kind === "draft" ? (
          // The key survives ordinary draft moves, so typed text does; a rejected create gets a new one.
          <NewRoomPopup
            key={draftPanelKey(handoff)}
            lat={selection.lat}
            lng={selection.lng}
            recovery={recovery ?? undefined}
            onCreated={onCreated}
            onConflict={onConflict}
            onFailed={onFailed}
            onClose={close}
          />
        ) : null}
        {selection.kind === "room" ? (
          // Keyed by room id and handoff revision: another room, or a create
          // outcome for this same room, remounts the panel with a fresh feed.
          <RoomPanel
            key={roomPanelKey(handoff, selection.room)}
            room={selection.room}
            seed={selection.seed}
            prefill={selection.prefill}
            onClose={close}
          />
        ) : null}
      </PanelSlot>
    </div>
  );
}
```

If chunk 9's delivered `MapShell.tsx` differs from its plan, keep its differences and apply these changes: `useReducer(handoffReducer, initialSelection, initialHandoff)` instead of the selection reducer; the three outcome callbacks; `NewRoomPopup` in place of the draft placeholder (the `PanelFrame` import goes away with it); the two panel keys.

Points that are easy to get wrong:
- `insertRoom` and `dispatch` are called in the same tick. React batches them, so the draft pin disappears and the room appears in one render.
- The callbacks must stay valid after the popup that received them unmounted. They close over nothing but `dispatch` and `insertRoom`; do not add state reads to them.
- `recovery ?? undefined`: the reducer stores `null`, the popup's prop is optional.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm test src/components/map`
Expected: PASS. `MapShell.test.tsx` keeps chunk 9's count (16); `MapShell.newRoom.test.tsx` 21 tests; `MapShell.pins.test.tsx` 1 test.

- [ ] **Step 7: Prove the key tests can fail**

Each mutation is temporary. Apply it, run `pnpm test src/components/map/MapShell.newRoom.test.tsx`, compare, and undo it with `git checkout src/lib/page/handoff.ts`.

| Mutation in `src/lib/page/handoff.ts` | Expected failures |
| --- | --- |
| `roomPanelKey` returns `room.id` | the three tests of "MapShell outcome for the room that is already open" |
| `draftPanelKey` returns `"draft"` | "restores the draft in place when the popup is still open", "restores it over a replacement draft, whose own edits are replaced" |
| `clickEmpty` sets `recovery` to `null` always | "moving the recovered draft keeps the guidance and makes the next create target B" |

If a mutation leaves everything green, the test does not prove what its name says: stop and investigate.

- [ ] **Step 8: Run the whole suite, lint and typecheck**

Run: `pnpm test && pnpm lint && pnpm typecheck`
Expected: B-files + 4 files / B-tests + 81 tests (with Tasks 2–5 done; 40 files / 776 tests on chunk 9's predicted baseline); lint and typecheck clean.

- [ ] **Step 9: Commit**

```bash
git add src/components/map/MapShell.tsx src/components/map/MapShell.test.tsx src/components/map/MapShell.newRoom.test.tsx src/components/map/MapShell.pins.test.tsx
git commit -m "feat(map): create rooms from the draft panel and hand every outcome to a fresh panel"
```

---

### Task 7: Playwright scenarios

These tests are written after the code they exercise, so the expected first result is a pass. A failure is a product defect or a wrong assumption about layout: use superpowers:systematic-debugging, open the trace (`pnpm exec playwright show-trace <path printed in the failure>`), and fix the cause. Do not loosen an assertion or add a sleep to make a scenario pass.

**Files:**
- Modify: `tests/e2e/helpers.ts`, `src/app/e2e/room-panel-layout/page.dev.tsx`, `tests/e2e/room-panel.spec.ts`
- Create: `tests/e2e/new-room.spec.ts`, `src/app/e2e/new-room-layout/page.dev.tsx`

**Interfaces:**
- Consumes: chunk 9's `tests/e2e/helpers.ts` (`ROOM_REGION`, `POLL_INTERVAL_MS`, `fillCompose(page, author, text)`, `rows(log)`, `type Room`, `type Message`), its Playwright configuration and the dev-only `dev.tsx` page extension; the running app: `POST /api/rooms` → `201 { room, message }` or `409 { error: { code: "conflict", room } }`, `GET /api/rooms?bbox=minLng,minLat,maxLng,maxLat` → `{ rooms, truncated }`; pins with `title = room.name`; `NewRoomPopup` with `recovery` and `createRoom` props (Task 3); `PanelSlot` (chunk 9).
- Produces: `clickEmptySpot(page: Page): Promise<{ lat: number; lng: number }>` in `tests/e2e/helpers.ts`; the dev-server route `/e2e/new-room-layout`; five tests in `tests/e2e/new-room.spec.ts`.

- [ ] **Step 1: Add `clickEmptySpot` to the helpers**

Append to the end of `tests/e2e/helpers.ts` (it already imports `expect` and `Page` from `@playwright/test` and re-exports `ROOM_REGION`):

```ts
const NEW_ROOM_HINT = /Your first message creates a chatroom at (-?\d+\.\d{6}), (-?\d+\.\d{6})\./;

/**
 * Pixels of the opening view (1280 × 720, centre 46.7712, 23.6236, zoom 2) that
 * a test may click: left of the panel slot, below the status pill, clear of the
 * zoom control and the attribution, inside the one world copy.
 */
const CLICK_AREA = { minX: 120, maxX: 840, minY: 120, maxY: 600 };
/** Where ROOM_REGION and its pins are drawn; fixture rooms pile up there, so it is skipped. */
const FIXTURE_PIXELS = { minX: 520, maxX: 660, minY: 280, maxY: 420 };

const randomInt = (min: number, max: number) => Math.floor(min + Math.random() * (max - min + 1));

/**
 * Places the draft pin on a spot where no room exists and returns the
 * coordinates shown in the popup's hint (the ones the server will store).
 * Rooms accumulate in the local database across runs, so nothing here depends
 * on a clean map: a click that opens an older room, lands in ROOM_REGION or
 * hits coordinates that already have a room is retried elsewhere.
 * Expects the map page with no panel open.
 */
export async function clickEmptySpot(page: Page): Promise<{ lat: number; lng: number }> {
  await expect(page.getByRole("button", { name: "Zoom in" })).toBeVisible(); // Leaflet has mounted
  const hint = page.getByText(NEW_ROOM_HINT);
  const send = page.getByRole("button", { name: "Send" });
  const close = page.getByRole("button", { name: "Close" });

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const x = randomInt(CLICK_AREA.minX, CLICK_AREA.maxX);
    const y = randomInt(CLICK_AREA.minY, CLICK_AREA.maxY);
    const inFixturePixels =
      x >= FIXTURE_PIXELS.minX && x <= FIXTURE_PIXELS.maxX && y >= FIXTURE_PIXELS.minY && y <= FIXTURE_PIXELS.maxY;
    if (inFixturePixels) continue;

    await page.mouse.click(x, y);
    // The draft appears after the map's 500 ms double-click window; a pin opens its room at once.
    // Nothing at all means the click came before the map listened (its handlers attach just
    // after the zoom control shows): try again rather than fail.
    const appeared = await hint
      .or(send)
      .waitFor({ state: "visible", timeout: 3_000 })
      .then(() => true, () => false);
    if (!appeared) continue;
    if (await send.isVisible()) {
      await close.click(); // landed on an older pin
      continue;
    }

    const match = NEW_ROOM_HINT.exec(await hint.innerText());
    if (match === null) throw new Error("clickEmptySpot: the hint has no coordinates");
    const lat = Number(match[1]);
    const lng = Number(match[2]);
    const inRegion =
      lat >= ROOM_REGION.minLat - 1 && lat <= ROOM_REGION.maxLat + 1 &&
      lng >= ROOM_REGION.minLng - 1 && lng <= ROOM_REGION.maxLng + 1;
    const half = 0.0000005;
    const bbox = [lng - half, lat - half, lng + half, lat + half].map((n) => n.toFixed(7)).join(",");
    const response = await page.request.get(`/api/rooms?bbox=${bbox}`);
    expect(response.status(), await response.text()).toBe(200);
    const { rooms } = (await response.json()) as { rooms: Room[] };
    if (!inRegion && rooms.length === 0) return { lat, lng };

    await close.click(); // taken or reserved: start the next attempt from the greeting
    await expect(hint).toBeHidden();
  }
  throw new Error(
    "clickEmptySpot: no free spot after 10 attempts. The local map is crowded; if its data is disposable, run `pnpm db:reset`.",
  );
}
```

Why it looks like this:
- The opening view is centre 46.7712, 23.6236 at zoom 2, where one pixel is about 0.35° of longitude. At 1280 × 720 the one world copy spans x 61–1085 and the panel slot starts at x 880; `CLICK_AREA` stays well inside both. `ROOM_REGION` (lat 40–50, lng 0–10) is drawn at about x 573–601, y 346–387; chunk 9's fixture rooms pile up there with pins 41 px tall, so `FIXTURE_PIXELS` skips a generous box around it. The pixel boxes only save retries: the authority is the coordinate check on the hint (`ROOM_REGION` plus one degree) and the `bbox` query, a box of ±0.0000005° around the rounded point.
- A map click becomes a draft only after the 500 ms double-click window, and any `pointerdown` or `keydown` cancels a pending one (`MapEvents`). The helper therefore waits for the result of each click before it does anything else.
- A retry starts from the greeting (the panel is closed first), so "the hint is visible" always means "this click placed the draft".

- [ ] **Step 2: Add the recovered-popup fixture**

Create `src/app/e2e/new-room-layout/page.dev.tsx`:

```tsx
"use client";

import { PanelSlot } from "@/components/panel/PanelSlot";
import { NewRoomPopup } from "@/components/room/NewRoomPopup";

// 120 lines of 24 characters and 119 newlines: 2999 code points, a valid draft.
const LONG_DRAFT = Array.from(
  { length: 120 },
  (_, index) => `line ${String(index + 1).padStart(3, "0")} of a long draft`,
).join("\n");

const recovery = {
  input: { lat: 45, lng: 5, author: "ann", text: LONG_DRAFT },
  error: new TypeError("fixture: the create response was lost"),
};

const ignore = () => {};

/**
 * Dev-server-only fixture for tests/e2e (new-room design §10 scenario 3): the
 * real NewRoomPopup in the real slot, recovered from a lost create response,
 * so the full uncertain-creation error and a long draft are on screen together.
 * Served at /e2e/new-room-layout by `next dev`; absent from `next build`.
 */
export default function NewRoomLayoutFixture() {
  return (
    <div className="relative h-dvh w-full overflow-hidden">
      <PanelSlot>
        <NewRoomPopup
          lat={45}
          lng={5}
          recovery={recovery}
          onCreated={ignore}
          onConflict={ignore}
          onFailed={ignore}
          onClose={ignore}
          createRoom={() => new Promise(() => {})}
        />
      </PanelSlot>
    </div>
  );
}
```

It is a geometry fixture like chunk 9's two: real components in the real slot, synthetic props, no HTTP.

- [ ] **Step 3: Give the room-panel layout fixture a prefill**

In `src/app/e2e/room-panel-layout/page.dev.tsx` replace

```tsx
        <RoomPanel room={room} onClose={() => {}} feedDeps={feedDeps} />
```

with

```tsx
        <RoomPanel
          room={room}
          prefill={{ author: "ana", text: "unsent draft" }}
          onClose={() => {}}
          feedDeps={feedDeps}
        />
```

and extend the sentence in the `feedDeps` comment that lists what ends up on screen so it names the moved notice too: "That puts the moved notice (from the prefill), the fetch alert, the backlog notice and a compose error on screen together." Every send fails in this fixture, so the notice never goes away.

- [ ] **Step 4: Extend chunk 9's layout test with the notice**

In `tests/e2e/room-panel.spec.ts`, inside `test.describe("10. bounded compose layout", …)`, replace the test `"fetch alert, backlog notice and compose error fit together with the long draft"` with:

```ts
  test("moved notice, fetch alert, backlog notice and compose error fit together with the long draft", async ({ page }) => {
    await page.goto("/e2e/room-panel-layout");
    await expect(page.getByText("A chatroom already exists here, you have been moved to it.")).toBeVisible();
    await page.getByRole("button", { name: "Load more messages" }).click();
    await expect(page.getByText("Use Load more messages to retry.")).toBeVisible();
    await fillCompose(page, "ann", LONG_DRAFT);
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(/Couldn't send\./)).toBeVisible();
    await expect(page.getByText("More messages are available")).toBeVisible();
    await expect(page.getByText("A chatroom already exists here, you have been moved to it.")).toBeVisible();

    await expectBoundedLayout(page);
  });
```

`expectBoundedLayout` is chunk 9's and already requires at least 96 px of list height and no page scrollbar. The prototype measured 123 px.

- [ ] **Step 5: Write the new-room scenarios**

Create `tests/e2e/new-room.spec.ts`:

```ts
import { expect, test, type Page, type Request } from "@playwright/test";

import { POLL_INTERVAL_MS, clickEmptySpot, fillCompose, rows, type Message, type Room } from "./helpers";

const INFO_TEXT = "This chatroom will receive a name after the first message is sent.";
const MOVED_TEXT = "A chatroom already exists here, you have been moved to it. Your message has not been sent.";
const CREATE_FAILED_TEXT =
  "Couldn't confirm creation. A chatroom may already exist at the submitted spot. Retry at the same spot to open it if it exists. Moving the pin starts a separate creation at the new spot.";
const ROOM_NAME = /^[a-z]+-[a-z]+-[a-z]+(-[a-z0-9]{4})?$/;

// 120 lines of 24 characters and 119 newlines: 2999 code points.
const LONG_DRAFT = Array.from(
  { length: 120 },
  (_, index) => `line ${String(index + 1).padStart(3, "0")} of a long draft`,
).join("\n");

const sixDecimals = ({ lat, lng }: { lat: number; lng: number }) => `${lat.toFixed(6)}, ${lng.toFixed(6)}`;

/** Every request to a room's messages endpoint, in order: history, catch-up and posts. */
function watchMessageRequests(page: Page) {
  const seen: Request[] = [];
  page.on("request", (request) => {
    if (/^\/api\/rooms\/[^/]+\/messages$/.test(new URL(request.url()).pathname)) seen.push(request);
  });
  const of = (roomId: string, method: string) =>
    seen.filter(
      (request) => request.method() === method && new URL(request.url()).pathname === `/api/rooms/${roomId}/messages`,
    );
  return {
    /** The `after` parameter of each GET for this room; null for a history request. */
    gets: (roomId: string) => of(roomId, "GET").map((request) => new URL(request.url()).searchParams.get("after")),
    posts: (roomId: string) => of(roomId, "POST"),
  };
}

/** Presses Create and returns the body of the server's answer to `POST /api/rooms`. */
async function pressCreate<T>(page: Page, status: number): Promise<T> {
  const answered = page.waitForResponse(
    (response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/rooms",
  );
  await page.getByRole("button", { name: "Create" }).click();
  const response = await answered;
  expect(response.status()).toBe(status);
  return (await response.json()) as T;
}

test("1. create a room and land in it, seeded", async ({ page }) => {
  const requests = watchMessageRequests(page);
  await page.clock.install(); // before navigation, so the poll interval belongs to this clock
  await page.goto("/");

  const spot = await clickEmptySpot(page);
  await expect(page.getByText("New chatroom", { exact: true })).toBeVisible();
  await expect(page.getByText(`Your first message creates a chatroom at ${sixDecimals(spot)}.`)).toBeVisible();
  await expect(page.getByLabel("Display name")).toBeFocused(); // nothing remembered yet
  await page.getByRole("button", { name: "About new chatrooms" }).hover();
  await expect(page.getByText(INFO_TEXT)).toBeVisible();

  const text = `first words ${Date.now()}`;
  await fillCompose(page, "ann", text);
  const { room, message } = await pressCreate<{ room: Room; message: Message }>(page, 201);

  expect(room.name).toMatch(ROOM_NAME);
  await expect(page.getByText(room.name, { exact: true })).toBeVisible(); // the panel title
  await expect(page.getByText("New chatroom", { exact: true })).toBeHidden();
  const log = page.getByRole("log");
  await expect(rows(log)).toHaveCount(1);
  await expect(log.getByText(text, { exact: true })).toHaveCount(1);
  await expect(page.getByLabel("Message")).toBeFocused();
  await expect(page.getByLabel("Message")).toHaveValue("");
  await expect(page.getByTitle(room.name, { exact: true })).toBeVisible(); // the new pin

  // Seeded: no history request, and catch-up starts from the first message.
  await expect.poll(() => requests.gets(room.id).length).toBeGreaterThanOrEqual(1);
  const beforeTick = requests.gets(room.id).length;
  await page.clock.fastForward(POLL_INTERVAL_MS);
  await expect.poll(() => requests.gets(room.id).length).toBeGreaterThan(beforeTick);
  expect(new Set(requests.gets(room.id))).toEqual(new Set([message.id]));
  await expect(log.getByText(text, { exact: true })).toHaveCount(1);

  await page.reload();
  await clickEmptySpot(page);
  await expect(page.getByLabel("Display name")).toHaveValue("ann");
  await expect(page.getByLabel("Message")).toBeFocused();
});

test.describe("2. a room already exists at the spot", () => {
  /** A draft at a free spot, then another author's room created there through the API. */
  async function conflictAtDraft(page: Page) {
    await page.goto("/");
    const spot = await clickEmptySpot(page);
    const response = await page.request.post("/api/rooms", {
      data: { ...spot, author: "someone else", text: "I was here first" },
    });
    expect(response.status(), await response.text()).toBe(201);
    const { room } = (await response.json()) as { room: Room };
    expect({ lat: room.lat, lng: room.lng }).toEqual(spot); // the hint showed what the server stores
    return room;
  }

  test("moves the visitor there with the notice and the unsent draft, and posts nothing", async ({ page }) => {
    const requests = watchMessageRequests(page);
    const room = await conflictAtDraft(page);
    const text = `my unsent words ${Date.now()}`;
    await fillCompose(page, "ann", text);

    const body = await pressCreate<{ error: { code: string; room: Room } }>(page, 409);
    expect(body.error.room.id).toBe(room.id);

    await expect(page.getByText(MOVED_TEXT)).toBeVisible();
    await expect(page.getByText(room.name, { exact: true })).toBeVisible();
    const log = page.getByRole("log");
    await expect(log.getByText("I was here first", { exact: true })).toBeVisible();
    await expect(log.getByText(text, { exact: true })).toHaveCount(0);
    await expect(page.getByLabel("Display name")).toHaveValue("ann");
    await expect(page.getByLabel("Message")).toHaveValue(text);
    await expect(page.getByLabel("Message")).toBeFocused();
    expect(requests.posts(room.id)).toHaveLength(0);

    await page.getByRole("button", { name: "Send" }).click();
    await expect(log.getByText(text, { exact: true })).toHaveCount(1);
    await expect(page.getByText(MOVED_TEXT)).toBeHidden();
    expect(requests.posts(room.id)).toHaveLength(1);
  });

  test("dismissing the notice keeps the prefilled fields", async ({ page }) => {
    await conflictAtDraft(page);
    await fillCompose(page, "ann", "still unsent");
    await pressCreate(page, 409);
    const notice = page.getByRole("status").filter({ hasText: MOVED_TEXT });
    await expect(notice).toBeVisible();

    await notice.getByRole("button", { name: "Dismiss" }).click();

    await expect(notice).toBeHidden();
    await expect(page.getByLabel("Display name")).toHaveValue("ann");
    await expect(page.getByLabel("Message")).toHaveValue("still unsent");
  });
});

test.describe("3. bounded popup layout", () => {
  async function expectBoundedPopup(page: Page) {
    const viewport = page.viewportSize()!;
    const textarea = page.getByLabel("Message");
    const scrolls = await textarea.evaluate((el) => el.scrollHeight > el.clientHeight + 1);
    expect(scrolls, "the textarea scrolls inside itself").toBe(true);
    expect((await textarea.boundingBox())!.height).toBeLessThanOrEqual(72);

    for (const control of [
      page.getByRole("button", { name: "Create" }),
      page.getByRole("button", { name: "Close" }),
      page.getByRole("button", { name: "About new chatrooms" }),
      page.getByLabel("Display name"),
    ]) {
      const box = (await control.boundingBox())!;
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    }

    const pageScrolls = await page.evaluate(
      () => document.documentElement.scrollHeight > window.innerHeight || document.body.scrollHeight > window.innerHeight,
    );
    expect(pageScrolls, "the page has no scrollbar").toBe(false);
  }

  test("a long many-line draft scrolls inside the message field", async ({ page }) => {
    expect([...LONG_DRAFT]).toHaveLength(2999);
    await page.goto("/");
    await clickEmptySpot(page);

    await fillCompose(page, "ann", LONG_DRAFT);

    await expectBoundedPopup(page);
  });

  test("a recovered popup fits with the full uncertain-creation error and the long draft", async ({ page }) => {
    await page.goto("/e2e/new-room-layout");

    await expect(page.getByText(CREATE_FAILED_TEXT)).toBeVisible();
    await expect(page.getByLabel("Message")).toHaveValue(LONG_DRAFT);
    await expectBoundedPopup(page);
  });
});
```

How the scenarios map to the spec (§10):
- **1** installs the clock before navigation, so the feed's poll interval belongs to it; time still runs, which the 500 ms click window and the tooltip's hover delay need. The room id and the first message id come from the server's own `201` answer. "No history request" is `requests.gets(room.id)` containing only that id: a history request would contribute `null`.
- **2** creates the other author's room through the API at the coordinates the hint showed, so the popup's own Create is a real `409`. The `toEqual(spot)` line proves the hint shows what the server stores.
- **3** checks the popup with a long draft on the real page and, on the fixture, the recovered popup with the full uncertain-creation error.

- [ ] **Step 6: Run the scenarios**

With the local stack running:

```bash
pnpm test:e2e tests/e2e/new-room.spec.ts
pnpm test:e2e tests/e2e/room-panel.spec.ts -g "fit together"
```

Expected: `5 passed`, then `1 passed`. If `/e2e/new-room-layout` answers 404, the running dev server is not this worktree's: restart `pnpm dev` from this worktree.

- [ ] **Step 7: Prove the assertions can fail**

Each mutation is temporary; undo it with `git checkout <file>` and let the dev server recompile.

| Mutation | Run | Expected failure |
| --- | --- | --- |
| In `MapShell.tsx`, dispatch `{ type: "conflict", room, prefill: { author: message.author, text: message.text } }` from `onCreated` (a created room opened without its seed) | `pnpm test:e2e tests/e2e/new-room.spec.ts -g "1\. create"` | fails at `toHaveValue("")` on the message field: the room opened through the conflict path, so the text came back as an unsent prefill instead of being the seeded first row |
| In `RoomPanel.tsx`, remove `{moved ? … : null}` | `pnpm test:e2e tests/e2e/new-room.spec.ts -g "2\. a room"` | both tests fail waiting for the notice text |
| In `NewRoomPopup.tsx`, drop `textareaClassName={BOUNDED_TEXTAREA_CLASS}` | `pnpm test:e2e tests/e2e/new-room.spec.ts -g "3\. bounded"` | both tests fail at "the textarea scrolls inside itself" |

- [ ] **Step 8: Check for flakiness, prove the fixture never ships, lint and typecheck**

```bash
pnpm test:e2e tests/e2e/new-room.spec.ts --repeat-each 5
pnpm test:e2e
pnpm build
pnpm test && pnpm lint && pnpm typecheck
```

Expected: `25 passed`, none flaky. The whole suite: B-e2e + 5 passed (23 on chunk 9's predicted baseline). `pnpm build` succeeds and its route list is exactly `/`, `/_not-found`, `/api/health`, `/api/rooms`, `/api/rooms/[id]`, `/api/rooms/[id]/messages`, with no `/e2e/…` line. Vitest counts are unchanged from Task 6; lint and typecheck are clean and cover `tests/e2e/**`.

Each run of `new-room.spec.ts` leaves three rooms at random spots outside `ROOM_REGION`. That is the accepted accumulation of chunk 9's harness; do not add cleanup.

- [ ] **Step 9: Commit**

`next dev` re-adds its own block to `AGENTS.md` when it starts. If `git status` shows `AGENTS.md` (or `CLAUDE.md`) modified by it, include the file in this commit.

```bash
git add tests/e2e/helpers.ts tests/e2e/new-room.spec.ts tests/e2e/room-panel.spec.ts src/app/e2e/new-room-layout src/app/e2e/room-panel-layout/page.dev.tsx
git commit -m "test(e2e): cover the new chatroom flow, the 409 hand-off and the notice layout"
```

---

### Task 8: Documentation and final verification

**Files:**
- Modify: `README.md`, `docs/KNOWN_LIMITATIONS.md`, `docs/superpowers/specs/2026-09-16-map-shell-design.md`, `docs/superpowers/specs/2026-09-17-room-panel-design.md`

**Interfaces:**
- Consumes: the finished chunk.
- Produces: documentation only.

- [ ] **Step 1: Add the "New chatroom flow" section to the README**

In `README.md`, insert directly before "## Tests" (after chunk 9's "## Room panel" section):

```markdown
## New chatroom flow

Clicking an empty spot opens the "New chatroom" form in the floating panel (PRD 3 Flow A).
Create sends the first message with the clicked coordinates; the server rounds them to six
decimals, and the form's hint shows that rounded spot.
Design: `docs/superpowers/specs/2026-09-17-new-room-flow-design.md`.

| Module                           | Provides                                                                  |
| -------------------------------- | ------------------------------------------------------------------------- |
| `@/components/room/NewRoomPopup` | The draft panel: hint, info bubble, `ComposeForm` "Create", the create call; reports `onCreated`, `onConflict`, `onFailed` |
| `@/components/room/MovedNotice`  | The dismissible notice shown after a create landed on an existing room     |
| `@/lib/page/handoff`             | `handoffReducer` around `selectionReducer`: panel `revision`, create `recovery`, `draftPanelKey`, `roomPanelKey` |
| `@/components/compose/ComposeForm` | Also `autoFocusField`, `submitFailedMessage`, `initialErrors`, `BOUNDED_TEXTAREA_CLASS` |

- **Created.** The new room's pin is inserted at once and its panel opens already showing the
  first message, with no history request; catch-up starts from that message.
- **A room already exists there (409).** Nothing is written. The visitor is moved into the
  existing room with a notice; name and message are prefilled and unsent. The notice goes away
  when dismissed or after a successful send.
- **The outcome always takes over the panel.** A create that settles after the visitor closed
  the form, opened a room or placed another draft still opens its room, or restores its draft,
  and replaces whatever is showing, including unsent edits made meanwhile. Several pending
  creates apply in the order they settle. Every outcome mounts a fresh panel, even for a room
  that is already open. Pending creates do not survive a page reload.
- **Failure.** The submitted name and message come back in a fresh form at the submitted
  coordinates with the error. Nothing is retried automatically. After a lost response the room
  may exist: Create at the same spot then opens it through the 409 path, while moving the pin
  first starts a separate creation at the new spot.
- **Pins.** A room inserted by an outcome keeps its pin while it is selected, even when an
  older refresh omits it. After closing, the pin follows the normal viewport refresh and the
  500-pin cap.
- The info bubble opens on hover and keyboard focus only (see `docs/KNOWN_LIMITATIONS.md`).

`tests/e2e/new-room.spec.ts` covers the flow in Chromium. Each run leaves three rooms at
random spots outside the fixture region; `clickEmptySpot` retries around existing rooms, and
on a very crowded local map it fails with a hint to reset disposable data.
```

Also, in the "## Map" section's module table, replace the `@/lib/page/selection` row's description so it reads:

```markdown
| `@/lib/page/selection`        | `Selection` (`none` / `draft` / `room`) and `selectionReducer`; `@/lib/page/handoff` wraps it for `MapShell` |
```

- [ ] **Step 2: Record the accepted limitations**

In `docs/KNOWN_LIMITATIONS.md`, add these rows at the end of the "Accepted limitations" table (after the "OSM tiles are best-effort" row):

```markdown
| The new-chatroom info bubble opens on hover or keyboard focus only | A tap on a touch screen does not show it. The PRD asks for hover or tap. | Touch support is deferred with the mobile layout. |
| Pending room creations live in the page | A create that is still pending when the page reloads or closes is forgotten: its outcome is not applied and its draft is not restored. Outcomes that do arrive replace intervening drafts, in the order they settle. | Wait for Create to finish before leaving. |
| Creation retry protection is per spot | After a lost response, only a retry at the same rounded coordinates is turned into a 409 for the room that may exist; moving the pin first can create a second room with the same text. | The failure message says so; retry at the same spot first. |
| Locally inserted pins are not retained after closing | A room inserted by a create outcome keeps its pin while selected. After the panel closes, an older or capped viewport response can omit it until a later refresh includes it. | Pan, zoom or wait for the next refresh. |
```

and extend the existing "Writes have no idempotency key" row's effect cell with this sentence at its end: "In that case the visitor lands in their own room with the 'already exists' notice and their message visible as its first entry."

- [ ] **Step 3: Reconcile the linked architecture documents with the handoff keys**

In `docs/superpowers/specs/2026-09-16-map-shell-design.md` §3, replace the `draft` and `room`
panel bullets with:

```markdown
  - `draft` → `NewRoomPopup`, keyed with `draftPanelKey(handoff)`. Ordinary moves preserve
    the revision and key; a create failure increments the revision and restores a fresh popup.
  - `room` → `RoomPanel`, keyed with `roomPanelKey(handoff, selection.room)`. A different room
    changes the key normally; every created or conflict outcome increments the revision so an
    outcome for the already-selected room still mounts a fresh panel.
```

In the same document's §6, keep the historical `selectionReducer` transition table intact. Replace
the room-ID-only key paragraph and the direct-dispatch "Wiring" list with this Chunk 10 extension:

```markdown
Chunk 10 keeps `selectionReducer` as the public pure selection transition table and wraps it in
`handoffReducer` inside `MapShell`. The wrapper owns `{ selection, revision, recovery }`. Ordinary
empty-map, pin, and close actions delegate to `selectionReducer`; `created`, `conflict`, and
`failed` update selection and handoff metadata atomically. Draft panels use `draft:<revision>` and
room panels use `<room.id>:<revision>`. The revision changes only for those three outcomes, so an
ordinary repeat click on the selected pin preserves the mounted panel while an outcome targeting
that same room mounts a fresh one.

Wiring:

- `onViewportChange` → `pins.setViewport`
- empty map click → dispatch the handoff `clickEmpty` action
- pin click → dispatch the handoff `clickPin` action
- panel close → dispatch the handoff `close` action
- `NewRoomPopup.onCreated` → `pins.insertRoom(room)` and dispatch `created(room, message)`
- `NewRoomPopup.onConflict` → `pins.insertRoom(room)` and dispatch `conflict(room, prefill)`
- `NewRoomPopup.onFailed` → dispatch `failed(input, error)`
```

Still in `docs/superpowers/specs/2026-09-16-map-shell-design.md`, update §8's table "Usage by later
chunks". Replace the row

```markdown
| `RoomPanel` (chunk 9) | `RoomTitle` | `MessageList` | backlog notice + `ComposeForm` "Send" |
```

with

```markdown
| `RoomPanel` (chunk 9) | `room.name` (no `RoomTitle`, new-room design decision 5) | `MessageList` | moved notice, fetch alert, backlog notice + `ComposeForm` "Send" |
```

If chunk 9 already rewrote that row, keep its wording and only make sure it names `room.name` and the moved notice.

In `docs/superpowers/specs/2026-09-17-room-panel-design.md` §3, replace only the MapShell snippet's
room-ID-only key expression:

```tsx
key={selection.room.id}
```

with the Chunk 10 expression, preserving the snippet's `room`, `seed`, `prefill`, and `onClose`
props:

```tsx
key={roomPanelKey(handoff, selection.room)}
```

Immediately after the snippet, add: "Chunk 10 supersedes Chunk 9's room-ID-only key with a
revision-aware handoff key. Ordinary selection keeps its mounted panel; every create outcome
increments the revision and fresh-mounts the destination panel, including an already-selected
room. See the new-room-flow design §6."

- [ ] **Step 4: Final verification**

Run each command and compare with the expected result. Evidence before claims: paste the summary lines into your hand-off.

```bash
pnpm test
pnpm lint
pnpm typecheck
pnpm build
pnpm test:e2e
```

Expected: `pnpm test` → B-files + 4 files, B-tests + 81 tests passed (40 / 776 on chunk 9's predicted baseline). `pnpm lint` → no output after the header. `pnpm typecheck` → exits 0. `pnpm build` → succeeds, route list without `/e2e`. `pnpm test:e2e` → B-e2e + 5 passed (23).

Then the manual check from the chunks document, in two browsers at the Supbuddy URL: click the same empty spot in both (or read the hint in one and create the room at those coordinates through the API or the other browser), press Create in the first, then in the second. The second shows the notice, the existing room's messages and the prefilled, unsent form. Also once: start a create, stop the dev server before it answers, and see the form come back with the uncertain-creation message and the draft; start the server and press Create again. Leave the local data intact.

- [ ] **Step 5: Commit**

```bash
git add README.md docs/KNOWN_LIMITATIONS.md docs/superpowers/specs/2026-09-16-map-shell-design.md docs/superpowers/specs/2026-09-17-room-panel-design.md
git commit -m "docs(room): document the new chatroom flow and its accepted limitations"
```

---

## Handoff to chunks 11 and 12

- **Chunk 11 (realtime).** Nothing here changes: a seeded feed already starts from the first message's bookmark, and every hand-off mounts a fresh feed. `MapShell.newRoom.test.tsx` relies on the hook's default adapter refusing realtime (`pollingOnlySubscribe`); when chunk 11 swaps the default, give that file the same way to stay in polling mode as the e2e scenarios get, or mock `@/lib/feed/realtime`.
- **Chunk 12 (URL and polish).** URL sync after creation hooks into `MapShell`'s `onCreated` / `onConflict`, or observes `handoff.selection`. `handoff.revision` is not part of any URL. Escape-to-close is still out of scope.

## Not in this chunk

Tap support for the info bubble and any mobile layout; a title animation; `RoomTitle`; locking the map or a map-level busy state while a create is pending; detecting that a 409 is the visitor's own room after a lost response; an optimistic pin before the server answers; Escape to close the panel; URL sync to `/room/<id>` after creation (chunk 12); realtime for the new room (chunk 11); any change to `selectionReducer` or `useRoomPins`; e2e cleanup of created rooms.

## Self-review

- **Spec coverage.** §1 decisions: 1 (Tasks 3, 6: `PanelFrame` in the slot), 2 (Tasks 3, 6), 3 (Tasks 5, 6), 4 (Task 3; limitation in Task 8), 5 (no task adds `RoomTitle`; Task 8 Step 3), 6 (Task 4), 7 (Tasks 5, 6), 8 (Tasks 2, 3, 4), 9 (Tasks 2, 3). §2: Task 1 is the gate. §3 files: every row of "New files" and "Modified files" has a task; `selection.ts` and `useRoomPins.ts` stay untouched. §4 props, rendering table, `ComposeForm` props, submit rules (Task 3). §5 (Task 3). §6 table, keys, created, conflict, failure recovery, take-over scope, pin retention, no map lock (Tasks 5, 6); Task 8 Step 3 reconciles the linked map-shell and room-panel architecture documents with those keys without rewriting the historical selection table. §7 notice, flags, footer order, feed conditions (Task 4); layout budget (Task 7 Steps 3–4). §8 three props and `CREATE_FAILED_MESSAGE` (Tasks 2, 3). §9 error table (Tasks 2, 3, 6: validation on `lat`, 503, lost response, 409, history failure after a conflict in Task 4). §10 Vitest lists: `NewRoomPopup.test.tsx` (Task 3), `ComposeForm.test.tsx` (Task 2), `RoomPanel.test.tsx` (Task 4), `MapShell` cases (Task 6, in two new files, reconciliation 8), `selection.test.ts` unchanged; Playwright helper and scenarios 1–3 (Task 7); manual check (Task 8 Step 4). §11 (Task 8). §12 restated above.
- **Gaps found and closed while writing.** Dropping the recovery when a recovered draft moves would blank its untouched form, so the reducer keeps it (reconciliation 3, caught by a mutation in Task 6 Step 7). `getByRole("alert")` is ambiguous in a Next page (the route announcer), so the e2e fixture test matches the message text. A first map click can be lost before the map's handlers attach, so `clickEmptySpot` retries (reconciliation 10). The spec's footer budget was measured rather than assumed: 123 px with all four notices.
- **Placeholders.** None: every created file has its full content, every modified file has exact edits or its full replacement, every command has its expected output. Baseline-relative counts (B-files, B-tests, B-e2e) are recorded in Task 1 because chunk 9 is not delivered at writing time.
- **Type consistency.** `ComposeFormProps.autoFocusField` / `submitFailedMessage` / `initialErrors` and `BOUNDED_TEXTAREA_CLASS` (Task 2) are used with those names in Tasks 3, 4 and 7. `submitErrors(error, fallback)` (Task 2) is called that way in `ComposeForm` and `NewRoomPopup`. `NewRoomPopupProps` (Task 3) matches `MapShell`'s JSX (Task 6) and the fixture (Task 7): `lat`, `lng`, `onCreated(room, message)`, `onConflict(room, prefill)`, `onFailed(input, error)`, `recovery?`, `onClose`, `createRoom?`. `HandoffAction`'s `created` / `conflict` / `failed` payloads (Task 5) are the ones `MapShell` dispatches (Task 6). `draftPanelKey(handoff)` and `roomPanelKey(handoff, room)` have the same signatures in Tasks 5 and 6. `MOVED_NOTICE_TEXT` (Task 4) and `CREATE_FAILED_MESSAGE` / `NEW_ROOM_INFO_TEXT` (Task 3) are the constants the unit tests import; the e2e spec repeats the three strings because `tests/e2e` does not import from `src/components`. `clickEmptySpot(page)` (Task 7 Step 1) is called with that shape in Step 5.
