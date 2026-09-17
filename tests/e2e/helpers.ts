import { setTimeout as nodeDelay } from "node:timers/promises";
import { expect, type APIRequestContext, type Locator, type Page } from "@playwright/test";

import { ROOM_REGION } from "../../src/app/e2e/roomRegion";

/**
 * Rooms are created inside this box. All four corners are inside the opening
 * map view (centre 46.7712, 23.6236, zoom 2) at 1280 × 720, away from the edges.
 * Recheck the corners if the map's centre, zoom or the test viewport changes.
 */
export { ROOM_REGION };

export type Room = { id: string; name: string; lat: number; lng: number; createdAt: string };
export type Message = { id: string; chatroomId: string; author: string; text: string; createdAt: string };

export const POLL_INTERVAL_MS = 30_000;

// ROOM_REGION is shared with the dev-only bounds fixture (created in Step 5a).

const round6 = (x: number) => Math.round(x * 1e6) / 1e6;
const between = (min: number, max: number) => round6(min + Math.random() * (max - min));

/**
 * A fresh room through the real API. A coordinate conflict (409) picks new
 * coordinates, at most five times; any other failure is not retried, because
 * the write may have happened.
 */
export async function createRoom(
  request: APIRequestContext,
  first: { author: string; text: string } = { author: "e2e", text: "message 1" },
): Promise<{ room: Room; message: Message }> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await request.post("/api/rooms", {
      data: {
        lat: between(ROOM_REGION.minLat, ROOM_REGION.maxLat),
        lng: between(ROOM_REGION.minLng, ROOM_REGION.maxLng),
        ...first,
      },
    });
    if (response.status() === 409) continue;
    expect(response.status(), await response.text()).toBe(201);
    return (await response.json()) as { room: Room; message: Message };
  }
  throw new Error("createRoom: five coordinate conflicts in a row");
}

export async function postMessage(
  request: APIRequestContext,
  roomId: string,
  input: { author: string; text: string },
): Promise<Message> {
  const response = await request.post(`/api/rooms/${roomId}/messages`, { data: input });
  expect(response.status(), await response.text()).toBe(201);
  return ((await response.json()) as { message: Message }).message;
}

/** Posts one at a time, so `createdAt` order is the post order. Texts: `<prefix> <n>`. */
export async function postMessages(
  request: APIRequestContext,
  roomId: string,
  count: number,
  opts: { prefix?: string; from?: number } = {},
): Promise<Message[]> {
  const { prefix = "message", from = 1 } = opts;
  const posted: Message[] = [];
  for (let n = from; n < from + count; n += 1) {
    posted.push(await postMessage(request, roomId, { author: "e2e", text: `${prefix} ${n}` }));
  }
  return posted;
}

/** A room holding `total` messages: "message 1" (the first message) to "message <total>". */
export async function roomWithMessages(request: APIRequestContext, total: number): Promise<Room> {
  const { room } = await createRoom(request);
  await postMessages(request, room.id, total - 1, { from: 2 });
  return room;
}

/**
 * Opens a room from its pin. The marker is focused and activated with Enter
 * (map-shell design §7), so overlapping pins at world zoom cannot steal a click.
 */
export async function openRoom(page: Page, room: Room): Promise<Locator> {
  await page.goto("/");
  const marker = page.getByTitle(room.name, { exact: true });
  await marker.waitFor();
  await marker.focus();
  await page.keyboard.press("Enter");
  const log = page.getByRole("log");
  await expect(log).toBeVisible();
  return log;
}

type CatchUpProbe = { started: number; settled: number };
declare global {
  interface Window { __roomCatchUpProbe: CatchUpProbe }
}

/**
 * Installs observation only: original fetch, status, body and failures pass through.
 * The task after JSON consumption lets the API/store promise continuations drain.
 * MessageChannel is deliberately independent of the paused timer/RAF clock.
 */
async function observeCatchUps(page: Page, roomId: string) {
  await page.addInitScript((id) => {
    const probe = { started: 0, settled: 0 };
    window.__roomCatchUpProbe = probe;
    const originalFetch = window.fetch.bind(window);
    const markSettled = () => {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => {
        probe.settled += 1;
        channel.port1.close();
        channel.port2.close();
      };
      channel.port2.postMessage(null);
    };
    window.fetch = async (...args: Parameters<typeof fetch>) => {
      const input = args[0];
      const url = new URL(input instanceof Request ? input.url : String(input), location.href);
      const method = args[1]?.method ?? (input instanceof Request ? input.method : "GET");
      const watched = method.toUpperCase() === "GET" &&
        url.pathname === `/api/rooms/${id}/messages` && url.searchParams.has("after");
      if (!watched) return originalFetch(...args);
      probe.started += 1; // before the real request: even a slow response cannot hide a tick
      try {
        const response = await originalFetch(...args);
        const originalJson = response.json.bind(response);
        response.json = async () => {
          try { return await originalJson(); }
          finally { markSettled(); }
        };
        return response;
      } catch (error) {
        markSettled();
        throw error;
      }
    };
  }, roomId);
}

const probeOf = (page: Page) => page.evaluate(() => ({ ...window.__roomCatchUpProbe }));

async function waitForCatchUpIdle(page: Page, minimum: number) {
  await expect.poll(async () => {
    const probe = await probeOf(page);
    return probe.settled >= minimum && probe.started === probe.settled;
  }).toBe(true);
}

/** Opens and settles the startup catch-up, then freezes time before scenario writes. */
export async function openPollingRoom(page: Page, room: Room): Promise<Locator> {
  await observeCatchUps(page, room.id);
  await page.clock.install();
  const log = await openRoom(page, room);
  await waitForCatchUpIdle(page, 1);
  // A future instant avoids pauseAt rejecting a timestamp already passed during the tool round trip.
  // If this crosses a tick, settle that request too, while no scenario writes exist yet.
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  await waitForCatchUpIdle(page, 1);
  await page.clock.runFor(32); // render/ResizeObserver frames, not a network-completion sleep
  await waitForCatchUpIdle(page, 1);
  if (process.env.E2E_SLOW_SETUP === "1") {
    const before = await probeOf(page);
    const at = await page.evaluate(() => Date.now());
    await nodeDelay(POLL_INTERVAL_MS + 1000); // deliberate adverse setup, runner time only
    expect(await page.evaluate(() => Date.now())).toBe(at);
    expect(await probeOf(page)).toEqual(before);
  }
  return log;
}

/** One deliberate tick; wait for real JSON consumption before checking the rendered result. */
export async function pollNow(page: Page): Promise<void> {
  const before = await probeOf(page);
  expect(before.started).toBe(before.settled);
  await page.clock.fastForward(POLL_INTERVAL_MS);
  await waitForCatchUpIdle(page, before.started + 1);
  await page.clock.runFor(32);
}

/** No request may even start while backlog owns the cursor. */
export async function expectNoCatchUp(page: Page): Promise<void> {
  const before = await probeOf(page);
  expect(before.started).toBe(before.settled);
  await page.clock.fastForward(POLL_INTERVAL_MS);
  await page.clock.runFor(32);
  expect(await probeOf(page)).toEqual(before);
}

export const rows = (log: Locator) => log.getByRole("article");

/** Pixels between the list's scroll position and its bottom. */
export const distanceFromBottom = (log: Locator) =>
  log.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight);

export const scrollTopOf = (log: Locator) => log.evaluate((el) => el.scrollTop);

export async function scrollListTo(log: Locator, top: number): Promise<void> {
  await log.evaluate((el, value) => {
    el.scrollTop = value;
  }, top);
}

/** The row's top edge in page coordinates. */
export async function topOf(row: Locator): Promise<number> {
  const box = await row.boundingBox();
  if (box === null) throw new Error("row is not rendered");
  return box.y;
}

export const pill = (page: Page) => page.getByRole("button", { name: "New messages" });

export async function fillCompose(page: Page, author: string, text: string): Promise<void> {
  await page.getByLabel("Display name").fill(author);
  await page.getByLabel("Message").fill(text);
}
