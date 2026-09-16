import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  conflict,
  fieldIssues,
  json,
  notFound,
  serviceUnavailable,
  validationError,
} from "@/lib/api/errors";
import type { Room } from "@/lib/schemas/types";

const room: Room = {
  id: "0f6c1d1e-6c2c-4d7e-9a8b-1f2e3d4c5b6a",
  name: "brave-crimson-otter",
  lat: 47.497913,
  lng: 19.040236,
  createdAt: "2026-09-16T15:00:00.123000Z",
};

describe("json", () => {
  it("serialises the body with the given status and a JSON content type", async () => {
    const response = json({ ok: true }, 201);

    expect(response.status).toBe(201);
    expect(response.headers.get("content-type")).toMatch(/^application\/json/);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("defaults to status 200", () => {
    expect(json({ ok: true }).status).toBe(200);
  });
});

describe("fieldIssues", () => {
  it("maps zod issues to dot-joined paths in schema order", () => {
    const schema = z.object({
      author: z.string(),
      nested: z.object({ items: z.array(z.number()) }),
    });
    const result = schema.safeParse({ nested: { items: [1, "x"] } });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(fieldIssues(result.error)).toEqual([
      { path: "author", message: expect.any(String) },
      { path: "nested.items.1", message: expect.any(String) },
    ]);
  });

  it("uses an empty path for an issue on the whole input", () => {
    const result = z.object({ a: z.string() }).safeParse(null);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(fieldIssues(result.error)).toEqual([{ path: "", message: expect.any(String) }]);
  });
});

describe("error responses", () => {
  it("validationError answers 400 with the field list", async () => {
    const fields = [{ path: "author", message: "is required" }];
    const response = validationError(fields);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { code: "validation", fields },
    });
  });

  it("notFound answers 404", async () => {
    const response = notFound();

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: { code: "not_found" } });
  });

  it("conflict answers 409 with the existing room", async () => {
    const response = conflict(room);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: { code: "conflict", room } });
  });

  it("serviceUnavailable answers 503 with a retry hint", async () => {
    const response = serviceUnavailable("Could not find a free room name, please try again");

    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("1");
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "unavailable",
        message: "Could not find a free room name, please try again",
      },
    });
  });
});
