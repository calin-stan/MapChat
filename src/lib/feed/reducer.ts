import type { Connection, FeedState } from "@/lib/feed/types";
import type { Message } from "@/lib/schemas/types";

import { compareCreatedAtId } from "@/lib/time/ordering";

/** Error message when initial history is empty twice (spec §5 "Opening"). */
export const EMPTY_HISTORY_MESSAGE = "Room has no messages";

export function initialFeedState(roomId: string): FeedState {
  return {
    roomId,
    status: "opening",
    hidden: false,
    messages: [],
    olderCursor: null,
    hasOlder: false,
    syncCursor: null,
    backlog: false,
    newerWanted: false,
    inflight: null,
    polling: false,
    channel: "none",
    error: null,
    initialRetried: false,
  };
}

/** What the panel shows: a confirmed channel wins, then a running poll timer. */
export function connectionOf(state: FeedState): Connection {
  if (state.channel === "subscribed") return "realtime";
  if (state.polling) return "polling";
  return "connecting";
}

/**
 * Dedupes `incoming` against `existing` by id (the existing row wins) and
 * returns the union in `compareCreatedAtId` order. `existing` must already be
 * sorted (the state invariant); it is returned as is when nothing is new.
 * Never mutates its inputs and never touches cursors.
 */
export function mergeMessages(existing: Message[], incoming: Message[]): Message[] {
  const known = new Set(existing.map((message) => message.id));
  const fresh: Message[] = [];
  for (const message of incoming) {
    if (known.has(message.id)) continue;
    known.add(message.id);
    fresh.push(message);
  }
  if (fresh.length === 0) return existing;
  return [...existing, ...fresh].sort(compareCreatedAtId);
}
