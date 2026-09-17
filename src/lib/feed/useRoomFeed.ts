import { useLayoutEffect, useMemo, useState, useSyncExternalStore } from "react";

import { api } from "@/lib/api/client";
import { getClientConfig } from "@/lib/config/client";
import { subscribeToRoom } from "@/lib/feed/realtime";
import { connectionOf, initialFeedState } from "@/lib/feed/reducer";
import { FeedNotReadyError, createFeedStore, type FeedDeps, type FeedStore } from "@/lib/feed/store";
import type { Connection, FeedError, FeedState } from "@/lib/feed/types";
import type { PostMessageInput } from "@/lib/schemas/message";
import type { Message } from "@/lib/schemas/types";

export type RoomFeed = {
  /** A started, live store with an open room and no room-gone error. */
  ready: boolean;
  messages: Message[];
  hasOlder: boolean;
  backlog: boolean;
  loading: FeedState["inflight"];
  connection: Connection;
  error: FeedError | null;
  loadOlder(): void;
  loadNewer(): Promise<void>;
  send(input: PostMessageInput): Promise<Message>;
  activity(): void;
  dismissError(): void;
};

export type RoomFeedOptions = { seed?: Message; deps?: Partial<FeedDeps> };

/** What rendering reads: the feed state, and whether a live store stands behind it. */
type Snapshot = { state: FeedState; live: boolean };

type Bridge = ReturnType<typeof createBridge>;

/**
 * The render-side half of the hook (room-feed design §7): an inert snapshot
 * holder with stable callbacks. Creating it fetches nothing and reads no
 * browser global, so abandoned renders and server rendering are free. A store
 * is attached by the committed effect and detached by its cleanup.
 */
function createBridge(roomId: string, options: RoomFeedOptions) {
  const opening: Snapshot = { state: initialFeedState(roomId), live: false };
  let snapshot = opening;
  let store: FeedStore | null = null;
  const listeners = new Set<() => void>();

  function publish(next: Snapshot) {
    snapshot = next;
    for (const listener of [...listeners]) listener();
  }

  return {
    roomId,
    options, // captured once per room identity; later prop changes do nothing
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    getServerSnapshot: () => opening,
    /** Connects a fresh store; the returned function disconnects it and publishes `live: false`. */
    attach(next: FeedStore) {
      store = next;
      const detach = next.subscribe(() => publish({ state: next.getState(), live: true }));
      return () => {
        detach();
        if (store === next) store = null;
        publish({ state: snapshot.state, live: false });
      };
    },
    loadOlder: () => store?.loadOlder(),
    loadNewer: () => store?.loadNewer() ?? Promise.resolve(),
    send: (input: PostMessageInput) => store?.send(input) ?? Promise.reject(new FeedNotReadyError()),
    activity: () => store?.activity(),
    dismissError: () => store?.dismissError(),
  };
}

/** Browser defaults, resolved inside the effect so rendering never touches them. */
function resolveDeps(deps: Partial<FeedDeps> = {}): FeedDeps {
  return {
    messages: deps.messages ?? api.messages,
    subscribe: deps.subscribe ?? subscribeToRoom,
    config: deps.config ?? getClientConfig(),
    timers: deps.timers,
  };
}

/**
 * The open room as React state (room-feed design §7). Each committed effect
 * setup creates and starts a fresh store and tracks document visibility;
 * cleanup disposes it for good, so Strict Mode's replay and a `roomId` change
 * never reuse a disposed store.
 */
export function useRoomFeed(roomId: string, opts?: RoomFeedOptions): RoomFeed {
  const [held, setHeld] = useState(() => createBridge(roomId, opts ?? {}));
  let bridge: Bridge = held;
  if (held.roomId !== roomId) {
    // Another room: switch to a fresh inert bridge in this same render.
    bridge = createBridge(roomId, opts ?? {});
    setHeld(bridge);
  }

  const snapshot = useSyncExternalStore(bridge.subscribe, bridge.getSnapshot, bridge.getServerSnapshot);

  // A layout effect, so a seeded room is ready before the first paint.
  useLayoutEffect(() => {
    const store = createFeedStore(bridge.roomId, resolveDeps(bridge.options.deps), bridge.options.seed);
    const detach = bridge.attach(store);
    const onVisibilityChange = () => store.setHidden(document.visibilityState === "hidden");
    document.addEventListener("visibilitychange", onVisibilityChange);
    store.start({ hidden: document.visibilityState === "hidden" });
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      detach();
      store.dispose();
    };
  }, [bridge]);

  return useMemo(() => {
    const { state, live } = snapshot;
    return {
      ready: live && state.status === "open" && !state.error?.notFound,
      messages: state.messages,
      hasOlder: state.hasOlder,
      backlog: state.backlog,
      loading: state.inflight,
      connection: connectionOf(state),
      error: state.error,
      loadOlder: bridge.loadOlder,
      loadNewer: bridge.loadNewer,
      send: bridge.send,
      activity: bridge.activity,
      dismissError: bridge.dismissError,
    };
  }, [snapshot, bridge]);
}
