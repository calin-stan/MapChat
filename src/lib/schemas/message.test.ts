import { describe, expect, it } from "vitest";

import {
  authorSchema,
  messageTextSchema,
  postMessageInputSchema,
} from "@/lib/schemas/message";
import { issuesOf } from "@/lib/schemas/test-helpers";

const ASTRAL = "\u{1D4B3}";

describe("authorSchema", () => {
  it("allows 100 characters and rejects 101", () => {
    expect(authorSchema.safeParse(ASTRAL.repeat(100)).success).toBe(true);
    expect(issuesOf(authorSchema, ASTRAL.repeat(101))).toEqual([
      { path: "", message: "must be between 1 and 100 characters" },
    ]);
  });
});

describe("messageTextSchema", () => {
  it("allows 3000 characters and rejects 3001", () => {
    expect(messageTextSchema.safeParse(ASTRAL.repeat(3000)).success).toBe(true);
    expect(issuesOf(messageTextSchema, ASTRAL.repeat(3001))).toEqual([
      { path: "", message: "must be between 1 and 3000 characters" },
    ]);
  });
});

describe("postMessageInputSchema", () => {
  it("parses a body and trims both fields", () => {
    expect(postMessageInputSchema.parse({ author: "  ann ", text: " hello\n" })).toEqual({
      author: "ann",
      text: "hello",
    });
  });

  it("reports every missing field with its path", () => {
    expect(issuesOf(postMessageInputSchema, {})).toEqual([
      { path: "author", message: "is required" },
      { path: "text", message: "is required" },
    ]);
  });

  it("reports length errors per field", () => {
    expect(
      issuesOf(postMessageInputSchema, { author: ASTRAL.repeat(101), text: "   " }),
    ).toEqual([
      { path: "author", message: "must be between 1 and 100 characters" },
      { path: "text", message: "must be between 1 and 3000 characters" },
    ]);
  });

  it("drops keys the client must not control", () => {
    expect(
      postMessageInputSchema.parse({
        author: "ann",
        text: "hi",
        chatroomId: "2f1b6a8e-5c1d-4f7e-9a3b-0c2d4e6f8a1b",
        createdAt: "2000-01-01T00:00:00Z",
      }),
    ).toEqual({ author: "ann", text: "hi" });
  });

  // Wrapped in objects: it.each spreads bare array cases into arguments.
  it.each([{ body: null }, { body: "hello" }, { body: [] }])("rejects the non-object body $body", ({ body }) => {
    const issues = issuesOf(postMessageInputSchema, body);
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toBe("");
  });
});
