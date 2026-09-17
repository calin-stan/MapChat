"use client";

import { FIXTURE_ROOM_ID, fixtureMessage, fixtureRange } from "@/app/e2e/fixtureMessages";
import { PanelSlot } from "@/components/panel/PanelSlot";
import { RoomPanel } from "@/components/room/RoomPanel";
import type { FeedDeps } from "@/lib/feed/store";

const room = {
  id: FIXTURE_ROOM_ID,
  name: "layout-fixture-room",
  lat: 45,
  lng: 5,
  createdAt: "2026-09-16T10:00:00.000000Z",
};

/**
 * A scripted feed: history loads, realtime is refused, the first catch-up
 * reports a backlog, the catch-up after it fails and every send fails. That
 * puts the moved notice (from the prefill), the fetch alert, the backlog
 * notice and a compose error on screen together. The script depends only on
 * the cursor, so Strict Mode's second store sees the same sequence as the
 * first.
 */
const feedDeps: FeedDeps = {
  messages: {
    list: async () => ({ messages: fixtureRange(1, 30), hasMore: true }),
    listAfter: async (_roomId, after) => {
      if (after !== fixtureMessage(30).id) throw new Error("fixture: catch-up fails");
      const next = fixtureMessage(31);
      return { messages: [next], hasMore: true, nextCursor: next.id };
    },
    post: async () => {
      throw new TypeError("fixture: send fails");
    },
  },
  subscribe: (_roomId, handlers) => {
    handlers.onFailed("fixture: polling only");
    return { unsubscribe: () => {} };
  },
  config: { pollIntervalMs: 3_600_000, realtimeIdleTimeoutMs: 3_600_000 },
};

/**
 * Dev-server-only fixture for tests/e2e (room-panel design §8 scenario 10):
 * the real RoomPanel in the real slot, to measure the footer with every notice
 * showing. Served at /e2e/room-panel-layout by `next dev`; absent from `next build`.
 */
export default function RoomPanelLayoutFixture() {
  return (
    <div className="relative h-dvh w-full overflow-hidden">
      <PanelSlot>
        <RoomPanel
          room={room}
          prefill={{ author: "ana", text: "unsent draft" }}
          onClose={() => {}}
          feedDeps={feedDeps}
        />
      </PanelSlot>
    </div>
  );
}
