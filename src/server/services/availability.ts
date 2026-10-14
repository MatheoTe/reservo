import { and, eq, gt, gte, inArray, lt, lte, or, sql } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";

import {
  bookings,
  breaks,
  dateOverrides,
  holidays,
  type Organization,
  type Service,
  services,
  staffMembers,
  staffServices,
  timeOff,
  workingHours,
} from "@/db/schema";
import {
  type AvailabilityQuery,
  computeSlots,
  type DateOverride,
  type IsoWeekday,
  type Slot,
  type StaffSchedule,
} from "@/lib/availability";

import type { Tx } from "../db/client";
import { notFound } from "../errors";

/** Postgres `time` comes back as "09:00:00"; the engine wants "09:00". */
const hhmm = (value: string) => value.slice(0, 5);

export interface BookableStaff {
  id: string;
  displayName: string;
  color: string;
}

/** Active staff members who offer the service, in a stable order. */
export async function staffForService(tx: Tx, serviceId: string): Promise<BookableStaff[]> {
  return tx
    .select({ id: staffMembers.id, displayName: staffMembers.displayName, color: staffMembers.color })
    .from(staffMembers)
    .innerJoin(staffServices, eq(staffServices.staffId, staffMembers.id))
    .where(and(eq(staffServices.serviceId, serviceId), eq(staffMembers.active, true)))
    .orderBy(staffMembers.displayName);
}

export async function activeService(tx: Tx, serviceId: string): Promise<Service> {
  const [service] = await tx
    .select()
    .from(services)
    .where(and(eq(services.id, serviceId), eq(services.active, true)));
  if (!service) throw notFound("Service");
  return service;
}

/**
 * Loads everything the pure engine needs for a set of staff and a date range.
 * The query window is widened by a day on each side: a local date in the org
 * zone can start or end on a neighbouring UTC date.
 */
export async function loadAvailabilityQuery(
  tx: Tx,
  params: { org: Organization; service: Service; staffIds: string[]; from: string; to: string; now: Date },
): Promise<AvailabilityQuery> {
  const { org, service, staffIds, from, to, now } = params;
  const base: Omit<AvailabilityQuery, "staff" | "closedDates"> = {
    timeZone: org.timeZone,
    from,
    to,
    now: now.getTime(),
    service: {
      durationMinutes: service.durationMinutes,
      bufferBeforeMinutes: service.bufferBeforeMinutes,
      bufferAfterMinutes: service.bufferAfterMinutes,
    },
    policy: {
      slotIntervalMinutes: org.slotIntervalMinutes,
      minNoticeMinutes: org.minNoticeMinutes,
      maxAdvanceDays: org.maxAdvanceDays,
    },
  };
  if (staffIds.length === 0) return { ...base, staff: [], closedDates: [] };

  const rangeStart = new Date(
    Temporal.PlainDate.from(from).subtract({ days: 1 }).toZonedDateTime(org.timeZone).epochMilliseconds,
  );
  const rangeEnd = new Date(Temporal.PlainDate.from(to).add({ days: 2 }).toZonedDateTime(org.timeZone).epochMilliseconds);
  const nowIso = now.toISOString();

  const [hours, breakRows, overrides, absences, closed, busy] = await Promise.all([
    tx.select().from(workingHours).where(inArray(workingHours.staffId, staffIds)),
    tx.select().from(breaks).where(inArray(breaks.staffId, staffIds)),
    tx
      .select()
      .from(dateOverrides)
      .where(and(inArray(dateOverrides.staffId, staffIds), gte(dateOverrides.date, from), lte(dateOverrides.date, to))),
    tx
      .select()
      .from(timeOff)
      .where(
        and(
          or(inArray(timeOff.staffId, staffIds), sql`${timeOff.staffId} is null`),
          lt(timeOff.startsAt, rangeEnd),
          gt(timeOff.endsAt, rangeStart),
        ),
      ),
    tx.select({ date: holidays.date }).from(holidays).where(and(gte(holidays.date, from), lte(holidays.date, to))),
    tx
      .select({ staffId: bookings.staffId, from: bookings.blockedFrom, until: bookings.blockedUntil })
      .from(bookings)
      .where(
        and(
          inArray(bookings.staffId, staffIds),
          lt(bookings.blockedFrom, rangeEnd),
          gt(bookings.blockedUntil, rangeStart),
          or(
            eq(bookings.status, "confirmed"),
            and(eq(bookings.status, "pending_payment"), sql`${bookings.holdExpiresAt} > ${nowIso}`),
          ),
        ),
      ),
  ]);

  const staff: StaffSchedule[] = staffIds.map((staffId) => {
    const overridesByDate = new Map<string, DateOverride>();
    for (const o of overrides.filter((r) => r.staffId === staffId)) {
      const entry = overridesByDate.get(o.date) ?? { date: o.date, windows: [] };
      if (o.startTime && o.endTime) entry.windows.push({ start: hhmm(o.startTime), end: hhmm(o.endTime) });
      overridesByDate.set(o.date, entry);
    }
    return {
      staffId,
      weeklyHours: hours
        .filter((h) => h.staffId === staffId)
        .map((h) => ({ weekday: h.weekday as IsoWeekday, start: hhmm(h.startTime), end: hhmm(h.endTime) })),
      weeklyBreaks: breakRows
        .filter((b) => b.staffId === staffId)
        .map((b) => ({ weekday: b.weekday as IsoWeekday, start: hhmm(b.startTime), end: hhmm(b.endTime) })),
      dateOverrides: [...overridesByDate.values()],
      timeOff: absences
        .filter((a) => a.staffId === null || a.staffId === staffId)
        .map((a) => ({ start: a.startsAt.getTime(), end: a.endsAt.getTime() })),
      busy: busy.filter((b) => b.staffId === staffId).map((b) => ({ start: b.from.getTime(), end: b.until.getTime() })),
    };
  });

  return { ...base, staff, closedDates: closed.map((c) => c.date) };
}

export async function computeAvailability(
  tx: Tx,
  params: { org: Organization; serviceId: string; staffId?: string; from: string; to: string; now: Date },
): Promise<{ slots: Slot[]; staff: BookableStaff[] }> {
  const service = await activeService(tx, params.serviceId);
  const offering = await staffForService(tx, service.id);
  const selected = params.staffId ? offering.filter((s) => s.id === params.staffId) : offering;
  if (params.staffId && selected.length === 0) throw notFound("Staff member");
  const query = await loadAvailabilityQuery(tx, {
    org: params.org,
    service,
    staffIds: selected.map((s) => s.id),
    from: params.from,
    to: params.to,
    now: params.now,
  });
  return { slots: computeSlots(query), staff: offering };
}
