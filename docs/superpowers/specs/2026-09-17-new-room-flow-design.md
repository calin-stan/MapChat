# Map Chat — New chatroom flow design (chunk 10)

**Review feedback:** [2026-09-17-new-room-flow-design-feedback.md](2026-09-17-new-room-flow-design-feedback.md)

Status: Review findings accepted and incorporated · Date: 2026-09-17
Sources: `docs/PRD.md` §3 Flow A, §4 (Compose behavior), §6.5 (409), §6.7;
`docs/KNOWN_LIMITATIONS.md` ("Writes have no idempotency key");
`docs/superpowers/specs/2026-09-16-map-shell-design.md` §3, §5.2, §6, §8 (panel slot,
`insertRoom`, selection, `PanelFrame`);
`docs/superpowers/specs/2026-09-17-room-panel-design.md` §3, §4, §4.1, §8 (seed path,
`RoomPanelProps`, footer, bounded composer, Playwright harness);
`docs/superpowers/plans/2026-09-16-chunk-07-compose-form.md` "Handoff to chunks 9 and 10";
`docs/superpowers/specs/2026-09-16-map-chat-implementation-chunks.md` chunk 10.

Chunk 10 turns the draft pin into a room: click an empty spot, name yourself, write a message,
press Create, and land in a live room that already shows that message. It also handles the
concurrent-creation conflict, where the server answers with the room somebody else created at
the same spot. This spec fixes the popup component, the info bubble, the hand-off into the
room panel for both outcomes, failure recovery, the 409 notice, three small `ComposeForm` additions, and the
chunk's tests.

## 1. Scope and decisions

In scope: `src/components/room/NewRoomPopup.tsx`, `src/components/room/MovedNotice.tsx`, the
shadcn `tooltip` primitive, the `NewRoomPopup` wiring in `MapShell`, the notice and focus
additions to `RoomPanel`, three optional props on `ComposeForm`, and a Playwright spec on chunk
9's harness.

Decisions made in this spec:

1. **Presentation is already settled.** The draft form lives in the one floating panel
   (`PanelFrame` in the top-right slot), not in a Leaflet popup; desktop only (map-shell design
   §1, §3). The component keeps the name `NewRoomPopup` from the chunks document.
2. **`NewRoomPopup` owns the create call** and reports created, conflict or failure to
   `MapShell`. The shell owns selection, panel handoff identity and recovered submission data.
3. **The outcome always takes over the panel.** When a create request settles, its outcome is
   applied whatever is selected by then, including after the visitor clicked a pin, moved the
   draft or closed the panel. Each created/conflict outcome starts a fresh room-panel lifetime,
   even for the already-selected room. A rejection restores a fresh draft at the submitted
   coordinates with the submitted author/text and error. The selection reducer is unchanged;
   the shell adds handoff identity and recovery state (section 6).
4. **Info bubble: stock shadcn `Tooltip`**, opening on hover and keyboard focus only. The PRD's
   "or tap" is knowingly not met; this matches the desktop-only decision and is recorded in
   `docs/KNOWN_LIMITATIONS.md`.
5. **No `RoomTitle`, no title animation.** `PanelFrame` already truncates a string title and
   chunk 9 passes `room.name`. The PRD's "title switches" is the draft frame unmounting and
   the keyed `RoomPanel` mounting in the same render. `RoomTitle` is removed from the target
   file layout.
6. **409 notice: a dismissible alert at the top of the room panel's footer**, directly above
   the prefilled compose form. It is derived from `prefill`, not stored in the selection.
7. **Typed text survives moving the draft.** Ordinary empty-map clicks preserve the popup's
   key. A failed submission instead restores its original coordinates and a fresh form;
   this is an explicit recovery transition, even if the draft has moved meanwhile.
8. **Focus follows the hand-off.** A `ComposeForm` prop focuses one field the first time the
   form is enabled. The popup uses it on open; the room panel uses it only when it was reached
   through this flow.
9. **Create-specific failure copy.** The form's generic lost-response message tells the visitor
   to check the room, and the popup has no room to check. A second `ComposeForm` prop replaces
   that message. A third prop initializes errors on a recovered form.

## 2. Dependencies

| Dependency | State at writing time | Needed for |
| --- | --- | --- |
| Chunk 4: `api.rooms.create`, `RoomsApi`, `CreateRoomOutcome`, `ApiValidationError`, `ApiRequestError` | Merged (`src/lib/api/client.ts`) | popup |
| Chunk 6: `MapShell`, `PanelFrame.titleAdornment`, `useRoomPins().insertRoom`, `selectionReducer`, `Prefill` | Merged | wiring |
| Chunk 7: `ComposeForm`, `useDisplayName`, `submitErrors` | Merged | popup footer |
| Chunk 9: `seed` on the room selection and `roomCreated.message`, `RoomPanel` with `seed` and `prefill`, `ComposeForm.textareaClassName`, shadcn `alert`, Playwright harness and `tests/e2e/helpers.ts` | **Not implemented.** Specified in the room-panel design | hand-off, notice, e2e |

This spec is written against chunk 9's contracts, not its code. Chunk 9 must be merged before
the chunk 10 plan is executed. The plan's first task verifies chunk 9's real exports against
the names used here (`RoomPanelProps`, the `Selection` seed, the panel's `submit` adapter, the
bounded textarea class, the e2e helpers) and reads any drift from the source files.

## 3. Files and interfaces

New files

| Path | Contents |
| --- | --- |
| `src/components/room/NewRoomPopup.tsx`, `NewRoomPopup.test.tsx` | The draft panel and its info bubble (sections 4, 5) |
| `src/components/room/MovedNotice.tsx` | The 409 notice (section 7) |
| `src/components/ui/tooltip.tsx` | `pnpm dlx shadcn@latest add tooltip` (style `base-nova`, Base UI) |
| `tests/e2e/new-room.spec.ts` | Section 10 |

Modified files

- `src/components/map/MapShell.tsx` and its test: the draft placeholder becomes
  `NewRoomPopup`; three outcome callbacks, handoff keys and recovery state (section 6).
- `src/components/room/RoomPanel.tsx` and its test: `MovedNotice` and the focus rule
  (sections 7, 8).
- `src/components/compose/ComposeForm.tsx` and its test: `autoFocusField` and
  `submitFailedMessage`, plus `initialErrors` (section 8); `src/components/compose/fieldErrors.ts` and its test if
  the fallback message is threaded through `submitErrors`.
- `tests/e2e/helpers.ts`: `clickEmptySpot` (section 10). The layout fixture of room-panel
  design §8 scenario 10 gains the notice.
- `README.md` (new chatroom flow), `docs/KNOWN_LIMITATIONS.md` (info bubble on tap).

`src/lib/page/selection.ts` is not modified: chunk 9 delivers the seed; recovery uses
`clickEmpty` at the submitted coordinates. Handoff identity and recovery metadata belong to
the shell, alongside selection. `useRoomPins` is unchanged; its retention boundary is section 6.

## 4. NewRoomPopup

```ts
// src/components/room/NewRoomPopup.tsx
export type NewRoomPopupProps = {
  lat: number;
  lng: number;
  onCreated(room: Room, message: Message): void;
  onConflict(room: Room, prefill: Prefill): void;
  onFailed(input: CreateRoomInput, error: unknown): void;
  recovery?: { input: CreateRoomInput; error: unknown };
  onClose(): void;
  createRoom?: RoomsApi["create"];   // defaults to api.rooms.create; tests inject a fake
};
```

Rendering, inside one `PanelFrame`:

| Slot | Content |
| --- | --- |
| `title` | "New chatroom" |
| `titleAdornment` | `NewRoomInfo` (section 5) |
| `onClose` | the prop |
| body | One line in `text-muted-foreground`: "Your first message creates a chatroom at 46.771200, 23.623600." The numbers are `roundCoord(lat).toFixed(6)` and `roundCoord(lng).toFixed(6)`, latitude first, so the hint shows the coordinates the server will store. |
| `footer` | `ComposeForm` |

`ComposeForm` props: `submitLabel="Create"`; `initialAuthor={recovery?.input.author ?? name}` with
`const [name] = useDisplayName()` (not copied into state; the form adopts a late value itself);
`initialText={recovery?.input.text}`; the same bounded `textareaClassName` chunk 9 gives the room panel, because a
content-sized textarea with a 3000-character draft would push Create out of the panel slot
(room-panel design §4.1). If chunk 9 kept that class string private to `RoomPanel`, this chunk
moves it to an exported constant next to `ComposeForm` and both callers import it.
`autoFocusField={(recovery?.input.author ?? name) ? "text" : "author"}` and
`submitFailedMessage={CREATE_FAILED_MESSAGE}` (section 8). For recovery, map its original error
through `submitErrors` with the create fallback and pass the result as `initialErrors`.

Submit:

```ts
async function submit(input: PostMessageInput): Promise<void> {
  const submitted = { ...input, lat, lng };   // immutable snapshot for this request
  let outcome: CreateRoomOutcome;
  try {
    outcome = await createRoom(submitted);
  } catch (error) {
    onFailed(submitted, error);
    throw error; // old form must not persist a name or clear its draft as a success
  }
  if (outcome.status === "created") onCreated(outcome.room, outcome.message);
  else onConflict(outcome.room, { author: input.author, text: input.text });
}
```

- `input` is already trimmed and validated by `ComposeForm`; the prefill carries those trimmed
  values.
- The raw click coordinates are sent; the server rounds them and is the source of truth.
- Rejections call `onFailed` and then propagate to the old `ComposeForm` unchanged.
  Neither success callback is called. The fresh recovered form owns the visible error (section 9).
- Both outcomes resolve, so the form persists the display name in both. Its own "clear the
  message" runs on a component that is unmounting and cannot touch the transferred prefill.
- The popup never posts a message. On a conflict nothing is written at all (PRD 6.5).
- All three callbacks are called even if the popup has unmounted meanwhile (decision 3). The
  component must not guard them behind an "is mounted" check.
- `lat` and `lng` may change while the popup is mounted (decision 7). Each request retains
  its submitted coordinates and trimmed input until settlement. Rejection restores those
  coordinates, so an immediate manual retry targets the original spot. A deliberate move
  after recovery changes the next submit's destination (section 8).

## 5. Info bubble

`NewRoomInfo`, a private component in `NewRoomPopup.tsx`: a shadcn `Tooltip` whose trigger is a
ghost icon `Button` (`size="icon-sm"`, `FaInfoCircle` with `aria-hidden`,
`aria-label="About new chatrooms"`) and whose content is the PRD text verbatim: "This chatroom
will receive a name after the first message is sent."

- Stock behaviour only: it opens on pointer hover and on keyboard focus, and closes on leave,
  blur and Escape. No controlled state, no click handler.
- The button is a real, focusable control, so keyboard and screen-reader users reach the text.
- A tap on a touch screen does not open it. Accepted; see decision 4.
- If the generated `tooltip.tsx` needs a provider, it wraps `NewRoomInfo` only; nothing is added
  to `app/layout.tsx` for one tooltip.

## 6. MapShell wiring and handoff identity

The shell keeps a monotonically increasing handoff revision alongside selection and optional
recovery data. Each outcome updates that metadata and selection atomically, so React cannot
commit a new selection with an old panel key. The implementation plan chooses the shell-local
state/reducer arrangement; the existing pure selection reducer and its public actions remain.

| Event | Selection and metadata | Panel lifetime |
| --- | --- | --- |
| Ordinary `clickEmpty` while draft is open | New coordinates, same revision and recovery data | Same popup/form; typed edits survive |
| `onCreated(room, message)` | `insertRoom(room)`, `roomCreated`; clear recovery; increment revision | Fresh room panel with seed, even if that room is already open |
| `onConflict(room, prefill)` | `insertRoom(room)`, `movedToExisting`; clear recovery; increment revision | Fresh room panel with prefill and no seed, even if already open |
| `onFailed(input, error)` | Retain `{ input, error }`; `clickEmpty` at input coordinates; increment revision | Fresh recovered popup/form with submitted author/text and mapped errors |
| Close or select another room | Normal selection transition; clear recovery metadata | Normal unmount/remount behavior |
| Click the already-selected room's pin | Keep selection, revision and metadata unchanged | No remount; drafts, notice state and feed survive |

Render the draft with a key derived from the revision, stable across ordinary draft moves.
Render the room panel with a key derived from both `room.id` and the revision. These keys
supersede chunk 9's room-ID-only wiring for chunk 10. The room panel and hook still capture
seed once per mount; no seed-update behavior is added to the hook.

- **Created.** In one render the draft pin disappears, the returned room is selected, and a
  fresh panel displays the first message without an initial-history request. If that room was
  already opened from a newly discovered pin, dispose that old feed and mount a seeded feed.
  Any earlier history request belongs to the disposed feed; it cannot update the new one.
  The new bookmark starts at the seed, and later catch-up recovers subsequent messages.
- **Conflict.** The fresh panel loads existing history normally. Its composer receives the
  submitted author/text, its notice flags reset and it focuses the message field on first
  enable, including when the previous panel for that same room was edited or had sent a message.
  A send already pending in the replaced panel may settle under the feed's disposal contract;
  its completion cannot clear the new draft or hide the new notice.
- **Failure recovery.** Every create rejection restores the request's coordinates and trimmed
  submitted author/text in an enabled popup, with the original error mapped as section 9
  specifies. This applies after close, pin selection, draft movement or a replacement draft.
  The request closure retains its snapshot through popup unmount; the shell retains the recovery
  payload after settlement. Recovery performs no request and does not persist the display name.
  The fresh form clears its initial error when the visitor next submits, using normal validation.
- **Take-over scope.** Every outcome applies in settlement order, even if other creates are
  also pending. It replaces the currently displayed draft/panel and any intervening unsent edits.
  Preservation covers the submitted snapshot through that request's settlement; this is not a
  draft archive. Closing or navigating away after recovery discards that recovered draft normally.
  Reloading or leaving the page does not retain pending submissions. No automatic retry is added.
- **Pin retention.** `insertRoom` makes the returned room available immediately. Selected-room
  augmentation keeps its pin present while selected, including after an older in-flight refresh
  replaces the fetched collection. Once closed, normal viewport refresh and the 500-pin cap
  apply: the pin can disappear until a suitable refresh or zoom includes it. There is no
  post-close retention guarantee and no change to the pin hook's refresh/insertion contract.
- The map is not locked and shows no busy state while a create is pending; `ComposeForm`'s
  disabled controls are the only pending indicator. All outcome callbacks remain callable
  after their originating popup unmounts while the shell is still mounted.

## 7. The 409 notice

```ts
// src/components/room/MovedNotice.tsx
export type MovedNoticeProps = { onDismiss(): void };
export const MOVED_NOTICE_TEXT =
  "A chatroom already exists here, you have been moved to it. Your message has not been sent.";
```

A compact shadcn `Alert` with `role="status"`: the text in `text-sm`, no title line, and a
ghost icon close button (`aria-label="Dismiss"`). The first sentence is the PRD's wording; the
second explains why the form below is prefilled.

`RoomPanel` state and rules:

- Two local flags, `noticeDismissed` and `sentOnce`, both initially false. The panel is keyed
  by room ID and handoff revision, so they reset on every create/conflict handoff,
  including a handoff to the same room, as well as when another room is selected.
- The notice shows while `prefill !== undefined && !noticeDismissed && !sentOnce`.
- The close button sets `noticeDismissed`. The panel's `submit` adapter sets `sentOnce` after
  `feed.send` resolves; a rejected send leaves the notice in place.
- `prefill` only ever comes from `movedToExisting`, so no `notice` field is added to the
  selection. Closing and re-opening the room, or clicking its pin from another room, yields a
  selection without `prefill` and therefore no notice. Clicking the pin of the already selected
  room returns the same selection object, so the notice and the prefill stay.
- Footer order, top to bottom: `MovedNotice`, fetch alert, `BacklogNotice`, `ComposeForm`.
- By feed condition (room-panel design §4): shown with `ready`, with `!ready` and with the
  initial-failure hint, because the visitor was moved either way and the draft is still in the
  disabled form. Not shown with the room-gone hint.
- **Layout budget.** Room-panel design §4.1 requires at least 96 px of message viewport at
  1280 × 720 with every footer notice present. That requirement now includes `MovedNotice`
  together with the fetch alert, the backlog notice and a compose error. Spacing and wrapping
  may be compacted to meet it; the page must not acquire a scrollbar. Section 10 proves it in a
  real browser.

## 8. ComposeForm additions

```ts
export type ComposeFormProps = {
  // …existing props, including chunk 9's textareaClassName
  /** Focus this field once, the first time the form is enabled after mount. */
  autoFocusField?: "author" | "text";
  /** Replaces SUBMIT_FAILED_MESSAGE for rejections that are neither validation nor `unavailable`. */
  submitFailedMessage?: string;
  /** Errors for this form mount; used to restore a rejected create. */
  initialErrors?: ComposeErrors;
};
```

- **`autoFocusField`.** Focuses the named field once: on mount when the form is enabled, else
  on the first change of `disabled` to false. It never fires again for that mount, never while
  `pending`, and does not select or move the text. Implemented with refs and an effect, not the
  `autoFocus` attribute, which cannot wait for an enabled form. Omitted means no focus change.
  - `NewRoomPopup` passes `name ? "text" : "author"`, evaluated at render: a visitor with a
    remembered name clicks the map and types their message straight away. A client-side mount
    reads the stored name synchronously, so the value is settled on the popup's first render.
  - `RoomPanel` passes `"text"` when `seed !== undefined || prefill !== undefined`, otherwise
    nothing. After Create, the button that held focus has unmounted; without this, focus falls
    to `<body>`. On the conflict path the form is disabled until history is ready, which is why
    the rule is "first enabled". Opening a room from a pin never moves focus.
- **`submitFailedMessage`.** Default `SUBMIT_FAILED_MESSAGE`; all existing callers unchanged.
  `NewRoomPopup` passes

  ```ts
  export const CREATE_FAILED_MESSAGE =
    "Couldn't confirm creation. A chatroom may already exist at the submitted spot. Retry at the same spot to open it if it exists. Moving the pin starts a separate creation at the new spot.";
  ```

  Recovery restores the submitted coordinates. Retrying at those same rounded coordinates
  turns an existing room into a 409 without posting again. Moving the recovered draft is an
  explicit change of destination: Create uses that new spot and may create a second room with
  the same text. The conditional wording remains visible after movement until the next submit.
  After a lost response the visitor may therefore land in their own room with
  the "already exists" notice and their message visible as its first entry. That is the accepted
  limitation "Writes have no idempotency key"; no detection is added.

- **`initialErrors`.** Initialize the form's local errors once per mount, defaulting to `{}`.
  Later prop changes do not replace local errors. Normal validation and submit clearing still
  apply. Recovery uses a new form key, so the error appears without adding imperative reset
  behavior. Author/text field errors remain associated with their fields; other errors remain
  form-level. Ordinary callers omit this prop.

## 9. Errors

| Situation | Behaviour | Owner |
| --- | --- | --- |
| Empty or over-long name or message | Inline field errors; no request | `ComposeForm` (chunk 7) |
| 400 with `author` / `text` fields | Inline field errors; draft kept | `submitErrors` |
| 400 on `lat` / `lng` | One form-level line (`lat must be …`); draft kept | `toComposeErrors` |
| 503 `unavailable` (name retries exhausted, PRD 6.3) | The server's message as a form-level line; draft kept | `submitErrors` |
| Network failure, 5xx, unparseable response | `CREATE_FAILED_MESSAGE`; draft kept; no automatic retry | section 8 |
| 409 | Not an error: `onConflict` | section 4 |
| History fails to load after a conflict hand-off | Chunk 9's initial-failure hint; the notice stays; the form stays disabled with the prefilled draft visible | room-panel design §4 |

Client validation errors make no request and keep the current popup and raw drafts unchanged.
A rejected create calls only `onFailed`: section 6 restores the submitted coordinates, trimmed
author/text and mapped errors in a fresh popup, even after navigation. A 409 calls `onConflict`
and opens a room panel; failure of that room's history remains there with its disabled prefill.
Neither of these room-panel cases restores a draft pin. No failure automatically retries a write.

## 10. Tests

Vitest; component files opt in with `// @vitest-environment jsdom`. Fakes are injected the
way the existing suites do it (`createRoom` prop, `feedDeps`, the mocked `useRoomPins`).

- `NewRoomPopup.test.tsx`
  - Title "New chatroom"; the info button's accessible name; focusing it shows the PRD text.
  - The hint shows both coordinates rounded to six decimals, latitude first.
  - The name field is prefilled from storage; the submit button reads "Create".
  - Created: `createRoom` is called once with the trimmed `author` and `text` and the `lat` /
    `lng` props; `onCreated(room, message)` is called; `onConflict` is not.
  - Conflict: `onConflict(room, { author, text })` with the trimmed values; `onCreated` is not
    called; `fetch` is never called (nothing is posted automatically).
  - A validation error on `lat`, a 503 `unavailable`, and a generic rejection each call only
    `onFailed` with the submitted snapshot and original error, and reject the form submission.
    A recovered popup shows the appropriate field/form errors and submitted author/text.
  - All compose controls are disabled while the request is pending; a second submit is ignored.
  - Rerendering with new `lat` / `lng` keeps the typed text; the next submit sends the new
    coordinates. A request already in flight settles with its original coordinates and still
    calls its callback after the component unmounts.
  - The display name is persisted after a created and after a conflict outcome, not after a
    rejection.
  - Focus: the message field when a name is stored, the name field otherwise; recovery uses
    its submitted author and focuses the message field.
- `ComposeForm.test.tsx`: `autoFocusField` focuses on mount when enabled, on first enable
  when mounted disabled, only once, and not at all when omitted; `submitFailedMessage` replaces
  the generic fallback but not field errors or the 503 message; `initialErrors` appears on
  mount, ignores later prop changes and follows normal submit/validation clearing. Defaults unchanged.
- `RoomPanel.test.tsx` (added cases): the notice shows with `prefill`, including while opening
  and with the initial-failure hint; absent without `prefill` and with the room-gone hint;
  Dismiss hides it; a resolved send hides it; a rejected send keeps it; it renders above the
  fetch alert; the message field is focused on first enable with `seed` and with `prefill`, and
  focus is untouched with neither.
- `MapShell.test.tsx` (added cases)
  - A draft selection renders `NewRoomPopup` with the draft's coordinates.
  - Created: `insertRoom(room)` is called; the room panel shows the first message exactly
    once; `messages.list` is not called for initial history; the first poll calls it with
    `{ after: message.id }`.
  - Conflict: `insertRoom(existing)`; the existing room's panel shows the notice and the
    prefilled name and text; history is requested once without a seed; `messages.post` is never
    called.
  - Take-over: with the create promise still pending, click a pin (and, separately, close the
    panel); resolving `created` opens the new room with its seed, and resolving `conflict`
    opens the existing room with notice and prefill.
  - Same-room conflict: open the eventual conflict room before settlement, edit its fields
    and, separately, send a message. Resolve the conflict: the submitted prefill replaces those
    fields, the new notice is visible, history loads for a fresh feed and focus follows first
    enable. A pending send in the replaced panel cannot clear the new draft or notice.
  - Same-room created: discover and open the created room before its delayed response arrives.
    Resolve creation: dispose the previous feed and mount with the seed exactly once; the new
    feed makes no initial-history request and polls from that seed. Ignore late old-feed results.
    An earlier initial request from opening the pin is allowed in this scenario.
  - Same-pin click without an outcome preserves the panel instance, edits and notice state.
  - Reject after close, pin selection and a replacement draft: each restores the submitted
    coordinates, trimmed author/text and mapped errors, makes no additional write and does not
    persist the name. Intervening edits are replaced according to the take-over rule.
  - Submit at A, move to B while pending, then reject: restore A and the submitted draft.
    Immediate manual retry submits A; deliberately moving the recovered draft to B submits B.
    Both states show conditional retry guidance until submission. No retry is automatic.
  - With multiple requests pending, outcomes apply in settlement order, each using its own
    snapshot and a fresh handoff revision, including failure after a different request succeeds.
  - Pin retention integration uses the real `useRoomPins` with a controlled room-list API:
    start a refresh whose result omits R, insert/select R through an outcome, then settle that
    refresh. R remains visible while selected; closing removes R if absent from the collection.
    A later refresh containing R restores its pin. No permanent pin cache is expected.
  - A second `onEmptyClick` while typing keeps the typed text and updates the hint.
- `selection.test.ts`: no new cases; chunk 9 covers the seed rows.

### Playwright — `tests/e2e/new-room.spec.ts`

On chunk 9's harness with its rules unchanged: Chromium, explicit 1280 × 720 viewport, real
dev server and local Supabase, data through the real API, role and visible-text selectors
only, `page.clock` for poll timing.

New helper `clickEmptySpot(page)` in `tests/e2e/helpers.ts`. Rooms accumulate in the local
database across runs, so the helper must not depend on a clean map:

- It picks a random point in a map region that is clear of the panel slot, the status pill,
  the zoom control and the attribution, and outside chunk 9's fixture region (lat [40, 50],
  lng [0, 10]).
- After the click it expects the "New chatroom" heading. If a room panel opened instead (the
  click landed on an older pin), it closes the panel and picks another point.
- It reads the coordinates from the hint and checks through `GET /api/rooms?bbox=`, with a box
  of ±0.0000005° around that point, that no room exists there; otherwise it picks another
  point.
- Retries are bounded; exhausting them fails the test with a message that suggests
  `pnpm db:reset`. It returns `{ lat, lng }`.

Scenarios

1. **Create and seeded open.** `clickEmptySpot`: the heading is "New chatroom" and the hint
   shows the coordinates; hovering the info button shows the PRD text. Fill the name and a
   message and click Create. The panel heading matches
   `/^[a-z]+-[a-z]+-[a-z]+(-[a-z0-9]{4})?$/`, the message appears exactly once, the message
   field is focused, and a marker whose `title` is the room name exists. No request to
   `/api/rooms/<id>/messages` without an `after` parameter was made. After
   `page.clock.fastForward(30_000)` a request with `after=<first message id>` was made and the
   message still appears once. After a reload, a new draft has the name prefilled and the
   message field focused.
2. **Real 409.** `clickEmptySpot`, then create a room at the returned coordinates through the
   API as another author. Fill the form and click Create. The notice text is visible, the
   heading is the existing room's name, the other author's message is in the log and the
   visitor's text is not, both fields hold the visitor's name and text, and no `POST` to
   `/api/rooms/<id>/messages` was made. Click Send: the message appears once and the notice is
   gone. Variant: dismiss the notice instead; the fields keep their values.
3. **Layout.** In the popup, a valid many-line draft close to 3000 code points scrolls inside
   the textarea; Create and the close button stay inside the viewport and the page does not
   scroll. Include a recovered popup with the full uncertain-creation error and long draft
   in the real-component layout fixture. The layout fixture of room-panel design §8 scenario 10 is extended with
   `MovedNotice` alongside the fetch alert, the backlog notice and a compose error: the ready
   list still has at least 96 px of height.

Manual (chunks document): two browsers click Create for the same spot, prepared by reading the
hint in one and creating through the API or the other browser; the second sees the notice and
the prefilled form.

## 11. Documentation

- `README.md`: a "New chatroom flow" section (what Create does, the conflict hand-off, the
  take-over rule including replaced intervening edits, restoration at submitted coordinates,
  same-spot retry versus moving the draft, selected-only pin retention, the e2e spec and its
  accumulation caveat).
- `docs/KNOWN_LIMITATIONS.md`, accepted limitations: "The new-chatroom info bubble opens on
  hover or keyboard focus only. A tap on a touch screen does not show it. The PRD asks for
  hover or tap; touch support is deferred with the mobile layout."
- Document that pending submissions survive panel navigation only until settlement, not a
  page reload, and that outcomes replace intervening drafts in settlement order. Creation
  retry protection applies only at the same rounded coordinates; moving the pin can create
  another room. Locally inserted pins have no retention guarantee after closing the panel.
- The chunks document already points chunk 10 at this spec and drops `RoomTitle`.

## 12. Out of scope

Tap support for the info bubble and any mobile layout; a title animation; `RoomTitle`; locking
the map or showing a map-level busy state while a create is pending; detecting that a 409 is
the visitor's own room after a lost response; an optimistic pin before the server answers;
Escape to close the panel; URL sync to `/room/<id>` after creation (chunk 12); realtime for the
new room (chunk 11, which needs no change here because the seeded feed already starts from the
first message's bookmark).
