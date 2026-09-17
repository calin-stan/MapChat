import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { toMessage } from "@/lib/db/rows";
import type { Message } from "@/lib/schemas/types";
import { getBrowserClient } from "@/lib/supabase/browser";

/** The realtime adapter contract (room-feed design §8). */
export type RealtimeHandle = { unsubscribe(): void };

export type RealtimeHandlers = {
  onSubscribed(): void;
  /** May fire after `onSubscribed` when the channel later drops. At most once per attempt. */
  onFailed(reason: string): void;
  onInsert(message: Message): void;
};

export type SubscribeToRoom = (
  roomId: string,
  handlers: RealtimeHandlers,
  client?: SupabaseClient,
) => RealtimeHandle;

/** The reason reported when the previous channel of the same room has not finished leaving. */
export const TOPIC_BUSY = "previous channel is still closing";
export const POSTGRES_READY_TIMEOUT_MS = 20_000;

const postgresStatus = z.object({
  extension: z.literal("postgres_changes"),
  status: z.enum(["ok", "error"]),
  channel: z.string(),
  message: z.unknown().optional(),
});

/**
 * One subscription attempt on channel `room:<id>`: INSERTs on `public.messages`
 * of that room (PRD 6.4). The first failure is terminal: the channel is removed
 * so the SDK cannot rejoin behind the feed's polling, and nothing is reported
 * afterwards. `unsubscribe()` ends the attempt the same way, silently.
 */
export const subscribeToRoom: SubscribeToRoom = (roomId, handlers, client = getBrowserClient()) => {
  const name = `room:${roomId}`;

  // The SDK hands back an existing channel of the same topic, and `subscribe()` on
  // one that is still leaving does nothing, without any status. Refuse instead.
  if (client.getChannels().some((existing) => existing.topic === `realtime:${name}`)) {
    handlers.onFailed(TOPIC_BUSY);
    return { unsubscribe: () => {} };
  }

  let ended = false; // failed or unsubscribed: every SDK callback is ignored from here
  const channel = client.channel(name);
  let joined = false;
  let postgresReady = false;
  let confirmed = false;
  const deadline = setTimeout(() => fail("POSTGRES_READY_TIMEOUT"), POSTGRES_READY_TIMEOUT_MS);

  function end() {
    ended = true; // before removal: leaving makes the SDK report CLOSED
    clearTimeout(deadline);
    client.removeChannel(channel).catch(() => {});
  }

  function fail(reason: string) {
    if (ended) return;
    end();
    handlers.onFailed(reason);
  }

  function confirmIfReady() {
    if (ended || confirmed || !joined || !postgresReady) return;
    confirmed = true;
    clearTimeout(deadline);
    handlers.onSubscribed();
  }

  try {
    channel
      .on("system", {}, (payload: unknown) => {
        if (ended) return;
        const result = postgresStatus.safeParse(payload);
        if (!result.success || result.data.channel !== name) return;
        if (result.data.status === "error") {
          const { message } = result.data;
          fail(typeof message === "string" && message !== "" ? `POSTGRES_CHANGES_ERROR: ${message}` : "POSTGRES_CHANGES_ERROR");
          return;
        }
        postgresReady = true;
        confirmIfReady();
      })
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `chatroom_id=eq.${roomId}` },
        (payload) => {
          if (ended) return;
          let message: Message;
          try {
            message = toMessage(payload.new);
          } catch (error) {
            console.warn(`Realtime ${name}: dropped a row.`, error);
            return;
          }
          handlers.onInsert(message);
        },
      )
      .subscribe((status, error) => {
        if (ended) return;
        if (status === "SUBSCRIBED") {
          joined = true;
          confirmIfReady();
          return;
        }
        // CHANNEL_ERROR, TIMED_OUT, or a CLOSED this adapter did not ask for.
        fail(error ? `${status}: ${error.message}` : status);
      });
  } catch (error) {
    end(); // synchronous SDK setup errors must not leave the deadline/channel behind
    throw error; // the store translates a throwing adapter into channelFailed
  }

  return {
    unsubscribe() {
      if (!ended) end();
    },
  };
};

/**
 * An adapter that refuses realtime on the next macrotask, so a room runs in
 * polling mode end to end. For tests and fixtures; the hook's default is
 * `subscribeToRoom`.
 */
export const pollingOnlySubscribe: SubscribeToRoom = (_roomId, handlers) => {
  const timer = setTimeout(() => handlers.onFailed("realtime refused"), 0);
  return { unsubscribe: () => clearTimeout(timer) };
};
