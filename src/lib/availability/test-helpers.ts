import { Temporal } from "temporal-polyfill";

import type { AvailabilityQuery, IsoWeekday, StaffSchedule, WeeklyWindow } from "./types";

/** Epoch ms for a wall-clock time in a zone, e.g. at("Europe/Madrid", "2026-03-29T10:00"). */
export function at(timeZone: string, local: string): number {
  return Temporal.PlainDateTime.from(local).toZonedDateTime(timeZone, { disambiguation: "reject" })
    .epochMilliseconds;
}

export function iso(epochMs: number): string {
  return Temporal.Instant.fromEpochMilliseconds(epochMs).toString();
}

export function localHHMM(epochMs: number, timeZone: string): string {
  const z = Temporal.Instant.fromEpochMilliseconds(epochMs).toZonedDateTimeISO(timeZone);
  return `${String(z.hour).padStart(2, "0")}:${String(z.minute).padStart(2, "0")}`;
}

export const ALL_DAYS: IsoWeekday[] = [1, 2, 3, 4, 5, 6, 7];

export function everyDay(
  start: string,
  end: string,
  days: IsoWeekday[] = ALL_DAYS,
): WeeklyWindow[] {
  return days.map((weekday) => ({ weekday, start, end }));
}

export function staff(overrides: Partial<StaffSchedule> = {}): StaffSchedule {
  return {
    staffId: "alice",
    weeklyHours: everyDay("09:00", "17:00"),
    weeklyBreaks: [],
    dateOverrides: [],
    timeOff: [],
    busy: [],
    ...overrides,
  };
}

/**
 * A query for a single day with permissive policy so tests only exercise the
 * rule under test. `now` defaults to far in the past.
 */
export function query(overrides: Partial<AvailabilityQuery> = {}): AvailabilityQuery {
  return {
    timeZone: "America/Argentina/Buenos_Aires",
    from: "2026-03-09",
    to: "2026-03-09",
    now: at("UTC", "2026-01-01T00:00"),
    service: { durationMinutes: 60, bufferBeforeMinutes: 0, bufferAfterMinutes: 0 },
    policy: { slotIntervalMinutes: 60, minNoticeMinutes: 0, maxAdvanceDays: 365 },
    staff: [staff()],
    ...overrides,
  };
}
