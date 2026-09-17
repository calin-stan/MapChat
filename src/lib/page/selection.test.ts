import { describe, expect, it } from "vitest";

import { type Selection, selectionReducer } from "@/lib/page/selection";
import type { Message, Room } from "@/lib/schemas/types";

const roomA: Room = {
  id: "00000000-0000-4000-8000-00000000000a",
  name: "brave-crimson-otter",
  lat: 46.7712,
  lng: 23.6236,
  createdAt: "2026-09-16T15:00:00.000000Z",
};
const roomB: Room = { ...roomA, id: "00000000-0000-4000-8000-00000000000b", name: "calm-amber-heron" };
const prefill = { author: "ana", text: "hello" };
const first: Message = {
  id: "00000000-0000-4000-8000-0000000000f1",
  chatroomId: roomB.id,
  author: "ana",
  text: "first!",
  createdAt: "2026-09-16T15:00:00.000000Z",
};

const none: Selection = { kind: "none" };
const draft: Selection = { kind: "draft", lat: 1, lng: 2 };
const selectedA: Selection = { kind: "room", room: roomA, prefill };
const createdA: Selection = { kind: "room", room: roomA, seed: { ...first, chatroomId: roomA.id } };
const goneA: Selection = { kind: "none", gone: roomA };

const everyState: [string, Selection][] = [
  ["none", none],
  ["draft", draft],
  ["room", selectedA],
  ["created room", createdA],
  ["gone notice", goneA],
];

describe("selectionReducer", () => {
  it.each(everyState)("clickEmpty from %s places a draft", (_, state) => {
    expect(selectionReducer(state, { type: "clickEmpty", lat: 10, lng: 20 })).toEqual({
      kind: "draft",
      lat: 10,
      lng: 20,
    });
  });

  it.each(everyState)("clickPin from %s selects the room without prefill or seed", (_, state) => {
    expect(selectionReducer(state, { type: "clickPin", room: roomB })).toEqual({
      kind: "room",
      room: roomB,
    });
  });

  it("clickPin on the already selected room returns the same state object", () => {
    const next = selectionReducer(selectedA, { type: "clickPin", room: { ...roomA } });

    expect(next).toBe(selectedA);
  });

  it("clickPin on the room just created keeps its seed by returning the same state object", () => {
    expect(selectionReducer(createdA, { type: "clickPin", room: { ...roomA } })).toBe(createdA);
  });

  it("re-opening a created room after close has no seed", () => {
    const closed = selectionReducer(createdA, { type: "close" });

    expect(selectionReducer(closed, { type: "clickPin", room: roomA })).toEqual({ kind: "room", room: roomA });
  });

  it.each(everyState)("roomCreated from %s selects the new room with its first message as seed", (_, state) => {
    expect(selectionReducer(state, { type: "roomCreated", room: roomB, message: first })).toEqual({
      kind: "room",
      room: roomB,
      seed: first,
    });
  });

  it.each(everyState)("movedToExisting from %s carries the prefill and never a seed", (_, state) => {
    expect(
      selectionReducer(state, { type: "movedToExisting", room: roomB, prefill }),
    ).toEqual({ kind: "room", room: roomB, prefill });
  });

  it.each(everyState)("close from %s clears the selection", (_, state) => {
    expect(selectionReducer(state, { type: "close" })).toEqual({ kind: "none" });
  });

  it("roomGone for the open room clears the selection and remembers the room", () => {
    expect(selectionReducer(selectedA, { type: "roomGone", roomId: roomA.id })).toEqual({
      kind: "none",
      gone: roomA,
    });
  });

  it.each(everyState)("roomGone for a room that is not open returns the same %s state object", (_, state) => {
    expect(selectionReducer(state, { type: "roomGone", roomId: roomB.id })).toBe(state);
  });

  it("does not mutate the previous state", () => {
    const before = structuredClone(selectedA);

    selectionReducer(selectedA, { type: "clickEmpty", lat: 1, lng: 1 });
    selectionReducer(selectedA, { type: "close" });
    selectionReducer(selectedA, { type: "roomGone", roomId: roomA.id });

    expect(selectedA).toEqual(before);
  });
});
