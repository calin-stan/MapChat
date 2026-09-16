import { describe, expect, it } from "vitest";

import { bboxSchema, messagesQuerySchema, uuidSchema } from "@/lib/schemas/query";
import { issuesOf } from "@/lib/schemas/test-helpers";

const ID_A = "2f1b6a8e-5c1d-4f7e-9a3b-0c2d4e6f8a1b";
const ID_B = "9c4e2d1a-7b3f-4a5e-8d6c-1f0e2a3b4c5d";

describe("bboxSchema", () => {
  it('parses "minLng,minLat,maxLng,maxLat"', () => {
    expect(bboxSchema.parse("-1,-2,3,4")).toEqual({ minLng: -1, minLat: -2, maxLng: 3, maxLat: 4 });
  });

  it("tolerates spaces around decimal parts", () => {
    expect(bboxSchema.parse(" 19.04 , 47.49,19.05, 47.5 ")).toEqual({
      minLng: 19.04,
      minLat: 47.49,
      maxLng: 19.05,
      maxLat: 47.5,
    });
  });

  it.each(["-180,-90,180,90", "1,1,1,1"])("accepts the whole world or a zero-area box: %j", (value) => {
    expect(bboxSchema.safeParse(value).success).toBe(true);
  });

  it.each(["1,2,3", "1,2,3,4,5", "", "a,b,c,d", "0x1,0,1,1", "1,,3,4", "Infinity,0,1,1"])(
    "rejects the malformed value %j",
    (value) => {
      expect(issuesOf(bboxSchema, value)).toEqual([
        { path: "", message: "must be four numbers: minLng,minLat,maxLng,maxLat" },
      ]);
    },
  );

  it.each(["3,4,-1,-2", "3,-2,-1,4", "-1,4,3,-2"])("rejects min greater than max: %j", (value) => {
    expect(issuesOf(bboxSchema, value)).toEqual([
      { path: "", message: "minimum must not be greater than maximum" },
    ]);
  });

  it("reports out-of-range longitudes on their corners", () => {
    expect(issuesOf(bboxSchema, "-181,-2,181,4")).toEqual([
      { path: "minLng", message: "must be between -180 and 180" },
      { path: "maxLng", message: "must be between -180 and 180" },
    ]);
  });

  it("reports an out-of-range latitude on its corner", () => {
    expect(issuesOf(bboxSchema, "0,-91,1,1")).toEqual([
      { path: "minLat", message: "must be between -90 and 90" },
    ]);
  });

  it("rejects a number too large to represent", () => {
    expect(issuesOf(bboxSchema, "1e999,0,1,1")).toEqual([
      { path: "minLng", message: "must be a number" },
    ]);
  });

  it("reports an absent value as required", () => {
    expect(issuesOf(bboxSchema, undefined)).toEqual([{ path: "", message: "is required" }]);
  });
});

describe("uuidSchema", () => {
  it.each([ID_A, ID_A.toUpperCase()])("accepts %s", (value) => {
    expect(uuidSchema.parse(value)).toBe(value);
  });

  it.each(["", "not-a-uuid", ID_A.replaceAll("-", ""), `${ID_A}0`])("rejects %j", (value) => {
    expect(issuesOf(uuidSchema, value)).toEqual([{ path: "", message: "must be a UUID" }]);
  });
});

describe("messagesQuerySchema", () => {
  it("accepts no cursor (initial history)", () => {
    expect(messagesQuerySchema.parse({})).toEqual({});
  });

  it.each(["before", "after"])("accepts %s alone", (key) => {
    expect(messagesQuerySchema.parse({ [key]: ID_A })).toEqual({ [key]: ID_A });
  });

  it("rejects before and after together", () => {
    expect(issuesOf(messagesQuerySchema, { before: ID_A, after: ID_B })).toEqual([
      { path: "", message: "use either before or after, not both" },
    ]);
  });

  it.each([
    ["before", "abc"],
    ["after", ""],
  ])("rejects a malformed %s cursor on its own path", (key, value) => {
    expect(issuesOf(messagesQuerySchema, { [key]: value })).toEqual([
      { path: key, message: "must be a UUID" },
    ]);
  });

  it("ignores unrelated query params", () => {
    expect(messagesQuerySchema.parse({ after: ID_A, bbox: "1,2,3,4", foo: "bar" })).toEqual({
      after: ID_A,
    });
  });
});
