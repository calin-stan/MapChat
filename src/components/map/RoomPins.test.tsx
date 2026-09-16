// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DraftPin } from "@/components/map/DraftPin";
import { RoomPins } from "@/components/map/RoomPins";
import type { Room } from "@/lib/schemas/types";

type FakeMarkerProps = {
  position: [number, number];
  icon: { options: { className?: string } };
  title?: string;
  interactive?: boolean;
  eventHandlers?: { click?: () => void };
};

// Track position and eventHandlers references by room title across renders
const markerRefs = new Map<string, { positions: ([number, number])[], eventHandlers: object[] }>();

// The real `leaflet` runs in jsdom, so `pinIcon` builds genuine DivIcons; only
// react-leaflet's Marker is replaced by a button that exposes its props.
vi.mock("react-leaflet", () => ({
  Marker: ({ position, icon, title, interactive, eventHandlers }: FakeMarkerProps) => {
    if (title) {
      if (!markerRefs.has(title)) {
        markerRefs.set(title, { positions: [], eventHandlers: [] });
      }
      const refs = markerRefs.get(title)!;
      refs.positions.push(position);
      refs.eventHandlers.push(eventHandlers!);
    }
    return (
      <button
        type="button"
        data-testid="marker"
        data-position={position.join(",")}
        data-icon={icon.options.className}
        data-interactive={String(interactive ?? true)}
        title={title}
        onClick={() => eventHandlers?.click?.()}
      />
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
const roomB: Room = { ...roomA, id: "00000000-0000-4000-8000-00000000000b", name: "calm-amber-heron", lat: 44.4268, lng: 26.1025 };

afterEach(cleanup);

describe("RoomPins", () => {
  it("renders one marker per room with its name as the native tooltip", () => {
    render(<RoomPins rooms={[roomA, roomB]} onPinClick={vi.fn()} />);

    const markers = screen.getAllByTestId("marker");
    expect(markers).toHaveLength(2);
    expect(markers[0].getAttribute("title")).toBe("brave-crimson-otter");
    expect(markers[0].getAttribute("data-position")).toBe("46.7712,23.6236");
    expect(markers[1].getAttribute("title")).toBe("calm-amber-heron");
  });

  it("gives the selected room the selected icon and the others the room icon", () => {
    render(<RoomPins rooms={[roomA, roomB]} selectedRoomId={roomB.id} onPinClick={vi.fn()} />);

    const [a, b] = screen.getAllByTestId("marker");
    expect(a.getAttribute("data-icon")).toBe("map-pin map-pin-room");
    expect(b.getAttribute("data-icon")).toBe("map-pin map-pin-selected");
  });

  it("calls onPinClick with the clicked room", () => {
    const onPinClick = vi.fn();
    render(<RoomPins rooms={[roomA, roomB]} onPinClick={onPinClick} />);

    fireEvent.click(screen.getAllByTestId("marker")[1]);

    expect(onPinClick).toHaveBeenCalledWith(roomB);
  });

  it("keeps position and eventHandlers references stable across re-renders", () => {
    markerRefs.clear();
    const onPinClick = vi.fn();
    const { rerender } = render(<RoomPins rooms={[roomA, roomB]} selectedRoomId={roomA.id} onPinClick={onPinClick} />);

    const roomAInitialRefs = markerRefs.get("brave-crimson-otter");
    expect(roomAInitialRefs).toBeDefined();
    expect(roomAInitialRefs!.positions).toHaveLength(1);
    expect(roomAInitialRefs!.eventHandlers).toHaveLength(1);

    // Rerender with same rooms and onPinClick but different selection to force re-render
    // of RoomPin components while keeping memoised position/eventHandlers
    rerender(<RoomPins rooms={[roomA, roomB]} selectedRoomId={roomB.id} onPinClick={onPinClick} />);

    const roomARerenderedRefs = markerRefs.get("brave-crimson-otter");
    expect(roomARerenderedRefs).toBeDefined();
    expect(roomARerenderedRefs!.positions).toHaveLength(2);
    expect(roomARerenderedRefs!.eventHandlers).toHaveLength(2);

    // Verify position reference stayed the same for roomA (not rebuilt on rerender)
    expect(roomARerenderedRefs!.positions[1]).toBe(roomAInitialRefs!.positions[0]);
    // Verify eventHandlers reference stayed the same for roomA (not recreated on rerender)
    expect(roomARerenderedRefs!.eventHandlers[1]).toBe(roomAInitialRefs!.eventHandlers[0]);
  });
});

describe("DraftPin", () => {
  it("renders a non-interactive marker with the draft icon", () => {
    render(<DraftPin lat={1.5} lng={2.5} />);

    const marker = screen.getByTestId("marker");
    expect(marker.getAttribute("data-position")).toBe("1.5,2.5");
    expect(marker.getAttribute("data-icon")).toBe("map-pin map-pin-draft");
    expect(marker.getAttribute("data-interactive")).toBe("false");
  });
});
