import { expect, test, type Page, type Request } from "@playwright/test";

import {
  clickEmptySpot,
  fillCompose,
  observeCatchUps,
  pollNow,
  refuseRealtime,
  rows,
  waitForCatchUpIdle,
  type Message,
  type Room,
} from "./helpers";

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
  await observeCatchUps(page); // armed before the room exists; keyed by id once Create answers
  await refuseRealtime(page); // this scenario counts polls, so the room must not go live
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

  // Seeded: no history request, and catch-up starts from the first message. Wait for the
  // seeded catch-up to settle (not merely start) before ticking, so the tick is never
  // dropped for landing while a fetch is still in flight (feed reducer: a tick is ignored
  // while `inflight !== null`).
  await waitForCatchUpIdle(page, room.id, 1);
  await pollNow(page, room.id);
  expect(new Set(requests.gets(room.id))).toEqual(new Set([message.id]));
  await expect(log.getByText(text, { exact: true })).toHaveCount(1);

  // A fresh load of the map, not `page.reload()`: the address is the new room's now
  // (chunk 12), and a reload would open it again instead of the world view.
  await page.goto("/");
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
      // exact: a random room name occasionally starts with "close" (e.g. "closed-gray-gibbon"),
      // whose pin is also a role=button and would otherwise match this substring search.
      page.getByRole("button", { name: "Close", exact: true }),
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
