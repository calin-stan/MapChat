import { describe, expect, it } from "vitest";

import {
  createRoomInputSchema,
  latSchema,
  lngSchema,
  roundCoord,
} from "@/lib/schemas/room";
import { issuesOf } from "@/lib/schemas/test-helpers";

describe("latSchema", () => {
  it.each([-90, 0, 90])("accepts %d", (value) => {
    expect(latSchema.parse(value)).toBe(value);
  });

  it.each([-90.000001, 90.000001])("rejects %d", (value) => {
    expect(issuesOf(latSchema, value)).toEqual([
      { path: "", message: "must be between -90 and 90" },
    ]);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, "47.5"])("rejects the non-number %j", (value) => {
    expect(issuesOf(latSchema, value)).toEqual([{ path: "", message: "must be a number" }]);
  });

  it("reports an absent value as required", () => {
    expect(issuesOf(latSchema, undefined)).toEqual([{ path: "", message: "is required" }]);
  });
});

describe("lngSchema", () => {
  it.each([-180, 180])("accepts %d", (value) => {
    expect(lngSchema.parse(value)).toBe(value);
  });

  it.each([-180.000001, 180.000001])("rejects %d", (value) => {
    expect(issuesOf(lngSchema, value)).toEqual([
      { path: "", message: "must be between -180 and 180" },
    ]);
  });
});

describe("createRoomInputSchema", () => {
  it("parses a body and trims the text fields", () => {
    expect(
      createRoomInputSchema.parse({ lat: 47.497913, lng: 19.040236, author: " ann ", text: "hello " }),
    ).toEqual({ lat: 47.497913, lng: 19.040236, author: "ann", text: "hello" });
  });

  it("reports every missing field in lat, lng, author, text order", () => {
    expect(issuesOf(createRoomInputSchema, {})).toEqual([
      { path: "lat", message: "is required" },
      { path: "lng", message: "is required" },
      { path: "author", message: "is required" },
      { path: "text", message: "is required" },
    ]);
  });

  it("does not round coordinates (the server calls roundCoord before insert)", () => {
    const parsed = createRoomInputSchema.parse({
      lat: 47.4979134999,
      lng: 19.0402361111,
      author: "ann",
      text: "hi",
    });
    expect(parsed.lat).toBe(47.4979134999);
    expect(parsed.lng).toBe(19.0402361111);
  });
});

describe("roundCoord", () => {
  it.each([
    [47.4979134999, 47.497913],
    [151.2092955, 151.209296],
    [-33.8688197, -33.86882],
    [179.9999996, 180],
    [-89.9999996, -90],
  ])("rounds %d to %d", (input, expected) => {
    expect(roundCoord(input)).toBe(expected);
  });

  it("puts two clicks 0.0000003 degrees apart on the same spot", () => {
    expect(roundCoord(10.1234564)).toBe(10.123456);
    expect(roundCoord(10.1234561)).toBe(10.123456);
  });

  it("never returns negative zero", () => {
    expect(Object.is(roundCoord(-0.0000001), 0)).toBe(true);
  });
});
