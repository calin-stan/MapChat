// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Api } from "@/lib/api/client";
import { useRoomPins } from "@/lib/map/useRoomPins";
import type { Room } from "@/lib/schemas/types";

type ListResult = { rooms: Room[]; truncated: boolean };

function room(id: string, createdAt: string): Room {
  return { id, name: `room-${id.slice(-4)}`, lat: 46.77, lng: 23.62, createdAt };
}
const A = room("00000000-0000-4000-8000-00000000000a", "2026-09-16T15:00:01.000000Z");
const B = room("00000000-0000-4000-8000-00000000000b", "2026-09-16T15:00:02.000000Z");

const SINGLE = { west: 20, south: 40, east: 30, north: 50 };
const CROSSING = { west: 170, south: 40, east: 190, north: 50 };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const ok = (rooms: Room[], truncated = false): Promise<ListResult> =>
  Promise.resolve({ rooms, truncated });

/** An `Api` whose `rooms.list` is a spy; other members are never called by the hook. */
function fakeApi() {
  const list = vi.fn<(bbox: unknown) => Promise<ListResult>>();
  return { api: { rooms: { list } } as unknown as Api, list };
}

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
}

/** Lets settled promises deliver their callbacks. */
async function flush() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function renderPins(api: Api, deps: { intervalMs?: number; debounceMs?: number } = {}) {
  return renderHook(() =>
    useRoomPins({ api, intervalMs: deps.intervalMs ?? 30_000, debounceMs: deps.debounceMs ?? 250 }),
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useRoomPins", () => {
  it("starts idle with no rooms and no truncation", () => {
    const { api } = fakeApi();

    const { result } = renderPins(api);

    expect(result.current).toMatchObject({ rooms: [], truncated: false, status: "idle" });
  });

  it("refreshes the first viewport at once and debounces later ones into one refresh", async () => {
    const { api, list } = fakeApi();
    list.mockImplementation(() => ok([A]));
    const { result } = renderPins(api);

    act(() => result.current.setViewport(SINGLE));
    expect(list).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe("loading");
    await flush();
    expect(result.current.status).toBe("ready");
    expect(result.current.rooms).toEqual([A]);

    act(() => {
      result.current.setViewport({ ...SINGLE, east: 31 });
      result.current.setViewport({ ...SINGLE, east: 32 });
      result.current.setViewport({ ...SINGLE, east: 33 });
    });
    expect(list).toHaveBeenCalledTimes(1);
    await advance(249);
    expect(list).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(list).toHaveBeenCalledTimes(2);
    expect(list.mock.calls[1][0]).toEqual({ minLng: 20, minLat: 40, maxLng: 33, maxLat: 50 });
  });

  it("queries every box of a crossing viewport and merges the results", async () => {
    const { api, list } = fakeApi();
    list.mockImplementationOnce(() => ok([A])).mockImplementationOnce(() => ok([B]));
    const { result } = renderPins(api);

    act(() => result.current.setViewport(CROSSING));
    await flush();

    expect(list).toHaveBeenCalledTimes(2);
    expect(list.mock.calls[0][0]).toEqual({ minLng: 170, minLat: 40, maxLng: 180, maxLat: 50 });
    expect(list.mock.calls[1][0]).toEqual({ minLng: -180, minLat: 40, maxLng: -170, maxLat: 50 });
    expect(result.current.rooms).toEqual([B, A]);
  });

  it("ignores a slow first response that resolves after a fast second one", async () => {
    const { api, list } = fakeApi();
    const first = deferred<ListResult>();
    const second = deferred<ListResult>();
    list.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result } = renderPins(api);

    act(() => result.current.setViewport(SINGLE));
    act(() => result.current.refresh());
    second.resolve({ rooms: [B], truncated: false });
    await flush();
    expect(result.current.rooms).toEqual([B]);

    first.resolve({ rooms: [A], truncated: false });
    await flush();
    expect(result.current.rooms).toEqual([B]);
  });

  it("discards a partial two-box result of a superseded refresh", async () => {
    const { api, list } = fakeApi();
    const d = [deferred<ListResult>(), deferred<ListResult>(), deferred<ListResult>(), deferred<ListResult>()];
    list
      .mockReturnValueOnce(d[0].promise)
      .mockReturnValueOnce(d[1].promise)
      .mockReturnValueOnce(d[2].promise)
      .mockReturnValueOnce(d[3].promise);
    const { result } = renderPins(api);

    act(() => result.current.setViewport(CROSSING));
    d[0].resolve({ rooms: [A], truncated: false }); // first refresh, box 1 only
    act(() => result.current.refresh());
    d[2].resolve({ rooms: [B], truncated: false });
    d[3].resolve({ rooms: [], truncated: false });
    await flush();
    expect(result.current.rooms).toEqual([B]);

    d[1].resolve({ rooms: [A], truncated: false }); // first refresh, box 2, too late
    await flush();
    expect(result.current.rooms).toEqual([B]);
  });

  it("keeps old pins and reports error when a box fails, until the next success", async () => {
    const { api, list } = fakeApi();
    list.mockImplementationOnce(() => ok([A], true));
    const { result } = renderPins(api);
    act(() => result.current.setViewport(SINGLE));
    await flush();
    expect(result.current).toMatchObject({ rooms: [A], truncated: true, status: "ready" });

    list.mockImplementationOnce(() => Promise.reject(new Error("boom")));
    act(() => result.current.refresh());
    await flush();
    expect(result.current).toMatchObject({ rooms: [A], truncated: true, status: "error" });

    const pending = deferred<ListResult>();
    list.mockReturnValueOnce(pending.promise);
    act(() => result.current.refresh());
    expect(result.current.status).toBe("error"); // no loading flicker while retrying

    pending.resolve({ rooms: [B], truncated: false });
    await flush();
    expect(result.current).toMatchObject({ rooms: [B], truncated: false, status: "ready" });
  });

  it("stays ready during a background refresh", async () => {
    const { api, list } = fakeApi();
    list.mockImplementationOnce(() => ok([A]));
    const { result } = renderPins(api);
    act(() => result.current.setViewport(SINGLE));
    await flush();

    list.mockReturnValueOnce(deferred<ListResult>().promise);
    act(() => result.current.refresh());

    expect(result.current.status).toBe("ready");
  });

  it("refreshes on the interval only while the tab is visible", async () => {
    const { api, list } = fakeApi();
    list.mockImplementation(() => ok([A]));
    const { result } = renderPins(api, { intervalMs: 1000 });
    act(() => result.current.setViewport(SINGLE));
    expect(list).toHaveBeenCalledTimes(1);

    await advance(1000);
    expect(list).toHaveBeenCalledTimes(2);
    await advance(1000);
    expect(list).toHaveBeenCalledTimes(3);

    act(() => setVisibility("hidden"));
    await advance(5000);
    expect(list).toHaveBeenCalledTimes(3);

    act(() => setVisibility("visible"));
    expect(list).toHaveBeenCalledTimes(4); // immediate refresh on restore
    await advance(1000);
    expect(list).toHaveBeenCalledTimes(5);
  });

  it("does not tick before a viewport is known", async () => {
    const { api, list } = fakeApi();
    renderPins(api, { intervalMs: 1000 });

    await advance(3000);

    expect(list).not.toHaveBeenCalled();
  });

  it.each(["resolve", "reject"] as const)(
    "ignores an obsolete viewport's %s during the next viewport's debounce",
    async (settle) => {
      const { api, list } = fakeApi();
      const old = deferred<ListResult>();
      list.mockImplementationOnce(() => ok([A], true)).mockReturnValueOnce(old.promise);
      const { result } = renderPins(api);
      act(() => result.current.setViewport(SINGLE));
      await flush();
      act(() => result.current.refresh());
      act(() => result.current.setViewport({ ...SINGLE, west: 21 }));

      if (settle === "resolve") old.resolve({ rooms: [B], truncated: false });
      else old.reject(new Error("obsolete failure"));
      await flush();

      expect(list).toHaveBeenCalledTimes(2); // the new viewport has not fetched yet
      expect(result.current).toMatchObject({ rooms: [A], truncated: true, status: "ready" });
      list.mockImplementationOnce(() => ok([B]));
      await advance(250);
      expect(result.current).toMatchObject({ rooms: [B], truncated: false, status: "ready" });
    },
  );

  it("publishes a slow success without periodic ticks superseding it", async () => {
    const { api, list } = fakeApi();
    const slow = deferred<ListResult>();
    list.mockReturnValueOnce(slow.promise).mockImplementation(() => ok([B]));
    const { result } = renderPins(api, { intervalMs: 1000 });
    act(() => result.current.setViewport(SINGLE));

    await advance(3500);
    expect(list).toHaveBeenCalledTimes(1);
    slow.resolve({ rooms: [A], truncated: false });
    await flush();
    expect(result.current).toMatchObject({ rooms: [A], status: "ready" });
    await advance(500);
    expect(list).toHaveBeenCalledTimes(2);
    expect(result.current.rooms).toEqual([B]);
  });

  it.each(["resolve", "reject"] as const)(
    "an older request's %s cannot release the newer request's ownership",
    async (settle) => {
      const { api, list } = fakeApi();
      const old = deferred<ListResult>();
      const current = deferred<ListResult>();
      list.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
      const { result } = renderPins(api, { intervalMs: 1000 });
      act(() => result.current.setViewport(SINGLE));
      act(() => result.current.refresh()); // explicit replacement is still supported
      if (settle === "resolve") old.resolve({ rooms: [A], truncated: false });
      else old.reject(new Error("obsolete failure"));
      await flush();

      await advance(2000);
      expect(list).toHaveBeenCalledTimes(2);
      current.resolve({ rooms: [B], truncated: false });
      await flush();
      expect(result.current).toMatchObject({ rooms: [B], status: "ready" });
    },
  );

  it("starts the new viewport without waiting for the old viewport's slow request", async () => {
    const { api, list } = fakeApi();
    list.mockReturnValueOnce(deferred<ListResult>().promise).mockImplementation(() => ok([B]));
    const { result } = renderPins(api);
    act(() => result.current.setViewport(SINGLE));
    act(() => result.current.setViewport({ ...SINGLE, west: 21 }));

    await advance(250);

    expect(list).toHaveBeenCalledTimes(2);
    expect(result.current.rooms).toEqual([B]);
  });

  it("does not let a periodic tick bypass the viewport debounce", async () => {
    const { api, list } = fakeApi();
    list.mockImplementation(() => ok([A]));
    const { result } = renderPins(api, { intervalMs: 1000 });
    act(() => result.current.setViewport(SINGLE));
    await advance(900);
    act(() => result.current.setViewport({ ...SINGLE, west: 21 }));

    await advance(100); // interval tick, with 150 ms of debounce left
    expect(list).toHaveBeenCalledTimes(1);
    await advance(150);
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("keeps the latest hidden viewport without starting requests until foregrounded", async () => {
    const { api, list } = fakeApi();
    list.mockImplementation(() => ok([A]));
    setVisibility("hidden");
    const { result } = renderPins(api, { intervalMs: 1000 });
    act(() => {
      result.current.setViewport(SINGLE);
      result.current.setViewport({ ...SINGLE, west: 21 });
      result.current.refresh();
    });
    await advance(5000);
    expect(list).not.toHaveBeenCalled();

    act(() => setVisibility("visible"));
    expect(list).toHaveBeenCalledTimes(1);
    expect(list.mock.calls[0][0]).toEqual({ minLng: 21, minLat: 40, maxLng: 30, maxLat: 50 });
    await advance(250);
    expect(list).toHaveBeenCalledTimes(1);
  });

  it.each([100, 1000])("cancels debounce when hidden for %i ms and refreshes once on restore", async (hiddenMs) => {
    const { api, list } = fakeApi();
    list.mockImplementation(() => ok([A]));
    const { result } = renderPins(api);
    act(() => result.current.setViewport(SINGLE));
    await flush();
    act(() => result.current.setViewport({ ...SINGLE, west: 21 }));
    act(() => setVisibility("hidden"));
    await advance(hiddenMs);
    expect(list).toHaveBeenCalledTimes(1);

    act(() => setVisibility("visible"));
    expect(list).toHaveBeenCalledTimes(2);
    await advance(250);
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("insertRoom merges by id, keeps newest-first order and leaves truncated alone", async () => {
    const { api, list } = fakeApi();
    list.mockImplementationOnce(() => ok([A], true));
    const { result } = renderPins(api);
    act(() => result.current.setViewport(SINGLE));
    await flush();

    act(() => result.current.insertRoom(B));
    expect(result.current.rooms).toEqual([B, A]);

    const renamed = { ...A, name: "renamed" };
    act(() => result.current.insertRoom(renamed));
    expect(result.current.rooms).toEqual([B, renamed]);
    expect(result.current.truncated).toBe(true);
    expect(list).toHaveBeenCalledTimes(1);
  });

  it("cancels the pending debounce and ignores in-flight responses after unmount", async () => {
    const { api, list } = fakeApi();
    const inFlight = deferred<ListResult>();
    list.mockReturnValueOnce(inFlight.promise).mockImplementation(() => ok([A]));
    const { result, unmount } = renderPins(api);
    act(() => result.current.setViewport(SINGLE));
    act(() => result.current.setViewport({ ...SINGLE, east: 31 }));

    unmount();
    inFlight.resolve({ rooms: [A], truncated: false });
    await flush();
    await advance(1000);

    expect(list).toHaveBeenCalledTimes(1);
  });
});
