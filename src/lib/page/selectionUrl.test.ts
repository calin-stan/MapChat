import { describe, expect, it } from "vitest";

import type { Selection } from "@/lib/page/selection";
import { pathForSelection } from "@/lib/page/selectionUrl";
import type { Room } from "@/lib/schemas/types";

const roomA: Room = {
  id: "00000000-0000-4000-8000-00000000000a",
  name: "brave-crimson-otter",
  lat: 46.7712,
  lng: 23.6236,
  createdAt: "2026-09-16T15:00:00.000000Z",
};

describe("pathForSelection", () => {
  it.each<[string, Selection]>([
    ["nothing", { kind: "none" }],
    ["a draft", { kind: "draft", lat: 1, lng: 2 }],
  ])("is the map's own path while %s is selected", (_label, selection) => {
    expect(pathForSelection(selection)).toBe("/");
  });

  it("is the room's shareable path while a room is open, whatever came with it", () => {
    expect(pathForSelection({ kind: "room", room: roomA })).toBe(`/room/${roomA.id}`);
    expect(
      pathForSelection({ kind: "room", room: roomA, prefill: { author: "ana", text: "hello" } }),
    ).toBe(`/room/${roomA.id}`);
  });
});
