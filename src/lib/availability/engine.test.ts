import { describe, expect, it } from "vitest";

import { computeSlots, isSlotAvailable, MAX_RANGE_DAYS, poolSlots } from "./engine";
import { AvailabilityInputError } from "./errors";
import { at, everyDay, localHHMM, query, staff } from "./test-helpers";
import type { AvailabilityQuery } from "./types";

const BA = "America/Argentina/Buenos_Aires";
const NY = "America/New_York";
const MADRID = "Europe/Madrid";

/** Local "HH:MM" start times of the computed slots, in the query's zone. */
function times(q: AvailabilityQuery): string[] {
  return computeSlots(q).map((s) => localHHMM(s.start, q.timeZone));
}

describe("computeSlots - working hours", () => {
  it("offers every hour inside 09:00-17:00 for a 60 minute service", () => {
    expect(times(query())).toEqual(["09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00"]);
  });

  it("never offers a slot that would end after closing", () => {
    const q = query({ service: { durationMinutes: 90, bufferBeforeMinutes: 0, bufferAfterMinutes: 0 } });
    expect(times(q).at(-1)).toBe("15:00"); // 15:00-16:30 fits, 16:00-17:30 doesn't
  });

  it("uses the slot interval as the grid, independent of duration", () => {
    const q = query({
      service: { durationMinutes: 45, bufferBeforeMinutes: 0, bufferAfterMinutes: 0 },
      policy: { slotIntervalMinutes: 15, minNoticeMinutes: 0, maxAdvanceDays: 365 },
      staff: [staff({ weeklyHours: everyDay("09:00", "10:30") })],
    });
    expect(times(q)).toEqual(["09:00", "09:15", "09:30", "09:45"]);
  });

  it("aligns the grid to the wall clock, not to an odd opening time", () => {
    const q = query({
      policy: { slotIntervalMinutes: 30, minNoticeMinutes: 0, maxAdvanceDays: 365 },
      staff: [staff({ weeklyHours: everyDay("09:10", "11:10") })],
    });
    expect(times(q)).toEqual(["09:30", "10:00"]);
  });

  it("returns nothing on a weekday without hours", () => {
    const q = query({ staff: [staff({ weeklyHours: everyDay("09:00", "17:00", [2, 3, 4, 5]) })] });
    expect(computeSlots(q)).toEqual([]); // 2026-03-09 is a Monday (1)
  });

  it("supports split shifts on the same day", () => {
    const q = query({
      staff: [
        staff({
          weeklyHours: [
            { weekday: 1, start: "08:00", end: "10:00" },
            { weekday: 1, start: "18:00", end: "20:00" },
          ],
        }),
      ],
    });
    expect(times(q)).toEqual(["08:00", "09:00", "18:00", "19:00"]);
  });

  it("merges overlapping weekly windows instead of duplicating slots", () => {
    const q = query({
      staff: [
        staff({
          weeklyHours: [
            { weekday: 1, start: "09:00", end: "12:00" },
            { weekday: 1, start: "11:00", end: "13:00" },
          ],
        }),
      ],
    });
    expect(times(q)).toEqual(["09:00", "10:00", "11:00", "12:00"]);
  });

  it("lets a service span two adjacent windows (they are merged)", () => {
    const q = query({
      service: { durationMinutes: 120, bufferBeforeMinutes: 0, bufferAfterMinutes: 0 },
      staff: [
        staff({
          weeklyHours: [
            { weekday: 1, start: "09:00", end: "10:00" },
            { weekday: 1, start: "10:00", end: "11:00" },
          ],
        }),
      ],
    });
    expect(times(q)).toEqual(["09:00"]);
  });

  it("accepts 24:00 as end of day", () => {
    const q = query({ staff: [staff({ weeklyHours: everyDay("22:00", "24:00") })] });
    expect(times(q)).toEqual(["22:00", "23:00"]);
  });

  it("handles a service longer than any window", () => {
    const q = query({ service: { durationMinutes: 600, bufferBeforeMinutes: 0, bufferAfterMinutes: 0 } });
    expect(computeSlots(q)).toEqual([]);
  });

  it("returns slot end = start + duration (buffers excluded)", () => {
    const q = query({ service: { durationMinutes: 50, bufferBeforeMinutes: 5, bufferAfterMinutes: 10 } });
    const [first] = computeSlots(q);
    expect(first!.end - first!.start).toBe(50 * 60_000);
  });
});

describe("computeSlots - breaks", () => {
  it("removes slots overlapping a lunch break", () => {
    const q = query({ staff: [staff({ weeklyBreaks: everyDay("13:00", "14:00") })] });
    expect(times(q)).toEqual(["09:00", "10:00", "11:00", "12:00", "14:00", "15:00", "16:00"]);
  });

  it("removes slots that would *run into* a break, not only start in it", () => {
    const q = query({
      policy: { slotIntervalMinutes: 30, minNoticeMinutes: 0, maxAdvanceDays: 365 },
      staff: [staff({ weeklyHours: everyDay("12:00", "15:00"), weeklyBreaks: everyDay("13:00", "13:30") })],
    });
    expect(times(q)).toEqual(["12:00", "13:30", "14:00"]);
  });

  it("only applies breaks on their own weekday", () => {
    const q = query({ staff: [staff({ weeklyBreaks: [{ weekday: 2, start: "09:00", end: "17:00" }] })] });
    expect(times(q)).toHaveLength(8);
  });
});

describe("computeSlots - date overrides and holidays", () => {
  it("replaces weekly hours for that date", () => {
    const q = query({
      staff: [staff({ dateOverrides: [{ date: "2026-03-09", windows: [{ start: "10:00", end: "12:00" }] }] })],
    });
    expect(times(q)).toEqual(["10:00", "11:00"]);
  });

  it("an override with no windows means the staff member is off", () => {
    const q = query({ staff: [staff({ dateOverrides: [{ date: "2026-03-09", windows: [] }] })] });
    expect(computeSlots(q)).toEqual([]);
  });

  it("an override can open a normally closed day", () => {
    const q = query({
      from: "2026-03-14",
      to: "2026-03-14", // Saturday
      staff: [
        staff({
          weeklyHours: everyDay("09:00", "17:00", [1, 2, 3, 4, 5]),
          dateOverrides: [{ date: "2026-03-14", windows: [{ start: "10:00", end: "13:00" }] }],
        }),
      ],
    });
    expect(times(q)).toEqual(["10:00", "11:00", "12:00"]);
  });

  it("an override also replaces the weekly breaks", () => {
    const q = query({
      staff: [
        staff({
          weeklyBreaks: everyDay("13:00", "14:00"),
          dateOverrides: [{ date: "2026-03-09", windows: [{ start: "12:00", end: "15:00" }] }],
        }),
      ],
    });
    expect(times(q)).toEqual(["12:00", "13:00", "14:00"]);
  });

  it("org-wide closed dates (holidays) remove every staff member", () => {
    const q = query({
      from: "2026-03-09",
      to: "2026-03-10",
      closedDates: ["2026-03-09"],
      staff: [staff({ staffId: "alice" }), staff({ staffId: "bob" })],
    });
    const slots = computeSlots(q);
    expect(slots).toHaveLength(16);
    expect(slots.every((s) => s.start >= at(BA, "2026-03-10T00:00"))).toBe(true);
  });
});

describe("computeSlots - time off", () => {
  it("removes a partial-day absence", () => {
    const q = query({
      staff: [staff({ timeOff: [{ start: at(BA, "2026-03-09T10:30"), end: at(BA, "2026-03-09T12:00") }] })],
    });
    expect(times(q)).toEqual(["09:00", "12:00", "13:00", "14:00", "15:00", "16:00"]);
  });

  it("removes multi-day vacations spanning the query range", () => {
    const q = query({
      from: "2026-03-09",
      to: "2026-03-13",
      staff: [staff({ timeOff: [{ start: at(BA, "2026-03-08T00:00"), end: at(BA, "2026-03-12T00:00") }] })],
    });
    const slots = computeSlots(q);
    expect(slots).toHaveLength(16); // only the 12th and 13th remain
    expect(slots[0]!.start).toBe(at(BA, "2026-03-12T09:00"));
  });
});

describe("computeSlots - existing bookings and buffers", () => {
  it("skips a slot taken by an existing booking", () => {
    const q = query({ staff: [staff({ busy: [{ start: at(BA, "2026-03-09T10:00"), end: at(BA, "2026-03-09T11:00") }] })] });
    expect(times(q)).not.toContain("10:00");
    expect(times(q)).toContain("11:00"); // touching ranges are fine
    expect(times(q)).toContain("09:00");
  });

  it("skips every candidate that would overlap a booking in the middle of it", () => {
    const q = query({
      service: { durationMinutes: 60, bufferBeforeMinutes: 0, bufferAfterMinutes: 0 },
      policy: { slotIntervalMinutes: 15, minNoticeMinutes: 0, maxAdvanceDays: 365 },
      staff: [
        staff({
          weeklyHours: everyDay("09:00", "12:00"),
          busy: [{ start: at(BA, "2026-03-09T10:15"), end: at(BA, "2026-03-09T10:30") }],
        }),
      ],
    });
    expect(times(q)).toEqual(["09:00", "09:15", "10:30", "10:45", "11:00"]);
  });

  it("requires the after-buffer to be free of other bookings", () => {
    const q = query({
      service: { durationMinutes: 60, bufferBeforeMinutes: 0, bufferAfterMinutes: 15 },
      staff: [staff({ busy: [{ start: at(BA, "2026-03-09T11:00"), end: at(BA, "2026-03-09T12:00") }] })],
    });
    // 10:00-11:00 + 15 min cleanup would collide with the 11:00 booking.
    expect(times(q)).not.toContain("10:00");
    expect(times(q)).toContain("09:00");
  });

  it("requires the before-buffer to be free of other bookings", () => {
    const q = query({
      service: { durationMinutes: 60, bufferBeforeMinutes: 10, bufferAfterMinutes: 0 },
      staff: [staff({ busy: [{ start: at(BA, "2026-03-09T10:00"), end: at(BA, "2026-03-09T11:00") }] })],
    });
    expect(times(q)).not.toContain("11:00");
    expect(times(q)).toContain("12:00");
  });

  it("lets buffers spill outside working hours", () => {
    const q = query({
      service: { durationMinutes: 60, bufferBeforeMinutes: 30, bufferAfterMinutes: 30 },
    });
    expect(times(q)[0]).toBe("09:00");
    expect(times(q).at(-1)).toBe("16:00");
  });

  it("existing bookings' stored ranges already include their own buffers", () => {
    // Booking 10:00-11:00 with 15 min cleanup is stored as busy 10:00-11:15.
    const q = query({
      policy: { slotIntervalMinutes: 15, minNoticeMinutes: 0, maxAdvanceDays: 365 },
      staff: [
        staff({
          weeklyHours: everyDay("10:00", "13:00"),
          busy: [{ start: at(BA, "2026-03-09T10:00"), end: at(BA, "2026-03-09T11:15") }],
        }),
      ],
    });
    expect(times(q)[0]).toBe("11:15");
  });

  it("ignores bookings of other staff members", () => {
    const busyBob = [{ start: at(BA, "2026-03-09T09:00"), end: at(BA, "2026-03-09T17:00") }];
    const q = query({ staff: [staff({ staffId: "alice" }), staff({ staffId: "bob", busy: busyBob })] });
    const slots = computeSlots(q);
    expect(new Set(slots.map((s) => s.staffId))).toEqual(new Set(["alice"]));
  });
});

describe("computeSlots - booking policy", () => {
  const now = at(BA, "2026-03-09T10:20");

  it("never offers slots in the past", () => {
    const q = query({ now });
    expect(times(q)[0]).toBe("11:00");
  });

  it("applies minimum notice", () => {
    const q = query({ now, policy: { slotIntervalMinutes: 60, minNoticeMinutes: 120, maxAdvanceDays: 365 } });
    expect(times(q)[0]).toBe("13:00"); // 10:20 + 2h = 12:20 -> next grid slot 13:00
  });

  it("accepts a slot exactly at the notice boundary", () => {
    const q = query({
      now: at(BA, "2026-03-09T10:00"),
      policy: { slotIntervalMinutes: 60, minNoticeMinutes: 60, maxAdvanceDays: 365 },
    });
    expect(times(q)[0]).toBe("11:00");
  });

  it("applies the booking horizon", () => {
    const q = query({
      now: at(BA, "2026-03-09T12:00"),
      from: "2026-03-09",
      to: "2026-03-12",
      policy: { slotIntervalMinutes: 60, minNoticeMinutes: 0, maxAdvanceDays: 2 },
    });
    const slots = computeSlots(q);
    expect(slots.at(-1)!.start).toBe(at(BA, "2026-03-11T12:00"));
  });
});

describe("computeSlots - time zones", () => {
  it("interprets hours in the org zone regardless of where the server runs", () => {
    const q = query({ timeZone: "Asia/Tokyo", staff: [staff({ weeklyHours: everyDay("09:00", "10:00") })] });
    const [slot] = computeSlots(q);
    expect(new Date(slot!.start).toISOString()).toBe("2026-03-09T00:00:00.000Z");
  });

  it("produces different instants for the same wall hours in different zones", () => {
    const ba = computeSlots(query({ timeZone: BA }))[0]!.start;
    const madrid = computeSlots(query({ timeZone: MADRID }))[0]!.start;
    expect(ba - madrid).toBe(4 * 3_600_000); // Madrid is UTC+1 in March before DST, BA is UTC-3
  });

  it("works for zones east of the date line", () => {
    const q = query({ timeZone: "Pacific/Kiritimati", staff: [staff({ weeklyHours: everyDay("00:00", "01:00") })] });
    const [slot] = computeSlots(q);
    // 00:00 on Mar 9 at UTC+14 is still Mar 8 in UTC.
    expect(new Date(slot!.start).toISOString()).toBe("2026-03-08T10:00:00.000Z");
  });

  it("rejects unknown zones", () => {
    expect(() => computeSlots(query({ timeZone: "Mars/Olympus_Mons" }))).toThrow(AvailabilityInputError);
  });
});

describe("computeSlots - daylight saving time", () => {
  it("keeps 09:00-17:00 wall hours on the spring-forward day (7h not 8h of UTC shift)", () => {
    const q = query({ timeZone: NY, from: "2026-03-07", to: "2026-03-09" });
    const slots = computeSlots(q);
    const firstOfDay = (date: string) => slots.find((s) => s.start >= at(NY, `${date}T00:00`))!.start;
    expect(new Date(firstOfDay("2026-03-07")).toISOString()).toBe("2026-03-07T14:00:00.000Z"); // EST
    expect(new Date(firstOfDay("2026-03-08")).toISOString()).toBe("2026-03-08T13:00:00.000Z"); // EDT
    expect(slots.map((s) => localHHMM(s.start, NY)).filter((t) => t === "09:00")).toHaveLength(3);
  });

  it("skips grid times that don't exist on the spring-forward night", () => {
    const q = query({
      timeZone: NY,
      from: "2026-03-08",
      to: "2026-03-08",
      staff: [staff({ weeklyHours: everyDay("00:00", "05:00") })],
    });
    // 02:00-03:00 doesn't exist; the window is only 4 real hours long.
    expect(times(q)).toEqual(["00:00", "01:00", "03:00", "04:00"]);
  });

  it("a 60 minute appointment can straddle the gap and still lasts 60 real minutes", () => {
    const q = query({
      timeZone: NY,
      from: "2026-03-08",
      to: "2026-03-08",
      policy: { slotIntervalMinutes: 30, minNoticeMinutes: 0, maxAdvanceDays: 365 },
      staff: [staff({ weeklyHours: everyDay("01:00", "04:00") })],
    });
    const slot = computeSlots(q).find((s) => localHHMM(s.start, NY) === "01:30")!;
    expect(localHHMM(slot.end, NY)).toBe("03:30");
    expect(slot.end - slot.start).toBe(3_600_000);
  });

  it("offers the repeated hour twice on the fall-back night", () => {
    const q = query({
      timeZone: NY,
      from: "2026-11-01",
      to: "2026-11-01",
      staff: [staff({ weeklyHours: everyDay("00:00", "03:00") })],
    });
    const slots = computeSlots(q);
    expect(slots.map((s) => localHHMM(s.start, NY))).toEqual(["00:00", "01:00", "01:00", "02:00"]);
    expect(new Set(slots.map((s) => s.start)).size).toBe(4); // four distinct instants
  });

  it("a booking in the first 01:00 doesn't block the second 01:00", () => {
    const firstOneAm = Date.parse("2026-11-01T05:00:00Z"); // 01:00 EDT
    const q = query({
      timeZone: NY,
      from: "2026-11-01",
      to: "2026-11-01",
      staff: [staff({ weeklyHours: everyDay("00:00", "03:00"), busy: [{ start: firstOneAm, end: firstOneAm + 3_600_000 }] })],
    });
    const starts = computeSlots(q).map((s) => new Date(s.start).toISOString());
    expect(starts).not.toContain("2026-11-01T05:00:00.000Z");
    expect(starts).toContain("2026-11-01T06:00:00.000Z"); // 01:00 EST
  });

  it("handles a European transition at 02:00 -> 03:00", () => {
    const q = query({
      timeZone: MADRID,
      from: "2026-03-29",
      to: "2026-03-29",
      policy: { slotIntervalMinutes: 30, minNoticeMinutes: 0, maxAdvanceDays: 365 },
      service: { durationMinutes: 30, bufferBeforeMinutes: 0, bufferAfterMinutes: 0 },
      staff: [staff({ weeklyHours: everyDay("01:00", "04:00") })],
    });
    expect(times(q)).toEqual(["01:00", "01:30", "03:00", "03:30"]);
  });

  it("opening hours that start inside the gap begin when the clock resumes", () => {
    const q = query({
      timeZone: MADRID,
      from: "2026-03-29",
      to: "2026-03-29",
      staff: [staff({ weeklyHours: everyDay("02:30", "05:00") })],
    });
    // 02:30 doesn't exist -> window starts at 03:30 local; grid slot 03:00 is before it.
    expect(times(q)).toEqual(["04:00"]);
  });

  it("time off expressed in UTC is respected across a DST change", () => {
    const q = query({
      timeZone: NY,
      from: "2026-11-01",
      to: "2026-11-01",
      staff: [
        staff({
          weeklyHours: everyDay("00:00", "03:00"),
          timeOff: [{ start: Date.parse("2026-11-01T06:00:00Z"), end: Date.parse("2026-11-01T07:00:00Z") }],
        }),
      ],
    });
    expect(computeSlots(q).map((s) => new Date(s.start).toISOString())).toEqual([
      "2026-11-01T04:00:00.000Z", // 00:00 EDT
      "2026-11-01T05:00:00.000Z", // 01:00 EDT
      "2026-11-01T07:00:00.000Z", // 02:00 EST
    ]);
  });

  it("handles 30-minute DST offsets (Lord Howe Island)", () => {
    const q = query({
      timeZone: "Australia/Lord_Howe",
      from: "2026-10-04",
      to: "2026-10-04",
      policy: { slotIntervalMinutes: 15, minNoticeMinutes: 0, maxAdvanceDays: 365 },
      service: { durationMinutes: 15, bufferBeforeMinutes: 0, bufferAfterMinutes: 0 },
      staff: [staff({ weeklyHours: everyDay("01:45", "03:00") })],
    });
    expect(times(q)).toEqual(["01:45", "02:30", "02:45"]);
  });
});

describe("computeSlots - multiple staff and ordering", () => {
  it("returns slots sorted by time, then staff id", () => {
    const q = query({
      staff: [
        staff({ staffId: "zoe", weeklyHours: everyDay("09:00", "11:00") }),
        staff({ staffId: "adam", weeklyHours: everyDay("10:00", "12:00") }),
      ],
    });
    expect(computeSlots(q).map((s) => `${localHHMM(s.start, BA)} ${s.staffId}`)).toEqual([
      "09:00 zoe",
      "10:00 adam",
      "10:00 zoe",
      "11:00 adam",
    ]);
  });

  it("spans multiple days", () => {
    const q = query({ from: "2026-03-09", to: "2026-03-15" });
    expect(computeSlots(q)).toHaveLength(7 * 8);
  });

  it("returns an empty list when there is no staff", () => {
    expect(computeSlots(query({ staff: [] }))).toEqual([]);
  });
});

describe("computeSlots - input validation", () => {
  it.each<[string, Partial<AvailabilityQuery>]>([
    ["from after to", { from: "2026-03-10", to: "2026-03-09" }],
    ["invalid date", { from: "2026-02-30" }],
    ["range too long", { from: "2026-01-01", to: "2026-12-31" }],
    ["zero duration", { service: { durationMinutes: 0, bufferBeforeMinutes: 0, bufferAfterMinutes: 0 } }],
    ["negative buffer", { service: { durationMinutes: 30, bufferBeforeMinutes: -5, bufferAfterMinutes: 0 } }],
    ["fractional interval", { policy: { slotIntervalMinutes: 7.5, minNoticeMinutes: 0, maxAdvanceDays: 30 } }],
    ["inverted window", { staff: [staff({ weeklyHours: [{ weekday: 1, start: "17:00", end: "09:00" }] })] }],
    ["malformed window", { staff: [staff({ weeklyBreaks: [{ weekday: 1, start: "1pm", end: "14:00" }] })] }],
  ])("rejects %s", (_label, overrides) => {
    expect(() => computeSlots(query(overrides))).toThrow(AvailabilityInputError);
  });

  it(`accepts exactly ${MAX_RANGE_DAYS} days`, () => {
    expect(() => computeSlots(query({ from: "2026-03-01", to: "2026-05-01" }))).not.toThrow();
  });
});

describe("poolSlots", () => {
  it("merges identical start times and keeps preference order", () => {
    const q = query({ staff: [staff({ staffId: "alice" }), staff({ staffId: "bob" })] });
    const pooled = poolSlots(computeSlots(q), ["bob", "alice"]);
    expect(pooled).toHaveLength(8);
    expect(pooled[0]!.staffIds).toEqual(["bob", "alice"]);
  });

  it("falls back to alphabetical order for unranked staff", () => {
    const q = query({ staff: [staff({ staffId: "carol" }), staff({ staffId: "alice" })] });
    expect(poolSlots(computeSlots(q))[0]!.staffIds).toEqual(["alice", "carol"]);
  });
});

describe("isSlotAvailable", () => {
  it("confirms an offered slot", () => {
    expect(isSlotAvailable(query(), "alice", at(BA, "2026-03-09T09:00"))).toBe(true);
  });

  it("rejects an off-grid start even if the time is free", () => {
    expect(isSlotAvailable(query(), "alice", at(BA, "2026-03-09T09:07"))).toBe(false);
  });

  it("rejects a slot for another staff member", () => {
    expect(isSlotAvailable(query(), "mallory", at(BA, "2026-03-09T09:00"))).toBe(false);
  });
});
