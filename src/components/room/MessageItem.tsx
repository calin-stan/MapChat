import { memo } from "react";

import type { Message } from "@/lib/schemas/types";
import { formatMessageTime } from "@/lib/time/format";

/**
 * One row (map-shell design §8), an `article` so tests and assistive tech can
 * address rows by role. `data-message-id` is how the list finds a row to
 * measure. Memoized: a row re-renders only when its message changes.
 */
export const MessageItem = memo(function MessageItem({ message }: { message: Message }) {
  return (
    <article data-message-id={message.id} className="flex flex-col gap-0.5 py-1.5">
      <p className="font-medium">{message.author}</p>
      <p className="break-words whitespace-pre-wrap">{message.text}</p>
      <time dateTime={message.createdAt} className="self-end text-xs text-muted-foreground">
        {formatMessageTime(message.createdAt)}
      </time>
    </article>
  );
});
