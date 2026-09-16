import { type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { insertMessageSeries, insertRoom } from "./fixtures";
import { connect, createApiClient, resolveSupabaseApi, truncateAll, type Sql } from "./helpers";

let sql: Sql;
let service: SupabaseClient;
let anon: SupabaseClient;

beforeAll(() => {
  sql = connect();
  const { apiUrl, anonKey, serviceRoleKey } = resolveSupabaseApi();
  service = createApiClient(apiUrl, serviceRoleKey);
  anon = createApiClient(apiUrl, anonKey);
});

afterAll(async () => {
  await sql.end();
});

beforeEach(async () => {
  await truncateAll(sql);
});

const NIL_UUID = "00000000-0000-0000-0000-000000000000";

interface RpcRow {
  id: string;
  chatroom_id: string;
  author: string;
  text: string;
  created_at: string;
}

function call(client: SupabaseClient, args: { p_room: string; p_mode: string; p_cursor: string | null; p_limit: number }) {
  return client.rpc("list_messages", args).abortSignal(AbortSignal.timeout(10_000));
}

// The contract the repository (src/lib/db/messages.ts) relies on: the SQLSTATE
// raised in the function arrives unchanged as error.code, and PostgREST maps
// PTxyz to HTTP xyz.
describe("list_messages: RPC contract", () => {
  it("returns rows newest first with created_at as an ISO string", async () => {
    const roomId = await insertRoom(sql, "room");
    const series = await insertMessageSeries(sql, roomId, 3);

    const { data, error, status } = await call(service, {
      p_room: roomId,
      p_mode: "initial",
      p_cursor: null,
      p_limit: 10,
    });

    expect(error).toBeNull();
    expect(status).toBe(200);
    const rows = data as RpcRow[];
    expect(rows.map((row) => row.id)).toEqual([series[2].id, series[1].id, series[0].id]);
    expect(rows[0]).toMatchObject({ chatroom_id: roomId, author: "ann", text: "m3" });
    expect(new Date(rows[0].created_at).toISOString()).toBe(series[2].created_at.toISOString());
  });

  it("answers 404 with code PT404 for an unknown room", async () => {
    const { data, error, status } = await call(service, {
      p_room: NIL_UUID,
      p_mode: "initial",
      p_cursor: null,
      p_limit: 10,
    });

    expect(data).toBeNull();
    expect(status).toBe(404);
    expect(error).toMatchObject({ code: "PT404", message: "room not found" });
  });

  it("answers 400 with code PT400 for a cursor from another room", async () => {
    const roomId = await insertRoom(sql, "room");
    await insertMessageSeries(sql, roomId, 1);
    const otherId = await insertRoom(sql, "other");
    const [foreign] = await insertMessageSeries(sql, otherId, 1);

    const { data, error, status } = await call(service, {
      p_room: roomId,
      p_mode: "after",
      p_cursor: foreign.id,
      p_limit: 10,
    });

    expect(data).toBeNull();
    expect(status).toBe(400);
    expect(error).toMatchObject({ code: "PT400", message: "cursor not found in room" });
  });

  it("refuses the anon key with code 42501", async () => {
    const roomId = await insertRoom(sql, "room");
    await insertMessageSeries(sql, roomId, 1);

    const { data, error, status } = await call(anon, {
      p_room: roomId,
      p_mode: "initial",
      p_cursor: null,
      p_limit: 10,
    });

    expect(data).toBeNull();
    expect([401, 403]).toContain(status);
    expect(error).toMatchObject({ code: "42501" });
  });
});
