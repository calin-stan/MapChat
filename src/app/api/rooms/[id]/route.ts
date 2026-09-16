import { fieldIssues, json, notFound, validationError } from "@/lib/api/errors";
import { findRoomById } from "@/lib/db/rooms";
import { uuidSchema } from "@/lib/schemas/query";
import { createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * GET /api/rooms/:id (PRD 6.5): the room behind a shared `/room/<id>` URL.
 * 200 { room }; 400 when the id is not a UUID; 404 when no room has it.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const id = uuidSchema.safeParse((await params).id);
  if (!id.success) {
    return validationError(
      fieldIssues(id.error).map((issue) => ({ path: "id", message: issue.message })),
    );
  }

  const room = await findRoomById(createServiceClient(), id.data);
  return room === null ? notFound() : json({ room });
}
