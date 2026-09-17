import { FaSpinner } from "react-icons/fa";

import { Button } from "@/components/ui/button";

export type LoadOlderButtonProps = { disabled: boolean; busy: boolean; onClick(): void };

/** First element of the message list. Presentational: the list derives the flags. */
export function LoadOlderButton({ disabled, busy, onClick }: LoadOlderButtonProps) {
  return (
    <div className="flex justify-center pb-2">
      <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={onClick}>
        {busy ? <FaSpinner aria-hidden className="animate-spin" /> : null}
        Load older
      </Button>
    </div>
  );
}
