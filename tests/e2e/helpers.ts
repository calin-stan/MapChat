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
  interface Window { __roomCatchUpProbe: Record<string, CatchUpProbe> }
}

/**
 * Installs observation only: original fetch, status, body and failures pass through.
 * The task after JSON consumption lets the API/store promise continuations drain.
 * MessageChannel is deliberately independent of the paused timer/RAF clock.
 * Keyed by room id (read from the URL, not passed in), so this can be armed before
 * navigation even when the room doesn't exist yet (new-room design §10 scenario 1):
 * every room's catch-up is tracked, and callers name the one they care about.
 */
export async function observeCatchUps(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const probes: Record<string, { started: number; settled: number }> = {};
    window.__roomCatchUpProbe = probes;
    const entryFor = (id: string) => (probes[id] ??= { started: 0, settled: 0 });
    const originalFetch = window.fetch.bind(window);
    const markSettled = (id: string) => {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => {
        entryFor(id).settled += 1;
        channel.port1.close();
        channel.port2.close();
      };
      channel.port2.postMessage(null);
    };
    window.fetch = async (...args: Parameters<typeof fetch>) => {
      const input = args[0];
      const url = new URL(input instanceof Request ? input.url : String(input), location.href);
      const method = args[1]?.method ?? (input instanceof Request ? input.method : "GET");
      const match = /^\/api\/rooms\/([^/]+)\/messages$/.exec(url.pathname);
      const watched = method.toUpperCase() === "GET" && match !== null && url.searchParams.has("after");
      if (!watched) return originalFetch(...args);
      const id = match[1];
      entryFor(id).started += 1; // before the real request: even a slow response cannot hide a tick
      try {
        const response = await originalFetch(...args);
        const originalJson = response.json.bind(response);
        response.json = async () => {
          try { return await originalJson(); }
          finally { markSettled(id); }
        };
        return response;
      } catch (error) {
        markSettled(id);
        throw error;
      }
    };
  });
}

const probeOf = (page: Page, roomId: string): Promise<CatchUpProbe> =>
  page.evaluate((id) => ({ ...(window.__roomCatchUpProbe[id] ?? { started: 0, settled: 0 }) }), roomId);

/** Waits until this room's catch-up has actually settled in the page, not merely started. */
export async function waitForCatchUpIdle(page: Page, roomId: string, minimum: number): Promise<void> {
  await expect.poll(async () => {
    const probe = await probeOf(page, roomId);
    return probe.settled >= minimum && probe.started === probe.settled;
  }).toBe(true);
}

/** Opens and settles the startup catch-up, then freezes time before scenario writes. */
export async function openPollingRoom(page: Page, room: Room): Promise<Locator> {
  await observeCatchUps(page);
  await page.clock.install();
  const log = await openRoom(page, room);
  await waitForCatchUpIdle(page, room.id, 1);
  // A future instant avoids pauseAt rejecting a timestamp already passed during the tool round trip.
  // If this crosses a tick, settle that request too, while no scenario writes exist yet.
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  await waitForCatchUpIdle(page, room.id, 1);
  await page.clock.runFor(32); // render/ResizeObserver frames, not a network-completion sleep
  await waitForCatchUpIdle(page, room.id, 1);
  if (process.env.E2E_SLOW_SETUP === "1") {
    const before = await probeOf(page, room.id);
    const at = await page.evaluate(() => Date.now());
    await nodeDelay(POLL_INTERVAL_MS + 1000); // deliberate adverse setup, runner time only
    expect(await page.evaluate(() => Date.now())).toBe(at);
    expect(await probeOf(page, room.id)).toEqual(before);
  }
  return log;
}

/** One deliberate tick; wait for real JSON consumption before checking the rendered result. */
export async function pollNow(page: Page, roomId: string): Promise<void> {
  const before = await probeOf(page, roomId);
  expect(before.started).toBe(before.settled);
  await page.clock.fastForward(POLL_INTERVAL_MS);
  await waitForCatchUpIdle(page, roomId, before.started + 1);
  await page.clock.runFor(32);
}

/** No request may even start while backlog owns the cursor. */
export async function expectNoCatchUp(page: Page, roomId: string): Promise<void> {
  const before = await probeOf(page, roomId);
  expect(before.started).toBe(before.settled);
  await page.clock.fastForward(POLL_INTERVAL_MS);
  await page.clock.runFor(32);
  expect(await probeOf(page, roomId)).toEqual(before);
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
  // exact: an accumulated room's random name occasionally contains "close" (e.g.
  // "closed-gray-gibbon"), whose pin is also a role=button and would otherwise
  // match this substring search while its own panel is open underneath.
  const close = page.getByRole("button", { name: "Close", exact: true });

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
