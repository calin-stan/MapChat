import { describe, expect, it } from "vitest";

import {
  draftPanelKey,
  type Handoff,
  handoffReducer,
  initialHandoff,
  roomPanelKey,
} from "@/lib/page/handoff";
import type { Message, Room } from "@/lib/schemas/types";

const roomA: Room = {
  id: "00000000-0000-4000-8000-00000000000a",
  name: "brave-crimson-otter",
  lat: 46.7712,
  lng: 23.6236,
  createdAt: "2026-09-16T15:00:00.000000Z",
};
const roomB: Room = { ...roomA, id: "00000000-0000-4000-8000-00000000000b", name: "calm-amber-heron" };
const first: Message = {
  id: "00000000-0000-4000-8000-0000000000f1",
  chatroomId: roomA.id,
  author: "ana",
  text: "first!",
  createdAt: "2026-09-16T15:00:00.000000Z",
};
const prefill = { author: "ana", text: "hello" };
const input = { lat: 1.5, lng: 2.5, author: "ana", text: "hello" };
const error = new TypeError("Failed to fetch");

const start = initialHandoff({ kind: "none" });
const draft: Handoff = handoffReducer(start, { type: "clickEmpty", lat: 1.5, lng: 2.5 });
const recovered: Handoff = handoffReducer(start, { type: "failed", input, error });
const openA: Handoff = handoffReducer(start, { type: "clickPin", room: roomA });

describe("handoffReducer", () => {
  it("starts at revision 0 with no recovery", () => {
    expect(initialHandoff({ kind: "room", room: roomA })).toEqual({
      selection: { kind: "room", room: roomA },
      revision: 0,
      recovery: null,
    });
  });

  it("moves an open draft without changing the revision", () => {
    const moved = handoffReducer(draft, { type: "clickEmpty", lat: 9, lng: 8 });

    expect(moved).toEqual({ selection: { kind: "draft", lat: 9, lng: 8 }, revision: 0, recovery: null });
    expect(draftPanelKey(moved)).toBe(draftPanelKey(draft));
  });

  it("keeps the recovery while the recovered draft moves", () => {
    const moved = handoffReducer(recovered, { type: "clickEmpty", lat: 9, lng: 8 });

    expect(moved.recovery).toBe(recovered.recovery);
    expect(moved.revision).toBe(recovered.revision);
    expect(moved.selection).toEqual({ kind: "draft", lat: 9, lng: 8 });
  });

  it.each([
    ["close", { type: "close" } as const],
    ["selecting a room", { type: "clickPin", room: roomA } as const],
  ])("drops the recovery on %s, without a new revision", (_label, action) => {
    const next = handoffReducer(recovered, action);

    expect(next.recovery).toBeNull();
    expect(next.revision).toBe(recovered.revision);
  });

  it("returns the same state for a click on the already selected pin", () => {
    expect(handoffReducer(openA, { type: "clickPin", room: { ...roomA } })).toBe(openA);
  });

  it("created selects the room with its seed under a new revision", () => {
    const next = handoffReducer(draft, { type: "created", room: roomA, message: first });

    expect(next).toEqual({ selection: { kind: "room", room: roomA, seed: first }, revision: 1, recovery: null });
  });

  it("conflict selects the room with the prefill and no seed under a new revision", () => {
    const next = handoffReducer(draft, { type: "conflict", room: roomB, prefill });

    expect(next).toEqual({ selection: { kind: "room", room: roomB, prefill }, revision: 1, recovery: null });
  });

  it("gives an outcome for the already open room a new panel key", () => {
    const next = handoffReducer(openA, { type: "conflict", room: roomA, prefill });

    expect(roomPanelKey(next, roomA)).not.toBe(roomPanelKey(openA, roomA));
  });

  it("failed restores a draft at the submitted coordinates with the recovery, from any selection", () => {
    for (const from of [start, draft, openA, handoffReducer(draft, { type: "clickEmpty", lat: 9, lng: 8 })]) {
      const next = handoffReducer(from, { type: "failed", input, error });

      expect(next.selection).toEqual({ kind: "draft", lat: 1.5, lng: 2.5 });
      expect(next.recovery).toEqual({ input, error });
      expect(next.revision).toBe(from.revision + 1);
      expect(draftPanelKey(next)).not.toBe(draftPanelKey(from));
    }
  });

  it("a success after a recovery clears it", () => {
    const next = handoffReducer(recovered, { type: "created", room: roomA, message: first });

    expect(next.recovery).toBeNull();
    expect(next.revision).toBe(recovered.revision + 1);
  });

  it("applies outcomes in the order they arrive, each under its own revision", () => {
    const afterCreate = handoffReducer(draft, { type: "created", room: roomA, message: first });
    const afterFailure = handoffReducer(afterCreate, { type: "failed", input, error });

    expect(afterFailure.selection).toEqual({ kind: "draft", lat: 1.5, lng: 2.5 });
    expect(afterFailure.revision).toBe(2);
  });
});
