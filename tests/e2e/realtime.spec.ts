import { expect, test, type Locator, type WebSocket } from "@playwright/test";

import {
  connectionOf,
  createRoom,
  fillCompose,
  goIdle,
  openLiveRoom,
  openPollingRoom,
  pollNow,
  postMessage,
  rows,
  roomWithMessages,
  scrollTopOf,
  settledCatchUps,
  waitForCatchUpIdle,
} from "./helpers";

const row = (log: Locator, text: string) =>
  rows(log).filter({ has: log.page().getByText(text, { exact: true }) });

test("1. a message from someone else arrives over the websocket, without a request", async ({ page, request }) => {
  const { room } = await createRoom(request);
  const log = await openLiveRoom(page, room);
  const before = await settledCatchUps(page, room.id);

  await postMessage(request, room.id, { author: "bob", text: "live from bob" });

  // The clock is paused: no poll can run, so only the websocket can deliver this row.
  await expect(row(log, "live from bob")).toHaveCount(1);
  expect(await settledCatchUps(page, room.id)).toBe(before);
  await expect(connectionOf(page)).toHaveAttribute("data-connection", "realtime");
});

test("2. an own message sent while live appears once", async ({ page, request }) => {
  const { room } = await createRoom(request);
  const log = await openLiveRoom(page, room);

  await fillCompose(page, "ann", "sent while live");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByLabel("Message")).toHaveValue("");
  // A later live row proves the echo of the own insert had its chance to arrive.
  await postMessage(request, room.id, { author: "bob", text: "after the send" });
  await expect(row(log, "after the send")).toHaveCount(1);

  await expect(row(log, "sent while live")).toHaveCount(1);
  await expect(rows(log)).toHaveCount(3);
});

test("3. idle leaves realtime and polls at once; a send rejoins", async ({ page, request }) => {
  const { room } = await createRoom(request);
  const log = await openLiveRoom(page, room);

  await goIdle(page, room.id); // asserts "polling" and one immediate catch-up

  // Polling delivers now, and only on a tick: the clock is paused, so nothing can fetch this row yet.
  await postMessage(request, room.id, { author: "bob", text: "while idle" });
  await page.clock.runFor(32);
  await expect(row(log, "while idle")).toHaveCount(0);
  await pollNow(page, room.id);
  await expect(row(log, "while idle")).toHaveCount(1);
  await expect(connectionOf(page)).toHaveAttribute("data-connection", "polling"); // polling never rejoins by itself

  const beforeSend = await settledCatchUps(page, room.id);
  await fillCompose(page, "ann", "back again");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(connectionOf(page)).toHaveAttribute("data-connection", "realtime");
  await expect(row(log, "back again")).toHaveCount(1);

  // Live again: settle the confirmation catch-up, then a row arrives with no request.
  await waitForCatchUpIdle(page, room.id, beforeSend + 1);
  const before = await settledCatchUps(page, room.id);
  await postMessage(request, room.id, { author: "bob", text: "live again" });
  await expect(row(log, "live again")).toHaveCount(1);
  expect(await settledCatchUps(page, room.id)).toBe(before);
});

test("4. a refused websocket means polling from the start", async ({ page, request }) => {
  const { room } = await createRoom(request);

  const log = await openPollingRoom(page, room); // refuses realtime; asserts "polling"

  await postMessage(request, room.id, { author: "bob", text: "by poll" });
  await pollNow(page, room.id);
  await expect(row(log, "by poll")).toHaveCount(1);
});

test("5. incoming automatic scrolling cannot postpone user idle", async ({ page, request }) => {
  const room = await roomWithMessages(request, 30);
  const log = await openLiveRoom(page, room);
  expect(await log.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  let previousTop = await scrollTopOf(log);
  for (let n = 1; n <= 2; n += 1) {
    await page.clock.fastForward(60_000);
    await postMessage(request, room.id, { author: "bob", text: `automatic follow ${n}` });
    await expect(row(log, `automatic follow ${n}`)).toHaveCount(1);
    await page.clock.runFor(32); // deliver positioning/scroll frames under the paused clock
    const top = await scrollTopOf(log);
    expect(top).toBeGreaterThan(previousTop); // this is actual automatic scrolling
    previousTop = top;
  }
  const before = await settledCatchUps(page, room.id);
  await page.clock.fastForward(60_000); // 180 seconds without user input, despite incoming rows
  await expect(connectionOf(page)).toHaveAttribute("data-connection", "polling");
  await waitForCatchUpIdle(page, room.id, before + 1);
});

test("6. reader scrolling postpones idle, then inactivity still leaves", async ({ page, request }) => {
  const room = await roomWithMessages(request, 30);
  const log = await openLiveRoom(page, room);
  await page.clock.fastForward(120_000);
  const previousTop = await scrollTopOf(log);
  await log.hover();
  await page.mouse.wheel(0, -250); // real browser input, not assigning scrollTop
  await page.clock.runFor(64);
  await expect.poll(() => scrollTopOf(log)).toBeLessThan(previousTop);
  await page.clock.fastForward(60_000); // past the original deadline
  await expect(connectionOf(page)).toHaveAttribute("data-connection", "realtime");
  await goIdle(page, room.id); // no more input: the restarted timeout still expires
});

test("7. a send after the websocket has closed rejoins over a new connection", async ({ page, request }) => {
  const { room } = await createRoom(request);
  const sockets: WebSocket[] = [];
  page.on("websocket", (ws) => {
    if (ws.url().includes("/realtime/v1/websocket")) sockets.push(ws);
  });
  const log = await openLiveRoom(page, room);
  expect(sockets).toHaveLength(1);
  const first = sockets[0];
  expect(first.isClosed()).toBe(false);

  await goIdle(page, room.id); // asserts "polling" and one immediate catch-up
  expect(first.isClosed()).toBe(false); // the SDK defers the disconnect after the last channel leaves

  // Past supabase-js's deferred disconnect (2 × 25 s heartbeat after the channel left).
  const beforeClose = await settledCatchUps(page, room.id);
  const closed = first.isClosed() ? Promise.resolve() : first.waitForEvent("close");
  await page.clock.fastForward(55_000);
  await closed;
  expect(first.isClosed()).toBe(true);
  expect(sockets).toHaveLength(1); // a client-side disconnect: nothing reconnects by itself
  await waitForCatchUpIdle(page, room.id, beforeClose + 1); // the jump crossed one poll tick
  await page.clock.runFor(32);
  await expect(connectionOf(page)).toHaveAttribute("data-connection", "polling");

  const beforeSend = await settledCatchUps(page, room.id);
  await fillCompose(page, "ann", "after the close");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(connectionOf(page)).toHaveAttribute("data-connection", "realtime");
  await expect(row(log, "after the close")).toHaveCount(1);
  expect(sockets).toHaveLength(2);
  expect(sockets[1].isClosed()).toBe(false);

  // Live over the new socket: settle the confirmation catch-up, then a row arrives with no request.
  await waitForCatchUpIdle(page, room.id, beforeSend + 1);
  const before = await settledCatchUps(page, room.id);
  await postMessage(request, room.id, { author: "bob", text: "live after the close" });
  await expect(row(log, "live after the close")).toHaveCount(1);
  expect(await settledCatchUps(page, room.id)).toBe(before);
});
