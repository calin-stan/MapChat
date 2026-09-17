import { expect, test } from "@playwright/test";

import { ROOM_REGION, createRoom, openRoom, rows } from "./helpers";

const EDGE_MARGIN_PX = 40;

test("the dev server and the local Supabase stack answer", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.status(), await response.text()).toBe(200);
});

test("a room created through the API opens from its pin with the keyboard", async ({ page, request }) => {
  const { room, message } = await createRoom(request, { author: "e2e", text: "harness check" });

  const log = await openRoom(page, room);

  await expect(page.getByText(room.name, { exact: true })).toBeVisible();
  await expect(rows(log)).toHaveCount(1);
  await expect(log.getByText(message.text)).toBeVisible();
});

test("every corner stays inside the opening view even when its pin is omitted by the cap", async ({ page }) => {
  await page.goto("/e2e/map-region");
  const report = page.getByRole("status", { name: "Map bounds" });
  await expect(report).toContainText('"ready":true');
  const measured = JSON.parse(await report.innerText()) as {
    ready: boolean;
    candidateCount: number;
    displayedCount: number;
    cornerPinsIncluded: boolean;
    corners: { lat: number; lng: number; inside: boolean; x: number; y: number }[];
  };
  expect(page.viewportSize()).toEqual({ width: 1280, height: 720 });
  expect(measured.candidateCount).toBe(505); // 501 newer rooms plus four old corners
  expect(measured.displayedCount).toBe(500);
  expect(measured.cornerPinsIncluded).toBe(false);
  expect(measured.corners.map(({ lat, lng }) => ({ lat, lng }))).toEqual(
    [ROOM_REGION.minLat, ROOM_REGION.maxLat].flatMap((lat) =>
      [ROOM_REGION.minLng, ROOM_REGION.maxLng].map((lng) => ({ lat, lng }))),
  );
  for (const corner of measured.corners) {
    expect(corner.inside).toBe(true);
    expect(corner.x).toBeGreaterThan(EDGE_MARGIN_PX);
    expect(corner.y).toBeGreaterThan(EDGE_MARGIN_PX);
    expect(corner.x).toBeLessThan(1280 - EDGE_MARGIN_PX);
    expect(corner.y).toBeLessThan(720 - EDGE_MARGIN_PX);
  }
});
