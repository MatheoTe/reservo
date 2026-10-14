import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";

import { at, iso } from "./test-helpers";
import {
  formatWallTime,
  instantsForWallTime,
  instantToPlainDate,
  InvalidWallTimeError,
  parseWallTime,
  wallTimeToInstant,
} from "./wall-time";

const d = (s: string) => Temporal.PlainDate.from(s);

describe("parseWallTime / formatWallTime", () => {
  it.each([
    ["00:00", 0],
    ["09:30", 570],
    ["23:59", 1439],
    ["24:00", 1440],
  ])("%s -> %d", (value, minutes) => {
    expect(parseWallTime(value)).toBe(minutes);
    expect(formatWallTime(minutes)).toBe(value);
  });

  it.each(["24:01", "9:00", "12:60", "25:00", "", "noon", "12:00:00"])("rejects %j", (value) => {
    expect(() => parseWallTime(value)).toThrow(InvalidWallTimeError);
  });
});

describe("wallTimeToInstant", () => {
  it("interprets the wall time in the given zone", () => {
    expect(iso(wallTimeToInstant(d("2026-03-09"), 9 * 60, "America/Argentina/Buenos_Aires"))).toBe(
      "2026-03-09T12:00:00Z",
    );
    expect(iso(wallTimeToInstant(d("2026-03-09"), 9 * 60, "Asia/Tokyo"))).toBe(
      "2026-03-09T00:00:00Z",
    );
  });

  it("maps 24:00 to midnight of the next day", () => {
    expect(wallTimeToInstant(d("2026-03-09"), 1440, "UTC")).toBe(at("UTC", "2026-03-10T00:00"));
  });

  it("pushes a non-existent time (spring-forward gap) forward", () => {
    // New York jumps 02:00 -> 03:00 on 2026-03-08; 02:30 does not exist.
    expect(wallTimeToInstant(d("2026-03-08"), 150, "America/New_York")).toBe(
      at("America/New_York", "2026-03-08T03:30"),
    );
  });

  it("resolves an ambiguous time (fall-back overlap) to the earlier instant", () => {
    // New York repeats 01:00-02:00 on 2026-11-01. 01:30 EDT (UTC-4) comes first.
    expect(iso(wallTimeToInstant(d("2026-11-01"), 90, "America/New_York"))).toBe(
      "2026-11-01T05:30:00Z",
    );
  });
});

describe("instantsForWallTime", () => {
  it("returns one instant on a normal day", () => {
    expect(instantsForWallTime(d("2026-03-09"), 600, "Europe/Madrid")).toHaveLength(1);
  });

  it("returns none inside a spring-forward gap", () => {
    expect(instantsForWallTime(d("2026-03-29"), 2 * 60 + 30, "Europe/Madrid")).toEqual([]);
  });

  it("returns both instants inside a fall-back overlap, one hour apart", () => {
    const both = instantsForWallTime(d("2026-10-25"), 2 * 60 + 30, "Europe/Madrid");
    expect(both.map(iso)).toEqual(["2026-10-25T00:30:00Z", "2026-10-25T01:30:00Z"]);
  });

  it("handles a 30-minute DST shift (Lord Howe Island)", () => {
    // 2026-10-04: clocks go 02:00 -> 02:30, so 02:15 never happens.
    expect(instantsForWallTime(d("2026-10-04"), 2 * 60 + 15, "Australia/Lord_Howe")).toEqual([]);
    expect(instantsForWallTime(d("2026-10-04"), 2 * 60 + 30, "Australia/Lord_Howe")).toHaveLength(
      1,
    );
  });
});

describe("instantToPlainDate", () => {
  it("returns the local calendar date, which can differ from UTC", () => {
    const instant = at("UTC", "2026-03-09T23:30");
    expect(instantToPlainDate(instant, "UTC").toString()).toBe("2026-03-09");
    expect(instantToPlainDate(instant, "Asia/Tokyo").toString()).toBe("2026-03-10");
    expect(instantToPlainDate(instant, "Pacific/Pago_Pago").toString()).toBe("2026-03-09");
  });
});
