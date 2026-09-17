import { isValidElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { MapShellProps } from "@/components/map/MapShell";
import type { Room } from "@/lib/schemas/types";

const loadSharedRoom = vi.hoisted(() => vi.fn());
// The real `notFound()` throws too; that is how it stops the render.
const notFound = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error("NEXT_HTTP_ERROR_FALLBACK;404");
  }),
);

vi.mock("@/lib/page/sharedRoom", () => ({ loadSharedRoom }));
vi.mock("next/navigation", () => ({ notFound }));
// The page only builds the element; nothing here renders the client shell.
vi.mock("@/components/map/MapShell", () => ({ MapShell: () => null }));

import RoomPage from "@/app/room/[id]/page";
import { MapShell } from "@/components/map/MapShell";

const room: Room = {
  id: "00000000-0000-4000-8000-00000000000a",
  name: "brave-crimson-otter",
  lat: 46.7712,
  lng: 23.6236,
  createdAt: "2026-09-16T15:00:00.000000Z",
};

const propsFor = (id: string) => ({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("/room/[id] page", () => {
  it("renders the shell with the room selected, centred on it at room zoom", async () => {
    loadSharedRoom.mockResolvedValueOnce(room);

    const element = await RoomPage(propsFor(room.id));

    expect(loadSharedRoom).toHaveBeenCalledWith(room.id);
    expect(isValidElement<MapShellProps>(element)).toBe(true);
    expect(element.type).toBe(MapShell);
    expect(element.props).toEqual({
      initialSelection: { kind: "room", room },
      initialCenter: { lat: 46.7712, lng: 23.6236 },
      initialZoom: 16,
    });
    expect(notFound).not.toHaveBeenCalled();
  });

  it("answers not found when the address names no room", async () => {
    loadSharedRoom.mockResolvedValueOnce(null);

    await expect(RoomPage(propsFor(room.id))).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
    expect(notFound).toHaveBeenCalledTimes(1);
  });

  it("does not turn a load failure into not found", async () => {
    loadSharedRoom.mockRejectedValueOnce(new Error("database unavailable"));

    await expect(RoomPage(propsFor(room.id))).rejects.toThrow("database unavailable");
    expect(notFound).not.toHaveBeenCalled();
  });
});
