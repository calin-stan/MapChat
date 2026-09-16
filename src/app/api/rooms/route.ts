import {
  conflict,
  fieldIssues,
  json,
  serviceUnavailable,
  validationError,
  type FieldIssue,
} from "@/lib/api/errors";
import { createRoom, findRoomsInBbox } from "@/lib/db/rooms";
import { NameCollision } from "@/lib/names/generate";
import { bboxSchema } from "@/lib/schemas/query";
import { createRoomInputSchema } from "@/lib/schemas/room";
import { createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/** Prefixes query-string issues with the parameter name: "bbox", "bbox.minLng". */
function underParam(param: string, issues: FieldIssue[]): FieldIssue[] {
  return issues.map((issue) => ({
    path: issue.path === "" ? param : `${param}.${issue.path}`,
    message: issue.message,
  }));
}

/**
 * GET /api/rooms?bbox=minLng,minLat,maxLng,maxLat (PRD 6.5)
 * 200 { rooms, truncated } for one non-crossing box; 400 on a bad bbox.
 */
export async function GET(request: Request): Promise<Response> {
  const bbox = bboxSchema.safeParse(new URL(request.url).searchParams.get("bbox"));
  if (!bbox.success) return validationError(underParam("bbox", fieldIssues(bbox.error)));

  return json(await findRoomsInBbox(createServiceClient(), bbox.data));
}

/**
 * POST /api/rooms { lat, lng, author, text } (PRD 6.3, 6.5, Flow A)
 * 201 { room, message }; 400 on invalid input; 409 with the room already at
 * that spot; 503 when no free room name could be found (retryable).
 */
export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return validationError([{ path: "", message: "must be a JSON body" }]);
  }

  const input = createRoomInputSchema.safeParse(body);
  if (!input.success) return validationError(fieldIssues(input.error));

  try {
    const result = await createRoom(createServiceClient(), input.data);
    if (result.kind === "exists") return conflict(result.room);
    return json({ room: result.room, message: result.message }, 201);
  } catch (error) {
    if (error instanceof NameCollision) {
      return serviceUnavailable("Could not find a free room name, please try again");
    }
    throw error;
  }
}
