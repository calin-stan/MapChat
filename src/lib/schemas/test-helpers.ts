import type { z } from "zod";

/**
 * Test helper: the validation issues `schema` reports for `input`, as
 * `{ path, message }` with the path dot-joined ("" for the whole input).
 * Returns [] when parsing succeeds. Not imported by application code.
 */
export function issuesOf(
  schema: z.ZodType,
  input: unknown,
): { path: string; message: string }[] {
  const result = schema.safeParse(input);
  if (result.success) return [];
  return result.error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}
