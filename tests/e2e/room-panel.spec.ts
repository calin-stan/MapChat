import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  createRoom,
  distanceFromBottom,
  fillCompose,
  openRoom,
  openPollingRoom,
  expectNoCatchUp,
  pill,
  pollNow,
  postMessage,
  postMessages,
  roomWithMessages,
  rows,
  scrollListTo,
  scrollTopOf,
  topOf,
} from "./helpers";

const POSITION_TOLERANCE_PX = 2;

/** The row whose message text is exactly `text` ("message 1" does not match "message 10"). */
const row = (log: Locator, text: string) =>
  rows(log).filter({ has: log.page().getByText(text, { exact: true }) });

async function expectAtBottom(log: Locator) {
  await expect.poll(() => distanceFromBottom(log)).toBeLessThanOrEqual(1);
}

async function expectSameTop(target: Locator, before: number) {
  await expect.poll(async () => Math.abs((await topOf(target)) - before)).toBeLessThanOrEqual(
    POSITION_TOLERANCE_PX,
  );
}

async function send(page: Page, author: string, text: string) {
  await fillCompose(page, author, text);
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByLabel("Message")).toHaveValue("");
}

test.describe("1. open and initial position", () => {
  test("shows author, text and time in ascending order", async ({ page, request }) => {
    const room = await roomWithMessages(request, 3);

    const log = await openRoom(page, room);

    await expect(rows(log)).toHaveCount(3);
    await expect(rows(log)).toContainText(["message 1", "message 2", "message 3"]);
    await expect(rows(log).first()).toContainText("e2e");
    await expect(rows(log).first().getByRole("time")).toHaveText(/^\d{2}:\d{2}$/);
  });

  test("opens a long room at its newest message", async ({ page, request }) => {
    const room = await roomWithMessages(request, 125);

    const log = await openRoom(page, room);

    await expect(rows(log)).toHaveCount(100);
    await expect(row(log, "message 125")).toBeInViewport();
    await expectAtBottom(log);
  });
});

test("2. Load older keeps the reader's position", async ({ page, request }) => {
  const room = await roomWithMessages(request, 125);
  const log = await openRoom(page, room);
  await expect(rows(log)).toHaveCount(100);
  const loadOlder = page.getByRole("button", { name: "Load older" });

  await scrollListTo(log, 0);
  const first = row(log, "message 26");
  const before = await topOf(first);
  await loadOlder.click();

  await expect(rows(log)).toHaveCount(120);
  await expectSameTop(first, before);
  await expect(loadOlder).toBeVisible();
  await expect(pill(page)).toBeHidden();

  await scrollListTo(log, 0);
  const second = row(log, "message 6");
  const beforeLast = await topOf(second);
  await loadOlder.click();

  await expect(rows(log)).toHaveCount(125);
  await expect(loadOlder).toBeHidden();
  await expectSameTop(second, beforeLast); // the button above it disappeared in the same commit
});

test("3. an incoming message at the bottom is followed without a pill", async ({ page, request }) => {
  const room = await roomWithMessages(request, 30);
  const log = await openPollingRoom(page, room);
  await expectAtBottom(log);

  await postMessage(request, room.id, { author: "other", text: "incoming one" });
  await pollNow(page, room.id);

  await expect(row(log, "incoming one")).toBeInViewport();
  await expectAtBottom(log);
  await expect(pill(page)).toBeHidden();
});

test("4. an incoming message while scrolled up shows the pill and keeps scrollTop", async ({ page, request }) => {
  const room = await roomWithMessages(request, 30);
  const log = await openPollingRoom(page, room);
  await scrollListTo(log, 120);
  const before = await scrollTopOf(log);

  await postMessage(request, room.id, { author: "other", text: "incoming two" });
  await pollNow(page, room.id);

  await expect(pill(page)).toBeVisible();
  expect(await scrollTopOf(log)).toBe(before);
  await expect(row(log, "incoming two")).not.toBeInViewport();

  await pill(page).click();
  await expectAtBottom(log);
  await expect(pill(page)).toBeHidden();
  await expect(row(log, "incoming two")).toBeInViewport();
});

test.describe("5. send", () => {
  test("appends once, clears the draft, keeps line breaks and remembers the name", async ({ page, request }) => {
    const room = await roomWithMessages(request, 2);
    const log = await openPollingRoom(page, room);

    await send(page, "ann", "first line\nsecond line");

    const sent = rows(log).filter({ hasText: "second line" });
    await expect(sent).toHaveCount(1);
    await expect(page.getByLabel("Display name")).toHaveValue("ann");
    const oneLine = await row(log, "message 2").getByText("message 2").boundingBox();
    const twoLines = await sent.getByText("second line").boundingBox();
    expect(twoLines!.height).toBeGreaterThan(oneLine!.height * 1.5); // pre-wrap in real layout

    await postMessage(request, room.id, { author: "other", text: "poll completion witness" });
    await pollNow(page, room.id);
    await expect(row(log, "poll completion witness")).toHaveCount(1);
    await expect(rows(log)).toHaveCount(4);
    await expect(sent).toHaveCount(1);

    // openPollingRoom paused the clock; resume it so the reload's own timers
    // (the map's viewport debounce) run in real time instead of staying frozen.
    await page.clock.resume();
    await openRoom(page, room); // reload and re-open
    await expect(page.getByLabel("Display name")).toHaveValue("ann");
    await expect(rows(page.getByRole("log")).filter({ hasText: "second line" })).toHaveCount(1);
  });

  test("an own send ends at the bottom even when scrolled up", async ({ page, request }) => {
    const room = await roomWithMessages(request, 30);
    const log = await openRoom(page, room);
    await scrollListTo(log, 0);

    await send(page, "ann", "sent from far up");

    await expect(row(log, "sent from far up")).toBeInViewport();
    await expectAtBottom(log);
    await expect(pill(page)).toBeHidden();
  });
});

test("6. a backlog pauses polling until Load more messages drains it", async ({ page, request }) => {
  const room = await roomWithMessages(request, 5);
  const log = await openPollingRoom(page, room);
  await expect(rows(log)).toHaveCount(5);
  await postMessages(request, room.id, 105, { prefix: "backlog" });

  await pollNow(page, room.id);
  await expect(page.getByText("More messages are available")).toBeVisible();
  await expect(rows(log)).toHaveCount(105);

  await expectNoCatchUp(page, room.id); // observe absence of a room-specific after request
  await expect(rows(log)).toHaveCount(105);

  await expectAtBottom(log);
  const before = await scrollTopOf(log);
  await page.getByRole("button", { name: "Load more messages" }).click();

  await expect(rows(log)).toHaveCount(110);
  await expect(page.getByText("More messages are available")).toBeHidden();
  await expect(pill(page)).toBeVisible();
  expect(await scrollTopOf(log)).toBe(before);
});

test.describe("7. local time", () => {
  test.use({ timezoneId: "Europe/Bucharest" });

  test("shows the message's time in the browser's zone", async ({ page, request }) => {
    const { room, message } = await createRoom(request, { author: "e2e", text: "what time is it" });
    const expected = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Bucharest",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(new Date(message.createdAt));

    const log = await openRoom(page, room);

    await expect(rows(log).first().getByRole("time")).toHaveText(expected);
    await expect(rows(log).first().getByRole("time")).toHaveAttribute("datetime", message.createdAt);
  });
});

test.describe("8. interior catch-up and manual backlog", () => {
  // Own C is taller than the list, so the reader can be scrolled up while C is
  // still the first visible row. Rows that land before C then push it down, and
  // only the anchor correction keeps it in place.
  const OWN_C = Array.from({ length: 40 }, (_, index) => `own C line ${String(index + 1).padStart(2, "0")}`).join("\n");
  const ownC = (log: Locator) => rows(log).filter({ hasText: "own C line 01" });

  /** Leaves the bottom by 100 px; C still covers the whole list viewport. */
  async function scrollUpInsideOwnC(log: Locator) {
    await expectAtBottom(log);
    await scrollListTo(log, (await scrollTopOf(log)) - 100);
    const list = (await log.boundingBox())!;
    const c = (await ownC(log).boundingBox())!;
    expect(c.y).toBeLessThan(list.y);
    expect(c.y + c.height).toBeGreaterThan(list.y + list.height);
  }

  test("follows an interior insert when near the bottom", async ({ page, request }) => {
    const room = await roomWithMessages(request, 30);
    const log = await openPollingRoom(page, room);
    // Another visitor's B exists before own C is sent, so the next catch-up inserts B above C.
    await postMessage(request, room.id, { author: "other", text: "interior B" });
    await send(page, "ann", "own C");
    await expect(row(log, "interior B")).toHaveCount(0);

    await pollNow(page, room.id);

    await expect(row(log, "interior B")).toBeVisible();
    expect(await topOf(row(log, "interior B"))).toBeLessThan(await topOf(row(log, "own C")));
    await expectAtBottom(log);
    await expect(pill(page)).toBeHidden();
  });

  test("keeps the visible row in place for an interior insert and shows the pill", async ({ page, request }) => {
    const room = await roomWithMessages(request, 30);
    const log = await openPollingRoom(page, room);
    await postMessage(request, room.id, { author: "other", text: "interior B" });
    await send(page, "ann", OWN_C);
    await scrollUpInsideOwnC(log);
    const before = await topOf(ownC(log));

    await pollNow(page, room.id);

    await expect(row(log, "interior B")).toHaveCount(1); // inserted above the row being read
    await expect(pill(page)).toBeVisible();
    await expectSameTop(ownC(log), before);
  });

  test("shows the pill for a manual backlog page that lands entirely before own C", async ({ page, request }) => {
    const room = await roomWithMessages(request, 3);
    const log = await openPollingRoom(page, room);
    await postMessages(request, room.id, 105, { prefix: "backlog" });
    await send(page, "ann", OWN_C); // displayed last, ahead of the bookmark
    await pollNow(page, room.id);
    await expect(page.getByText("More messages are available")).toBeVisible();
    await expect(rows(log)).toHaveCount(104); // 3 + own C + the first 100 of the backlog
    await expect(rows(log).last()).toContainText("own C line 01");
    await scrollUpInsideOwnC(log);
    const before = await topOf(ownC(log));

    await page.getByRole("button", { name: "Load more messages" }).click();

    // First and last ids are unchanged: only the full id comparison sees these five rows.
    await expect(rows(log)).toHaveCount(109);
    await expect(rows(log).last()).toContainText("own C line 01");
    await expect(pill(page)).toBeVisible();
    await expectSameTop(ownC(log), before);
  });
});

test("9. rows added above and below in one commit keep the visible row in place", async ({ page }) => {
  await page.goto("/e2e/message-list");
  const log = page.getByRole("log");
  await expect(rows(log)).toHaveCount(30);
  await row(log, "fixture message 25").scrollIntoViewIfNeeded();
  await scrollListTo(log, (await scrollTopOf(log)) - 30);
  const anchor = row(log, "fixture message 25");
  await expect(anchor).toBeInViewport();
  const before = await topOf(anchor);

  await page.getByRole("button", { name: "Add rows above and below" }).click();

  await expect(rows(log)).toHaveCount(50);
  await expectSameTop(anchor, before);
  await expect(pill(page)).toBeVisible();
});

test.describe("10. bounded compose layout", () => {
  // 120 lines of 24 characters and 119 newlines: 2999 code points.
  const LONG_DRAFT = Array.from(
    { length: 120 },
    (_, index) => `line ${String(index + 1).padStart(3, "0")} of a long draft`,
  ).join("\n");

  async function expectBoundedLayout(page: Page) {
    const viewport = page.viewportSize()!;
    const textarea = page.getByLabel("Message");
    const scrolls = await textarea.evaluate((el) => el.scrollHeight > el.clientHeight + 1);
    expect(scrolls, "the textarea scrolls inside itself").toBe(true);
    expect((await textarea.boundingBox())!.height).toBeLessThanOrEqual(72);

    for (const control of [
      page.getByRole("button", { name: "Send" }),
      // exact: a random room name occasionally starts with "close" (e.g. "closed-gray-gibbon"),
      // whose pin is also a role=button and would otherwise match this substring search.
      page.getByRole("button", { name: "Close", exact: true }),
      page.getByLabel("Display name"),
    ]) {
      const box = (await control.boundingBox())!;
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    }

    const list = (await page.getByRole("log").boundingBox())!;
    expect(list.height).toBeGreaterThanOrEqual(96);
    const pageScrolls = await page.evaluate(
      () => document.documentElement.scrollHeight > window.innerHeight || document.body.scrollHeight > window.innerHeight,
    );
    expect(pageScrolls, "the page has no scrollbar").toBe(false);
  }

  test("a long many-line draft stays inside the panel and can be sent", async ({ page, request }) => {
    expect([...LONG_DRAFT]).toHaveLength(2999);
    const room = await roomWithMessages(request, 30);
    const log = await openRoom(page, room);

    await fillCompose(page, "ann", LONG_DRAFT);
    await expectBoundedLayout(page);

    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByLabel("Message")).toHaveValue("");
    await expect(rows(log)).toHaveCount(31);
    const sentText = await rows(log).last().getByRole("paragraph").nth(1).innerText();
    expect(sentText).toBe(LONG_DRAFT);
  });

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
});
