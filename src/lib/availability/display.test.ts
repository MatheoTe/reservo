import { describe, expect, it } from "vitest";

import { groupByLocalDate, localDate, localTime, utcOffset } from "./display";
import { at } from "./test-helpers";

describe("groupByLocalDate", () => {
  // Evening slots in Buenos Aires (UTC-3) are already "tomorrow" in Tokyo (UTC+9).
  const slots = [
    { start: at("America/Argentina/Buenos_Aires", "2026-03-09T09:00") },
    { start: at("America/Argentina/Buenos_Aires", "2026-03-09T14:00") },
    { start: at("America/Argentina/Buenos_Aires", "2026-03-09T16:00") },
  ];

  it("groups by the org's calendar day", () => {
    const groups = groupByLocalDate(slots, "America/Argentina/Buenos_Aires");
    expect(groups.map((g) => [g.date, g.items.length])).toEqual([["2026-03-09", 3]]);
  });

  it("groups by the customer's calendar day when they are elsewhere", () => {
    const groups = groupByLocalDate(slots, "Asia/Tokyo");
    expect(groups.map((g) => [g.date, g.items.length])).toEqual([
      ["2026-03-09", 1], // 21:00 Tokyo
      ["2026-03-10", 2], // 02:00 and 04:00 Tokyo
    ]);
  });

  it("returns groups in chronological order even for unsorted input", () => {
    const groups = groupByLocalDate([slots[2]!, slots[0]!], "Asia/Tokyo");
    expect(groups.map((g) => g.date)).toEqual(["2026-03-09", "2026-03-10"]);
  });
});

describe("localTime / localDate / utcOffset", () => {
  const instant = Date.parse("2026-07-01T12:00:00Z");

  it("formats in the requested zone", () => {
    expect(localTime(instant, "Europe/Madrid")).toBe("14:00");
    expect(localTime(instant, "America/New_York")).toBe("08:00");
    expect(localDate(instant, "Pacific/Kiritimati")).toBe("2026-07-02");
  });

  it("reports the offset in effect at that instant", () => {
    expect(utcOffset(instant, "Europe/Madrid")).toBe("+02:00");
    expect(utcOffset(Date.parse("2026-01-15T12:00:00Z"), "Europe/Madrid")).toBe("+01:00");
  });
});
