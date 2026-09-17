import { FaSpinner } from "react-icons/fa";

import { Button } from "@/components/ui/button";

export type BacklogNoticeProps = { disabled: boolean; busy: boolean; onLoadMore(): void };

/** Shown above the compose form while a catch-up page said more rows exist (PRD 4 "History"). */
export function BacklogNotice({ disabled, busy, onLoadMore }: BacklogNoticeProps) {
  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <p className="text-muted-foreground">More messages are available</p>
      <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={onLoadMore}>
        {busy ? <FaSpinner aria-hidden className="animate-spin" /> : null}
        Load more messages
      </Button>
    </div>
  );
}
