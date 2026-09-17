import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Room } from "@/lib/schemas/types";

// `server-only` throws outside a React Server build. Hoisted above the imports.
vi.mock("server-only", () => ({}));

const findRoomById = vi.hoisted(() => vi.fn());
const createServiceClient = vi.hoisted(() => vi.fn(() => "service-client"));

vi.mock("@/lib/db/rooms", () => ({ findRoomById }));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient }));

import { loadSharedRoom } from "@/lib/page/sharedRoom";

const room: Room = {
  id: "00000000-0000-4000-8000-00000000000a",
  name: "brave-crimson-otter",
  lat: 46.7712,
  lng: 23.6236,
  createdAt: "2026-09-16T15:00:00.000000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("loadSharedRoom", () => {
  it("returns the room the repository finds, through a service client", async () => {
    findRoomById.mockResolvedValueOnce(room);

    await expect(loadSharedRoom(room.id)).resolves.toBe(room);
    expect(findRoomById).toHaveBeenCalledWith("service-client", room.id);
  });

  it("returns null for an id no room has", async () => {
    findRoomById.mockResolvedValueOnce(null);

    await expect(loadSharedRoom(room.id)).resolves.toBeNull();
  });

  it.each(["not-a-uuid", "", "00000000-0000-4000-8000-00000000000a/../x", "%20"])(
    "returns null for the malformed id %j without a database call",
    async (id) => {
      await expect(loadSharedRoom(id)).resolves.toBeNull();
      expect(createServiceClient).not.toHaveBeenCalled();
      expect(findRoomById).not.toHaveBeenCalled();
    },
  );

  it("lets a repository failure through: it is not a missing room", async () => {
    findRoomById.mockRejectedValueOnce(new Error("findRoomById failed"));

    await expect(loadSharedRoom(room.id)).rejects.toThrow("findRoomById failed");
  });
});
