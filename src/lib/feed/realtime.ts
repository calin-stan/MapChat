import type { SupabaseClient } from "@supabase/supabase-js";

import type { Message } from "@/lib/schemas/types";

/**
 * The realtime adapter contract (room-feed design §8). Chunk 9 ships the types
 * and a stand-in adapter; chunk 11 adds `subscribeToRoom` here and makes it the default.
 */
export type RealtimeHandle = { unsubscribe(): void };

export type RealtimeHandlers = {
  onSubscribed(): void;
  /** May fire after `onSubscribed` when the channel later drops. */
  onFailed(reason: string): void;
  onInsert(message: Message): void;
};

export type SubscribeToRoom = (
  roomId: string,
  handlers: RealtimeHandlers,
  client?: SupabaseClient,
) => RealtimeHandle;

/**
 * Chunk 9's default adapter: realtime is refused on the next macrotask, so
 * every room runs in polling mode end to end (room-feed design §7).
 */
export const pollingOnlySubscribe: SubscribeToRoom = (_roomId, handlers) => {
  const timer = setTimeout(() => handlers.onFailed("realtime not implemented"), 0);
  return { unsubscribe: () => clearTimeout(timer) };
};
