import type { FieldIssue } from "@/lib/api/errors";

/** What the compose form shows: one message per field, one for the form. */
export type ComposeErrors = { author?: string; text?: string; form?: string };

/**
 * Shown when the request itself failed, so the write may or may not have
 * happened (PRD 4 "Compose behavior"). Drafts are kept; no automatic retry.
 */
export const SUBMIT_FAILED_MESSAGE =
  "Couldn't send. Your message may still have gone through, so check the room before trying again.";

function isFieldIssue(value: unknown): value is FieldIssue {
  if (typeof value !== "object" || value === null) return false;
  const { path, message } = value as Partial<FieldIssue>;
  return typeof path === "string" && typeof message === "string";
}

/**
 * True for chunk 4's `ApiValidationError`, recognised by name and shape
 * rather than by class, so this module needs no runtime import of `@/lib/api/client`.
 */
export function isValidationError(error: unknown): error is Error & { fields: FieldIssue[] } {
  if (!(error instanceof Error) || error.name !== "ApiValidationError") return false;
  const { fields } = error as Error & { fields?: unknown };
  return Array.isArray(fields) && fields.every(isFieldIssue);
}

/** First message per form field; issues on other paths become one form message. */
export function toComposeErrors(issues: FieldIssue[]): ComposeErrors {
  const errors: ComposeErrors = {};
  const other: string[] = [];
  for (const { path, message } of issues) {
    if (path === "author" || path === "text") errors[path] ??= message;
    else other.push(path === "" ? message : `${path} ${message}`);
  }
  if (other.length > 0) errors.form = other.join("; ");
  return errors;
}

/**
 * Errors to show after `onSubmit` rejected. Never empty. `fallback` is the
 * form-level line for a rejection that is neither a validation error nor
 * `unavailable`: the write may or may not have happened.
 */
export function submitErrors(error: unknown, fallback: string = SUBMIT_FAILED_MESSAGE): ComposeErrors {
  if (isValidationError(error)) {
    const errors = toComposeErrors(error.fields);
    return Object.keys(errors).length > 0 ? errors : { form: error.message || "Invalid input" };
  }
  if (error instanceof Error && error.name === "ApiRequestError") {
    const { code } = error as Error & { code?: unknown };
    // 503 after the room-name retries (PRD 6.3): nothing was written, and the
    // server's message says what to do.
    if (code === "unavailable" && error.message) return { form: error.message };
  }
  return { form: fallback };
}
