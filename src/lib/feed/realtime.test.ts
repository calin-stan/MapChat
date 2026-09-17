import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POSTGRES_READY_TIMEOUT_MS, TOPIC_BUSY, subscribeToRoom, type RealtimeHandlers } from "@/lib/feed/realtime";
import { createFeedStore } from "@/lib/feed/store";
import { ROOM, TEST_CONFIG, catchUp, fakeMessages, id, msg, page } from "@/lib/feed/test-helpers";

const { getBrowserClient } = vi.hoisted(() => ({ getBrowserClient: vi.fn() }));
vi.mock("@/lib/supabase/browser", () => ({ getBrowserClient }));

type StatusCallback = (status: string, error?: Error) => void;
type InsertCallback = (payload: { new: unknown }) => void;

type FakeChannel = {
  topic: string;
  on: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
  /** What the adapter registered, for the test to call as the SDK would. */
  status: StatusCallback;
  insert: InsertCallback;
  system(payload: unknown): void;
};

/**
 * The slice of `SupabaseClient` the adapter uses. Like the SDK, it keeps a
 * channel registered until it is removed, and removal reports CLOSED to the
 * channel's status callback before it resolves.
 */
function fakeClient() {
  const registered: FakeChannel[] = [];
  const channel = vi.fn((name: string) => {
    const created: FakeChannel = {
      topic: `realtime:${name}`,
      on: vi.fn((type: string, _filter: unknown, callback: unknown) => {
        if (type === "system") created.system = callback as (payload: unknown) => void;
        else created.insert = callback as InsertCallback;
        return created;
      }),
      subscribe: vi.fn((callback: StatusCallback) => {
        created.status = callback;
        return created;
      }),
      status: () => {},
      insert: () => {},
      system: () => {},
    };
    registered.push(created);
    return created;
  });
  const removeChannel = vi.fn(async (removed: FakeChannel) => {
    removed.status("CLOSED");
    registered.splice(registered.indexOf(removed), 1);
    return "ok" as const;
  });
  const client = { channel, removeChannel, getChannels: () => registered };
  return { client: client as unknown as SupabaseClient, channel, removeChannel, registered };
}

function fakeHandlers() {
  return { onSubscribed: vi.fn(), onFailed: vi.fn(), onInsert: vi.fn() } satisfies RealtimeHandlers;
}

/** The row Postgres Changes delivers for `msg(n)`: snake_case, as stored. */
function row(n: number) {
  const message = msg(n);
  return {
    id: message.id,
    chatroom_id: message.chatroomId,
    author: message.author,
    text: message.text,
    created_at: message.createdAt,
  };
}

function setup() {
  const fake = fakeClient();
  const handlers = fakeHandlers();
  const handle = subscribeToRoom(ROOM, handlers, fake.client);
  return { ...fake, handlers, handle, channel: fake.registered[0] };
}

const postgresReady = (channel: FakeChannel) => channel.system({
  extension: "postgres_changes", status: "ok", channel: `room:${ROOM}`,
});
const confirm = (channel: FakeChannel) => {
  channel.status("SUBSCRIBED");
  postgresReady(channel);
};

beforeEach(() => vi.useFakeTimers());

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  getBrowserClient.mockReset();
});

describe("subscribeToRoom", () => {
  it("joins room:<id> for INSERTs on the room's messages", () => {
    const fake = fakeClient();

    subscribeToRoom(ROOM, fakeHandlers(), fake.client);

    expect(fake.channel).toHaveBeenCalledTimes(1);
    expect(fake.channel).toHaveBeenCalledWith(`room:${ROOM}`);
    const [created] = fake.registered;
    expect(created.on).toHaveBeenCalledWith(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "messages", filter: `chatroom_id=eq.${ROOM}` },
      expect.any(Function),
    );
    expect(created.on).toHaveBeenCalledWith("system", {}, expect.any(Function));
    expect(created.subscribe).toHaveBeenCalledTimes(1);
  });

  it("uses the browser client when none is passed", () => {
    const fake = fakeClient();
    getBrowserClient.mockReturnValue(fake.client);

    subscribeToRoom(ROOM, fakeHandlers());

    expect(getBrowserClient).toHaveBeenCalledTimes(1);
    expect(fake.channel).toHaveBeenCalledWith(`room:${ROOM}`);
  });

  it("waits for Postgres readiness after SUBSCRIBED, then confirms once", () => {
    const { channel, handlers, removeChannel } = setup();

    channel.status("SUBSCRIBED");

    expect(handlers.onSubscribed).not.toHaveBeenCalled();
    postgresReady(channel);
    postgresReady(channel);
    channel.status("SUBSCRIBED");
    expect(handlers.onSubscribed).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(handlers.onFailed).not.toHaveBeenCalled();
    expect(removeChannel).not.toHaveBeenCalled();
  });

  it.each([
    ["CHANNEL_ERROR", new Error("too_many_joins"), "CHANNEL_ERROR: too_many_joins"],
    ["CHANNEL_ERROR", undefined, "CHANNEL_ERROR"],
    ["TIMED_OUT", undefined, "TIMED_OUT"],
    ["CLOSED", undefined, "CLOSED"],
  ])("reports %s as a failure and removes the channel (%#)", (status, error, reason) => {
    const { channel, handlers, removeChannel } = setup();

    channel.status(status, error);

    expect(handlers.onFailed).toHaveBeenCalledTimes(1);
    expect(handlers.onFailed).toHaveBeenCalledWith(reason);
    expect(removeChannel).toHaveBeenCalledTimes(1);
    expect(removeChannel).toHaveBeenCalledWith(channel);
  });

  it("reports a drop after SUBSCRIBED as a failure", () => {
    const { channel, handlers, removeChannel } = setup();

    confirm(channel);
    channel.status("CHANNEL_ERROR", new Error("socket closed"));

    expect(handlers.onFailed).toHaveBeenCalledWith("CHANNEL_ERROR: socket closed");
    expect(removeChannel).toHaveBeenCalledTimes(1);
  });

  it("is silent after the first failure: no second failure, success or insert", () => {
    const { channel, handlers, handle, removeChannel } = setup();

    channel.status("TIMED_OUT"); // removal reports CLOSED through the fake, as the SDK does
    channel.status("CHANNEL_ERROR", new Error("again"));
    confirm(channel);
    channel.insert({ new: row(3) });
    handle.unsubscribe();

    expect(handlers.onFailed).toHaveBeenCalledTimes(1);
    expect(handlers.onSubscribed).not.toHaveBeenCalled();
    expect(handlers.onInsert).not.toHaveBeenCalled();
    expect(removeChannel).toHaveBeenCalledTimes(1);
  });

  it("maps an inserted row to a Message", () => {
    const { channel, handlers } = setup();
    channel.status("SUBSCRIBED");

    channel.insert({ new: row(3) });

    expect(handlers.onInsert).toHaveBeenCalledTimes(1);
    expect(handlers.onInsert).toHaveBeenCalledWith(msg(3));
  });

  it("keeps microseconds from the +00:00 form Postgres Changes sends", () => {
    const { channel, handlers } = setup();

    channel.insert({ new: { ...row(3), created_at: "2026-09-16T10:00:00.000003+00:00" } });

    expect(handlers.onInsert).toHaveBeenCalledWith(msg(3));
  });

  it("drops and logs a malformed row without failing the channel", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { channel, handlers, removeChannel } = setup();
    channel.status("SUBSCRIBED");

    channel.insert({ new: { ...row(3), chatroom_id: undefined } });
    channel.insert({ new: row(4) });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(handlers.onFailed).not.toHaveBeenCalled();
    expect(removeChannel).not.toHaveBeenCalled();
    expect(handlers.onInsert).toHaveBeenCalledTimes(1);
    expect(handlers.onInsert).toHaveBeenCalledWith(msg(4));
  });

  it("unsubscribes silently: the CLOSED of its own removal is not a failure", () => {
    const { channel, handlers, handle, removeChannel } = setup();
    channel.status("SUBSCRIBED");

    handle.unsubscribe();
    channel.insert({ new: row(3) });
    channel.status("CHANNEL_ERROR");
    handle.unsubscribe();

    expect(removeChannel).toHaveBeenCalledTimes(1);
    expect(removeChannel).toHaveBeenCalledWith(channel);
    expect(handlers.onFailed).not.toHaveBeenCalled();
    expect(handlers.onInsert).not.toHaveBeenCalled();
  });

  it("survives a removal that rejects", async () => {
    const { channel, handlers, removeChannel } = setup();
    removeChannel.mockRejectedValueOnce(new Error("socket gone"));

    channel.status("TIMED_OUT");
    await Promise.resolve();

    expect(handlers.onFailed).toHaveBeenCalledTimes(1);
  });

  it("refuses while the room's previous channel is still registered, and leaves it alone", () => {
    const fake = fakeClient();
    subscribeToRoom(ROOM, fakeHandlers(), fake.client); // still leaving, as far as the SDK knows
    const handlers = fakeHandlers();

    const handle = subscribeToRoom(ROOM, handlers, fake.client);
    handle.unsubscribe();

    expect(handlers.onFailed).toHaveBeenCalledTimes(1);
    expect(handlers.onFailed).toHaveBeenCalledWith(TOPIC_BUSY);
    expect(fake.channel).toHaveBeenCalledTimes(1);
    expect(fake.removeChannel).not.toHaveBeenCalled();
  });

  it("joins another room while one is open", () => {
    const fake = fakeClient();
    subscribeToRoom(ROOM, fakeHandlers(), fake.client);
    const handlers = fakeHandlers();

    subscribeToRoom(id(9), handlers, fake.client);

    expect(handlers.onFailed).not.toHaveBeenCalled();
    expect(fake.channel).toHaveBeenLastCalledWith(`room:${id(9)}`);
  });
  it("accepts readiness before the channel callback without confirming early", () => {
    const { channel, handlers } = setup();
    postgresReady(channel);
    expect(handlers.onSubscribed).not.toHaveBeenCalled();
    channel.status("SUBSCRIBED");
    expect(handlers.onSubscribed).toHaveBeenCalledTimes(1);
  });

  it("ignores unrelated, wrong-channel and malformed system events", () => {
    const { channel, handlers } = setup();
    channel.status("SUBSCRIBED");
    channel.system(null);
    channel.system({ extension: "system", status: "ok", channel: `room:${ROOM}` });
    channel.system({ extension: "postgres_changes", status: "ok", channel: "another-room" });
    channel.system({ extension: "postgres_changes", channel: `room:${ROOM}` });
    expect(handlers.onSubscribed).not.toHaveBeenCalled();
    expect(handlers.onFailed).not.toHaveBeenCalled();
    postgresReady(channel);
    expect(handlers.onSubscribed).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])("bounds missing readiness, joined=%s", (joined) => {
    const { channel, handlers, removeChannel } = setup();
    if (joined) channel.status("SUBSCRIBED");
    vi.advanceTimersByTime(POSTGRES_READY_TIMEOUT_MS);
    expect(handlers.onFailed).toHaveBeenCalledExactlyOnceWith("POSTGRES_READY_TIMEOUT");
    confirm(channel);
    expect(handlers.onSubscribed).not.toHaveBeenCalled();
    expect(removeChannel).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([false, true])("fails on a Postgres error, already ready=%s", (ready) => {
    const { channel, handlers, removeChannel } = setup();
    if (ready) confirm(channel);
    channel.system({ extension: "postgres_changes", status: "error", channel: `room:${ROOM}`, message: "unavailable" });
    expect(handlers.onFailed).toHaveBeenCalledExactlyOnceWith("POSTGRES_CHANGES_ERROR: unavailable");
    expect(removeChannel).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("fails on a Postgres error whose message is not a string", () => {
    const { channel, handlers, removeChannel } = setup();
    confirm(channel);
    channel.system({ extension: "postgres_changes", status: "error", channel: `room:${ROOM}`, message: null });
    expect(handlers.onFailed).toHaveBeenCalledExactlyOnceWith("POSTGRES_CHANGES_ERROR");
    expect(removeChannel).toHaveBeenCalledTimes(1);
  });

  it("cancels the deadline and ignores readiness after disposal", () => {
    const { channel, handlers, handle } = setup();
    channel.status("SUBSCRIBED");
    handle.unsubscribe();
    expect(vi.getTimerCount()).toBe(0);
    confirm(channel);
    vi.advanceTimersByTime(POSTGRES_READY_TIMEOUT_MS);
    expect(handlers.onSubscribed).not.toHaveBeenCalled();
    expect(handlers.onFailed).not.toHaveBeenCalled();
  });

  it("catches an insert between channel join and Postgres readiness through the real store", async () => {
    const fake = fakeClient();
    const messages = fakeMessages();
    const store = createFeedStore(ROOM, {
      messages: messages.api, config: TEST_CONFIG,
      subscribe: (roomId, handlers) => subscribeToRoom(roomId, handlers, fake.client),
    });
    store.start({ hidden: false });
    messages.list[0].resolve(page([msg(1), msg(2)]));
    await vi.advanceTimersByTimeAsync(0);
    const [channel] = fake.registered;
    channel.status("SUBSCRIBED");
    expect(store.getState().channel).toBe("subscribing");
    expect(messages.api.listAfter).not.toHaveBeenCalled();
    // Message 3 commits now; no insert callback arrives before replication is ready.
    postgresReady(channel);
    expect(messages.api.listAfter).toHaveBeenCalledExactlyOnceWith(ROOM, id(2));
    messages.listAfter[0].resolve(catchUp([msg(3)], id(3)));
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getState().messages.map((message) => message.id)).toEqual([id(1), id(2), id(3)]);
    expect(store.getState()).toMatchObject({ channel: "subscribed", polling: false });
    store.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["error", "deadline"])("enters polling through the store on readiness %s", async (failure) => {
    const fake = fakeClient();
    const messages = fakeMessages();
    const store = createFeedStore(ROOM, {
      messages: messages.api, config: TEST_CONFIG,
      subscribe: (roomId, handlers) => subscribeToRoom(roomId, handlers, fake.client),
    });
    store.start({ hidden: false });
    messages.list[0].resolve(page([msg(1), msg(2)]));
    await vi.advanceTimersByTimeAsync(0);
    const [channel] = fake.registered;
    channel.status("SUBSCRIBED");
    if (failure === "error") {
      channel.system({ extension: "postgres_changes", status: "error", channel: `room:${ROOM}` });
    } else {
      await vi.advanceTimersByTimeAsync(POSTGRES_READY_TIMEOUT_MS);
    }
    expect(store.getState()).toMatchObject({ channel: "none", polling: true });
    expect(messages.api.listAfter).toHaveBeenCalledExactlyOnceWith(ROOM, id(2));
    expect(fake.removeChannel).toHaveBeenCalledTimes(1);
    store.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

});
