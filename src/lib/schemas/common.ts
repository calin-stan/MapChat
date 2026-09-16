import { z } from "zod";

/**
 * Length in Unicode code points, the unit of every text limit (PRD 4). Matches
 * Postgres `char_length`, so the browser, the route handler and the database
 * check constraints agree: `"\u{1D4B3}".length` is 2, `countChars` gives 1.
 */
export function countChars(s: string): number {
  return [...s].length;
}

/**
 * A zod `error` function: "is required" when the value is absent (undefined or
 * null), otherwise `message`. Keeps field errors readable after a field name.
 */
export function requiredOr(message: string) {
  return (issue: { input?: unknown }) => (issue.input == null ? "is required" : message);
}

/**
 * Postgres `text` cannot hold NUL, and a lone UTF-16 surrogate cannot be
 * encoded as UTF-8. Both would fail at insert time as a 500 instead of a 400.
 */
function isStorable(s: string): boolean {
  return !s.includes("\0") && !/([\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff])/.test(s);
}

/**
 * Required user text (PRD 4): trims surrounding whitespace, keeps everything
 * inside, then requires `min` to `max` code points.
 */
export function trimmedText(min: number, max: number) {
  return z
    .string({ error: requiredOr("must be text") })
    .trim()
    .refine(isStorable, { error: "contains characters that cannot be stored" })
    .refine(
      (s) => {
        const length = countChars(s);
        return length >= min && length <= max;
      },
      { error: `must be between ${min} and ${max} characters` },
    );
}
