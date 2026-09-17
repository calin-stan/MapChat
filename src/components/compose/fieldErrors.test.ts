import { describe, expect, it } from "vitest";

import {
  isValidationError,
  SUBMIT_FAILED_MESSAGE,
  submitErrors,
  toComposeErrors,
} from "@/components/compose/fieldErrors";
import type { FieldIssue } from "@/lib/api/errors";

/** Shaped like chunk 4's ApiValidationError without importing it. */
function validationError(fields: unknown): Error {
  return Object.assign(new Error("invalid"), { name: "ApiValidationError", fields });
}

/** Shaped like chunk 4's ApiRequestError without importing it. */
function requestError(status: number, code: string | undefined, message: string): Error {
  return Object.assign(new Error(message), { name: "ApiRequestError", status, code });
}

describe("toComposeErrors", () => {
  it("keeps the first message per form field", () => {
    expect(
      toComposeErrors([
        { path: "author", message: "first" },
        { path: "author", message: "second" },
        { path: "text", message: "must be between 1 and 3000 characters" },
      ]),
    ).toEqual({ author: "first", text: "must be between 1 and 3000 characters" });
  });

  it("turns issues on other paths into one form message", () => {
    expect(
      toComposeErrors([
        { path: "lat", message: "must be between -90 and 90" },
        { path: "", message: "must be an object" },
      ]),
    ).toEqual({ form: "lat must be between -90 and 90; must be an object" });
  });

  it("returns no errors for no issues", () => {
    expect(toComposeErrors([])).toEqual({});
  });
});

describe("isValidationError", () => {
  const fields: FieldIssue[] = [{ path: "text", message: "is required" }];

  it("accepts an Error named ApiValidationError with well-formed fields", () => {
    expect(isValidationError(validationError(fields))).toBe(true);
    expect(isValidationError(validationError([]))).toBe(true);
  });

  it.each([
    ["a plain Error", new Error("boom")],
    ["an Error with the name but no fields", Object.assign(new Error("x"), { name: "ApiValidationError" })],
    ["fields that are not an array", validationError({ path: "text", message: "x" })],
    ["a malformed field entry", validationError([{ path: 1, message: "x" }])],
    ["a non-Error object with the right shape", { name: "ApiValidationError", fields }],
    ["a string", "ApiValidationError"],
    ["null", null],
  ])("rejects %s", (_label, value) => {
    expect(isValidationError(value)).toBe(false);
  });
});

describe("submitErrors", () => {
  it("maps a validation error to its fields", () => {
    expect(submitErrors(validationError([{ path: "text", message: "is required" }]))).toEqual({
      text: "is required",
    });
  });

  it("falls back to the error message when a validation error has no usable fields", () => {
    const error = validationError([]);
    error.message = "Invalid input";
    expect(submitErrors(error)).toEqual({ form: "Invalid input" });
  });

  it("shows the server's message for an unavailable request error", () => {
    const message = "Could not find a free room name, please try again";
    expect(submitErrors(requestError(503, "unavailable", message))).toEqual({ form: message });
  });

  it.each([
    ["a request error with another code", requestError(404, "not_found", "Request failed with status 404")],
    ["a request error without a code", requestError(502, undefined, "Request failed with status 502")],
    ["a network failure", new TypeError("Failed to fetch")],
    ["a non-error value", "boom"],
    ["undefined", undefined],
  ])("uses the lost-response message for %s", (_label, error) => {
    expect(submitErrors(error)).toEqual({ form: SUBMIT_FAILED_MESSAGE });
  });

  it("never returns an empty object", () => {
    for (const error of [validationError([]), new Error("x"), null]) {
      expect(Object.keys(submitErrors(error)).length).toBeGreaterThan(0);
    }
  });
});

describe("submitErrors with a fallback", () => {
  const FALLBACK = "Couldn't confirm creation.";

  it("uses the fallback only for a lost response", () => {
    expect(submitErrors(new TypeError("Failed to fetch"), FALLBACK)).toEqual({ form: FALLBACK });
    expect(submitErrors(requestError(502, undefined, "Request failed with status 502"), FALLBACK)).toEqual({
      form: FALLBACK,
    });
  });

  it("keeps validation fields and the unavailable message", () => {
    expect(submitErrors(validationError([{ path: "lat", message: "must be between -90 and 90" }]), FALLBACK)).toEqual({
      form: "lat must be between -90 and 90",
    });
    expect(submitErrors(requestError(503, "unavailable", "try again"), FALLBACK)).toEqual({ form: "try again" });
  });
});
