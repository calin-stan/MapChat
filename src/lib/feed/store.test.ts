import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiRequestError } from "@/lib/api/client";
import { pollingOnlySubscribe, type SubscribeToRoom } from "@/lib/feed/realtime";
import { FeedNotReadyError, createFeedStore, type FeedDeps } from "@/lib/feed/store";
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
import type { Message } from "@/lib/schemas/types";

const POLL = TEST_CONFIG.pollIntervalMs;
const IDLE = TEST_CONFIG.realtimeIdleTimeoutMs;

/** Lets settled promises run their callbacks. Fires no timer later than "now". */
const flush = () => vi.advanceTimersByTimeAsync(0);

function setup(opts: { subscribe?: SubscribeToRoom; seed?: Message } = {}) {
  const messages = fakeMessages();
  const realtime = fakeRealtime();
  const deps: FeedDeps = {
    messages: messages.api,
    subscribe: opts.subscribe ?? realtime.subscribe,
    config: TEST_CONFIG,
  };
  const store = createFeedStore(ROOM, deps, opts.seed);
  const listener = vi.fn();
  store.subscribe(listener);
  return { store, messages, realtime, listener };
}

/** A started, visible store whose history [1, 2] has loaded; the join is still pending. */
async function opened(opts: { subscribe?: SubscribeToRoom } = {}) {
  const ctx = setup(opts);
  ctx.store.start({ hidden: false });
  ctx.messages.list[0].resolve(page([msg(1), msg(2)], true));
  await flush();
  return ctx;
}

/** As `opened`, then the join is refused: polling, with the immediate catch-up answered empty. */
async function polling() {
  const ctx = await opened();
  ctx.realtime.attempts[0].handlers.onFailed("refused");
  ctx.messages.listAfter[0].resolve(catchUp([], id(2)));
  await flush();
  return ctx;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("construction and start", () => {
  it("is inert until start: no requests, no subscription, no timers", () => {
    const { store, messages, realtime } = setup();

    expect(store.getState().status).toBe("opening");
    expect(messages.api.list).not.toHaveBeenCalled();
    expect(realtime.attempts).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ignores actions before start", async () => {
    const { store, messages, listener } = setup();

    store.loadOlder();
    store.setHidden(true);
    store.dispatch({ type: "pollTick" });
    await store.loadNewer();

    expect(store.getState().hidden).toBe(false);
    expect(messages.api.list).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
  });

  it("fetches initial history once, however often start is called", () => {
    const { store, messages } = setup();

    store.start({ hidden: false });
    store.start({ hidden: false });

    expect(messages.api.list).toHaveBeenCalledTimes(1);
    expect(messages.api.list).toHaveBeenCalledWith(ROOM);
    expect(store.getState().inflight).toBe("initial");
  });

  it("opens from a seed without a history request and tries realtime", () => {
    const { store, messages, realtime } = setup({ seed: msg(7) });

    store.start({ hidden: false });

    expect(store.getState()).toMatchObject({ status: "open", messages: [msg(7)], syncCursor: id(7) });
    expect(messages.api.list).not.toHaveBeenCalled();
    expect(realtime.attempts).toHaveLength(1);
  });

  it("notifies once per accepted action and not for an ignored one", async () => {
    const { store, listener } = await opened();
    listener.mockClear();

    store.dispatch({ type: "subscribed" });
    expect(listener).toHaveBeenCalledTimes(1);

    store.dispatch({ type: "subscribed" }); // already subscribed: same state object
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("polling with the stand-in adapter", () => {
  it("loads history, is refused, then polls at once and every interval", async () => {
    // `opened` flushes with a 0 ms advance, which also lets the stand-in refuse the join.
    const { store, messages } = await opened({ subscribe: pollingOnlySubscribe });

    expect(store.getState()).toMatchObject({ channel: "none", polling: true, inflight: "newer" });
    expect(messages.api.listAfter).toHaveBeenCalledTimes(1);
    expect(messages.api.listAfter).toHaveBeenLastCalledWith(ROOM, id(2));

    messages.listAfter[0].resolve(catchUp([msg(3)], id(3)));
    await flush();
    expect(store.getState().messages.map((m) => m.id)).toEqual([id(1), id(2), id(3)]);

    await vi.advanceTimersByTimeAsync(POLL);
    expect(messages.api.listAfter).toHaveBeenCalledTimes(2);
    expect(messages.api.listAfter).toHaveBeenLastCalledWith(ROOM, id(3));
  });

  it("does not start a second catch-up while one is in flight", async () => {
    const { messages } = await polling();

    await vi.advanceTimersByTimeAsync(POLL);
    expect(messages.api.listAfter).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(POLL * 2); // still unanswered
    expect(messages.api.listAfter).toHaveBeenCalledTimes(2);
  });

  it("pauses ticks during a backlog until loadNewer drains it", async () => {
    const { store, messages } = await polling();
    await vi.advanceTimersByTimeAsync(POLL);
    messages.listAfter[1].resolve(catchUp([msg(3)], id(3), true));
    await flush();
    expect(store.getState().backlog).toBe(true);

    await vi.advanceTimersByTimeAsync(POLL * 2);
    expect(messages.api.listAfter).toHaveBeenCalledTimes(2);

    const done = store.loadNewer();
    expect(messages.api.listAfter).toHaveBeenLastCalledWith(ROOM, id(3));
    messages.listAfter[2].resolve(catchUp([msg(4)], id(4)));
    await done;
    expect(store.getState()).toMatchObject({ backlog: false, syncCursor: id(4) });

    await vi.advanceTimersByTimeAsync(POLL);
    expect(messages.api.listAfter).toHaveBeenCalledTimes(4);
  });

  it("pages older history from the page's first id, not the oldest displayed row", async () => {
    const { store, messages } = await polling();
    store.dispatch({ type: "received", message: msg(0) }); // displayed, but not from a page

    store.loadOlder();

    expect(messages.api.list).toHaveBeenLastCalledWith(ROOM, { before: id(1) });
  });

  it("reports a failed fetch and marks a 404 as room gone", async () => {
    const { store, messages } = await polling();
    store.loadOlder();
    messages.list[1].reject(new ApiRequestError(404, "not_found", "Room not found"));
    await flush();

    expect(store.getState().error).toEqual({ op: "older", message: "Room not found", notFound: true });
    expect(vi.getTimerCount()).toBe(0); // the reducer stopped polling
  });

  it("turns a synchronous throw from the API into fetchFailed", async () => {
    const { store, messages } = setup();
    vi.mocked(messages.api.list).mockImplementationOnce(() => {
      throw new Error("boom");
    });

    store.start({ hidden: false });
    await flush();

    expect(store.getState().error).toEqual({ op: "initial", message: "boom", notFound: false });
  });
});

describe("manual loadNewer completion", () => {
  it("resolves only after its own response is published", async () => {
    const { store, messages } = await polling();
    const seen: number[] = [];
    let settled = false;

    const done = store.loadNewer().then(() => {
      settled = true;
      seen.push(store.getState().messages.length);
    });
    store.dispatch({ type: "received", message: msg(9) }); // unrelated arrival
    await flush();
    expect(settled).toBe(false);

    messages.listAfter[1].resolve(catchUp([msg(3)], id(3)));
    await done;
    expect(seen).toEqual([4]); // 1, 2, 9 and the fetched 3
  });

  it("resolves after a failure is published and never rejects", async () => {
    const { store, messages } = await polling();

    const done = store.loadNewer();
    messages.listAfter[1].reject(new Error("offline"));
    await expect(done).resolves.toBeUndefined();

    expect(store.getState().error).toMatchObject({ op: "newer", message: "offline" });
  });

  it("resolves at once when ignored, without joining the fetch in flight", async () => {
    const { store, messages } = await polling();
    store.loadOlder();
    let settled = false;

    void store.loadNewer().then(() => {
      settled = true;
    });
    await flush();

    expect(settled).toBe(true);
    expect(store.getState().inflight).toBe("older");
    expect(messages.api.listAfter).toHaveBeenCalledTimes(1);
  });

  it("is not settled by a later automatic fetch", async () => {
    const { store, messages } = await polling();
    await vi.advanceTimersByTimeAsync(POLL); // tick fetch in flight: listAfter[1]
    let settled = false;
    void store.loadNewer().then(() => {
      settled = true;
    });
    await flush();
    expect(settled).toBe(true); // ignored, because the tick's fetch is running

    settled = false;
    messages.listAfter[1].resolve(catchUp([], id(2)));
    await flush();
    const mine = store.loadNewer().then(() => {
      settled = true;
    });
    await flush();
    expect(settled).toBe(false);
    messages.listAfter[2].resolve(catchUp([], id(2)));
    await mine;
  });

  it("resolves on disposal without publishing the late response", async () => {
    const { store, messages, listener } = await polling();
    const done = store.loadNewer();
    const before = store.getState().messages;
    listener.mockClear();

    store.dispose();
    await done;
    messages.listAfter[1].resolve(catchUp([msg(3)], id(3)));
    await flush();

    expect(store.getState().messages).toBe(before);
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("channel attempts", () => {
  it("cleans up a handle whose attempt failed before subscribe returned", async () => {
    const unsubscribe = vi.fn();
    const subscribe: SubscribeToRoom = (_roomId, handlers) => {
      handlers.onFailed("refused synchronously");
      handlers.onSubscribed(); // late success from a dead attempt
      return { unsubscribe };
    };
    const { store } = await opened({ subscribe });

    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(store.getState()).toMatchObject({ channel: "none", polling: true });
  });

  it("treats a throwing adapter as a failed attempt", async () => {
    const { store } = await opened({
      subscribe: () => {
        throw new Error("no websocket");
      },
    });

    expect(store.getState()).toMatchObject({ channel: "none", polling: true });
  });

  it("ignores success, inserts and repeated failures after the first failure", async () => {
    const { store, realtime, messages } = await opened();
    const { handlers, unsubscribe } = realtime.attempts[0];

    handlers.onFailed("CHANNEL_ERROR");
    handlers.onFailed("CLOSED");
    handlers.onSubscribed();
    handlers.onInsert(msg(5));

    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(store.getState()).toMatchObject({ channel: "none", polling: true });
    expect(store.getState().messages).toHaveLength(2);
    expect(messages.api.listAfter).toHaveBeenCalledTimes(1);
  });

  it("confirms, merges inserts and falls back to polling when the channel later drops", async () => {
    const { store, realtime, messages } = await opened();
    const { handlers, unsubscribe } = realtime.attempts[0];

    handlers.onSubscribed();
    handlers.onInsert(msg(3));
    expect(store.getState()).toMatchObject({ channel: "subscribed", polling: false });
    expect(store.getState().messages).toHaveLength(3);
    messages.listAfter[0].resolve(catchUp([msg(3)], id(3)));
    await flush();

    handlers.onFailed("CLOSED");
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(store.getState()).toMatchObject({ channel: "none", polling: true });
    expect(realtime.attempts).toHaveLength(1); // nothing re-subscribes by itself
  });

  it("recovers from a failed confirmation catch-up on the next tick only", async () => {
    const { store, realtime, messages } = await opened();
    realtime.attempts[0].handlers.onSubscribed();

    messages.listAfter[0].reject(new Error("offline"));
    await flush();
    expect(store.getState()).toMatchObject({ channel: "none", polling: true, syncCursor: id(2) });
    expect(realtime.attempts[0].unsubscribe).toHaveBeenCalledTimes(1);
    expect(messages.api.listAfter).toHaveBeenCalledTimes(1); // no immediate retry loop

    await vi.advanceTimersByTimeAsync(POLL);
    expect(messages.api.listAfter).toHaveBeenLastCalledWith(ROOM, id(2));
    messages.listAfter[1].resolve(catchUp([msg(3)], id(3)));
    await flush();
    expect(store.getState()).toMatchObject({ error: null, syncCursor: id(3) });
  });

  it("runs the catch-up owed by a confirmation even when the older page fails", async () => {
    const { store, realtime, messages } = await opened();
    store.loadOlder();
    realtime.attempts[0].handlers.onSubscribed(); // catch-up is owed: older is in flight

    messages.list[1].reject(new Error("offline"));
    await flush();

    expect(messages.api.listAfter).toHaveBeenCalledTimes(1);
    messages.listAfter[0].resolve(catchUp([], id(2)));
    await flush();
    expect(store.getState().error).toMatchObject({ op: "older" }); // still visible
  });

  it("keeps the backlog button as the retry after a failed backlog fetch", async () => {
    const { store, messages } = await polling();
    await vi.advanceTimersByTimeAsync(POLL);
    messages.listAfter[1].resolve(catchUp([msg(3)], id(3), true));
    await flush();

    const done = store.loadNewer();
    messages.listAfter[2].reject(new Error("offline"));
    await done;

    expect(store.getState()).toMatchObject({ backlog: true, syncCursor: id(3) });
    await vi.advanceTimersByTimeAsync(POLL * 2);
    expect(messages.api.listAfter).toHaveBeenCalledTimes(3); // ticks stay paused
  });

  it("restarts the idle timer on activity only while one runs", async () => {
    const { store, realtime } = await opened();
    store.activity(); // subscribing: no timer yet
    expect(vi.getTimerCount()).toBe(0);

    realtime.attempts[0].handlers.onSubscribed();
    await vi.advanceTimersByTimeAsync(IDLE - 1);
    store.activity();
    await vi.advanceTimersByTimeAsync(IDLE - 1);
    expect(store.getState().channel).toBe("subscribed");

    await vi.advanceTimersByTimeAsync(1);
    expect(store.getState()).toMatchObject({ channel: "none", polling: true });
  });
});

describe("visibility", () => {
  it.each([["unseeded", undefined], ["seeded", msg(7)]] as const)(
    "polls instead of subscribing when started hidden (%s)",
    async (_name, seed) => {
      const { store, messages, realtime } = setup({ seed });

      store.start({ hidden: true });
      if (!seed) {
        messages.list[0].resolve(page([msg(7)]));
        await flush();
      }

      expect(realtime.attempts).toHaveLength(0);
      expect(store.getState()).toMatchObject({ polling: true, channel: "none", hidden: true });
      expect(messages.api.listAfter).toHaveBeenCalledTimes(1);
    },
  );

  it("records hiding during the initial fetch and then selects polling", async () => {
    const { store, messages, realtime } = setup();
    store.start({ hidden: false });

    store.setHidden(true);
    messages.list[0].resolve(page([msg(1)]));
    await flush();

    expect(realtime.attempts).toHaveLength(0);
    expect(store.getState().polling).toBe(true);
  });

  it("cancels a pending join when hidden, and a late confirmation cannot revive it", async () => {
    const { store, realtime } = await opened();
    const { handlers, unsubscribe } = realtime.attempts[0];

    store.setHidden(true);
    handlers.onSubscribed();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(store.getState()).toMatchObject({ channel: "none", polling: true });
  });

  it("starts no second interval when hidden twice, and does nothing on becoming visible", async () => {
    const { store, messages, realtime } = await polling();

    store.setHidden(true);
    store.setHidden(true);
    store.setHidden(false);

    expect(vi.getTimerCount()).toBe(1);
    expect(messages.api.listAfter).toHaveBeenCalledTimes(1);
    expect(realtime.attempts).toHaveLength(1);
  });

  it("cancels a re-subscription when hidden, and a visible send may subscribe again", async () => {
    const { store, messages, realtime } = await polling();
    void store.send({ author: "ann", text: "one" });
    messages.post[0].resolve(msg(3));
    await flush();
    expect(realtime.attempts).toHaveLength(2);

    store.setHidden(true);
    expect(realtime.attempts[1].unsubscribe).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1); // the same poll interval, not a second one

    store.setHidden(false);
    expect(realtime.attempts).toHaveLength(2);
    void store.send({ author: "ann", text: "two" });
    messages.post[1].resolve(msg(4));
    await flush();
    expect(realtime.attempts).toHaveLength(3);
  });

  it("merges a send that finishes while hidden without rejoining", async () => {
    const { store, messages, realtime } = await polling();
    const sending = store.send({ author: "ann", text: "hi" });

    store.setHidden(true);
    messages.post[0].resolve(msg(3));
    await sending;

    expect(store.getState().messages.map((m) => m.id)).toContain(id(3));
    expect(realtime.attempts).toHaveLength(1);
  });
});

describe("send", () => {
  it("rejects without posting before start, while loading, after a failed load and after disposal", async () => {
    const { store, messages } = setup();
    const input = { author: "ann", text: "hi" };

    await expect(store.send(input)).rejects.toBeInstanceOf(FeedNotReadyError);
    store.start({ hidden: false });
    await expect(store.send(input)).rejects.toMatchObject({ code: "feed_not_ready" });

    messages.list[0].reject(new Error("offline"));
    await flush();
    await expect(store.send(input)).rejects.toBeInstanceOf(FeedNotReadyError);
    store.dismissError();
    await expect(store.send(input)).rejects.toBeInstanceOf(FeedNotReadyError);

    store.dispose();
    await expect(store.send(input)).rejects.toBeInstanceOf(FeedNotReadyError);
    expect(messages.api.post).not.toHaveBeenCalled();
  });

  it("rejects without posting once the room is gone", async () => {
    const { store, messages } = await polling();
    store.loadOlder();
    messages.list[1].reject(new ApiRequestError(404, "not_found"));
    await flush();

    await expect(store.send({ author: "ann", text: "hi" })).rejects.toBeInstanceOf(FeedNotReadyError);
    expect(messages.api.post).not.toHaveBeenCalled();
  });

  it("appends the posted message once; the next poll does not duplicate it", async () => {
    const { store, messages } = await polling();

    const sending = store.send({ author: "ann", text: "hi" });
    expect(messages.api.post).toHaveBeenCalledWith(ROOM, { author: "ann", text: "hi" });
    messages.post[0].resolve(msg(3));
    await expect(sending).resolves.toEqual(msg(3));
    expect(store.getState().syncCursor).toBe(id(2)); // a POST never moves the bookmark

    await vi.advanceTimersByTimeAsync(POLL);
    messages.listAfter[1].resolve(catchUp([msg(3)], id(3)));
    await flush();
    expect(store.getState().messages.map((m) => m.id)).toEqual([id(1), id(2), id(3)]);
  });

  it("rethrows a failed POST unchanged and dispatches nothing", async () => {
    const { store, messages, listener } = await polling();
    listener.mockClear();
    const failure = new ApiRequestError(500);

    const sending = store.send({ author: "ann", text: "hi" });
    messages.post[0].reject(failure);

    await expect(sending).rejects.toBe(failure);
    expect(listener).not.toHaveBeenCalled();
  });

  it("settles a POST that outlives the store without touching its state", async () => {
    const { store, messages } = await polling();
    const sending = store.send({ author: "ann", text: "hi" });

    store.dispose();
    const closed = store.getState();
    messages.post[0].resolve(msg(3));

    await expect(sending).resolves.toEqual(msg(3));
    expect(store.getState()).toBe(closed);
  });
});

describe("dispose", () => {
  it("releases the channel and every timer, is idempotent, and cannot restart", async () => {
    const { store, realtime, messages } = await opened();
    realtime.attempts[0].handlers.onSubscribed();
    expect(vi.getTimerCount()).toBe(1); // idle timer

    store.dispose();
    store.dispose();
    store.start({ hidden: false });

    expect(realtime.attempts[0].unsubscribe).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(store.getState().status).toBe("closed");
    expect(messages.api.list).toHaveBeenCalledTimes(1);
  });

  it("ignores a response that resolves afterwards and does not notify", async () => {
    const { store, messages, listener } = setup();
    store.start({ hidden: false });
    listener.mockClear();

    store.dispose();
    const closed = store.getState();
    messages.list[0].resolve(page([msg(1)]));
    await flush();

    expect(store.getState()).toBe(closed);
    expect(listener).not.toHaveBeenCalled();
  });

  it("cleans up a handle returned after a synchronous callback disposed the store", () => {
    const unsubscribe = vi.fn();
    const ctx = setup({
      seed: msg(1),
      subscribe: () => {
        ctx.store.dispose();
        return { unsubscribe };
      },
    });

    ctx.store.start({ hidden: false });

    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(ctx.store.getState().status).toBe("closed");
  });

  it("reduces reentrant actions iteratively, after the current effects", async () => {
    const seen: string[] = [];
    const subscribe: SubscribeToRoom = (_roomId, handlers) => {
      handlers.onSubscribed(); // synchronous, before the handle exists
      seen.push(ctx.store.getState().channel);
      return { unsubscribe: vi.fn() };
    };
    const ctx = setup({ seed: msg(1), subscribe });

    ctx.store.start({ hidden: false });

    expect(seen).toEqual(["subscribing"]); // queued, not reduced inside the effect
    expect(ctx.store.getState().channel).toBe("subscribed");
  });
});
