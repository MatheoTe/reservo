import { Temporal } from "temporal-polyfill";

/**
 * Wall-clock helpers. A "wall time" is what a person reads on the clock in a
 * given time zone ("09:00 in America/Argentina/Buenos_Aires"). Business rules
 * (opening hours, breaks) are stored as wall times because that is how owners
 * think about them; bookings are stored as absolute instants.
 */

const WALL_TIME = /^([01]\d|2[0-3]):([0-5]\d)$|^24:00$/;

export const MINUTES_PER_DAY = 24 * 60;
export const MS_PER_MINUTE = 60_000;

export class InvalidWallTimeError extends Error {
  constructor(value: string) {
    super(`Invalid wall time "${value}". Expected HH:MM between 00:00 and 24:00.`);
    this.name = "InvalidWallTimeError";
  }
}

/** "09:30" -> 570. "24:00" is accepted as an end-of-day marker (1440). */
export function parseWallTime(value: string): number {
  const match = WALL_TIME.exec(value);
  if (!match) throw new InvalidWallTimeError(value);
  if (value === "24:00") return MINUTES_PER_DAY;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function formatWallTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function assertTimeZone(timeZone: string): void {
  // Throws RangeError for unknown zones; cheaper than keeping our own list.
  Temporal.Now.zonedDateTimeISO(timeZone);
}

/**
 * Resolves a wall-clock time on a calendar date to an absolute instant.
 *
 * Uses `compatible` disambiguation, matching how calendars (RFC 5545) treat
 * DST transitions:
 *  - spring-forward gap: 02:30 that does not exist becomes 03:30 (pushed later)
 *  - fall-back overlap: 01:30 that happens twice resolves to the first one
 *
 * `minutes === 1440` means "midnight at the end of this day".
 */
export function wallTimeToInstant(date: Temporal.PlainDate, minutes: number, timeZone: string): number {
  const day = minutes === MINUTES_PER_DAY ? date.add({ days: 1 }) : date;
  const m = minutes === MINUTES_PER_DAY ? 0 : minutes;
  return day
    .toPlainDateTime({ hour: Math.floor(m / 60), minute: m % 60 })
    .toZonedDateTime(timeZone, { disambiguation: "compatible" }).epochMilliseconds;
}

/**
 * Every instant at which the wall clock reads `minutes` on `date`.
 *
 * - normal time: exactly one instant
 * - inside a spring-forward gap: zero (that time never shows on the clock)
 * - inside a fall-back overlap: two (the clock shows it twice)
 *
 * Slot generation uses this so a 01:30 slot on a fall-back night is offered
 * twice (they are genuinely different hours) and a 02:30 slot on a
 * spring-forward night is not offered at all.
 */
export function instantsForWallTime(date: Temporal.PlainDate, minutes: number, timeZone: string): number[] {
  const pdt = date.toPlainDateTime({ hour: Math.floor(minutes / 60), minute: minutes % 60 });
  const earlier = pdt.toZonedDateTime(timeZone, { disambiguation: "earlier" });
  const later = pdt.toZonedDateTime(timeZone, { disambiguation: "later" });
  const existsOnClock = Temporal.PlainDateTime.compare(earlier.toPlainDateTime(), pdt) === 0;
  if (!existsOnClock) return [];
  if (earlier.epochMilliseconds === later.epochMilliseconds) return [earlier.epochMilliseconds];
  return [earlier.epochMilliseconds, later.epochMilliseconds];
}

/** Local calendar date of an instant in a zone, e.g. for "today" in the org. */
export function instantToPlainDate(epochMs: number, timeZone: string): Temporal.PlainDate {
  return Temporal.Instant.fromEpochMilliseconds(epochMs).toZonedDateTimeISO(timeZone).toPlainDate();
}

export function* eachDate(from: Temporal.PlainDate, to: Temporal.PlainDate): Generator<Temporal.PlainDate> {
  for (let d = from; Temporal.PlainDate.compare(d, to) <= 0; d = d.add({ days: 1 })) {
    yield d;
  }
}
