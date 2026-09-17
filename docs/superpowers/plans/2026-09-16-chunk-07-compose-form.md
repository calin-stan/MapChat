# Chunk 7: Compose Form and Display Name Storage Implementation Plan

**Review feedback:** [2026-09-16-chunk-07-compose-form-feedback.md](2026-09-16-chunk-07-compose-form-feedback.md)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The one compose form (display name + message + submit) that the "New chatroom" popup (chunk 10) and the room panel (chunk 9) both render, plus the remembered display name in `localStorage`, with component tests.

**Architecture:** Three small layers, each testable on its own. `src/lib/storage/displayName.ts` is a plain module over `localStorage` (read, write, subscribe) that degrades to "not remembered" when storage is missing or blocked. `src/lib/storage/useDisplayName.ts` exposes it to React through `useSyncExternalStore`, so the server and the hydrating client both see `""` and the stored name appears after mount without an effect. `src/components/compose/ComposeForm.tsx` is a controlled client component that validates with chunk 3's `postMessageInputSchema`, shows per-field errors and code-point counters, calls the caller's `onSubmit`, and on success clears the message, keeps the name and persists it. Error mapping (zod issues and the API's validation error) is a pure module, `src/components/compose/fieldErrors.ts`. Component tests use Testing Library under jsdom, which this chunk adds to the toolchain.

**Tech Stack:** TypeScript 5 (`strict`), Next.js 16.3.5 App Router, React 19.2.8, Tailwind CSS 4, shadcn/ui (style `base-nova`, primitives from `@base-ui/react`), zod 4.6, Vitest 5 with jsdom 30, `@testing-library/react` 16.3, `@testing-library/user-event` 14.6, `@testing-library/jest-dom` 7.0, pnpm 10, Node 22.

**Spec:** `docs/superpowers/specs/2026-09-16-map-chat-implementation-chunks.md`, "Chunk 7 — Compose form and display name storage" (plus §0 Global constraints, §0.1 layout, §0.2 DTOs). PRD (`docs/PRD.md`, v4): §3 Flow A steps 3–5 and Flow B step 4, §4 "Input rules" and "Compose behavior", §6.7 "Client state". Chunk 6's design (`docs/superpowers/specs/2026-09-16-map-shell-design.md` §8) fixes where the form sits: the footer of `PanelFrame`, under "New chatroom" with submit label "Create" and under the room panel with "Send". The downstream feed contract comes from `docs/superpowers/specs/2026-09-16-room-feed-design.md` §7 (`send(): Promise<Message>`, `ready`, and `opts.seed`), including its review follow-up. Recheck that design and its feedback when chunks 9/10 are implemented; it is not delivered code, and its newer interfaces supersede the older chunk-list examples at this boundary.

## Global Constraints

Copied from the spec §0 where they apply to this chunk, adjusted to the repository as it exists:

- Language: TypeScript, `strict: true`, no `any` in committed code.
- Package manager: pnpm (`packageManager: pnpm@10.9.0`). Node 22 LTS.
- Framework: Next.js 16, App Router. Components that use state, event handlers or browser APIs are client components (`"use client"` at the top of the file; `node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md`).
- UI: React 19, Tailwind, "shadcn/ui components wherever one fits; icons from `react-icons`". This chunk adds the shadcn `input`, `textarea` and `label` components with the project's CLI (`components.json`, style `base-nova`, which wraps `@base-ui/react` primitives). No icons are needed.
- Validation: `zod` 4.x (`^4.6.5`). "One schema module shared by client and server." The form validates with chunk 3's `postMessageInputSchema` and adds no schema.
- Character counting: "`[...s].length` in JS, `char_length()` in Postgres. Limits: author 1..100, text 1..3000, after `trim()`." The counters use `countChars` from `@/lib/schemas/common`.
- PRD §4 "Compose behavior": "Disable Submit while its request is pending. Clear the message only after confirmed success; validation errors and request failures preserve both the display name and message draft. Do not automatically retry writes. If a response is lost, explain that the message may have been sent and ask the visitor to check the room before retrying."
- PRD §6.7: "Display name lives in `localStorage` under a single key, read on mount and written on every successful submit. Storage access is wrapped so a blocked storage API degrades to 'not remembered'." Key: `mapchat.displayName` (spec, chunk 7).
- Lint: `eslint-config-next` 16 enables `react-hooks/set-state-in-effect` and `react-hooks/set-state-in-render` as errors. Reading storage into state inside `useEffect` is therefore not an option; the hook uses `useSyncExternalStore`.
- Tests: Vitest, TDD (failing test first). Unit tests colocated as `*.test.ts(x)` under `src/`; a file opts into jsdom with `// @vitest-environment jsdom` on its first line. Target one file with `pnpm test <path>` **without** `--` (with `--`, Vitest ignores the filter and runs every file).
- Commits: conventional commits, one commit per task. The repository has no GitButler workspace (`but status` reports "No GitButler project found"), so the steps use plain `git`; if GitButler is active when you execute, use the `commit` skill with the same messages.

## Prerequisites (verified on 2026-09-16)

- `main` is at `cc985c8 docs(spec): add chunk 6 map shell and map view design`. Chunk 3 is merged (`021a72a`): `src/lib/schemas/{common,message,room,query,types}.ts`, `src/lib/schemas/test-helpers.ts`, `src/lib/names/generate.ts`, `src/lib/supabase/{server,browser}.ts`.
- Chunks 4 and 5 exist only as branches in worktrees (`/Users/calin/dev/other/wp-worktrees/chunk-04-rooms-api`, `.../chunk-05-messages-api`), not on `main`. **This chunk depends on chunk 3 only and must not import `@/lib/api/client` or `@/lib/api/errors`.** The form recognises chunk 4's `ApiValidationError` structurally (by `name` and a `fields` array), so it works once chunk 4 lands without a code change here.
- Installed and relevant: `react@19.2.8`, `zod@^4.6.5`, `jsdom@^30.0.1`, `vitest@^5.0.1`, `@vitejs/plugin-react`, `shadcn@^4.21.0` (local CLI at `node_modules/.bin/shadcn`), `@base-ui/react@1.8.0`, `cn` (shadcn's class helper; `@/lib/utils` re-exports it). Not installed: any `@testing-library/*` package (Task 1 adds them).
- `vitest.config.ts` runs `src/**/*.test.{ts,tsx}` in the `node` environment with the `@` alias and `@vitejs/plugin-react`; it has no `setupFiles` yet.
- Node 22.23 has no `globalThis.localStorage` (it is `undefined` without `--experimental-webstorage`), so the Node-environment tests below are meaningful.
- Verified in a scratch Vitest run against the installed jsdom: `vi.spyOn(Storage.prototype, "getItem")` intercepts `localStorage.getItem`, `new StorageEvent("storage", { key })` dispatches on `window`, and a setup file with a conditional top-level `await import(...)` loads in both environments.
- Base UI's `Button` renders a native `disabled` attribute when `disabled` is set (`node_modules/@base-ui/react/utils/useFocusableWhenDisabled.mjs:36`), so jest-dom's `toBeDisabled()` applies.

## Before you start: worktree

Execute this plan in its own worktree, following the sibling convention already in use:

```bash
cd /Users/calin/dev/other/wp
git worktree add -b chunk-07-compose-form /Users/calin/dev/other/wp-worktrees/chunk-07-compose-form main
cd /Users/calin/dev/other/wp-worktrees/chunk-07-compose-form
pnpm install
cp /Users/calin/dev/other/wp/.env.local .env.local   # git-ignored; only `pnpm build`/`pnpm dev` read it
pnpm test && pnpm typecheck
```

Expected: `pnpm test` reports the existing suites passing (8 files); `pnpm typecheck` exits 0. Every path below is relative to this worktree.

## Design decisions (not settled by the spec)

1. **Late-arriving display name.** `useDisplayName` returns `""` during server rendering and hydration and the stored name right after. A form mounted during hydration would capture `""` if it copied `initialAuthor` into state once. So the form keeps drafts as `string | null`: `null` means "untouched, show the prop". The visible value is `draft ?? prop`. A name that arrives later is adopted while the field is untouched; a user edit wins from then on. The same rule serves chunk 10's 409 hand-off for `initialText`.
2. **What the user sees on an empty field.** The schema reports `"must be between 1 and 100 characters"` for an empty-after-trim value (its `"is required"` message is only for absent input; see `src/lib/schemas/common.ts`). The form prefixes every field message with the field label, so the user reads "Display name must be between 1 and 100 characters" and "Message must be between 1 and 3000 characters". One source of truth for messages, no client-side rewording.
3. **Counters** show `${max - countChars(value)} characters left` for the raw (untrimmed) value, in `text-muted-foreground`, switching to `text-destructive` when negative. Counting the raw value means the counter can read "-1" for a value that validates after trimming; that is acceptable and documented in the component.
4. **Errors after `onSubmit` rejects** (`submitErrors` in `fieldErrors.ts`):
   - an error whose `name` is `"ApiValidationError"` with a `fields: { path, message }[]` array (chunk 4's class) → per-field messages; paths other than `author`/`text` (for example `lat` from `POST /api/rooms`) become one form-level message;
   - an error whose `name` is `"ApiRequestError"` and `code` is `"unavailable"` (chunk 4's 503 after the room-name retries, PRD 6.3: nothing was written) → its `message` as the form-level message;
   - anything else (network failure, lost response, 5xx, 404) → `SUBMIT_FAILED_MESSAGE`: "Couldn't send. Your message may still have gone through, so check the room before trying again." (PRD 4). Drafts are preserved in every case.
5. **Success** = `onSubmit` resolved. Errors are cleared as soon as client validation passes (so nothing stale shows while pending); after `onSubmit` resolves, `writeDisplayName(author)` with the trimmed author, then clear the message draft. The display-name field keeps what the user typed (untrimmed); only the persisted value is trimmed.
6. **Pending**: disable the display-name input, message textarea, and submit button while `onSubmit` is in flight. This prevents typing a second draft that the first response would clear. A second submit during that window is ignored. The external `disabled` prop also disables all three controls and guards the submit handler. On rejection, re-enable the controls (unless externally disabled) and preserve both drafts; on success, re-enable them and clear only the submitted message. Deferred success/failure tests attempt to type while pending and assert that the drafts cannot change.
7. **Keyboard**: no Enter-to-send or Ctrl+Enter; the button submits. Not in the PRD; can be added later without changing the contract.
8. **Test tooling**: `@testing-library/react`, `@testing-library/dom` (RTL 16's peer), `@testing-library/user-event`, `@testing-library/jest-dom`. A root `vitest.setup.ts` registers the jest-dom matchers for every test and, only when a DOM exists, `afterEach(cleanup)` (Vitest does not expose `afterEach` globally, so RTL's automatic cleanup never runs on its own).

## File structure

| Path | Responsibility | Task |
| --- | --- | --- |
| `package.json`, `pnpm-lock.yaml` | Testing Library dev dependencies | 1 |
| `vitest.config.ts` (modify) | `setupFiles: ["./vitest.setup.ts"]` | 1 |
| `vitest.setup.ts` | jest-dom matchers; DOM-only `afterEach(cleanup)` | 1 |
| `src/components/ui/input.tsx`, `textarea.tsx`, `label.tsx` | shadcn primitives (generated by the CLI) | 1 |
| `src/components/ui/primitives.test.tsx` | Toolchain smoke test: label, input, textarea, user-event, jest-dom | 1 |
| `src/lib/storage/displayName.ts` | `DISPLAY_NAME_KEY`, `readDisplayName`, `writeDisplayName`, `subscribeDisplayName` | 2 |
| `src/lib/storage/displayName.test.ts` | jsdom: round trip, blocked storage, failed write, subscriptions | 2 |
| `src/lib/storage/displayName.node.test.ts` | Node: no storage, no window | 2 |
| `src/lib/storage/useDisplayName.ts` | `useDisplayName()` via `useSyncExternalStore` | 3 |
| `src/lib/storage/useDisplayName.test.tsx` | jsdom: initial value, `setName`, other-tab change, server snapshot | 3 |
| `src/components/compose/fieldErrors.ts` | `FieldIssue`, `ComposeErrors`, `SUBMIT_FAILED_MESSAGE`, `zodFieldIssues`, `isValidationError`, `toComposeErrors`, `submitErrors` | 4 |
| `src/components/compose/fieldErrors.test.ts` | Node: every mapping rule | 4 |
| `src/components/compose/ComposeForm.tsx` | `ComposeForm`, `ComposeFormProps`, `AUTHOR_MAX`, `TEXT_MAX` | 5 |
| `src/components/compose/ComposeForm.test.tsx` | jsdom: acceptance cases plus pending success/failure, prefill, counters, server-to-client hydration | 5 |
| `README.md` (modify) | "Compose form and display name" section; Testing Library note under "Tests" | 6 |

Dependency order: Task 1 (tooling) → Task 2 (storage) → Task 3 (hook) → Task 4 (error mapping, independent of 2–3) → Task 5 (form and hydration tests, needs 1, 2, 3, 4) → Task 6 (docs, verification). No barrel files.

---

### Task 1: Testing Library, Vitest setup file and the shadcn form primitives

**Files:**
- Modify: `package.json` (dev dependencies), `vitest.config.ts`
- Create: `vitest.setup.ts`, `src/components/ui/input.tsx`, `src/components/ui/textarea.tsx`, `src/components/ui/label.tsx` (the last three generated by the shadcn CLI)
- Test: `src/components/ui/primitives.test.tsx`

**Interfaces:**
- Consumes: `components.json` (style `base-nova`, aliases `@/components/ui`), `cn` from the `cn` package.
- Produces: `Input` from `@/components/ui/input` (`React.ComponentProps<"input">`, wraps `@base-ui/react/input`), `Textarea` from `@/components/ui/textarea` (`React.ComponentProps<"textarea">`, native element), `Label` from `@/components/ui/label` (`React.ComponentProps<"label">`, native element). Every `*.test.tsx` under `src/` can `import { render, screen } from "@testing-library/react"`, `import userEvent from "@testing-library/user-event"`, and use jest-dom matchers (`toBeInTheDocument`, `toHaveValue`, `toBeDisabled`, …) without importing them.

- [ ] **Step 1: Install the Testing Library packages**

```bash
cd /Users/calin/dev/other/wp-worktrees/chunk-07-compose-form
pnpm add -D @testing-library/react@^16.3.3 @testing-library/dom@^10.4.2 @testing-library/user-event@^14.6.7 @testing-library/jest-dom@^7.0.1
grep -n '@testing-library' package.json
```

Expected: four `@testing-library/*` lines under `devDependencies`. (`@testing-library/dom` is RTL 16's peer dependency; pnpm does not auto-install peers.)

- [ ] **Step 2: Add the shadcn input, textarea and label components**

```bash
cd /Users/calin/dev/other/wp-worktrees/chunk-07-compose-form
pnpm exec shadcn add input textarea label -y
ls src/components/ui/
git status --short
```

Expected: `src/components/ui/{button,input,label,textarea}.tsx`; `git status` shows only the three new files plus `package.json`/`pnpm-lock.yaml` from Step 1 (the CLI's only dependency, `cn`, is already installed). A dry run on 2026-09-16 (`pnpm exec shadcn add input textarea label --dry-run -y`) listed exactly these three files. If the CLI rewrites `src/app/globals.css`, revert that file with `git checkout src/app/globals.css`; nothing in this chunk needs a CSS change.

- [ ] **Step 3: Write the failing smoke test**

Create `src/components/ui/primitives.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

// Proves the component-test toolchain: jsdom, Testing Library, user-event,
// the jest-dom matchers from vitest.setup.ts, and the shadcn primitives.
describe("form primitives", () => {
  it("renders a labelled input the user can type into", async () => {
    const user = userEvent.setup();
    render(
      <>
        <Label htmlFor="name">Display name</Label>
        <Input id="name" />
      </>,
    );

    const input = screen.getByLabelText("Display name");
    await user.type(input, "ann");

    expect(input).toBeInTheDocument();
    expect(input).toHaveValue("ann");
  });

  it("renders a textarea that keeps line breaks", async () => {
    const user = userEvent.setup();
    render(<Textarea aria-label="Message" />);

    const textarea = screen.getByLabelText("Message");
    await user.type(textarea, "a{Enter}b");

    expect(textarea).toHaveValue("a\nb");
  });

  it("cleans the document between tests", () => {
    expect(screen.queryByLabelText("Message")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `pnpm test src/components/ui/primitives.test.tsx`
Expected: FAIL. The first two tests fail with `TypeError: expect(...).toBeInTheDocument is not a function` (no jest-dom matchers yet); the third fails the same way, and would also fail without cleanup because the previous test's textarea would still be in the document.

- [ ] **Step 5: Add the setup file and register it**

Create `vitest.setup.ts` at the repository root:

```ts
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";

// Component tests opt into jsdom per file (`// @vitest-environment jsdom`).
// Only there is there a document to clean between tests. Vitest does not
// expose `afterEach` globally, so Testing Library's own auto-cleanup never
// runs; register it here instead.
if (typeof document !== "undefined") {
  const { cleanup } = await import("@testing-library/react");
  afterEach(cleanup);
}
```

In `vitest.config.ts`, add `setupFiles` to the `test` block so it reads:

```ts
  test: {
    // Pure logic runs in node. Component tests opt in per file with
    // `// @vitest-environment jsdom` on the first line.
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./vitest.setup.ts"],
  },
```

- [ ] **Step 6: Run the smoke test and the whole suite**

Run: `pnpm test src/components/ui/primitives.test.tsx`
Expected: PASS, 3 tests.

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: every existing Node-environment test still passes (the setup file's DOM branch is skipped there); `tsc` and ESLint exit 0. If `tsc` reports `Top-level 'await' expressions are only allowed when the 'module' option is ...`, check that `tsconfig.json` still has `"module": "esnext"`; it does on `main`.

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-lock.yaml vitest.config.ts vitest.setup.ts src/components/ui/input.tsx src/components/ui/textarea.tsx src/components/ui/label.tsx src/components/ui/primitives.test.tsx
git commit -m "test: add Testing Library, jest-dom setup and shadcn form primitives"
```

---

### Task 2: Display name storage module

**Files:**
- Create: `src/lib/storage/displayName.ts`
- Test: `src/lib/storage/displayName.test.ts` (jsdom), `src/lib/storage/displayName.node.test.ts` (Node)

**Interfaces:**
- Consumes: nothing from the project.
- Produces (used by Tasks 3 and 5, and by chunks 9 and 10):
  - `DISPLAY_NAME_KEY = "mapchat.displayName"`
  - `readDisplayName(): string | null` — the stored name; `null` when nothing (or `""`) is stored, when there is no `localStorage` (server, Node) or when access throws.
  - `writeDisplayName(name: string): void` — stores `name`; a throwing `setItem` is swallowed; always notifies subscribers afterwards.
  - `subscribeDisplayName(listener: () => void): () => void` — calls `listener` after every `writeDisplayName` in this tab and after a `storage` event for the key (or a storage clear, `key === null`); returns the unsubscribe function. Safe without a `window`.

- [ ] **Step 1: Write the failing jsdom tests**

Create `src/lib/storage/displayName.test.ts`:

```ts
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DISPLAY_NAME_KEY,
  readDisplayName,
  subscribeDisplayName,
  writeDisplayName,
} from "@/lib/storage/displayName";

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Makes the next storage calls throw, as a browser does when site data is blocked. */
function blocked(method: "getItem" | "setItem") {
  const error = new DOMException("storage is blocked", "SecurityError");
  const throwing = () => {
    throw error;
  };
  if (method === "getItem") vi.spyOn(Storage.prototype, "getItem").mockImplementation(throwing);
  else vi.spyOn(Storage.prototype, "setItem").mockImplementation(throwing);
}

describe("readDisplayName", () => {
  it("returns null when nothing is stored", () => {
    expect(readDisplayName()).toBeNull();
  });

  it("returns the stored name", () => {
    localStorage.setItem(DISPLAY_NAME_KEY, "ann");
    expect(readDisplayName()).toBe("ann");
  });

  it("treats an empty stored value as nothing", () => {
    localStorage.setItem(DISPLAY_NAME_KEY, "");
    expect(readDisplayName()).toBeNull();
  });

  it("returns null when storage access throws", () => {
    blocked("getItem");
    expect(readDisplayName()).toBeNull();
  });
});

describe("writeDisplayName", () => {
  it("stores the name under the key", () => {
    writeDisplayName("ann");
    expect(localStorage.getItem(DISPLAY_NAME_KEY)).toBe("ann");
    expect(readDisplayName()).toBe("ann");
  });

  it("overwrites a previous name", () => {
    writeDisplayName("ann");
    writeDisplayName("bob");
    expect(readDisplayName()).toBe("bob");
  });

  it("swallows a failed write and is then not remembered", () => {
    blocked("setItem");
    expect(() => writeDisplayName("ann")).not.toThrow();
    vi.restoreAllMocks();
    expect(readDisplayName()).toBeNull();
  });

  it("notifies subscribers after a write, even a failed one", () => {
    const calls: string[] = [];
    const unsubscribe = subscribeDisplayName(() => calls.push(readDisplayName() ?? "(none)"));

    writeDisplayName("ann");
    blocked("setItem");
    writeDisplayName("bob");
    unsubscribe();

    expect(calls).toEqual(["ann", "ann"]);
  });
});

describe("subscribeDisplayName", () => {
  it("notifies on a storage event for the key or a clear, not for other keys", () => {
    let count = 0;
    const unsubscribe = subscribeDisplayName(() => {
      count += 1;
    });

    window.dispatchEvent(new StorageEvent("storage", { key: DISPLAY_NAME_KEY }));
    expect(count).toBe(1);
    window.dispatchEvent(new StorageEvent("storage", { key: "other" }));
    expect(count).toBe(1);
    window.dispatchEvent(new StorageEvent("storage", { key: null }));
    expect(count).toBe(2);

    unsubscribe();
  });

  it("stops notifying after unsubscribe", () => {
    let count = 0;
    const unsubscribe = subscribeDisplayName(() => {
      count += 1;
    });
    unsubscribe();

    writeDisplayName("ann");
    window.dispatchEvent(new StorageEvent("storage", { key: DISPLAY_NAME_KEY }));

    expect(count).toBe(0);
  });

  it("keeps other subscribers when one unsubscribes", () => {
    const seen: string[] = [];
    const first = subscribeDisplayName(() => seen.push("first"));
    const second = subscribeDisplayName(() => seen.push("second"));
    first();

    writeDisplayName("ann");
    second();

    expect(seen).toEqual(["second"]);
  });
});
```

Create `src/lib/storage/displayName.node.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  readDisplayName,
  subscribeDisplayName,
  writeDisplayName,
} from "@/lib/storage/displayName";

// Server rendering and the Node test environment have neither localStorage
// nor window. Every function must degrade to "not remembered" (PRD 6.7).
describe("displayName without a DOM", () => {
  it("runs where there is no storage and no window", () => {
    expect(typeof globalThis.localStorage).toBe("undefined");
    expect(typeof window).toBe("undefined");
  });

  it("reads null, writes without throwing and still notifies", () => {
    expect(readDisplayName()).toBeNull();

    let count = 0;
    const unsubscribe = subscribeDisplayName(() => {
      count += 1;
    });
    expect(() => writeDisplayName("ann")).not.toThrow();
    unsubscribe();

    expect(count).toBe(1);
    expect(readDisplayName()).toBeNull();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm test src/lib/storage`
Expected: FAIL in both files with `Failed to resolve import "@/lib/storage/displayName"`.

- [ ] **Step 3: Write the module**

Create `src/lib/storage/displayName.ts`:

```ts
/**
 * The remembered display name (PRD 6.7): one localStorage key, read on
 * mount, written after every successful submit. Every storage access is
 * wrapped so a missing or blocked storage API degrades to "not remembered":
 * the server has no localStorage, Node has none without a flag, and a
 * browser can throw a SecurityError when site data is blocked.
 *
 * Subscribers exist so React can observe the value through
 * `useSyncExternalStore` (see `useDisplayName`).
 */

export const DISPLAY_NAME_KEY = "mapchat.displayName";

type Listener = () => void;

const listeners = new Set<Listener>();

/** The storage object, or null when there is none or access is blocked. */
function storage(): Storage | null {
  try {
    const candidate: Storage | undefined = globalThis.localStorage;
    return candidate ?? null;
  } catch {
    return null;
  }
}

/** The stored name, or null when nothing is stored or storage is unavailable. */
export function readDisplayName(): string | null {
  try {
    const value = storage()?.getItem(DISPLAY_NAME_KEY) ?? null;
    return value === "" ? null : value;
  } catch {
    return null;
  }
}

/**
 * Remembers `name` for the next visit and notifies subscribers. A failed
 * write (blocked storage, quota) is swallowed: the name is simply not
 * remembered. Subscribers are notified either way so a hook re-reads.
 */
export function writeDisplayName(name: string): void {
  try {
    storage()?.setItem(DISPLAY_NAME_KEY, name);
  } catch {
    // Not remembered; the form still works for this visit.
  }
  for (const listener of listeners) listener();
}

/**
 * Calls `listener` after every `writeDisplayName` in this tab and after
 * another tab changes the key (or clears storage). Returns the unsubscribe
 * function. Shaped for `useSyncExternalStore`; safe without a window.
 */
export function subscribeDisplayName(listener: Listener): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === DISPLAY_NAME_KEY) listener();
  };
  const target = typeof window === "undefined" ? undefined : window;
  target?.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    target?.removeEventListener("storage", onStorage);
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test src/lib/storage`
Expected: PASS, 2 files, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/storage/displayName.ts src/lib/storage/displayName.test.ts src/lib/storage/displayName.node.test.ts
git commit -m "feat(storage): remember the display name in localStorage with safe fallbacks"
```

---

### Task 3: `useDisplayName` hook

**Files:**
- Create: `src/lib/storage/useDisplayName.ts`
- Test: `src/lib/storage/useDisplayName.test.tsx`

**Interfaces:**
- Consumes: `readDisplayName`, `writeDisplayName`, `subscribeDisplayName` from `@/lib/storage/displayName` (Task 2).
- Produces (used by chunks 9 and 10 to fill `ComposeForm`'s `initialAuthor`):
  - `useDisplayName(): [name: string, setName: (name: string) => void]` — `name` is `""` on the server and during hydration, then the stored name; it updates after `setName` in this tab and after `storage` events from other tabs. `setName` is `writeDisplayName` itself (stable identity).

- [ ] **Step 1: Write the failing test**

Create `src/lib/storage/useDisplayName.test.tsx`:

```tsx
// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";

import { DISPLAY_NAME_KEY } from "@/lib/storage/displayName";
import { useDisplayName } from "@/lib/storage/useDisplayName";

beforeEach(() => {
  localStorage.clear();
});

describe("useDisplayName", () => {
  it("is empty when nothing is stored", () => {
    const { result } = renderHook(() => useDisplayName());
    expect(result.current[0]).toBe("");
  });

  it("starts with the stored name", () => {
    localStorage.setItem(DISPLAY_NAME_KEY, "ann");
    const { result } = renderHook(() => useDisplayName());
    expect(result.current[0]).toBe("ann");
  });

  it("stores and re-renders through setName", () => {
    const { result } = renderHook(() => useDisplayName());

    act(() => result.current[1]("bob"));

    expect(result.current[0]).toBe("bob");
    expect(localStorage.getItem(DISPLAY_NAME_KEY)).toBe("bob");
  });

  it("keeps the same setName across renders", () => {
    const { result, rerender } = renderHook(() => useDisplayName());
    const setName = result.current[1];
    rerender();
    expect(result.current[1]).toBe(setName);
  });

  it("follows a change made by another tab", () => {
    const { result } = renderHook(() => useDisplayName());

    act(() => {
      localStorage.setItem(DISPLAY_NAME_KEY, "cat");
      window.dispatchEvent(new StorageEvent("storage", { key: DISPLAY_NAME_KEY }));
    });

    expect(result.current[0]).toBe("cat");
  });

  it("renders as empty on the server even when a name is stored", () => {
    localStorage.setItem(DISPLAY_NAME_KEY, "ann");
    function Probe() {
      const [name] = useDisplayName();
      return <span>{name === "" ? "(empty)" : name}</span>;
    }

    expect(renderToString(<Probe />)).toContain("(empty)");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test src/lib/storage/useDisplayName.test.tsx`
Expected: FAIL with `Failed to resolve import "@/lib/storage/useDisplayName"`.

- [ ] **Step 3: Write the hook**

Create `src/lib/storage/useDisplayName.ts`:

```ts
import { useSyncExternalStore } from "react";

import {
  readDisplayName,
  subscribeDisplayName,
  writeDisplayName,
} from "@/lib/storage/displayName";

function getSnapshot(): string {
  return readDisplayName() ?? "";
}

function getServerSnapshot(): string {
  return "";
}

/**
 * The remembered display name as React state (PRD 6.7). It is "" on the
 * server and while hydrating, so server and client markup agree; React then
 * re-renders with the stored value. `setName` persists and notifies every
 * mounted hook in this tab; other tabs are picked up through `storage`
 * events. Uses `useSyncExternalStore` rather than an effect, which also
 * satisfies the `react-hooks/set-state-in-effect` lint rule.
 *
 * Call it from client components only.
 */
export function useDisplayName(): [name: string, setName: (name: string) => void] {
  const name = useSyncExternalStore(subscribeDisplayName, getSnapshot, getServerSnapshot);
  return [name, writeDisplayName];
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test src/lib/storage`
Expected: PASS, 3 files, 19 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/storage/useDisplayName.ts src/lib/storage/useDisplayName.test.tsx
git commit -m "feat(storage): add useDisplayName hook over useSyncExternalStore"
```

---

### Task 4: Field error mapping

**Files:**
- Create: `src/components/compose/fieldErrors.ts`
- Test: `src/components/compose/fieldErrors.test.ts`

**Interfaces:**
- Consumes: `z.ZodError` type from `zod`; `postMessageInputSchema` from `@/lib/schemas/message` (in tests only).
- Produces (used by Task 5):
  - `type FieldIssue = { path: string; message: string }` — the same shape as chunk 4's `FieldIssue` in `@/lib/api/errors`, declared here so this chunk builds on chunk 3 alone. (Chunk 4's `fieldIssues(error)` has the same body as `zodFieldIssues`; once both are on `main`, one may import the other.)
  - `type ComposeErrors = { author?: string; text?: string; form?: string }`
  - `SUBMIT_FAILED_MESSAGE: string`
  - `zodFieldIssues(error: z.ZodError): FieldIssue[]` — path dot-joined, `""` for the whole input.
  - `isValidationError(error: unknown): error is Error & { fields: FieldIssue[] }` — `instanceof Error`, `name === "ApiValidationError"`, `fields` an array of well-formed issues.
  - `toComposeErrors(issues: FieldIssue[]): ComposeErrors` — first message per form field; other paths joined into `form` as `"<path> <message>"` (or just the message when the path is `""`).
  - `submitErrors(error: unknown): ComposeErrors` — the rules from "Design decisions" item 4; never returns an empty object.

- [ ] **Step 1: Write the failing test**

Create `src/components/compose/fieldErrors.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  isValidationError,
  SUBMIT_FAILED_MESSAGE,
  submitErrors,
  toComposeErrors,
  zodFieldIssues,
  type FieldIssue,
} from "@/components/compose/fieldErrors";
import { postMessageInputSchema } from "@/lib/schemas/message";

/** Shaped like chunk 4's ApiValidationError without importing it. */
function validationError(fields: unknown): Error {
  return Object.assign(new Error("invalid"), { name: "ApiValidationError", fields });
}

/** Shaped like chunk 4's ApiRequestError without importing it. */
function requestError(status: number, code: string | undefined, message: string): Error {
  return Object.assign(new Error(message), { name: "ApiRequestError", status, code });
}

describe("zodFieldIssues", () => {
  it("maps each issue to its dot-joined path and message", () => {
    const result = postMessageInputSchema.safeParse({});
    if (result.success) throw new Error("expected a failure");

    expect(zodFieldIssues(result.error)).toEqual([
      { path: "author", message: "is required" },
      { path: "text", message: "is required" },
    ]);
  });

  it("joins nested paths and uses an empty path for the whole input", () => {
    const nested = z.object({ a: z.object({ b: z.string() }) }).safeParse({ a: { b: 1 } });
    if (nested.success) throw new Error("expected a failure");
    expect(zodFieldIssues(nested.error)[0].path).toBe("a.b");

    const whole = z.string().safeParse(1);
    if (whole.success) throw new Error("expected a failure");
    expect(zodFieldIssues(whole.error)[0].path).toBe("");
  });
});

describe("toComposeErrors", () => {
  it("keeps the first message per form field", () => {
    expect(
      toComposeErrors([
        { path: "author", message: "first" },
        { path: "author", message: "second" },
        { path: "text", message: "must be between 1 and 3000 characters" },
      ]),
    ).toEqual({ author: "first", text: "must be between 1 and 3000 characters" });
  });

  it("turns issues on other paths into one form message", () => {
    expect(
      toComposeErrors([
        { path: "lat", message: "must be between -90 and 90" },
        { path: "", message: "must be an object" },
      ]),
    ).toEqual({ form: "lat must be between -90 and 90; must be an object" });
  });

  it("returns no errors for no issues", () => {
    expect(toComposeErrors([])).toEqual({});
  });
});

describe("isValidationError", () => {
  const fields: FieldIssue[] = [{ path: "text", message: "is required" }];

  it("accepts an Error named ApiValidationError with well-formed fields", () => {
    expect(isValidationError(validationError(fields))).toBe(true);
    expect(isValidationError(validationError([]))).toBe(true);
  });

  it.each([
    ["a plain Error", new Error("boom")],
    ["an Error with the name but no fields", Object.assign(new Error("x"), { name: "ApiValidationError" })],
    ["fields that are not an array", validationError({ path: "text", message: "x" })],
    ["a malformed field entry", validationError([{ path: 1, message: "x" }])],
    ["a non-Error object with the right shape", { name: "ApiValidationError", fields }],
    ["a string", "ApiValidationError"],
    ["null", null],
  ])("rejects %s", (_label, value) => {
    expect(isValidationError(value)).toBe(false);
  });
});

describe("submitErrors", () => {
  it("maps a validation error to its fields", () => {
    expect(submitErrors(validationError([{ path: "text", message: "is required" }]))).toEqual({
      text: "is required",
    });
  });

  it("falls back to the error message when a validation error has no usable fields", () => {
    const error = validationError([]);
    error.message = "Invalid input";
    expect(submitErrors(error)).toEqual({ form: "Invalid input" });
  });

  it("shows the server's message for an unavailable request error", () => {
    const message = "Could not find a free room name, please try again";
    expect(submitErrors(requestError(503, "unavailable", message))).toEqual({ form: message });
  });

  it.each([
    ["a request error with another code", requestError(404, "not_found", "Request failed with status 404")],
    ["a request error without a code", requestError(502, undefined, "Request failed with status 502")],
    ["a network failure", new TypeError("Failed to fetch")],
    ["a non-error value", "boom"],
    ["undefined", undefined],
  ])("uses the lost-response message for %s", (_label, error) => {
    expect(submitErrors(error)).toEqual({ form: SUBMIT_FAILED_MESSAGE });
  });

  it("never returns an empty object", () => {
    for (const error of [validationError([]), new Error("x"), null]) {
      expect(Object.keys(submitErrors(error)).length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test src/components/compose/fieldErrors.test.ts`
Expected: FAIL with `Failed to resolve import "@/components/compose/fieldErrors"`.

- [ ] **Step 3: Write the module**

Create `src/components/compose/fieldErrors.ts`:

```ts
import type { z } from "zod";

/**
 * One validation problem as the API reports it (chunk spec §0.2). Same shape
 * as chunk 4's `FieldIssue` in `@/lib/api/errors`, declared here so the form
 * depends on chunk 3 only.
 */
export type FieldIssue = { path: string; message: string };

/** What the compose form shows: one message per field, one for the form. */
export type ComposeErrors = { author?: string; text?: string; form?: string };

/**
 * Shown when the request itself failed, so the write may or may not have
 * happened (PRD 4 "Compose behavior"). Drafts are kept; no automatic retry.
 */
export const SUBMIT_FAILED_MESSAGE =
  "Couldn't send. Your message may still have gone through, so check the room before trying again.";

/** zod issues as `{ path, message }`, path dot-joined ("" for the whole input). */
export function zodFieldIssues(error: z.ZodError): FieldIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join("."),
    message: issue.message,
  }));
}

function isFieldIssue(value: unknown): value is FieldIssue {
  if (typeof value !== "object" || value === null) return false;
  const { path, message } = value as Partial<FieldIssue>;
  return typeof path === "string" && typeof message === "string";
}

/**
 * True for chunk 4's `ApiValidationError`, recognised by name and shape
 * rather than by class so this module needs no import from `@/lib/api`.
 */
export function isValidationError(error: unknown): error is Error & { fields: FieldIssue[] } {
  if (!(error instanceof Error) || error.name !== "ApiValidationError") return false;
  const { fields } = error as Error & { fields?: unknown };
  return Array.isArray(fields) && fields.every(isFieldIssue);
}

/** First message per form field; issues on other paths become one form message. */
export function toComposeErrors(issues: FieldIssue[]): ComposeErrors {
  const errors: ComposeErrors = {};
  const other: string[] = [];
  for (const { path, message } of issues) {
    if (path === "author" || path === "text") errors[path] ??= message;
    else other.push(path === "" ? message : `${path} ${message}`);
  }
  if (other.length > 0) errors.form = other.join("; ");
  return errors;
}

/** Errors to show after `onSubmit` rejected. Never empty. */
export function submitErrors(error: unknown): ComposeErrors {
  if (isValidationError(error)) {
    const errors = toComposeErrors(error.fields);
    return Object.keys(errors).length > 0 ? errors : { form: error.message || "Invalid input" };
  }
  if (error instanceof Error && error.name === "ApiRequestError") {
    const { code } = error as Error & { code?: unknown };
    // 503 after the room-name retries (PRD 6.3): nothing was written, and the
    // server's message says what to do.
    if (code === "unavailable" && error.message) return { form: error.message };
  }
  return { form: SUBMIT_FAILED_MESSAGE };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test src/components/compose/fieldErrors.test.ts`
Expected: PASS, 22 tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/compose/fieldErrors.ts src/components/compose/fieldErrors.test.ts
git commit -m "feat(compose): map zod issues and API errors to compose form messages"
```

---

### Task 5: `ComposeForm` component

**Files:**
- Create: `src/components/compose/ComposeForm.tsx`
- Test: `src/components/compose/ComposeForm.test.tsx`

**Interfaces:**
- Consumes: `Button` (`@/components/ui/button`), `Input`, `Textarea`, `Label` (Task 1); `countChars` (`@/lib/schemas/common`); `postMessageInputSchema`, `PostMessageInput` (`@/lib/schemas/message`); `writeDisplayName` (Task 2); `useDisplayName` (Task 3, hydration test only); `submitErrors`, `toComposeErrors`, `zodFieldIssues`, `ComposeErrors` (Task 4).
- Produces (used by chunks 9 and 10):
  - `AUTHOR_MAX = 100`, `TEXT_MAX = 3000`
  - `type ComposeFormProps = { initialAuthor: string; initialText?: string; submitLabel?: string; disabled?: boolean; onSubmit(input: PostMessageInput): Promise<void> }`
  - `ComposeForm(props: ComposeFormProps)` — a client component rendering a `<form>` with a "Display name" `Input`, a "Message" `Textarea`, one counter under each, per-field error text, an optional form-level error, and a submit `Button` labelled `submitLabel` (default `"Send"`).
  - Behaviour: on submit, `postMessageInputSchema.safeParse({ author, text })`; failure → field errors, `onSubmit` not called. Success → `await onSubmit(parsed.data)` (trimmed values) with all three controls disabled meanwhile; resolve → `writeDisplayName(parsed.data.author)`, message cleared, name kept, errors cleared; reject → `submitErrors(error)`, drafts kept.

- [ ] **Step 1: Write the failing test**

Create `src/components/compose/ComposeForm.test.tsx`:

```tsx
// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ComposeForm, type ComposeFormProps } from "@/components/compose/ComposeForm";
import { SUBMIT_FAILED_MESSAGE } from "@/components/compose/fieldErrors";
import { DISPLAY_NAME_KEY, writeDisplayName } from "@/lib/storage/displayName";
import { useDisplayName } from "@/lib/storage/useDisplayName";

const AUTHOR_ERROR = "Display name must be between 1 and 100 characters";
const TEXT_ERROR = "Message must be between 1 and 3000 characters";

function setup(props: Partial<ComposeFormProps> = {}) {
  const onSubmit = vi.fn<ComposeFormProps["onSubmit"]>(async () => {});
  const user = userEvent.setup();
  const view = render(<ComposeForm initialAuthor="" onSubmit={onSubmit} {...props} />);
  return {
    user,
    onSubmit,
    rerender: view.rerender,
    author: () => screen.getByLabelText("Display name"),
    text: () => screen.getByLabelText("Message"),
    submit: () => screen.getByRole("button", { name: props.submitLabel ?? "Send" }),
  };
}

/** Shaped like chunk 4's ApiValidationError without importing it. */
function validationError(fields: { path: string; message: string }[]): Error {
  return Object.assign(new Error("invalid"), { name: "ApiValidationError", fields });
}

beforeEach(() => {
  localStorage.clear();
});

describe("ComposeForm validation", () => {
  it("shows both field errors on an empty submit and does not call onSubmit", async () => {
    const { user, onSubmit, author, text, submit } = setup();

    await user.click(submit());

    expect(await screen.findByText(AUTHOR_ERROR)).toBeInTheDocument();
    expect(screen.getByText(TEXT_ERROR)).toBeInTheDocument();
    expect(author()).toHaveAttribute("aria-invalid", "true");
    expect(text()).toHaveAttribute("aria-invalid", "true");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("rejects a 101-character name before calling onSubmit", async () => {
    const { user, onSubmit, author, text, submit } = setup();
    // fireEvent.change sets the whole value at once; user.type would type 101 keystrokes.
    fireEvent.change(author(), { target: { value: "a".repeat(101) } });
    await user.type(text(), "hello");

    await user.click(submit());

    expect(await screen.findByText(AUTHOR_ERROR)).toBeInTheDocument();
    expect(screen.queryByText(TEXT_ERROR)).not.toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("clears earlier errors on a later valid submit", async () => {
    const { user, author, text, submit } = setup();
    await user.click(submit());
    expect(await screen.findByText(AUTHOR_ERROR)).toBeInTheDocument();

    await user.type(author(), "ann");
    await user.type(text(), "hello");
    await user.click(submit());

    await waitFor(() => expect(screen.queryByText(AUTHOR_ERROR)).not.toBeInTheDocument());
    expect(screen.queryByText(TEXT_ERROR)).not.toBeInTheDocument();
    expect(author()).not.toHaveAttribute("aria-invalid");
  });
});

describe("ComposeForm submit", () => {
  it("submits trimmed values, clears the message, keeps the name and remembers it", async () => {
    const { user, onSubmit, author, text, submit } = setup();
    await user.type(author(), "  ann ");
    await user.type(text(), " hello ");

    await user.click(submit());

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ author: "ann", text: "hello" }));
    await waitFor(() => expect(text()).toHaveValue(""));
    expect(author()).toHaveValue("  ann ");
    expect(localStorage.getItem(DISPLAY_NAME_KEY)).toBe("ann");
  });

  it.each(["success", "failure"] as const)(
    "prevents editing and duplicate submits while pending, then handles %s",
    async (outcome) => {
      let resolve!: () => void;
      let reject!: (error: Error) => void;
      const { user, onSubmit, author, text, submit } = setup();
      onSubmit.mockImplementation(
        () => new Promise<void>((done, fail) => { resolve = done; reject = fail; }),
      );
      await user.type(author(), "ann");
      await user.type(text(), "hello");

      await user.click(submit());
      await waitFor(() => expect(submit()).toBeDisabled());
      expect(author()).toBeDisabled();
      expect(text()).toBeDisabled();
      await user.type(author(), "other name");
      await user.type(text(), "second, unsent draft");
      await user.click(submit());
      expect(author()).toHaveValue("ann");
      expect(text()).toHaveValue("hello");
      expect(onSubmit).toHaveBeenCalledTimes(1);
      expect(onSubmit).toHaveBeenCalledWith({ author: "ann", text: "hello" });

      await act(async () => {
        if (outcome === "success") resolve();
        else reject(new TypeError("Failed to fetch"));
      });
      expect(submit()).toBeEnabled();
      expect(author()).toBeEnabled();
      expect(text()).toBeEnabled();
      expect(author()).toHaveValue("ann");
      if (outcome === "success") {
        expect(text()).toHaveValue("");
        expect(localStorage.getItem(DISPLAY_NAME_KEY)).toBe("ann");
      } else {
        expect(text()).toHaveValue("hello");
        expect(screen.getByRole("alert")).toHaveTextContent(SUBMIT_FAILED_MESSAGE);
        expect(localStorage.getItem(DISPLAY_NAME_KEY)).toBeNull();
      }
    },
  );

  it("maps a server validation error to its field and keeps the drafts", async () => {
    const { user, onSubmit, author, text, submit } = setup();
    onSubmit.mockRejectedValueOnce(
      validationError([{ path: "text", message: "must be between 1 and 3000 characters" }]),
    );
    await user.type(author(), "ann");
    await user.type(text(), "hello");

    await user.click(submit());

    expect(await screen.findByText(TEXT_ERROR)).toBeInTheDocument();
    expect(text()).toHaveValue("hello");
    expect(author()).toHaveValue("ann");
    expect(text()).toHaveAttribute("aria-invalid", "true");
    expect(localStorage.getItem(DISPLAY_NAME_KEY)).toBeNull();
  });

  it("shows a form-level message when the request fails and keeps the drafts", async () => {
    const { user, onSubmit, author, text, submit } = setup();
    onSubmit.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await user.type(author(), "ann");
    await user.type(text(), "hello");

    await user.click(submit());

    expect(await screen.findByRole("alert")).toHaveTextContent(SUBMIT_FAILED_MESSAGE);
    expect(text()).toHaveValue("hello");
    expect(author()).toHaveValue("ann");
    expect(submit()).toBeEnabled();
  });

  it("shows the server's message for an unavailable request error", async () => {
    const message = "Could not find a free room name, please try again";
    const { user, onSubmit, author, text, submit } = setup();
    onSubmit.mockRejectedValueOnce(
      Object.assign(new Error(message), { name: "ApiRequestError", status: 503, code: "unavailable" }),
    );
    await user.type(author(), "ann");
    await user.type(text(), "hello");

    await user.click(submit());

    expect(await screen.findByText(message)).toBeInTheDocument();
  });
});

describe("ComposeForm props", () => {
  it("prefills the name and the message", () => {
    const { author, text } = setup({ initialAuthor: "ann", initialText: "draft" });
    expect(author()).toHaveValue("ann");
    expect(text()).toHaveValue("draft");
  });

  it("adopts a display name that arrives after mount while the field is untouched", async () => {
    const { user, onSubmit, rerender, author } = setup();
    expect(author()).toHaveValue("");

    rerender(<ComposeForm initialAuthor="ann" onSubmit={onSubmit} />);
    expect(author()).toHaveValue("ann");

    await user.type(author(), "e");
    rerender(<ComposeForm initialAuthor="zed" onSubmit={onSubmit} />);
    expect(author()).toHaveValue("anne");
  });

  it("hydrates an empty server field, adopts storage, and preserves a later user edit", async () => {
    localStorage.setItem(DISPLAY_NAME_KEY, "ann");
    const onSubmit = vi.fn<ComposeFormProps["onSubmit"]>(async () => {});
    const onRecoverableError = vi.fn();
    function StoredCompose() {
      const [name] = useDisplayName();
      return <ComposeForm initialAuthor={name} onSubmit={onSubmit} />;
    }

    const container = document.createElement("div");
    container.innerHTML = renderToString(<StoredCompose />);
    document.body.appendChild(container);
    const author = () => within(container).getByLabelText("Display name");
    let root: Root | undefined;
    try {
      expect(author()).toHaveValue("");
      await act(async () => {
        root = hydrateRoot(container, <StoredCompose />, { onRecoverableError });
      });
      await waitFor(() => expect(author()).toHaveValue("ann"));
      expect(onRecoverableError).not.toHaveBeenCalled();

      const user = userEvent.setup();
      await user.type(author(), "e");
      act(() => writeDisplayName("bob"));
      expect(author()).toHaveValue("anne");
      expect(onRecoverableError).not.toHaveBeenCalled();
    } finally {
      // hydrateRoot is created outside RTL, so its cleanup must be explicit.
      await act(async () => { root?.unmount(); });
      container.remove();
    }
  });

  it("uses submitLabel for the button", () => {
    const { submit } = setup({ submitLabel: "Create" });
    expect(submit()).toHaveTextContent("Create");
  });

  it("disables every control when disabled", () => {
    const { author, text, submit } = setup({ disabled: true });
    expect(author()).toBeDisabled();
    expect(text()).toBeDisabled();
    expect(submit()).toBeDisabled();
  });
});

describe("ComposeForm counters", () => {
  it("starts at the limits", () => {
    setup();
    expect(screen.getByText("100 characters left")).toBeInTheDocument();
    expect(screen.getByText("3000 characters left")).toBeInTheDocument();
  });

  it("counts code points, not UTF-16 units", () => {
    const { text } = setup();
    // Two astral characters: 4 UTF-16 units, 2 code points.
    fireEvent.change(text(), { target: { value: "\u{1D518}\u{1D518}" } });
    expect(screen.getByText("2998 characters left")).toBeInTheDocument();
  });

  it("goes negative past the limit and uses the singular form at one", () => {
    const { author } = setup();
    fireEvent.change(author(), { target: { value: "a".repeat(101) } });
    expect(screen.getByText("-1 characters left")).toBeInTheDocument();
    fireEvent.change(author(), { target: { value: "a".repeat(99) } });
    expect(screen.getByText("1 character left")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test src/components/compose/ComposeForm.test.tsx`
Expected: FAIL with `Failed to resolve import "@/components/compose/ComposeForm"`.

- [ ] **Step 3: Write the component**

Create `src/components/compose/ComposeForm.tsx`:

```tsx
"use client";

import { useId, useState, type FormEvent } from "react";

import {
  submitErrors,
  toComposeErrors,
  zodFieldIssues,
  type ComposeErrors,
} from "@/components/compose/fieldErrors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { countChars } from "@/lib/schemas/common";
import { postMessageInputSchema, type PostMessageInput } from "@/lib/schemas/message";
import { writeDisplayName } from "@/lib/storage/displayName";

/** Limits from PRD 4, in code points after trimming; the counters use the raw value. */
export const AUTHOR_MAX = 100;
export const TEXT_MAX = 3000;

export type ComposeFormProps = {
  /** Shown in the name field until the user edits it; a later value is adopted while untouched. */
  initialAuthor: string;
  /** Shown in the message field until the user edits it (chunk 10's 409 hand-off). */
  initialText?: string;
  /** Submit button text. */
  submitLabel?: string;
  /** Disables every control, for example while the room is unavailable. */
  disabled?: boolean;
  /**
   * Receives the trimmed, validated values. Reject with chunk 4's
   * `ApiValidationError` to show its fields inline; any other rejection shows
   * a form-level message. Drafts survive every rejection.
   */
  onSubmit(input: PostMessageInput): Promise<void>;
};

/**
 * The one compose form shared by the "New chatroom" popup and the room panel
 * (PRD 6.7). Validates with the shared schema, shows per-field errors and
 * remaining-character counters, disables all controls while a request is pending,
 * clears the message only after success and remembers the display name then
 * (PRD 4 "Compose behavior", Flow B step 4).
 */
export function ComposeForm({
  initialAuthor,
  initialText = "",
  submitLabel = "Send",
  disabled = false,
  onSubmit,
}: ComposeFormProps) {
  const id = useId();
  const authorId = `${id}-author`;
  const textId = `${id}-text`;

  // null = untouched: the field shows the prop, so a remembered name that
  // arrives after hydration (see useDisplayName) is adopted without an effect.
  const [authorDraft, setAuthorDraft] = useState<string | null>(null);
  const [textDraft, setTextDraft] = useState<string | null>(null);
  const [errors, setErrors] = useState<ComposeErrors>({});
  const [pending, setPending] = useState(false);

  const author = authorDraft ?? initialAuthor;
  const text = textDraft ?? initialText;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled || pending) return;

    const parsed = postMessageInputSchema.safeParse({ author, text });
    if (!parsed.success) {
      setErrors(toComposeErrors(zodFieldIssues(parsed.error)));
      return;
    }

    // Valid: drop stale messages now, so none show while the request is pending.
    setErrors({});
    setPending(true);
    try {
      await onSubmit(parsed.data);
      writeDisplayName(parsed.data.author);
      setTextDraft("");
    } catch (error) {
      setErrors(submitErrors(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      aria-busy={pending}
      className="flex flex-col gap-3"
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={authorId}>Display name</Label>
        <Input
          id={authorId}
          name="author"
          autoComplete="nickname"
          value={author}
          onChange={(event) => setAuthorDraft(event.target.value)}
          disabled={disabled || pending}
          aria-invalid={errors.author ? true : undefined}
          aria-describedby={errors.author ? `${authorId}-error` : undefined}
        />
        <FieldFooter
          label="Display name"
          error={errors.author}
          errorId={`${authorId}-error`}
          left={AUTHOR_MAX - countChars(author)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={textId}>Message</Label>
        <Textarea
          id={textId}
          name="text"
          rows={3}
          value={text}
          onChange={(event) => setTextDraft(event.target.value)}
          disabled={disabled || pending}
          aria-invalid={errors.text ? true : undefined}
          aria-describedby={errors.text ? `${textId}-error` : undefined}
        />
        <FieldFooter
          label="Message"
          error={errors.text}
          errorId={`${textId}-error`}
          left={TEXT_MAX - countChars(text)}
        />
      </div>

      {errors.form ? (
        <p role="alert" className="text-sm text-destructive">
          {errors.form}
        </p>
      ) : null}

      <Button type="submit" disabled={disabled || pending} className="self-end">
        {submitLabel}
      </Button>
    </form>
  );
}

type FieldFooterProps = {
  label: string;
  error: string | undefined;
  errorId: string;
  /** Characters left before the limit; negative when over it. */
  left: number;
};

/** Error text on the left (prefixed with the field label), counter on the right. */
function FieldFooter({ label, error, errorId, left }: FieldFooterProps) {
  return (
    <div className="flex items-start justify-between gap-2 text-xs">
      {error ? (
        <p id={errorId} className="text-destructive">
          {label} {error}
        </p>
      ) : (
        <span />
      )}
      <span className={left < 0 ? "text-destructive tabular-nums" : "text-muted-foreground tabular-nums"}>
        {charactersLeft(left)}
      </span>
    </div>
  );
}

function charactersLeft(left: number): string {
  return `${left} ${left === 1 ? "character" : "characters"} left`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test src/components/compose/ComposeForm.test.tsx`
Expected: PASS, 17 tests (including both deferred-submit outcomes and actual server-to-client hydration). If a test logs `Warning: An update to ComposeForm inside a test was not wrapped in act(...)`, the assertion after the click is not awaiting; use `findBy*` or `await waitFor(...)` as the tests above do rather than reading the DOM synchronously after `user.click`.

- [ ] **Step 5: Lint and typecheck**

Run: `pnpm lint && pnpm typecheck`
Expected: both exit 0. The `react-hooks/*` rules pass because the form derives `author`/`text` from state and props during render and never sets state in an effect or during render.

- [ ] **Step 6: Commit**

```bash
git add src/components/compose/ComposeForm.tsx src/components/compose/ComposeForm.test.tsx
git commit -m "feat(compose): add the shared ComposeForm with validation, counters and pending state"
```

---

### Task 6: Documentation and full verification

**Files:**
- Modify: `README.md` ("Tests" section; new "Compose form and display name" section before "## Database")

**Interfaces:**
- Consumes: everything above.
- Produces: the handoff below for chunks 9 and 10, recorded in the README.

- [ ] **Step 1: Document the tooling and the modules**

In `README.md`, replace the "## Tests" section body with:

```markdown
## Tests

Unit tests live next to the code as `*.test.ts` and run in a Node environment. A component
test opts into jsdom with `// @vitest-environment jsdom` as its first line and uses Testing
Library (`@testing-library/react`, `user-event`); `vitest.setup.ts` registers the jest-dom
matchers for every file and, when a DOM exists, cleans it between tests. Target one file with
`pnpm test <path>` (no `--`).
```

Insert this section before `## Database`:

```markdown
## Compose form and display name

The "New chatroom" popup and the room panel render the same form (PRD 6.7), so the 409
hand-off is a prop change, not a second implementation.

| Module                          | Provides                                                                                     |
| ------------------------------- | -------------------------------------------------------------------------------------------- |
| `@/lib/storage/displayName`     | `DISPLAY_NAME_KEY`, `readDisplayName`, `writeDisplayName`, `subscribeDisplayName`; every access is wrapped, so blocked or missing storage means "not remembered" |
| `@/lib/storage/useDisplayName`  | `useDisplayName(): [name, setName]`; `""` on the server and while hydrating, the stored name after mount, updated across tabs |
| `@/components/compose/ComposeForm` | `ComposeForm({ initialAuthor, initialText?, submitLabel?, disabled?, onSubmit })`      |
| `@/components/compose/fieldErrors` | `submitErrors`, `toComposeErrors`, `zodFieldIssues`, `isValidationError`, `SUBMIT_FAILED_MESSAGE` |

`ComposeForm` validates with `postMessageInputSchema`, shows "<Field> <message>" under each
field, and shows remaining characters counted in code points. On submit it disables both fields
and the button, preventing edits that could be erased by the pending response,
awaits `onSubmit` with the trimmed values, and on success clears the message, keeps the name
and stores it. If `onSubmit` rejects with an error named `ApiValidationError` carrying
`fields: { path, message }[]`, the messages appear under their fields (other paths become one
form-level line); an `ApiRequestError` with code `unavailable` shows the server's message;
any other rejection shows a "may still have gone through" notice. Drafts survive every
rejection. Pass `initialAuthor={name}` from `useDisplayName()`; a value that arrives after
mount is adopted while the field is untouched.
```

- [ ] **Step 2: Full verification**

```bash
cd /Users/calin/dev/other/wp-worktrees/chunk-07-compose-form
pnpm test && pnpm lint && pnpm typecheck && pnpm build
```

Expected: Vitest reports 14 files passing (8 from before, plus `primitives`, `displayName`, `displayName.node`, `useDisplayName`, `fieldErrors`, `ComposeForm`); ESLint, `tsc` and `next build` exit 0. `next build` needs `.env.local` (copied in "Before you start"); it does not call the Supabase stack.

- [ ] **Step 3: Optional visual check**

The form has no page yet (chunks 9 and 10 mount it). To look at it once, temporarily render it from `src/app/page.tsx` in a client wrapper, run `pnpm dev`, open the printed URL, then discard the change:

```tsx
// src/components/compose/ComposePreview.tsx — temporary, do not commit
"use client";
import { ComposeForm } from "@/components/compose/ComposeForm";
import { useDisplayName } from "@/lib/storage/useDisplayName";

export function ComposePreview() {
  const [name] = useDisplayName();
  return (
    <div className="w-96 rounded-lg border p-4">
      <ComposeForm initialAuthor={name} onSubmit={async (input) => console.log(input)} />
    </div>
  );
}
```

Check: the name field is empty on first load, submitting "ann"/"hello" logs the trimmed input and clears the message, a reload shows "ann" prefilled, and an empty submit shows both messages. Then `git checkout src/app/page.tsx && rm src/components/compose/ComposePreview.tsx`.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: describe the compose form, display name storage and component tests"
git status --short
```

Expected: a clean tree. Finish with `superpowers:finishing-a-development-branch` (merge `chunk-07-compose-form` into `main` as chunks 2 and 3 were, with a merge commit).

---

## Handoff to chunks 9 and 10

- **Author prefill.** In the component that mounts the form, call `const [name] = useDisplayName()` and pass `initialAuthor={prefill?.author ?? name}`. Do not copy `name` into state; the form adopts a late value itself.
- **Room panel (chunk 9).** Render `<ComposeForm initialAuthor={…} initialText={prefill?.text} submitLabel="Send" disabled={!feed.ready} onSubmit={async (input) => { await feed.send(input); }} />` in `PanelFrame`'s footer. The async block deliberately discards the returned `Message`, adapting the newer feed design's `Promise<Message>` to this form's `Promise<void>`; it preserves rejection. Let API validation errors propagate unchanged. The revised feed design owns `ready` and rejects `FeedNotReadyError` if readiness changes before submission: the panel must translate that known no-write error into a form-level validation issue (for example, reject `new ApiValidationError([{ path: "", message: error.message }])`) so the draft is preserved without an uncertain-write notice. Do not swallow that rejection and resolve as though a message was sent. This boundary behavior belongs to chunk 9 and its tests. The panel is keyed by `room.id`, resetting drafts and the hook on room changes. Type-check this real wiring against the delivered hook when chunk 9 lands; the older chunk-list `send(): Promise<void>` example is not the newer hook's contract.
- **New chatroom (chunk 10).** `submitLabel="Create"`; call `api.rooms.create({ ...input, lat, lng })` inside `onSubmit`. For `created`, retain both `outcome.room` and `outcome.message`. Chunks 6/9/10 must extend the selection/panel handoff (or equivalent parent state) so `roomCreated` carries the first message as `seed`, the room selection and `RoomPanel` retain it, and the panel's first `useRoomFeed(room.id, { seed })` receives it. The current room-only selection contract is insufficient and must be updated by those chunks before this flow is considered complete. The feed uses the returned message immediately for display and its initial synchronization bookmark, avoiding an initial-history request. Seed is captured for the room identity: supplying it after the first mount is too late.
- **Conflict transfer (chunk 10).** For `conflict`, dispatch `movedToExisting` with the existing room and `{ author, text }` as an unsent prefill; do not create a seed from that input or call `api.messages.post`. Load the existing room's history normally. Both successful creation and completed conflict transfer may resolve the popup's callback after handing off the data; the popup unmounts, so its local message clear cannot remove the transferred prefill. A 400 on `lat`/`lng` becomes a form-level line and a 503 `unavailable` shows the server message; both reject and keep the draft.
- **Integration acceptance (chunks 9/10).** Test the actual panel adapter with a `Promise<Message>` send result and API rejection; loading/failed history must keep composing disabled, and a readiness race must preserve the draft with a known no-write message. Test that a created outcome passes its first message through selection to the first hook mount, displays it once, initializes `syncCursor` to its id, and makes no initial-history request. Separately test that a conflict prefills author/text after the popup unmounts, loads existing history without a seed, and never posts automatically. These checks are downstream obligations, not outcomes proven by chunk 7's component mocks. Reconcile the newer feed design and its feedback before implementing that boundary.
- **Chunk 12's deleted-room 404** surfaces in the form as `SUBMIT_FAILED_MESSAGE`; close the panel with your own notice when `api` reports `not_found` and do not rely on the form for that.
- **Duplicate helper.** `zodFieldIssues` here and `fieldIssues` in chunk 4's `@/lib/api/errors` are the same four lines. After both are on `main`, make the form import chunk 4's (`import { fieldIssues } from "@/lib/api/errors"`) and delete `zodFieldIssues`; its tests move accordingly.

## Not in this chunk

- Enter/Ctrl+Enter to submit; a "Sending…" label; focus management after submit.
- Any page that mounts the form (chunks 9, 10), and the info icon and title of the popup (chunk 10).
- Rewording the schema's empty-field message; the form prefixes the label instead.

## Self-review

- **Spec coverage.** Interfaces: `DISPLAY_NAME_KEY`, `readDisplayName`, `writeDisplayName` (Task 2); `useDisplayName` returning `""` until mounted (Task 3); `ComposeFormProps` with `initialAuthor`, `initialText?`, `submitLabel?` default "Send", `disabled?`, `onSubmit` (Task 5). Behaviour: validates with `postMessageInputSchema` on submit, inline field errors, counters via `countChars`, clears text not author after success, `writeDisplayName(author)` on success (Task 5). Acceptance: empty submit shows both errors and does not call `onSubmit`; valid submit passes trimmed values, clears text, persists author; server `ApiValidationError` maps to its field; `readDisplayName` returns null when `localStorage` throws (Tasks 2, 5). PRD 4 compose behaviour: all controls disabled while pending, deferred success/failure tests prevent editing and duplicate submission, drafts preserved on validation and request failure, lost-response notice, no automatic retry (Task 5). PRD 6.7: single key, wrapped access (Task 2), shared form (Task 5, handoff).
- **Placeholders.** None: every file has its full content; every command has its expected output.
- **Hydration coverage.** Task 5 hydrates server HTML with stored author data, checks `onRecoverableError`, adopts the remembered name, and confirms a later storage update does not overwrite a user edit. The manually created root is unmounted even if an assertion fails.
- **Type consistency.** `FieldIssue`/`ComposeErrors` are defined in Task 4 and consumed by name in Task 5; `subscribeDisplayName(listener): () => void` matches `useSyncExternalStore`'s subscribe signature in Task 3; `ComposeFormProps["onSubmit"]` is the `vi.fn` generic in the Task 5 tests; the label prefix ("Display name", "Message") is the same string in `FieldFooter` and in the test constants; `charactersLeft` output matches the counter assertions ("100 characters left", "1 character left", "-1 characters left").
