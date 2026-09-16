import type { z } from "zod";

import type { Room } from "@/lib/schemas/types";

/** One validation problem. `path` is dot-joined; "" means the whole input. */
export type FieldIssue = { path: string; message: string };

/**
 * Error bodies of the JSON API (chunk spec §0.2; PRD 6.3 for `unavailable`).
 * The client (`@/lib/api/client`) maps these to typed errors by `code`.
 */
export type ApiErrorBody =
  | { error: { code: "validation"; fields: FieldIssue[] } }
  | { error: { code: "not_found" } }
  | { error: { code: "conflict"; room: Room } }
  | { error: { code: "unavailable"; message: string } };

/** zod issues as `{ path, message }`, in the order zod reports them. */
export function fieldIssues(error: z.ZodError): FieldIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join("."),
    message: issue.message,
  }));
}

/** A JSON response with `status` (default 200). */
export function json<T>(data: T, status = 200): Response {
  return Response.json(data, { status });
}

/** 400: the request body or query string failed validation (PRD 6.5). */
export function validationError(fields: FieldIssue[]): Response {
  return json<ApiErrorBody>({ error: { code: "validation", fields } }, 400);
}

/** 404: no room with that id. */
export function notFound(): Response {
  return json<ApiErrorBody>({ error: { code: "not_found" } }, 404);
}

/** 409: a room already exists at the rounded coordinates; the body carries it (PRD 6.5). */
export function conflict(room: Room): Response {
  return json<ApiErrorBody>({ error: { code: "conflict", room } }, 409);
}

/** 503: a retryable failure, such as exhausting room-name attempts (PRD 6.3). */
export function serviceUnavailable(message: string): Response {
  return Response.json({ error: { code: "unavailable", message } } satisfies ApiErrorBody, {
    status: 503,
    headers: { "retry-after": "1" },
  });
}
