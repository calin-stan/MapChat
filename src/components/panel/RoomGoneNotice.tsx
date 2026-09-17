import { FaTimes } from "react-icons/fa";

import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { Room } from "@/lib/schemas/types";

export type RoomGoneNoticeProps = { room: Room; onDismiss(): void };

export const roomGoneNoticeText = (room: Room) => `The chatroom ${room.name} no longer exists.`;

/**
 * The page-level notice after an open room answered 404 and its panel was
 * closed (chunk 12). It sits in the panel slot above the greeting and goes
 * away with the next selection or its own dismiss button. `role="status"`:
 * the notice reports something that already happened and asks for no action,
 * so it informs rather than alarms.
 */
export function RoomGoneNotice({ room, onDismiss }: RoomGoneNoticeProps) {
  return (
    <Alert role="status" className="shadow-sm has-data-[slot=alert-action]:pr-10">
      <AlertDescription>{roomGoneNoticeText(room)}</AlertDescription>
      <AlertAction>
        <Button variant="ghost" size="icon-xs" aria-label="Dismiss" onClick={onDismiss}>
          <FaTimes aria-hidden />
        </Button>
      </AlertAction>
    </Alert>
  );
}
