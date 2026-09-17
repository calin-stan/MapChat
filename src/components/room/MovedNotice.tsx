import { FaTimes } from "react-icons/fa";

import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export type MovedNoticeProps = { onDismiss(): void };

/** The first sentence is PRD 3 Flow A's wording; the second says why the form below is prefilled. */
export const MOVED_NOTICE_TEXT =
  "A chatroom already exists here, you have been moved to it. Your message has not been sent.";

/**
 * Shown at the top of the room panel's footer after a create landed on an
 * existing room (new-room design §7). `role="status"`: it informs, it is not an error.
 */
export function MovedNotice({ onDismiss }: MovedNoticeProps) {
  return (
    <Alert role="status" className="has-data-[slot=alert-action]:pr-10">
      <AlertDescription>{MOVED_NOTICE_TEXT}</AlertDescription>
      <AlertAction>
        <Button variant="ghost" size="icon-xs" aria-label="Dismiss" onClick={onDismiss}>
          <FaTimes aria-hidden />
        </Button>
      </AlertAction>
    </Alert>
  );
}
