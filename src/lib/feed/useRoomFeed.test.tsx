// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FeedNotReadyError, type FeedDeps } from "@/lib/feed/store";
import {
  ROOM,
  TEST_CONFIG,
  catchUp,
  fakeMessages,
  fakeRealtime,
  id,
  msg,
  page,
} from "@/lib/feed/test-helpers";
import { useRoomFeed, type RoomFeed, type RoomFeedOptions } from "@/lib/feed/useRoomFeed";

const OTHER_ROOM = "22222222-2222-4222-8222-222222222222";

function fakeDeps() {
  const messages = fakeMessages();
  const realtime = fakeRealtime();
  const deps: FeedDeps = { messages: messages.api, subscribe: realtime.subscribe, config: TEST_CONFIG };
  return { deps, messages, realtime };
}

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
}

/** Lets settled promises run inside `act`, so React commits the resulting snapshots. */
const settle = () => act(async () => {});

afterEach(() => {
  setVisibility("visible");
  vi.useRealTimers();
});

describe("useRoomFeed", () => {
  it("opens the room after commit and exposes the store's state", async () => {
    const { deps, messages } = fakeDeps();
    const { result } = renderHook(() => useRoomFeed(ROOM, { deps }));

    expect(result.current).toMatchObject({ ready: false, loading: "initial", messages: [] });
    expect(messages.api.list).toHaveBeenCalledTimes(1);

    messages.list[0].resolve(page([msg(1), msg(2)], true));
    await settle();

    expect(result.current).toMatchObject({
      ready: true,
      hasOlder: true,
      loading: null,
      connection: "connecting",
      backlog: false,
      error: null,
    });
    expect(result.current.messages.map((m) => m.id)).toEqual([id(1), id(2)]);
  });

  it("reaches the store through stable callbacks", async () => {
    const { deps, messages } = fakeDeps();
    const { result } = renderHook(() => useRoomFeed(ROOM, { deps }));
    const first = result.current;
    messages.list[0].resolve(page([msg(1)], true));
    await settle();

    act(() => result.current.loadOlder());

    expect(messages.api.list).toHaveBeenLastCalledWith(ROOM, { before: id(1) });
    expect(result.current.loading).toBe("older");
    expect(result.current.loadOlder).toBe(first.loadOlder);
    expect(result.current.send).toBe(first.send);
  });

  it("is ready at once from a seed, with no history request", () => {
    const { deps, messages } = fakeDeps();
    const { result } = renderHook(() => useRoomFeed(ROOM, { deps, seed: msg(7) }));

    expect(result.current.ready).toBe(true);
    expect(result.current.messages).toEqual([msg(7)]);
    expect(messages.api.list).not.toHaveBeenCalled();
  });

  it("captures seed and deps once per room; later values do nothing", () => {
    const first = fakeDeps();
    const second = fakeDeps();
    const { result, rerender } = renderHook((opts: RoomFeedOptions) => useRoomFeed(ROOM, opts), {
      initialProps: { deps: first.deps, seed: msg(7) },
    });

    rerender({ deps: second.deps, seed: msg(8) });

    expect(result.current.messages).toEqual([msg(7)]);
    expect(second.realtime.attempts).toHaveLength(0);
  });

  it("disposes the store on unmount: late responses are ignored and callbacks go inert", async () => {
    const { deps, messages } = fakeDeps();
    const { result, unmount } = renderHook(() => useRoomFeed(ROOM, { deps }));
    const feed = result.current;

    unmount();
    messages.list[0].resolve(page([msg(1)]));
    await settle();

    expect(result.current.messages).toEqual([]);
    await expect(feed.send({ author: "ann", text: "hi" })).rejects.toBeInstanceOf(FeedNotReadyError);
    await expect(feed.loadNewer()).resolves.toBeUndefined();
    expect(messages.api.post).not.toHaveBeenCalled();
  });

  it("delegates loadNewer's completion and settles it when the room is replaced", async () => {
    const { deps, messages, realtime } = fakeDeps();
    const { result, rerender } = renderHook((roomId: string) => useRoomFeed(roomId, { deps }), {
      initialProps: ROOM,
    });
    messages.list[0].resolve(page([msg(1)]));
    await settle();
    act(() => realtime.attempts[0].handlers.onFailed("refused"));
    messages.listAfter[0].resolve(catchUp([], id(1)));
    await settle();

    let settled = false;
    let completion!: Promise<void>;
    act(() => {
      completion = result.current.loadNewer().then(() => {
        settled = true;
      });
    });
    await settle();
    expect(settled).toBe(false); // waits for listAfter[1]

    rerender(OTHER_ROOM);
    await completion;
    messages.listAfter[1].resolve(catchUp([msg(2)], id(2)));
    await settle();
    expect(result.current.messages).toEqual([]); // the new room is untouched by the old response
  });

  it("switches to a fresh opening snapshot when roomId changes", async () => {
    const { deps, messages } = fakeDeps();
    const { result, rerender } = renderHook((roomId: string) => useRoomFeed(roomId, { deps }), {
      initialProps: ROOM,
    });
    messages.list[0].resolve(page([msg(1)]));
    await settle();

    rerender(OTHER_ROOM);

    expect(result.current).toMatchObject({ ready: false, messages: [], loading: "initial" });
    expect(messages.api.list).toHaveBeenLastCalledWith(OTHER_ROOM);
  });

  it("leaves exactly one live store after Strict Mode's setup, cleanup, setup", async () => {
    vi.useFakeTimers();
    const { deps, messages, realtime } = fakeDeps();
    const { result } = renderHook(() => useRoomFeed(ROOM, { deps }), { wrapper: StrictMode });
    expect(messages.api.list).toHaveBeenCalledTimes(2);

    messages.list[0].resolve(page([msg(9)])); // the disposed first store
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(result.current.messages).toEqual([]);

    messages.list[1].resolve(page([msg(1)]));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(result.current.messages).toEqual([msg(1)]);
    expect(result.current.ready).toBe(true);
    expect(realtime.attempts).toHaveLength(1);

    act(() => realtime.attempts[0].handlers.onFailed("refused"));
    expect(vi.getTimerCount()).toBe(1); // one poll interval, none left over from the first store
  });

  it("polls instead of subscribing when mounted in a hidden tab", async () => {
    setVisibility("hidden");
    const { deps, messages, realtime } = fakeDeps();
    const { result } = renderHook(() => useRoomFeed(ROOM, { deps }));
    messages.list[0].resolve(page([msg(1)]));
    await settle();

    expect(realtime.attempts).toHaveLength(0);
    expect(result.current.connection).toBe("polling");
  });

  it("tracks visibility changes and stops tracking on unmount", async () => {
    const { deps, messages, realtime } = fakeDeps();
    const { result, unmount } = renderHook(() => useRoomFeed(ROOM, { deps }));
    messages.list[0].resolve(page([msg(1)]));
    await settle();

    setVisibility("hidden");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(realtime.attempts[0].unsubscribe).toHaveBeenCalledTimes(1);
    expect(result.current.connection).toBe("polling");

    const remove = vi.spyOn(document, "removeEventListener");
    try {
      unmount();
      expect(remove).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
    } finally {
      remove.mockRestore();
    }
  });

  it("renders on the server and hydrates without work or mismatch", async () => {
    const { deps, messages, realtime } = fakeDeps();
    const seen: RoomFeed[] = [];
    function Probe() {
      const feed = useRoomFeed(ROOM, { deps, seed: msg(7) });
      seen.push(feed);
      return <p>{feed.ready ? `ready:${feed.messages.length}` : "opening"}</p>;
    }

    const html = renderToString(<Probe />);
    expect(html).toContain("opening");
    expect(seen[0]).toMatchObject({ ready: false, messages: [] }); // the seed waits for commit
    expect(messages.api.list).not.toHaveBeenCalled();
    expect(realtime.attempts).toHaveLength(0);

    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.appendChild(container);
    const onRecoverableError = vi.fn();
    const root = await act(async () => hydrateRoot(container, <Probe />, { onRecoverableError }));
    try {
      expect(container.textContent).toBe("ready:1");
      expect(onRecoverableError).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
});
