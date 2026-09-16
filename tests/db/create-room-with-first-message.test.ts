import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { asRole, connect, expectPgError, truncateAll, type DbRole, type Sql } from "./helpers";

let sql: Sql;

beforeAll(() => {
  sql = connect();
});

afterAll(async () => {
  await sql.end();
});

beforeEach(async () => {
  await truncateAll(sql);
});

const FN_SIGNATURE =
  "public.create_room_with_first_message(double precision, double precision, text, text, text)";

interface RoomJson {
  id: string;
  name: string;
  lat: number;
  lng: number;
  created_at: string;
}

interface MessageJson {
  id: string;
  chatroom_id: string;
  author: string;
  text: string;
  created_at: string;
}

interface CreateResult {
  room: RoomJson;
  message: MessageJson;
}

interface CreateInput {
  lat: number;
  lng: number;
  name: string;
  author: string;
  text: string;
}

/** Calls directly as `role`; HTTP responses are tested in create-room-rpc.test.ts. */
async function createRoom(role: DbRole, input: CreateInput): Promise<CreateResult> {
  return asRole(sql, role, async (db) => {
    const [row] = await db<{ result: CreateResult }[]>`
      select public.create_room_with_first_message(
        ${input.lat}::double precision,
        ${input.lng}::double precision,
        ${input.name},
        ${input.author},
        ${input.text}
      ) as result`;
    return row.result;
  });
}

const valid: CreateInput = {
  lat: 47.497913,
  lng: 19.040236,
  name: "brave-crimson-otter",
  author: "ann",
  text: "hello from budapest",
};

async function countRooms(): Promise<number> {
  const [row] = await sql<{ count: number }[]>`select count(*)::int as count from public.chatrooms`;
  return row.count;
}

async function countMessages(): Promise<number> {
  const [row] = await sql<{ count: number }[]>`select count(*)::int as count from public.messages`;
  return row.count;
}

describe("create_room_with_first_message: happy path", () => {
  it("creates the room and its first message and returns both", async () => {
    const result = await createRoom("service_role", valid);

    expect(result.room).toMatchObject({
      name: "brave-crimson-otter",
      lat: 47.497913,
      lng: 19.040236,
    });
    expect(result.room.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.message).toMatchObject({
      chatroom_id: result.room.id,
      author: "ann",
      text: "hello from budapest",
    });
    expect(result.message.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(new Date(result.message.created_at).getTime()).toBeGreaterThanOrEqual(
      new Date(result.room.created_at).getTime(),
    );

    expect(await countRooms()).toBe(1);
    expect(await countMessages()).toBe(1);
  });
});

describe("create_room_with_first_message: atomicity and conflicts", () => {
  it("writes nothing when the first message is invalid", async () => {
    await expectPgError(createRoom("service_role", { ...valid, text: "" }), {
      code: "23514",
      constraint: "messages_text_check",
    });

    expect(await countRooms()).toBe(0);
    expect(await countMessages()).toBe(0);
  });

  it("writes nothing when the author is invalid", async () => {
    await expectPgError(createRoom("service_role", { ...valid, author: "" }), {
      code: "23514",
      constraint: "messages_author_check",
    });

    expect(await countRooms()).toBe(0);
  });

  it("surfaces a name collision as chatrooms_name_key and leaves the existing room untouched", async () => {
    await createRoom("service_role", valid);

    await expectPgError(
      createRoom("service_role", { ...valid, lat: 1, lng: 1, text: "second attempt" }),
      { code: "23505", constraint: "chatrooms_name_key" },
    );

    expect(await countRooms()).toBe(1);
    expect(await countMessages()).toBe(1);
  });

  it("surfaces a coordinate collision as chatrooms_lat_lng_key (the 409 rule)", async () => {
    await createRoom("service_role", valid);

    await expectPgError(
      createRoom("service_role", { ...valid, name: "calm-teal-heron", text: "same spot" }),
      { code: "23505", constraint: "chatrooms_lat_lng_key" },
    );

    expect(await countRooms()).toBe(1);
    expect(await countMessages()).toBe(1);
  });

  it("rejects out-of-range coordinates with the chatrooms checks", async () => {
    await expectPgError(createRoom("service_role", { ...valid, lat: 91 }), {
      code: "23514",
      constraint: "chatrooms_lat_check",
    });
    await expectPgError(createRoom("service_role", { ...valid, lng: -181 }), {
      code: "23514",
      constraint: "chatrooms_lng_check",
    });
    expect(await countRooms()).toBe(0);
  });
});

describe("create_room_with_first_message: privileges", () => {
  it("is SECURITY INVOKER with a pinned search_path", async () => {
    const [row] = await sql<{ prosecdef: boolean; proconfig: string[] | null }[]>`
      select prosecdef, proconfig from pg_proc
      where oid = ${FN_SIGNATURE}::regprocedure`;
    expect(row.prosecdef).toBe(false);
    expect(row.proconfig).toEqual(['search_path=""']);
  });

  it("grants EXECUTE to service_role only", async () => {
    const [row] = await sql<{ anon: boolean; authenticated: boolean; service_role: boolean; acl: string }[]>`
      select
        has_function_privilege('anon', ${FN_SIGNATURE}, 'EXECUTE') as anon,
        has_function_privilege('authenticated', ${FN_SIGNATURE}, 'EXECUTE') as authenticated,
        has_function_privilege('service_role', ${FN_SIGNATURE}, 'EXECUTE') as service_role,
        coalesce(array_to_string(proacl, ','), '') as acl
      from pg_proc where oid = ${FN_SIGNATURE}::regprocedure`;

    expect(row.anon).toBe(false);
    expect(row.authenticated).toBe(false);
    expect(row.service_role).toBe(true);
    // An entry with an empty grantee ("=X/owner") would mean PUBLIC can execute.
    expect(row.acl).not.toMatch(/(^|,)=X\//);
  });

  it("refuses anon callers (the anon key must never create rooms)", async () => {
    await expectPgError(createRoom("anon", valid), {
      code: "42501",
      message: /permission denied for function create_room_with_first_message/,
    });
    expect(await countRooms()).toBe(0);
  });

  it("refuses authenticated callers", async () => {
    await expectPgError(createRoom("authenticated", valid), {
      code: "42501",
      message: /permission denied for function create_room_with_first_message/,
    });
    expect(await countRooms()).toBe(0);
  });
});
