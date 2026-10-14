import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";

import { formatRangeLabel, localRange, parseDateParam, startOfWeek, wallMinutes } from "./calendar";

describe("calendar helpers", () => {
  it("weeks start on Monday", () => {
    expect(startOfWeek(Temporal.PlainDate.from("2026-10-14")).toString()).toBe("2026-10-12"); // Wed -> Mon
    expect(startOfWeek(Temporal.PlainDate.from("2026-10-18")).toString()).toBe("2026-10-12"); // Sun -> Mon
  });

  it("falls back to today for invalid params", () => {
    expect(parseDateParam("2026-02-31", "UTC").toString()).toBe(Temporal.Now.plainDateISO("UTC").toString());
  });

  it("a local week across a DST change is not exactly 7*24h", () => {
    const { start, end } = localRange(Temporal.PlainDate.from("2026-10-19"), 7, "Europe/Madrid");
    expect(end.getTime() - start.getTime()).toBe(7 * 24 * 3600_000 + 3600_000); // fall back adds an hour
  });

  it("wallMinutes reads the local clock", () => {
    expect(wallMinutes(new Date("2026-07-01T12:30:00Z"), "Europe/Madrid")).toBe(14 * 60 + 30);
  });

  it("formats range labels", () => {
    expect(formatRangeLabel(Temporal.PlainDate.from("2026-12-28"), Temporal.PlainDate.from("2027-01-03"))).toBe(
      "Dec 28, 2026 - Jan 3, 2027",
    );
  });
});
