import { vi } from "vitest";

import type { MessagesApi } from "@/lib/api/client";
import type { RealtimeHandlers, SubscribeToRoom } from "@/lib/feed/realtime";
import type { FeedTimers } from "@/lib/feed/store";
import type { PostMessageInput } from "@/lib/schemas/message";
import type { CatchUpPage, Message, MessagePage } from "@/lib/schemas/types";

export const ROOM = "11111111-1111-4111-8111-111111111111";
export const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** Message `n`, created `n` microseconds into the same second, so ids and times sort alike. */
export function msg(n: number, overrides: Partial<Message> = {}): Message {
  return {
    id: id(n),
    chatroomId: ROOM,
    author: `author-${n}`,
    text: `message ${n}`,
    createdAt: `2026-09-16T10:00:00.${String(n).padStart(6, "0")}Z`,
    ...overrides,
  };
}

export const page = (messages: Message[], hasMore = false): MessagePage => ({ messages, hasMore });

export function catchUp(messages: Message[], nextCursor: string, hasMore = false): CatchUpPage {
  return { messages, hasMore, nextCursor };
}

export type Deferred<T> = {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
};

export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

type Call<A, T> = Deferred<T> & { args: A };

/** A `MessagesApi` whose every call stays pending until the test settles it. */
export function fakeMessages() {
  const list: Call<{ before?: string }, MessagePage>[] = [];
  const listAfter: Call<{ after: string }, CatchUpPage>[] = [];
  const post: Call<{ input: PostMessageInput }, Message>[] = [];
  const api: MessagesApi = {
    list: vi.fn((_roomId: string, params?: { before?: string }) => {
      const call = { ...deferred<MessagePage>(), args: { before: params?.before } };
      list.push(call);
      return call.promise;
    }),
    listAfter: vi.fn((_roomId: string, after: string) => {
      const call = { ...deferred<CatchUpPage>(), args: { after } };
      listAfter.push(call);
      return call.promise;
    }),
    post: vi.fn((_roomId: string, input: PostMessageInput) => {
      const call = { ...deferred<Message>(), args: { input } };
      post.push(call);
      return call.promise;
    }),
  };
  return { api, list, listAfter, post };
}

/** A realtime adapter the test drives by hand: one entry per `subscribe` call. */
export function fakeRealtime() {
  const attempts: { handlers: RealtimeHandlers; unsubscribe: ReturnType<typeof vi.fn> }[] = [];
  const subscribe: SubscribeToRoom = (_roomId, handlers) => {
    const unsubscribe = vi.fn();
    attempts.push({ handlers, unsubscribe });
    return { unsubscribe };
  };
  return { subscribe, attempts };
}

export const TEST_CONFIG = { pollIntervalMs: 30_000, realtimeIdleTimeoutMs: 180_000 };

/** Timers the test fires by hand, for component tests that keep real timers for user-event. */
export function manualTimers() {
  const intervals = new Map<number, () => void>();
  let nextId = 1;
  let idleStarts = 0;
  const timers = {
    setInterval: (callback: () => void) => {
      intervals.set(nextId, callback);
      return nextId++;
    },
    clearInterval: (handle: number) => void intervals.delete(handle),
    // The idle timer never fires in these tests; they count how often it is (re)started.
    setTimeout: () => {
      idleStarts += 1;
      return 0;
    },
    clearTimeout: () => {},
  } as unknown as FeedTimers;
  return {
    timers,
    tick: () => [...intervals.values()].forEach((callback) => callback()),
    idleStarts: () => idleStarts,
  };
}
