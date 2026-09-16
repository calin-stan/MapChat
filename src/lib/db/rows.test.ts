import { describe, expect, it } from "vitest";
import { z } from "zod";

import { messageRowSchema, parseRow, roomRowSchema, RowShapeError, toMessage, toRoom } from "@/lib/db/rows";

const roomRow = {
  id: "62c68de5-4ca1-40d0-b9e1-df45c251ae3f",
  name: "brave-crimson-otter",
  lat: 47.497913,
  lng: 19.040236,
  created_at: "2026-09-16T19:31:44.091331+00:00",
};

const messageRow = {
  id: "263debd5-7a6a-44d3-b9d0-7271248715bd",
  chatroom_id: "62c68de5-4ca1-40d0-b9e1-df45c251ae3f",
  author: "ann",
  text: "hello\n  world",
  created_at: "2026-09-16T19:31:44.091331+00:00",
};

describe("toRoom", () => {
  it("maps a chatrooms row to the Room DTO with a microsecond UTC timestamp", () => {
    expect(toRoom(roomRow)).toEqual({
      id: "62c68de5-4ca1-40d0-b9e1-df45c251ae3f",
      name: "brave-crimson-otter",
      lat: 47.497913,
      lng: 19.040236,
      createdAt: "2026-09-16T19:31:44.091331Z",
    });
  });

  it("drops columns the DTO does not have", () => {
    expect(toRoom({ ...roomRow, extra: 1 })).not.toHaveProperty("extra");
  });

  it("converts an offset timestamp to UTC", () => {
    expect(toRoom({ ...roomRow, created_at: "2026-09-16T17:00:00+02:00" }).createdAt).toBe(
      "2026-09-16T15:00:00.000000Z",
    );
  });

  it.each([
    { label: "a missing column", row: { ...roomRow, name: undefined } },
    { label: "a non-numeric coordinate", row: { ...roomRow, lat: "47.5" } },
    { label: "a malformed id", row: { ...roomRow, id: "not-a-uuid" } },
    { label: "an unparsable timestamp", row: { ...roomRow, created_at: "yesterday" } },
    { label: "a non-object", row: "row" },
  ])("throws RowShapeError for $label", ({ row }) => {
    expect(() => toRoom(row)).toThrow(RowShapeError);
    expect(() => toRoom(row)).toThrow(/^Unexpected chatrooms row: /);
  });
});

describe("toMessage", () => {
  it("maps a messages row to the Message DTO, keeping inner whitespace", () => {
    expect(toMessage(messageRow)).toEqual({
      id: "263debd5-7a6a-44d3-b9d0-7271248715bd",
      chatroomId: "62c68de5-4ca1-40d0-b9e1-df45c251ae3f",
      author: "ann",
      text: "hello\n  world",
      createdAt: "2026-09-16T19:31:44.091331Z",
    });
  });

  it("names the messages table in its shape error", () => {
    expect(() => toMessage({ ...messageRow, chatroom_id: 7 })).toThrow(
      /^Unexpected messages row: chatroom_id /,
    );
  });
});

describe("parseRow", () => {
  it("returns the parsed value on success", () => {
    expect(parseRow(z.object({ n: z.number() }), { n: 1 }, "probe")).toEqual({ n: 1 });
  });

  it("lists every issue with its path, using <row> for the whole input", () => {
    expect(() => parseRow(z.object({ n: z.number() }), null, "probe")).toThrow(
      "Unexpected probe row: <row> Invalid input: expected object, received null",
    );
  });

  it("composes: the RPC result schema reuses both row schemas", () => {
    const schema = z.object({ room: roomRowSchema, message: messageRowSchema });

    expect(parseRow(schema, { room: roomRow, message: messageRow }, "rpc")).toEqual({
      room: toRoom(roomRow),
      message: toMessage(messageRow),
    });
  });
});
