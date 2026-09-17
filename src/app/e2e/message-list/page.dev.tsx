"use client";

import { useState } from "react";

import { fixtureRange } from "@/app/e2e/fixtureMessages";
import { PanelFrame } from "@/components/panel/PanelFrame";
import { PanelSlot } from "@/components/panel/PanelSlot";
import { MessageList } from "@/components/room/MessageList";

/**
 * Dev-server-only fixture for tests/e2e (room-panel design §8 scenario 9): the
 * real MessageList in the real panel slot, with props the test changes in one
 * commit. Served at /e2e/message-list by `next dev`; absent from `next build`.
 */
export default function MessageListFixture() {
  const [messages, setMessages] = useState(() => fixtureRange(11, 40));

  return (
    <div className="relative h-dvh w-full overflow-hidden">
      <button type="button" className="m-4 underline" onClick={() => setMessages(fixtureRange(1, 50))}>
        Add rows above and below
      </button>
      <PanelSlot>
        <PanelFrame title="MessageList fixture">
          <MessageList messages={messages} hasOlder loading={null} onLoadOlder={() => {}} />
        </PanelFrame>
      </PanelSlot>
    </div>
  );
}
