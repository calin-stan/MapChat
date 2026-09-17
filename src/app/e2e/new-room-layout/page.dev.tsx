"use client";

import { PanelSlot } from "@/components/panel/PanelSlot";
import { NewRoomPopup } from "@/components/room/NewRoomPopup";

// 120 lines of 24 characters and 119 newlines: 2999 code points, a valid draft.
const LONG_DRAFT = Array.from(
  { length: 120 },
  (_, index) => `line ${String(index + 1).padStart(3, "0")} of a long draft`,
).join("\n");

const recovery = {
  input: { lat: 45, lng: 5, author: "ann", text: LONG_DRAFT },
  error: new TypeError("fixture: the create response was lost"),
};

const ignore = () => {};

/**
 * Dev-server-only fixture for tests/e2e (new-room design §10 scenario 3): the
 * real NewRoomPopup in the real slot, recovered from a lost create response,
 * so the full uncertain-creation error and a long draft are on screen together.
 * Served at /e2e/new-room-layout by `next dev`; absent from `next build`.
 */
export default function NewRoomLayoutFixture() {
  return (
    <div className="relative h-dvh w-full overflow-hidden">
      <PanelSlot>
        <NewRoomPopup
          lat={45}
          lng={5}
          recovery={recovery}
          onCreated={ignore}
          onConflict={ignore}
          onFailed={ignore}
          onClose={ignore}
          createRoom={() => new Promise(() => {})}
        />
      </PanelSlot>
    </div>
  );
}
