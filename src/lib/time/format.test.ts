import { describe, expect, it } from "vitest";

import { formatMessageTime } from "@/lib/time/format";

const BUCHAREST = "Europe/Bucharest"; // UTC+3 in September, UTC+2 in January
const now = new Date("2026-09-16T20:00:00Z");

describe("formatMessageTime", () => {
  it("shows only the time for a message from today in the target zone", () => {
    expect(formatMessageTime("2026-09-16T15:00:00.000000Z", { now, timeZone: BUCHAREST })).toBe("18:00");
  });

  it("uses a 24-hour clock with leading zeros", () => {
    expect(formatMessageTime("2026-09-16T00:05:00.000000Z", { now, timeZone: "UTC" })).toBe("00:05");
  });

  it("adds day and month for another day of the same year", () => {
    expect(formatMessageTime("2026-09-15T14:03:00.000000Z", { now, timeZone: BUCHAREST })).toBe(
      "15 Sep 17:03",
    );
  });

  it("adds the year for a message from another year", () => {
    expect(formatMessageTime("2025-09-16T14:03:00.000000Z", { now, timeZone: BUCHAREST })).toBe(
      "16 Sep 2025 17:03",
    );
  });

  it("judges 'today' in the target zone, not in UTC", () => {
    // 21:30 UTC on the 15th is 00:30 on the 16th in Bucharest: the same local day as `now`.
    expect(formatMessageTime("2026-09-15T21:30:00.000000Z", { now, timeZone: BUCHAREST })).toBe("00:30");
    // The same instant seen from UTC is yesterday.
    expect(formatMessageTime("2026-09-15T21:30:00.000000Z", { now, timeZone: "UTC" })).toBe("15 Sep 21:30");
  });

  it("judges the year in the target zone", () => {
    const newYear = new Date("2026-01-01T10:00:00Z");
    // 22:30 UTC on 31 Dec is 00:30 on 1 Jan in Bucharest.
    expect(formatMessageTime("2025-12-31T22:30:00.000000Z", { now: newYear, timeZone: BUCHAREST })).toBe(
      "00:30",
    );
  });

  it("parses six fractional digits", () => {
    expect(formatMessageTime("2026-09-16T15:00:00.123456Z", { now, timeZone: BUCHAREST })).toBe("18:00");
  });

  it("uses fixed three-letter months, whatever the ICU data says", () => {
    const labels = Array.from({ length: 12 }, (_, month) =>
      formatMessageTime(new Date(Date.UTC(2025, month, 10, 12)).toISOString(), { now, timeZone: "UTC" })
        .split(" ")[1],
    );
    expect(labels).toEqual(["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]);
  });

  it("defaults to the current time and the runtime zone", () => {
    const justNow = new Date().toISOString();
    expect(formatMessageTime(justNow)).toMatch(/^\d{2}:\d{2}$/);
  });

  it("returns an empty string for an unparseable timestamp", () => {
    expect(formatMessageTime("not a date")).toBe("");
  });
});
