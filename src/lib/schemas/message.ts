import { z } from "zod";

import { trimmedText } from "@/lib/schemas/common";

/** Display name limit (PRD 4), in code points after trimming. */
export const AUTHOR_MAX_CHARS = 100;

/** Message body limit (PRD 4), in code points after trimming. */
export const TEXT_MAX_CHARS = 3000;

/** Display name (PRD 4): 1 to 100 characters after trimming. */
export const authorSchema = trimmedText(1, AUTHOR_MAX_CHARS);

/** Message body (PRD 4): 1 to 3000 characters after trimming; inner whitespace is kept. */
export const messageTextSchema = trimmedText(1, TEXT_MAX_CHARS);

/**
 * Body of `POST /api/rooms/:id/messages`, and the compose form's values.
 * Unknown keys are dropped, so a client cannot choose the room or timestamp.
 */
export const postMessageInputSchema = z.object({
  author: authorSchema,
  text: messageTextSchema,
});

export type PostMessageInput = z.infer<typeof postMessageInputSchema>;
