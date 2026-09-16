import { z } from "zod";

import { trimmedText } from "@/lib/schemas/common";

/** Display name (PRD 4): 1 to 100 characters after trimming. */
export const authorSchema = trimmedText(1, 100);

/** Message body (PRD 4): 1 to 3000 characters after trimming; inner whitespace is kept. */
export const messageTextSchema = trimmedText(1, 3000);

/**
 * Body of `POST /api/rooms/:id/messages`, and the compose form's values.
 * Unknown keys are dropped, so a client cannot choose the room or timestamp.
 */
export const postMessageInputSchema = z.object({
  author: authorSchema,
  text: messageTextSchema,
});

export type PostMessageInput = z.infer<typeof postMessageInputSchema>;
