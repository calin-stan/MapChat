import { z } from "zod";

import { fieldIssues, json, notFound, validationError } from "@/lib/api/errors";
import { getServerConfig } from "@/lib/config/server";
import {
  CATCH_UP_PAGE_SIZE,
  insertMessage,
  listMessages,
  type ListMode,
} from "@/lib/db/messages";
import { postMessageInputSchema } from "@/lib/schemas/message";
import { messagesQuerySchema, uuidSchema } from "@/lib/schemas/query";
import { createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

// Wrapping the segment in an object gives the issue the path "id".
const paramsSchema = z.object({ id: uuidSchema });

/**
 * GET /api/rooms/:id/messages              newest HISTORY_INITIAL_SIZE, oldest first
 * GET /api/rooms/:id/messages?before=<id>  next HISTORY_PAGE_SIZE older than the cursor
 * GET /api/rooms/:id/messages?after=<id>   up to CATCH_UP_PAGE_SIZE newer, with nextCursor
 * (PRD 6.5). 400 for a bad id, query or cursor; 404 for an unknown room.
 */
export async function GET(request: Request, { params }: Context): Promise<Response> {
  const routeParams = paramsSchema.safeParse(await params);
  if (!routeParams.success) return validationError(fieldIssues(routeParams.error));

  const query = messagesQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!query.success) return validationError(fieldIssues(query.error));

  const { historyInitialSize, historyPageSize } = getServerConfig();
  const { before, after } = query.data;
  const [mode, limit]: [ListMode, number] =
    before !== undefined
      ? [{ mode: "before", cursorId: before }, historyPageSize]
      : after !== undefined
        ? [{ mode: "after", cursorId: after }, CATCH_UP_PAGE_SIZE]
        : [{ mode: "initial" }, historyInitialSize];

  const result = await listMessages(createServiceClient(), routeParams.data.id, mode, limit);
  if (result.kind === "room_not_found") return notFound();
  if (result.kind === "cursor_not_found") {
    return validationError([{ path: mode.mode, message: "is not a message in this room" }]);
  }

  const { messages, hasMore } = result;
  if (mode.mode === "after") {
    // The client's next synchronization bookmark (PRD 6.4): the last row, or
    // the cursor it sent when nothing is newer yet.
    const nextCursor = messages.at(-1)?.id ?? mode.cursorId;
    return json({ messages, hasMore, nextCursor }, 200);
  }
  return json({ messages, hasMore }, 200);
}

/**
 * POST /api/rooms/:id/messages with { author, text } (PRD 6.5). Answers 201
 * with the stored message, 400 with field errors, 404 for an unknown room.
 */
export async function POST(request: Request, { params }: Context): Promise<Response> {
  const routeParams = paramsSchema.safeParse(await params);
  if (!routeParams.success) return validationError(fieldIssues(routeParams.error));

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return validationError([{ path: "", message: "must be a JSON body" }]);
  }
  const input = postMessageInputSchema.safeParse(body);
  if (!input.success) return validationError(fieldIssues(input.error));

  const message = await insertMessage(createServiceClient(), routeParams.data.id, input.data);
  if (message === null) return notFound();
  return json({ message }, 201);
}
