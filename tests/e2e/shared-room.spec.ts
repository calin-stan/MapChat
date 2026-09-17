import { expect, test, type Page } from "@playwright/test";

import { clickEmptySpot, createRoom, fillCompose, rows, type Room } from "./helpers";

const GREETING = "Click on the map to start a chat";
const NOT_FOUND_TEXT = "This chatroom or page doesn't exist. It may have been removed.";
const NIL_UUID = "00000000-0000-4000-8000-000000000000";

const pathOf = (page: Page) => new URL(page.url()).pathname;
const roomPath = (room: Room) => `/room/${room.id}`;
/** The panel title. A pin carries the name in its `title` attribute, which `getByText` never matches. */
const panelTitle = (page: Page, room: Room) => page.getByText(room.name, { exact: true });
// exact: a pin is a role=button named after its room, and a random name can contain "close".
const closeButton = (page: Page) => page.getByRole("button", { name: "Close", exact: true });

/** Arm after initial navigation: neither selection direction may request a page. */
function watchSelectionPageRequests(page: Page, room: Room) {
  const seen: string[] = [];
  const onRequest = (request: import("@playwright/test").Request) => {
    const path = new URL(request.url()).pathname;
    if (path === "/" || path === roomPath(room)) seen.push(request.url());
  };
  page.on("request", onRequest);
  return { seen, stop: () => page.off("request", onRequest) };
}

/** Compare the marker tip: selected/unselected icons have different dimensions. */
async function pinTip(page: Page, room: Room) {
  const box = await page.getByTitle(room.name, { exact: true }).boundingBox();
  if (box === null) throw new Error("room pin is not visible");
  return { x: box.x + box.width / 2, y: box.y + box.height };
}

/** Opens a room from its pin on the page that is already loaded (map-shell design §7: Enter on the focused marker). */
async function openFromPin(page: Page, room: Room) {
  const marker = page.getByTitle(room.name, { exact: true });
  await marker.waitFor();
  await marker.focus();
  await page.keyboard.press("Enter");
}

test("1. a shared URL opens the map on the room with its panel open", async ({ page, request }) => {
  const { room } = await createRoom(request, { author: "ana", text: "hello from the shared room" });
  const pinsRequest = page.waitForRequest(
    (candidate) => candidate.method() === "GET" && new URL(candidate.url()).pathname === "/api/rooms",
  );

  const response = await page.goto(roomPath(room));

  expect(response?.status()).toBe(200);
  await expect(panelTitle(page, room)).toBeVisible();
  await expect(rows(page.getByRole("log"))).toHaveText([/hello from the shared room/]);
  expect(pathOf(page)).toBe(roomPath(room));

  // The selected pin (28 × 42, anchored at its tip) stands on the centre of the 1280 × 720 map.
  const pin = await page.getByTitle(room.name, { exact: true }).boundingBox();
  if (pin === null) throw new Error("the room's pin is not rendered");
  expect(Math.abs(pin.x + pin.width / 2 - 640)).toBeLessThanOrEqual(2);
  expect(Math.abs(pin.y + pin.height - 360)).toBeLessThanOrEqual(2);

  // Room zoom, not the world view: the first pins request asks for a small box around the room.
  const bbox = new URL((await pinsRequest).url()).searchParams.get("bbox");
  const [minLng, minLat, maxLng, maxLat] = (bbox ?? "").split(",").map(Number);
  expect(maxLng - minLng).toBeLessThan(0.1);
  expect(maxLat - minLat).toBeLessThan(0.1);
  expect(Math.abs((minLng + maxLng) / 2 - room.lng)).toBeLessThan(0.001);
  expect(Math.abs((minLat + maxLat) / 2 - room.lat)).toBeLessThan(0.001);
});

for (const entry of ["map", "shared URL"] as const) {
  test(`2. selection preserves the map without navigation, entering from ${entry}`, async ({ page, request }) => {
    const { room } = await createRoom(request);
    const firstPins = page.waitForResponse(
      (response) => response.request().method() === "GET" && new URL(response.url()).pathname === "/api/rooms",
    );
    await page.goto(entry === "map" ? "/" : roomPath(room));
    await firstPins;
    await expect(page.getByTitle(room.name, { exact: true })).toBeVisible();
    if (entry === "shared URL") await expect(rows(page.getByRole("log"))).toHaveCount(1);

    // A map-owned DOM node detects remounts even during cached client transitions.
    // Use its public accessible control, with no test id or Leaflet private API.
    const zoomButton = page.getByRole("button", { name: "Zoom in", exact: true });
    const originalControl = await zoomButton.elementHandle();
    if (originalControl === null) throw new Error("map control is missing");
    const zoomedPins = page.waitForResponse(
      (response) => response.request().method() === "GET" && new URL(response.url()).pathname === "/api/rooms",
    );
    await zoomButton.click(); // make a remount's initial viewport observably different
    await zoomedPins; // requested after Leaflet's moveend
    const tip = await pinTip(page, room);
    const entries = await page.evaluate(() => window.history.length);
    const pageRequests = watchSelectionPageRequests(page, room);

    const expectSameMap = async () => {
      // Let committed layout/effects paint before checking the retained element.
      await page.evaluate(() => new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }));
      expect(await originalControl.evaluate((element) => element.isConnected)).toBe(true);
      const currentControl = await zoomButton.elementHandle();
      if (currentControl === null) throw new Error("map control disappeared");
      try {
        expect(await originalControl.evaluate((element, current) => element === current, currentControl)).toBe(true);
      } finally {
        await currentControl.dispose();
      }
      const currentTip = await pinTip(page, room);
      expect(Math.abs(currentTip.x - tip.x)).toBeLessThanOrEqual(2);
      expect(Math.abs(currentTip.y - tip.y)).toBeLessThanOrEqual(2);
      expect(await page.evaluate(() => window.history.length)).toBe(entries);
      expect(pageRequests.seen).toHaveLength(0); // covers both / and /room/<id>, including RSC
    };

    try {
      if (entry === "shared URL") {
        await closeButton(page).click();
        await expect(page.getByText(GREETING)).toBeVisible();
        expect(pathOf(page)).toBe("/");
        await expectSameMap();
      }

      await openFromPin(page, room);
      await expect(page).toHaveURL(new RegExp(`${roomPath(room)}$`));
      await expect(rows(page.getByRole("log"))).toHaveCount(1);
      await expectSameMap();

      await closeButton(page).click();
      await expect(page.getByText(GREETING)).toBeVisible();
      expect(pathOf(page)).toBe("/");
      await expectSameMap();
    } finally {
      pageRequests.stop();
      await originalControl.dispose();
    }

    // Only after observation stops: prove that the shared address is a real page.
    await page.goto(roomPath(room));
    await expect(panelTitle(page, room)).toBeVisible();
    await expect(rows(page.getByRole("log"))).toHaveCount(1);
  });
}

test("3. a reload keeps the open room", async ({ page, request }) => {
  const { room } = await createRoom(request);
  await page.goto("/");
  await openFromPin(page, room);
  await expect(page).toHaveURL(new RegExp(`${roomPath(room)}$`));

  await page.reload();

  await expect(panelTitle(page, room)).toBeVisible();
  await expect(rows(page.getByRole("log"))).toHaveCount(1);
  expect(pathOf(page)).toBe(roomPath(room));
});

test("4. a room created here gets its address at once", async ({ page }) => {
  await page.goto("/");
  await clickEmptySpot(page);
  await fillCompose(page, "ana", `shareable ${Date.now()}`);
  const answered = page.waitForResponse(
    (candidate) => candidate.request().method() === "POST" && new URL(candidate.url()).pathname === "/api/rooms",
  );

  await page.getByRole("button", { name: "Create" }).click();

  const { room } = (await (await answered).json()) as { room: Room };
  await expect(panelTitle(page, room)).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`${roomPath(room)}$`));
});

test.describe("5. an address that names no room", () => {
  for (const [label, id] of [
    ["an unknown id", NIL_UUID],
    ["a malformed id", "not-a-uuid"],
  ] as const) {
    test(`answers 404 for ${label} and offers the map`, async ({ page }) => {
      const response = await page.goto(`/room/${id}`);

      expect(response?.status()).toBe(404);
      await expect(page.getByText(NOT_FOUND_TEXT)).toBeVisible();

      await page.getByRole("link", { name: "Open the map" }).click();

      await expect(page.getByText(GREETING)).toBeVisible();
      expect(pathOf(page)).toBe("/");
    });
  }
});

test("6. a room that disappears closes its panel with a notice", async ({ page, request }) => {
  const { room } = await createRoom(request);
  // The API has no delete. This one interception makes the room's messages endpoint answer
  // what the server answers for a removed room; the page itself still loads from the real server.
  await page.route(`**/api/rooms/${room.id}/messages*`, (route) =>
    route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: { code: "not_found" } }) }),
  );

  await page.goto(roomPath(room));

  const notice = page.getByText(`The chatroom ${room.name} no longer exists.`);
  await expect(notice).toBeVisible();
  await expect(page.getByText(GREETING)).toBeVisible();
  await expect(closeButton(page)).toHaveCount(0);
  await expect(page).toHaveURL(/\/$/);
  expect(pathOf(page)).toBe("/");

  await page.getByRole("button", { name: "Dismiss", exact: true }).click();

  await expect(notice).toHaveCount(0);
  await expect(page.getByText(GREETING)).toBeVisible();
});
