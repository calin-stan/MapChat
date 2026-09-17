// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";

import { MapShell } from "@/components/map/MapShell";
import type { MapViewProps } from "@/components/map/MapView";
import type { CreateRoomOutcome } from "@/lib/api/client";
import { type Deferred, deferred, fakeMessages } from "@/lib/feed/test-helpers";
import type { Room } from "@/lib/schemas/types";

// Unlike MapShell.newRoom.test.tsx, `useRoomPins` is real here: the point is how
// its refreshes interact with a room inserted by a create outcome (new-room design §6).
type RoomList = { rooms: Room[]; truncated: boolean };
const fakeApi = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  api: {
    get rooms() {
      return (fakeApi.current as { rooms: unknown }).rooms;
    },
    get messages() {
      return (fakeApi.current as { messages: unknown }).messages;
    },
  },
}));

vi.mock("@/lib/config/client", () => ({
  getClientConfig: () => ({
    supabaseUrl: "http://127.0.0.1:55021",
    supabaseAnonKey: "anon",
    pollIntervalMs: 3_600_000, // no periodic refresh during the test
    realtimeIdleTimeoutMs: 3_600_000,
  }),
}));

vi.mock("next/dynamic", () => ({
  default: () =>
    function FakeMapView(props: MapViewProps) {
      return (
        <div>
          {props.rooms.map((room) => (
            <button key={room.id} type="button" onClick={() => props.onPinClick(room)}>
              {room.name}
            </button>
          ))}
          <button type="button" onClick={() => props.onEmptyClick({ lat: 46.5, lng: 23.5 })}>
            empty
          </button>
          <button
            type="button"
            onClick={() => props.onViewportChange({ west: 1, south: 2, east: 3, north: 4 })}
          >
            move
          </button>
        </div>
      );
    },
}));

const existing: Room = {
  id: "00000000-0000-4000-8000-00000000000a",
  name: "brave-crimson-otter",
  lat: 46.5,
  lng: 23.5,
  createdAt: "2026-09-16T15:00:00.000000Z",
};
const other: Room = { ...existing, id: "00000000-0000-4000-8000-00000000000b", name: "calm-amber-heron", lat: 1, lng: 2 };

const pin = (room: Room) => screen.queryByRole("button", { name: room.name });

beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
  return () => {
    fakeApi.current = null;
  };
});

it("keeps an inserted pin while its room is selected, then follows the fetched rooms", async () => {
  const lists: Deferred<RoomList>[] = [];
  const create = deferred<CreateRoomOutcome>();
  fakeApi.current = {
    rooms: {
      list: vi.fn(() => {
        const call = deferred<RoomList>();
        lists.push(call);
        return call.promise;
      }),
      create: vi.fn(() => create.promise),
    },
    messages: fakeMessages().api, // history stays pending; this test is about pins
  };
  const user = userEvent.setup();
  render(<MapShell initialSelection={{ kind: "none" }} initialCenter={{ lat: 0, lng: 0 }} initialZoom={2} />);

  // A refresh whose snapshot predates the room is in flight…
  fireEvent.click(screen.getByRole("button", { name: "move" }));
  expect(lists).toHaveLength(1);

  // …when a create lands on that room.
  fireEvent.click(screen.getByRole("button", { name: "empty" }));
  await user.type(screen.getByLabelText("Display name"), "ann");
  await user.type(screen.getByLabelText("Message"), "hello");
  await user.click(screen.getByRole("button", { name: "Create" }));
  await act(async () => create.resolve({ status: "conflict", room: existing }));
  expect(pin(existing)).toBeInTheDocument(); // inserted at once

  // The older refresh settles without it: the selected room keeps its pin.
  await act(async () => lists[0].resolve({ rooms: [other], truncated: false }));
  expect(pin(other)).toBeInTheDocument();
  expect(pin(existing)).toBeInTheDocument();

  // Closed: no retention guarantee, the pin follows the fetched collection.
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(pin(existing)).not.toBeInTheDocument();

  // A later refresh that contains the room brings the pin back.
  fireEvent.click(screen.getByRole("button", { name: "move" }));
  await waitFor(() => expect(lists).toHaveLength(2)); // after the 250 ms debounce
  await act(async () => lists[1].resolve({ rooms: [existing, other], truncated: false }));
  expect(pin(existing)).toBeInTheDocument();
});
