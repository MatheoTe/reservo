import { Temporal } from "temporal-polyfill";

import { AvailabilityInputError } from "./errors";
import { type Interval, normalize, overlapsAny, subtract } from "./intervals";
import type { AvailabilityQuery, PooledSlot, Slot, StaffSchedule, WallWindow } from "./types";
import {
  assertTimeZone,
  eachDate,
  instantsForWallTime,
  InvalidWallTimeError,
  MINUTES_PER_DAY,
  MS_PER_MINUTE,
  parseWallTime,
  wallTimeToInstant,
} from "./wall-time";

/** Hard cap so a malicious/buggy query can't make us iterate for years. */
export const MAX_RANGE_DAYS = 62;

/**
 * Computes every bookable slot for a service across the given staff members.
 *
 * Rules, in order:
 *  1. Working windows for each local date come from a date override if one
 *     exists (overrides replace both hours and breaks), otherwise from the
 *     weekly hours minus weekly breaks. Org-wide closed dates yield nothing.
 *  2. Time off is removed from the working windows.
 *  3. Candidate starts are wall-clock times on a grid of `slotIntervalMinutes`
 *     from local midnight. Times that don't exist (DST gap) are skipped;
 *     times that happen twice (DST overlap) are offered twice.
 *  4. A candidate is kept when the appointment itself `[start, start+duration)`
 *     fits inside one working window, AND the buffered range
 *     `[start-before, end+after)` doesn't overlap any busy range. Buffers may
 *     spill outside working hours (cleanup after closing is fine) but never
 *     into another booking - the same rule the DB exclusion constraint enforces.
 *  5. Notice / horizon policy relative to `now`.
 *
 * The function is pure: no I/O, no clock reads, no randomness.
 */
export function computeSlots(query: AvailabilityQuery): Slot[] {
  const { from, to } = validateQuery(query);
  const { service, policy, timeZone } = query;
  const closed = new Set(query.closedDates ?? []);

  const durationMs = service.durationMinutes * MS_PER_MINUTE;
  const beforeMs = service.bufferBeforeMinutes * MS_PER_MINUTE;
  const afterMs = service.bufferAfterMinutes * MS_PER_MINUTE;
  const earliestStart = query.now + policy.minNoticeMinutes * MS_PER_MINUTE;
  const latestStart = query.now + policy.maxAdvanceDays * MINUTES_PER_DAY * MS_PER_MINUTE;

  const slots: Slot[] = [];

  for (const member of query.staff) {
    const busy = normalize(member.busy);
    const timeOff = normalize(member.timeOff);

    for (const date of eachDate(from, to)) {
      if (closed.has(date.toString())) continue;

      const open = subtract(workingWindowsFor(member, date, timeZone), timeOff);
      if (open.length === 0) continue;

      for (let minute = 0; minute < MINUTES_PER_DAY; minute += policy.slotIntervalMinutes) {
        for (const start of instantsForWallTime(date, minute, timeZone)) {
          if (start < earliestStart || start > latestStart) continue;
          const appointment: Interval = { start, end: start + durationMs };
          if (!open.some((w) => w.start <= appointment.start && appointment.end <= w.end)) continue;
          const blocked: Interval = { start: start - beforeMs, end: appointment.end + afterMs };
          if (overlapsAny(busy, blocked)) continue;
          slots.push({ staffId: member.staffId, start, end: appointment.end });
        }
      }
    }
  }

  return slots.sort((a, b) => a.start - b.start || a.staffId.localeCompare(b.staffId));
}

/**
 * Collapses per-staff slots into unique start times for the "any staff"
 * option. Staff ids keep the order given in `preference` so callers can
 * implement round-robin or least-busy assignment.
 */
export function poolSlots(
  slots: readonly Slot[],
  preference: readonly string[] = [],
): PooledSlot[] {
  const rank = new Map(preference.map((id, i) => [id, i]));
  const byStart = new Map<number, PooledSlot>();
  for (const s of slots) {
    const existing = byStart.get(s.start);
    if (existing) existing.staffIds.push(s.staffId);
    else byStart.set(s.start, { start: s.start, end: s.end, staffIds: [s.staffId] });
  }
  const pooled = [...byStart.values()].sort((a, b) => a.start - b.start);
  for (const p of pooled) {
    p.staffIds.sort(
      (a, b) => (rank.get(a) ?? Infinity) - (rank.get(b) ?? Infinity) || a.localeCompare(b),
    );
  }
  return pooled;
}

/** Server-side re-check used right before inserting a booking. */
export function isSlotAvailable(query: AvailabilityQuery, staffId: string, start: number): boolean {
  return computeSlots(query).some((s) => s.staffId === staffId && s.start === start);
}

function workingWindowsFor(
  member: StaffSchedule,
  date: Temporal.PlainDate,
  timeZone: string,
): Interval[] {
  const iso = date.toString();
  const override = member.dateOverrides.find((o) => o.date === iso);
  if (override) return toInstants(override.windows, date, timeZone);

  const weekday = date.dayOfWeek;
  const hours = member.weeklyHours.filter((w) => w.weekday === weekday);
  const breaks = member.weeklyBreaks.filter((w) => w.weekday === weekday);
  return subtract(toInstants(hours, date, timeZone), toInstants(breaks, date, timeZone));
}

function toInstants(
  windows: readonly WallWindow[],
  date: Temporal.PlainDate,
  timeZone: string,
): Interval[] {
  return normalize(
    windows.map((w) => ({
      start: wallTimeToInstant(date, parseWallTime(w.start), timeZone),
      end: wallTimeToInstant(date, parseWallTime(w.end), timeZone),
    })),
  );
}

function validateQuery(query: AvailabilityQuery): {
  from: Temporal.PlainDate;
  to: Temporal.PlainDate;
} {
  try {
    assertTimeZone(query.timeZone);
  } catch {
    throw new AvailabilityInputError(`Unknown time zone "${query.timeZone}".`);
  }

  let from: Temporal.PlainDate;
  let to: Temporal.PlainDate;
  try {
    from = Temporal.PlainDate.from(query.from, { overflow: "reject" });
    to = Temporal.PlainDate.from(query.to, { overflow: "reject" });
  } catch {
    throw new AvailabilityInputError("`from` and `to` must be valid YYYY-MM-DD dates.");
  }
  const days = from.until(to, { largestUnit: "days" }).days;
  if (days < 0) throw new AvailabilityInputError("`from` must not be after `to`.");
  if (days >= MAX_RANGE_DAYS)
    throw new AvailabilityInputError(`Range is limited to ${MAX_RANGE_DAYS} days.`);

  const { service, policy } = query;
  assertPositiveInt(service.durationMinutes, "service.durationMinutes");
  assertNonNegativeInt(service.bufferBeforeMinutes, "service.bufferBeforeMinutes");
  assertNonNegativeInt(service.bufferAfterMinutes, "service.bufferAfterMinutes");
  assertPositiveInt(policy.slotIntervalMinutes, "policy.slotIntervalMinutes");
  assertNonNegativeInt(policy.minNoticeMinutes, "policy.minNoticeMinutes");
  assertNonNegativeInt(policy.maxAdvanceDays, "policy.maxAdvanceDays");

  for (const member of query.staff) {
    const windows = [
      ...member.weeklyHours,
      ...member.weeklyBreaks,
      ...member.dateOverrides.flatMap((o) => o.windows),
    ];
    for (const w of windows) {
      let start: number;
      let end: number;
      try {
        start = parseWallTime(w.start);
        end = parseWallTime(w.end);
      } catch (err) {
        if (err instanceof InvalidWallTimeError) throw new AvailabilityInputError(err.message);
        throw err;
      }
      if (start >= end) {
        throw new AvailabilityInputError(
          `Window ${w.start}-${w.end} for staff ${member.staffId} must end after it starts.`,
        );
      }
    }
  }

  return { from, to };
}

function assertPositiveInt(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0)
    throw new AvailabilityInputError(`${name} must be a positive integer.`);
}

function assertNonNegativeInt(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0)
    throw new AvailabilityInputError(`${name} must be a non-negative integer.`);
}
