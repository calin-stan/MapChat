import type { CatchUpPage, Message, MessagePage } from "@/lib/schemas/types";

/**
 * Types of the room feed core (design: docs/superpowers/specs/2026-09-16-room-feed-design.md
 * §3–§4). The reducer in `@/lib/feed/reducer` is pure; effects are data that the
 * store (chunk 9) runs against the API client, the realtime adapter and timers.
 */

/** Which HTTP read an in-flight marker, a failure or an error refers to. */
export type FetchOp = "initial" | "older" | "newer";

/** A failed read. Kept until dismissed; a `notFound` error is terminal for the room. */
export type FeedError = {
  op: FetchOp;
  message: string;
  /** True when the API answered 404: the room is gone. */
  notFound: boolean;
};

export type FeedStatus = "opening" | "open" | "closed";

export type ChannelState = "none" | "subscribing" | "subscribed";

export type FeedState = {
  roomId: string;
  status: FeedStatus;
  /** Current document visibility; retained while opening. */
  hidden: boolean;
  /** Ascending by compareCreatedAtId, unique by id. */
  messages: Message[];
  /** First id of the last successful initial/before page; the "Load older" cursor. */
  olderCursor: string | null;
  /** hasMore of that page. */
  hasOlder: boolean;
  /** PRD 6.4 synchronization bookmark; set on open, then only `newerLoaded` moves it. */
  syncCursor: string | null;
  /** The last catch-up said hasMore; periodic catch-up is paused. */
  backlog: boolean;
  /** A catch-up is owed but another fetch is in flight. */
  newerWanted: boolean;
  /** At most one fetch at a time. */
  inflight: FetchOp | null;
  /** The poll timer is running. */
  polling: boolean;
  channel: ChannelState;
  error: FeedError | null;
  /** An empty initial history is retried once. */
  initialRetried: boolean;
};

/** What the panel shows: derived by `connectionOf`, never stored. */
export type Connection = "connecting" | "realtime" | "polling";

export type FeedAction =
  | { type: "opened"; hidden: boolean; seed?: Message } // seed = first message from atomic room creation
  | { type: "historyLoaded"; page: MessagePage }
  | { type: "olderRequested" }
  | { type: "olderLoaded"; page: MessagePage }
  | { type: "newerRequested" } // "Load more messages" click
  | { type: "pollTick" } // from the poll timer
  | { type: "newerLoaded"; page: CatchUpPage }
  | { type: "fetchFailed"; op: FetchOp; message: string; notFound: boolean }
  | { type: "received"; message: Message } // realtime insert or own POST response
  | { type: "sent" } // after a successful own POST
  | { type: "subscribed" }
  | { type: "channelFailed"; reason: string } // refusal, timeout, or drop after subscribed
  | { type: "idle" } // idle timer fired
  | { type: "visibilityChanged"; hidden: boolean }
  | { type: "errorDismissed" }
  | { type: "closed" };

export type FeedEffect =
  | { type: "fetchInitial" }
  | { type: "fetchOlder"; before: string }
  | { type: "fetchNewer"; after: string }
  | { type: "subscribe" }
  | { type: "unsubscribe" }
  | { type: "startPolling" }
  | { type: "stopPolling" }
  | { type: "startIdleTimer" }
  | { type: "stopIdleTimer" };
