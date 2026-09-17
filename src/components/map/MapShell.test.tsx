// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MapShell, pinsToRender } from "@/components/map/MapShell";
import type { MapViewProps } from "@/components/map/MapView";
import type { RoomPins } from "@/lib/map/useRoomPins";
import type { Selection } from "@/lib/page/selection";
import type { Message, Room } from "@/lib/schemas/types";

const fakePins = vi.hoisted(() => ({ current: null as RoomPins | null }));

vi.mock("@/lib/map/useRoomPins", () => ({
  useRoomPins: () => {
    if (fakePins.current === null) throw new Error("test did not set fakePins");
    return fakePins.current;
  },
}));

// The room panel runs its real feed hook. Its browser defaults are replaced:
// a fixed config, and a messages API whose requests never settle.
const fakeMessages = vi.hoisted(() => ({
  list: vi.fn(() => new Promise<never>(() => {})),
  listAfter: vi.fn(() => new Promise<never>(() => {})),
  post: vi.fn(() => new Promise<never>(() => {})),
}));

vi.mock("@/lib/config/client", () => ({
  getClientConfig: () => ({
    supabaseUrl: "http://127.0.0.1:55021",
    supabaseAnonKey: "anon",
    pollIntervalMs: 30_000,
    realtimeIdleTimeoutMs: 180_000,
  }),
}));

vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  api: { rooms: {}, messages: fakeMessages },
}));

// The map bundle never loads in tests: `next/dynamic` returns a fake MapView
// that renders the pins as buttons and exposes the three callbacks.
vi.mock("next/dynamic", () => ({
  default: () =>
    function FakeMapView(props: MapViewProps) {
      return (
        <div data-testid="map">
          {props.rooms.map((room) => (
            <button
              key={room.id}
              type="button"
              data-testid="pin"
              data-selected={String(room.id === props.selectedRoomId)}
              onClick={() => props.onPinClick(room)}
            >
              {room.name}
            </button>
          ))}
          {props.draft ? (
            <span data-testid="draft">
              {props.draft.lat},{props.draft.lng}
            </span>
          ) : null}
          <button
            type="button"
            data-testid="empty"
            onClick={() => props.onEmptyClick({ lat: 46.5, lng: 23.5 })}
          >
            empty
          </button>
          <button
            type="button"
            data-testid="move"
            onClick={() => props.onViewportChange({ west: 1, south: 2, east: 3, north: 4 })}
          >
            move
          </button>
        </div>
      );
    },
}));

const roomA: Room = {
  id: "00000000-0000-4000-8000-00000000000a",
  name: "brave-crimson-otter",
  lat: 46.7712,
  lng: 23.6236,
  createdAt: "2026-09-16T15:00:00.000000Z",
};
const roomB: Room = { ...roomA, id: "00000000-0000-4000-8000-00000000000b", name: "calm-amber-heron" };

function pinsWith(overrides: Partial<RoomPins> = {}): RoomPins {
  return {
    rooms: [],
    truncated: false,
    status: "ready",
    setViewport: vi.fn(),
    refresh: vi.fn(),
    insertRoom: vi.fn(),
    ...overrides,
  };
}

function renderShell(pins: RoomPins = pinsWith(), initialSelection: Selection = { kind: "none" }) {
  fakePins.current = pins;
  return render(
    <MapShell initialSelection={initialSelection} initialCenter={{ lat: 0, lng: 0 }} initialZoom={2} />,
  );
}

const greeting = () => screen.queryByText("Click on the map to start a chat");
const closeButton = () => screen.queryByRole("button", { name: "Close" });

afterEach(() => {
  cleanup();
  fakePins.current = null;
  vi.clearAllMocks();
});

describe("pinsToRender", () => {
  it("returns the fetched rooms unchanged when nothing or a draft is selected", () => {
    const rooms = [roomA];

    expect(pinsToRender(rooms, { kind: "none" })).toBe(rooms);
    expect(pinsToRender(rooms, { kind: "draft", lat: 1, lng: 2 })).toBe(rooms);
  });

  it("returns the fetched rooms unchanged when the selected room is among them", () => {
    const rooms = [roomA, roomB];

    expect(pinsToRender(rooms, { kind: "room", room: roomB })).toBe(rooms);
  });

  it("appends the selected room when the fetched rooms omit it", () => {
    expect(pinsToRender([roomA], { kind: "room", room: roomB })).toEqual([roomA, roomB]);
  });
});

describe("MapShell", () => {
  it("shows the greeting first, with no close button", () => {
    renderShell();

    expect(greeting()).toBeTruthy();
    expect(closeButton()).toBeNull();
  });

  it("forwards viewport changes to the pins hook", () => {
    const pins = pinsWith();
    renderShell(pins);

    fireEvent.click(screen.getByTestId("move"));

    expect(pins.setViewport).toHaveBeenCalledWith({ west: 1, south: 2, east: 3, north: 4 });
  });

  it("shows the New chatroom placeholder with the coordinates after an empty click", () => {
    renderShell();

    fireEvent.click(screen.getByTestId("empty"));

    expect(screen.getByText("New chatroom")).toBeTruthy();
    expect(screen.getByText("46.500000, 23.500000")).toBeTruthy();
    expect(screen.getByTestId("draft").textContent).toBe("46.5,23.5");
    expect(greeting()).toBeNull();
  });

  it("opens the room panel and marks the pin selected after a pin click", () => {
    renderShell(pinsWith({ rooms: [roomA, roomB] }));

    fireEvent.click(screen.getByRole("button", { name: roomB.name }));

    expect(screen.getByRole("status").textContent).toContain("Loading messages…");
    expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();
    expect(fakeMessages.list).toHaveBeenCalledWith(roomB.id);
    expect(screen.getAllByText(roomB.name)).toHaveLength(2); // pin and panel title
    expect(screen.getByRole("button", { name: roomB.name }).getAttribute("data-selected")).toBe("true");
    expect(screen.getByRole("button", { name: roomA.name }).getAttribute("data-selected")).toBe("false");
    expect(screen.queryByTestId("draft")).toBeNull();
  });

  it("remounts the panel with a fresh feed when another pin is clicked", () => {
    renderShell(pinsWith({ rooms: [roomA, roomB] }));

    fireEvent.click(screen.getByRole("button", { name: roomA.name }));
    fireEvent.click(screen.getByRole("button", { name: roomB.name }));

    expect(fakeMessages.list.mock.calls).toEqual([[roomA.id], [roomB.id]]);
  });

  it("shows the seed of a freshly created room without a history request", () => {
    const seed: Message = {
      id: "00000000-0000-4000-8000-0000000000f1",
      chatroomId: roomA.id,
      author: "ana",
      text: "first message here",
      createdAt: "2026-09-16T15:00:00.000000Z",
    };
    renderShell(pinsWith({ rooms: [roomA] }), { kind: "room", room: roomA, seed });

    expect(screen.getByRole("log").textContent).toContain("first message here");
    expect(fakeMessages.list).not.toHaveBeenCalled();
  });

  it("passes a prefill to the panel's form", () => {
    renderShell(pinsWith({ rooms: [roomA] }), {
      kind: "room",
      room: roomA,
      prefill: { author: "ana", text: "unsent draft" },
    });

    expect((screen.getByLabelText("Message") as HTMLTextAreaElement).value).toBe("unsent draft");
  });

  it("unmounts the panel and returns to the greeting after close", () => {
    renderShell(pinsWith({ rooms: [roomA] }));
    fireEvent.click(screen.getByRole("button", { name: roomA.name }));

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(greeting()).toBeTruthy();
    expect(closeButton()).toBeNull();
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
  });

  it("replaces an open room with the new-room form on an empty click", () => {
    renderShell(pinsWith({ rooms: [roomA] }));
    fireEvent.click(screen.getByRole("button", { name: roomA.name }));

    fireEvent.click(screen.getByTestId("empty"));

    expect(screen.getByText("New chatroom")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
  });

  it("passes a pin for a selected room that the fetched rooms omit", () => {
    renderShell(pinsWith({ rooms: [roomA] }), { kind: "room", room: roomB });

    const pins = screen.getAllByTestId("pin");
    expect(pins.map((pin) => pin.textContent)).toEqual([roomA.name, roomB.name]);
    expect(pins[1].getAttribute("data-selected")).toBe("true");
  });

  it("shows no status pill when pins are fine", () => {
    renderShell();

    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows the truncation pill, which wins over a failed refresh", () => {
    renderShell(pinsWith({ truncated: true, status: "error" }));

    expect(screen.getByRole("status").textContent).toBe("Zoom in to see more rooms");
  });

  it("shows the refresh failure pill", () => {
    renderShell(pinsWith({ status: "error" }));

    expect(screen.getByRole("status").textContent).toBe("Couldn't refresh rooms");
  });
});
