import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import {
  classifyRoomConflict,
  createRoom,
  RepositoryError,
  ROOMS_BBOX_LIMIT,
} from "@/lib/db/rooms";
import { NameCollision } from "@/lib/names/generate";

const roomRow = {
  id: "62c68de5-4ca1-40d0-b9e1-df45c251ae3f",
  name: "brave-crimson-otter",
  lat: 10.123456,
  lng: 20,
  created_at: "2026-09-16T19:31:44.091331+00:00",
};

const messageRow = {
  id: "263debd5-7a6a-44d3-b9d0-7271248715bd",
  chatroom_id: roomRow.id,
  author: "ann",
  text: "hello",
  created_at: "2026-09-16T19:31:44.091331+00:00",
};

const nameTaken = {
  code: "23505",
  details: "Key (name)=(x) already exists.",
  hint: null,
  message: 'duplicate key value violates unique constraint "chatrooms_name_key"',
};

const spotTaken = {
  code: "23505",
  details: "Key (lat, lng)=(10.123456, 20) already exists.",
  hint: null,
  message: 'duplicate key value violates unique constraint "chatrooms_lat_lng_key"',
};

type RpcAnswer = { data: unknown; error: null } | { data: null; error: typeof nameTaken };
type RpcCall = (fn: string, args: { p_name: string }) => Promise<RpcAnswer>;

/**
 * A fake client: `rpc` answers from the queue in order (the last answer
 * repeats), `from().select().eq().eq().maybeSingle()` answers `byCoords`.
 */
function fakeDb(rpcAnswers: RpcAnswer[], byCoords: unknown = null) {
  let call = 0;
  const rpc = vi.fn<RpcCall>(async () => rpcAnswers[Math.min(call++, rpcAnswers.length - 1)]);
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => ({ data: byCoords, error: null }),
  };
  const from = vi.fn(() => chain);
  return { db: { rpc, from } as unknown as SupabaseClient, rpc, from };
}

const input = { lat: 10.1234564, lng: 20.0000004, author: "ann", text: "hello" };

/** Names "name-1", "name-2", ... in call order. */
function counter(): () => string {
  let n = 0;
  return () => `name-${++n}`;
}

describe("classifyRoomConflict", () => {
  it("recognises the name constraint", () => {
    expect(classifyRoomConflict(nameTaken)).toBe("name");
  });

  it("recognises the coordinate constraint", () => {
    expect(classifyRoomConflict(spotTaken)).toBe("coordinates");
  });

  it("ignores other SQLSTATEs even with a matching message", () => {
    expect(classifyRoomConflict({ ...nameTaken, code: "23514" })).toBeUndefined();
  });

  it("ignores other unique constraints and unexpected message formats", () => {
    expect(
      classifyRoomConflict({
        code: "23505",
        message: 'duplicate key value violates unique constraint "messages_pkey"',
      }),
    ).toBeUndefined();
    expect(
      classifyRoomConflict({ code: "23505", message: "chatrooms_name_key already exists" }),
    ).toBeUndefined();
  });

  it("ignores null and undefined", () => {
    expect(classifyRoomConflict(null)).toBeUndefined();
    expect(classifyRoomConflict(undefined)).toBeUndefined();
  });
});

describe("createRoom", () => {
  it("rounds the coordinates and returns the created room and message", async () => {
    const { db, rpc } = fakeDb([{ data: { room: roomRow, message: messageRow }, error: null }]);

    const result = await createRoom(db, input, { generateName: counter() });

    expect(result).toEqual({
      kind: "created",
      room: {
        id: roomRow.id,
        name: "brave-crimson-otter",
        lat: 10.123456,
        lng: 20,
        createdAt: "2026-09-16T19:31:44.091331Z",
      },
      message: {
        id: messageRow.id,
        chatroomId: roomRow.id,
        author: "ann",
        text: "hello",
        createdAt: "2026-09-16T19:31:44.091331Z",
      },
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("create_room_with_first_message", {
      p_lat: 10.123456,
      p_lng: 20,
      p_name: "name-1",
      p_author: "ann",
      p_text: "hello",
    });
  });

  it("retries with a new name after a name collision", async () => {
    const { db, rpc } = fakeDb([
      { data: null, error: nameTaken },
      { data: null, error: nameTaken },
      { data: { room: roomRow, message: messageRow }, error: null },
    ]);

    const result = await createRoom(db, input, { generateName: counter() });

    expect(result.kind).toBe("created");
    expect(rpc.mock.calls.map(([, args]) => args.p_name)).toEqual([
      "name-1",
      "name-2",
      "name-3",
    ]);
  });

  it("gives up with NameCollision after 1 + 5 + 1 attempts", async () => {
    const { db, rpc, from } = fakeDb([{ data: null, error: nameTaken }]);

    await expect(
      createRoom(db, input, { generateName: counter(), suffix: () => "x7k2" }),
    ).rejects.toBeInstanceOf(NameCollision);
    expect(rpc).toHaveBeenCalledTimes(7);
    expect(rpc.mock.calls[6][1].p_name).toBe("name-7-x7k2");
    expect(from).not.toHaveBeenCalled();
  });

  it("returns the existing room on a coordinate collision, without a name retry", async () => {
    const existing = { ...roomRow, id: "0f6c1d1e-6c2c-4d7e-9a8b-1f2e3d4c5b6a", name: "first" };
    const { db, rpc } = fakeDb([{ data: null, error: spotTaken }], existing);

    const result = await createRoom(db, input, { generateName: counter() });

    expect(result).toEqual({
      kind: "exists",
      room: {
        id: existing.id,
        name: "first",
        lat: 10.123456,
        lng: 20,
        createdAt: "2026-09-16T19:31:44.091331Z",
      },
    });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("fails when the coordinate conflict names a room that cannot be found", async () => {
    const { db } = fakeDb([{ data: null, error: spotTaken }], null);

    await expect(createRoom(db, input, { generateName: counter() })).rejects.toThrow(
      RepositoryError,
    );
  });

  it("wraps other PostgREST errors without retrying", async () => {
    const failure = { ...nameTaken, code: "42501", message: "permission denied for function" };
    const { db, rpc } = fakeDb([{ data: null, error: failure }]);

    const error = await createRoom(db, input, { generateName: counter() }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RepositoryError);
    expect(error).toMatchObject({ code: "42501", message: "createRoom: permission denied for function" });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("rejects an RPC result of the wrong shape", async () => {
    const { db } = fakeDb([{ data: { room: roomRow }, error: null }]);

    await expect(createRoom(db, input, { generateName: counter() })).rejects.toThrow(
      /^Unexpected create_room_with_first_message row: message /,
    );
  });
});

describe("ROOMS_BBOX_LIMIT", () => {
  it("is the PRD's 500-pin cap", () => {
    expect(ROOMS_BBOX_LIMIT).toBe(500);
  });
});
