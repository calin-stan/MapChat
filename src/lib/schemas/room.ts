import { z } from "zod";

import { requiredOr } from "@/lib/schemas/common";
import { authorSchema, messageTextSchema } from "@/lib/schemas/message";

function coordinate(min: number, max: number) {
  const range = `must be between ${min} and ${max}`;
  // z.number() already rejects NaN and ±Infinity.
  return z
    .number({ error: requiredOr("must be a number") })
    .min(min, { error: range })
    .max(max, { error: range });
}

/** Latitude in degrees (PRD 4). */
export const latSchema = coordinate(-90, 90);

/** Longitude in degrees (PRD 4). */
export const lngSchema = coordinate(-180, 180);

/**
 * Body of `POST /api/rooms`: the clicked spot plus the first message.
 * Coordinates are validated, not rounded; the route handler applies
 * {@link roundCoord} before insert (PRD 6.2).
 */
export const createRoomInputSchema = z.object({
  lat: latSchema,
  lng: lngSchema,
  author: authorSchema,
  text: messageTextSchema,
});

export type CreateRoomInput = z.infer<typeof createRoomInputSchema>;

/**
 * Rounds a coordinate to 6 decimals (about 11 cm), the precision at which the
 * `(lat, lng)` unique constraint decides "a room already exists here" (PRD 6.2).
 * A value that was in range stays in range.
 */
export function roundCoord(x: number): number {
  // `+ 0` turns -0 into 0, so a click just west of 0° is stored as 0.
  return Math.round(x * 1e6) / 1e6 + 0;
}
