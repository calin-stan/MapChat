import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";

import type { MessagePage } from "@/lib/schemas/types";
import { compareCreatedAtId } from "@/lib/time/ordering";

import { insertMessageSeries, insertRoom } from "../db/fixtures";
import { apiRequest, connect, routeParams, truncateAll, type Sql } from "./helpers";

vi.mock("server-only", () => ({}));

let sql: Sql;
beforeAll(() => { sql = connect(); });
afterAll(async () => { await sql.end(); });
beforeEach(async () => {
  vi.resetModules();
  await truncateAll(sql);
});
afterEach(() => { vi.unstubAllEnvs(); });

async function reader(initial: number, page: number) {
  vi.stubEnv("HISTORY_INITIAL_SIZE", String(initial));
  vi.stubEnv("HISTORY_PAGE_SIZE", String(page));
  const { GET } = await import("@/app/api/rooms/[id]/messages/route");
  return async (roomId: string, before?: string): Promise<MessagePage> => {
    const query = before === undefined ? "" : `?before=${before}`;
    const response = await GET(apiRequest(`/api/rooms/${roomId}/messages${query}`), routeParams(roomId));
    expect(response.status).toBe(200);
    return (await response.json()) as MessagePage;
  };
}

it("keeps the sentinel at size 999 for both initial and before pages", async () => {
  const roomId = await insertRoom(sql, "cap-boundary");
  const series = await insertMessageSeries(sql, roomId, 1001);
  const get = await reader(999, 999);

  const initial = await get(roomId);
  expect(initial.messages).toHaveLength(999);
  expect(initial.messages[0].id).toBe(series[2].id);
  expect(initial.hasMore).toBe(true);

  // 1000 older rows match: 999 returned plus the sentinel at the API cap.
  const older = await get(roomId, series[1000].id);
  expect(older.messages).toHaveLength(999);
  expect(older.messages[0].id).toBe(series[1].id);
  expect(older.hasMore).toBe(true);
  const last = await get(roomId, older.messages[0].id);
  expect(last.messages.map((m) => m.id)).toEqual([series[0].id]);
  expect(last.hasMore).toBe(false);
});

it("advances older history when microsecond ordering opposes UUID ordering", async () => {
  const roomId = await insertRoom(sql, "microseconds");
  const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const fixtures = [
    { id: uuid(4), text: "X", at: "2026-09-16T10:00:00.122900Z" },
    { id: uuid(3), text: "A", at: "2026-09-16T10:00:00.123100Z" },
    { id: uuid(1), text: "B", at: "2026-09-16T10:00:00.123200Z" },
    { id: uuid(2), text: "C", at: "2026-09-16T10:00:00.123300Z" },
  ];
  for (const row of fixtures) {
    // Explicit ids, so insertMessageAt can't be used; see its microsecond-bind comment in tests/db/fixtures.ts.
    await sql`insert into public.messages (id, chatroom_id, author, text, created_at)
      values (${row.id}::uuid, ${roomId}::uuid, 'ann', ${row.text}, ${sql.typed(row.at, 25)}::timestamptz)`;
  }
  const get = await reader(3, 1); // Valid nondefault sizes also exercise route configuration.
  const initial = await get(roomId);
  expect(initial.hasMore).toBe(true);
  const displayed = [...initial.messages].sort(compareCreatedAtId);
  expect(displayed.map((m) => m.text)).toEqual(["A", "B", "C"]);
  expect(displayed.map((m) => m.createdAt)).toEqual(fixtures.slice(1).map((m) => m.at));

  // Capture the SQL boundary before merging, independently of display state.
  const olderCursor = initial.messages[0].id;
  expect(displayed[0].id).toBe(olderCursor);
  const older = await get(roomId, olderCursor);
  expect(older.messages.map((m) => m.text)).toEqual(["X"]);
  expect(older.hasMore).toBe(false);
  expect([...older.messages, ...displayed].sort(compareCreatedAtId).map((m) => m.text))
    .toEqual(["X", "A", "B", "C"]);
});
