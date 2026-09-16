import { z } from "zod";

import { requiredOr } from "@/lib/schemas/common";
import { latSchema, lngSchema } from "@/lib/schemas/room";

/** A map viewport in degrees (PRD 6.5, `GET /api/rooms?bbox=`). */
export type Bbox = { minLng: number; minLat: number; maxLng: number; maxLat: number };

// A plain decimal with an optional exponent ("-19.04", ".5", "1e-7").
// Rejects "", "0x1f" and "Infinity", all of which Number() would accept.
const DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;

/**
 * Parses the `bbox` query value "minLng,minLat,maxLng,maxLat". Each corner must
 * be a valid coordinate and the minimum must not exceed the maximum, so a box
 * crossing the antimeridian is rejected. The map normalizes world offsets and
 * splits crossing viewports into two non-crossing queries; it does not clamp
 * longitude endpoints. Spans of at least 360 degrees query the whole world.
 */
export const bboxSchema = z
  .string({ error: requiredOr("must be text") })
  .transform((value, ctx) => {
    const parts = value.split(",").map((part) => part.trim());
    if (parts.length !== 4 || !parts.every((part) => DECIMAL.test(part))) {
      ctx.addIssue({
        code: "custom",
        message: "must be four numbers: minLng,minLat,maxLng,maxLat",
      });
      return z.NEVER;
    }
    const [minLng, minLat, maxLng, maxLat] = parts.map(Number);
    return { minLng, minLat, maxLng, maxLat };
  })
  .pipe(
    z
      .object({ minLng: lngSchema, minLat: latSchema, maxLng: lngSchema, maxLat: latSchema })
      .refine((box) => box.minLng <= box.maxLng && box.minLat <= box.maxLat, {
        error: "minimum must not be greater than maximum",
      }),
  );

/** A room or message id: the `:id` route segment and the history cursors. */
export const uuidSchema = z.uuid({ error: requiredOr("must be a UUID") });

/**
 * Query of `GET /api/rooms/:id/messages` (PRD 6.5): no cursor for the newest
 * page, `before=<message-id>` for older history, `after=<message-id>` for
 * catch-up. Pass `Object.fromEntries(url.searchParams)`; other keys are dropped.
 */
export const messagesQuerySchema = z
  .object({
    before: uuidSchema.optional(),
    after: uuidSchema.optional(),
  })
  .refine((query) => query.before === undefined || query.after === undefined, {
    error: "use either before or after, not both",
  });

export type MessagesQuery = z.infer<typeof messagesQuerySchema>;
