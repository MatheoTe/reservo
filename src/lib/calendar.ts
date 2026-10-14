import { Temporal } from "temporal-polyfill";

/**
 * Calendar math for dashboard views, always in the organization's zone.
 * Weeks start on Monday (ISO).
 */
export function todayIn(timeZone: string, now = Date.now()): Temporal.PlainDate {
  return Temporal.Instant.fromEpochMilliseconds(now).toZonedDateTimeISO(timeZone).toPlainDate();
}

export function parseDateParam(value: string | undefined, timeZone: string): Temporal.PlainDate {
  if (value) {
    try {
      return Temporal.PlainDate.from(value, { overflow: "reject" });
    } catch {
      // fall through to today
    }
  }
  return todayIn(timeZone);
}

export function startOfWeek(date: Temporal.PlainDate): Temporal.PlainDate {
  return date.subtract({ days: date.dayOfWeek - 1 });
}

/** [start, end) instants covering whole local days. */
export function localRange(from: Temporal.PlainDate, daysCount: number, timeZone: string): { start: Date; end: Date } {
  return {
    start: new Date(from.toZonedDateTime(timeZone).epochMilliseconds),
    end: new Date(from.add({ days: daysCount }).toZonedDateTime(timeZone).epochMilliseconds),
  };
}

/** Minutes since local midnight of the given instant (DST-correct wall clock). */
export function wallMinutes(date: Date, timeZone: string): number {
  const z = Temporal.Instant.fromEpochMilliseconds(date.getTime()).toZonedDateTimeISO(timeZone);
  return z.hour * 60 + z.minute;
}

export function localDateOf(date: Date, timeZone: string): string {
  return Temporal.Instant.fromEpochMilliseconds(date.getTime()).toZonedDateTimeISO(timeZone).toPlainDate().toString();
}

export function formatDay(date: Temporal.PlainDate, locale = "en-US"): { weekday: string; day: string; month: string } {
  const js = new Date(Date.UTC(date.year, date.month - 1, date.day));
  return {
    weekday: js.toLocaleDateString(locale, { weekday: "short", timeZone: "UTC" }),
    day: String(date.day),
    month: js.toLocaleDateString(locale, { month: "short", timeZone: "UTC" }),
  };
}

export function formatRangeLabel(start: Temporal.PlainDate, end: Temporal.PlainDate, locale = "en-US"): string {
  const a = new Date(Date.UTC(start.year, start.month - 1, start.day));
  const b = new Date(Date.UTC(end.year, end.month - 1, end.day));
  const fmt = (d: Date, withYear: boolean) =>
    d.toLocaleDateString(locale, { month: "short", day: "numeric", year: withYear ? "numeric" : undefined, timeZone: "UTC" });
  return `${fmt(a, start.year !== end.year)} - ${fmt(b, true)}`;
}
