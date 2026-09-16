import { describe, expect, it } from "vitest";
import { z } from "zod";

import { countChars, requiredOr, trimmedText } from "@/lib/schemas/common";
import { issuesOf } from "@/lib/schemas/test-helpers";

// One code point outside the Basic Multilingual Plane: two UTF-16 units, one
// character (PRD 4).
const ASTRAL = "\u{1D4B3}";

describe("countChars", () => {
  it.each([
    { input: "", expected: 0 },
    { input: "abc", expected: 3 },
    { input: ASTRAL, expected: 1 },
    { input: "é", expected: 2 }, // "e" + combining acute accent: two code points
  ])("counts $input as $expected characters", ({ input, expected }) => {
    expect(countChars(input)).toBe(expected);
  });
});

describe("requiredOr", () => {
  it('says "is required" for undefined and null, otherwise the given message', () => {
    const schema = z.string({ error: requiredOr("must be text") });

    expect(issuesOf(schema, undefined)).toEqual([{ path: "", message: "is required" }]);
    expect(issuesOf(schema, null)).toEqual([{ path: "", message: "is required" }]);
    expect(issuesOf(schema, 42)).toEqual([{ path: "", message: "must be text" }]);
  });
});

describe("trimmedText", () => {
  const schema = trimmedText(1, 5);
  const range = { path: "", message: "must be between 1 and 5 characters" };

  it("trims surrounding whitespace", () => {
    expect(schema.parse("  hi \n")).toBe("hi");
  });

  it("keeps inner whitespace and line breaks", () => {
    expect(schema.parse("a  \nb")).toBe("a  \nb");
  });

  it.each(["", "   ", "\n\t", " ﻿"])(
    "rejects %j because it is empty after trimming",
    (input) => {
      expect(issuesOf(schema, input)).toEqual([range]);
    },
  );

  it("counts code points, not UTF-16 units", () => {
    expect(schema.parse(ASTRAL.repeat(5))).toHaveLength(10);
    expect(issuesOf(schema, ASTRAL.repeat(6))).toEqual([range]);
  });

  it("measures the length after trimming", () => {
    expect(schema.parse("  12345  ")).toBe("12345");
  });

  it("rejects values that are not strings", () => {
    expect(issuesOf(schema, undefined)).toEqual([{ path: "", message: "is required" }]);
    expect(issuesOf(schema, 42)).toEqual([{ path: "", message: "must be text" }]);
  });

  it.each(["a\0b", "a\ud800b", "\udc00"])(
    "rejects %j because Postgres cannot store it",
    (input) => {
      expect(issuesOf(schema, input)).toEqual([
        { path: "", message: "contains characters that cannot be stored" },
      ]);
    },
  );

  it("accepts 100 emoji (200 UTF-16 units) under a 100-character limit", () => {
    const emoji = "\u{1F600}".repeat(100);
    expect(emoji.length).toBe(200);
    expect(trimmedText(1, 100).safeParse(emoji).success).toBe(true);
  });
});
