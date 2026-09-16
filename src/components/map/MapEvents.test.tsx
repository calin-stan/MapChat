// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { map as createMap, type LeafletEventHandlerFnMap, type Map as LeafletMap } from "leaflet";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MAP_CLICK_DELAY_MS, MapEvents } from "@/components/map/MapEvents";
import { type Selection, selectionReducer } from "@/lib/page/selection";

const context = vi.hoisted(() => ({ map: null as LeafletMap | null }));
vi.mock("react-leaflet", async () => {
  const { useEffect } = await import("react");
  function useMap() {
    if (context.map === null) throw new Error("test map not ready");
    return context.map;
  }
  return {
    useMap,
    useMapEvents: (handlers: LeafletEventHandlerFnMap) => {
      const map = useMap();
      useEffect(() => {
        map.on(handlers);
        return () => { map.off(handlers); };
      }, [map, handlers]);
      return map;
    },
  };
});

let container: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers();
  container = document.createElement("div");
  document.body.append(container);
  Object.defineProperties(container, {
    clientWidth: { value: 1440 },
    clientHeight: { value: 900 },
  });
  context.map = createMap(container, {
    center: [46.7712, 23.6236], zoom: 2, minZoom: 2, maxZoom: 19,
    maxBounds: [[-90, -180], [90, 180]], maxBoundsViscosity: 1,
    worldCopyJump: false, doubleClickZoom: false,
    zoomAnimation: false, fadeAnimation: false,
  });
});
afterEach(() => {
  cleanup();
  context.map?.remove();
  context.map = null;
  container.remove();
  vi.useRealTimers();
});

function advance(ms: number) {
  act(() => { vi.advanceTimersByTime(ms); });
}
function click(detail = 1, clientX = 720) {
  fireEvent.click(container, { clientX, clientY: 450, detail });
}

describe("MapEvents", () => {
  it("reports the initial viewport and completed moves", () => {
    const onViewportChange = vi.fn();
    render(<MapEvents onViewportChange={onViewportChange} onEmptyClick={vi.fn()} />);
    expect(onViewportChange).toHaveBeenCalledTimes(1);
    act(() => { context.map?.fire("moveend"); });
    expect(onViewportChange).toHaveBeenCalledTimes(2);
  });

  it("emits a valid single click once after the arbitration window", () => {
    const onEmptyClick = vi.fn();
    render(<MapEvents onViewportChange={vi.fn()} onEmptyClick={onEmptyClick} />);
    click();
    advance(MAP_CLICK_DELAY_MS - 1);
    expect(onEmptyClick).not.toHaveBeenCalled();
    advance(1);
    expect(onEmptyClick).toHaveBeenCalledTimes(1);
    const point = onEmptyClick.mock.calls[0][0];
    expect(point.lat).toBeGreaterThanOrEqual(-90);
    expect(point.lat).toBeLessThanOrEqual(90);
    expect(point.lng).toBeGreaterThanOrEqual(-180);
    expect(point.lng).toBeLessThanOrEqual(180);
  });

  it("ignores a real Leaflet click on the blank world margin", () => {
    const onEmptyClick = vi.fn();
    render(<MapEvents onViewportChange={vi.fn()} onEmptyClick={onEmptyClick} />);
    expect(context.map?.containerPointToLatLng([10, 450]).lng).toBeLessThan(-180);
    click(1, 10);
    advance(MAP_CLICK_DELAY_MS);
    expect(onEmptyClick).not.toHaveBeenCalled();
  });

  const states: Selection[] = [
    { kind: "none" },
    { kind: "room", room: {
      id: "00000000-0000-4000-8000-00000000000a", name: "brave-crimson-otter",
      lat: 46.7712, lng: 23.6236, createdAt: "2026-09-16T15:00:00.000000Z",
    } },
  ];
  it.each(states)("a double-click preserves the $kind selection without zooming", (initial) => {
    let selection = initial;
    const onEmptyClick = vi.fn((point: { lat: number; lng: number }) => {
      selection = selectionReducer(selection, { type: "clickEmpty", ...point });
    });
    render(<MapEvents onViewportChange={vi.fn()} onEmptyClick={onEmptyClick} />);
    click(1);
    advance(250);
    click(2);
    fireEvent.doubleClick(container, { clientX: 720, clientY: 450, detail: 2 });
    advance(MAP_CLICK_DELAY_MS);
    expect(onEmptyClick).not.toHaveBeenCalled();
    expect(selection).toBe(initial);
    expect(context.map?.getZoom()).toBe(2);
  });

  it("cancels draft placement when map movement starts", () => {
    const onEmptyClick = vi.fn();
    render(<MapEvents onViewportChange={vi.fn()} onEmptyClick={onEmptyClick} />);
    click();
    act(() => { context.map?.fire("movestart"); });
    advance(MAP_CLICK_DELAY_MS);
    expect(onEmptyClick).not.toHaveBeenCalled();
  });

  it.each(["pointerdown", "keydown"])("cancels pending placement on a later %s interaction", (type) => {
    const onEmptyClick = vi.fn();
    render(<MapEvents onViewportChange={vi.fn()} onEmptyClick={onEmptyClick} />);
    click();
    fireEvent(document.body, new Event(type, { bubbles: true }));
    advance(MAP_CLICK_DELAY_MS);
    expect(onEmptyClick).not.toHaveBeenCalled();
  });

  it("clears pending draft placement on unmount", () => {
    const onEmptyClick = vi.fn();
    const { unmount } = render(<MapEvents onViewportChange={vi.fn()} onEmptyClick={onEmptyClick} />);
    click();
    unmount();
    advance(MAP_CLICK_DELAY_MS);
    expect(onEmptyClick).not.toHaveBeenCalled();
  });
});
