import { describe, expect, it, vi } from "vitest";

import { createRoom } from "@/lib/db/rooms";
import { loadSharedRoom } from "@/lib/page/sharedRoom";

import { serviceClient } from "./helpers";

// `@/lib/page/sharedRoom` imports `server-only`, which throws outside a React
// Server build. Hoisted by Vitest above the imports.
vi.mock("server-only", () => ({}));

const NIL_UUID = "00000000-0000-4000-8000-000000000000";

// No truncation here: the test adds one room at a random spot and reads it back.
const round6 = (x: number) => Math.round(x * 1e6) / 1e6;
const spot = () => ({ lat: round6(-60 + Math.random() * 120), lng: round6(-170 + Math.random() * 340) });

describe("loadSharedRoom against the local stack", () => {
  it("returns the stored room, exactly as the rooms API reports it", async () => {
    const { room } = await createRoom(serviceClient(), { ...spot(), author: "ana", text: "hello" });

    await expect(loadSharedRoom(room.id)).resolves.toEqual(room);
  });

  it("returns null for a well-formed id no room has", async () => {
    await expect(loadSharedRoom(NIL_UUID)).resolves.toBeNull();
  });

  it("returns null for a malformed id", async () => {
    await expect(loadSharedRoom("not-a-uuid")).resolves.toBeNull();
  });
});
