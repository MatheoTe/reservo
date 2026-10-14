import { and, asc, eq, gte } from "drizzle-orm";

import { breaks, holidays, staffMembers, timeOff, workingHours } from "@/db/schema";

import { audit } from "../audit";
import { can } from "../auth/rbac";
import type { Tx } from "../db/client";
import { forbidden, notFound } from "../errors";
import type { Actor } from "./team";

interface Window {
  weekday: number;
  start: string;
  end: string;
}

async function assertCanManageSchedule(tx: Tx, actor: Actor, staffId: string) {
  const [staff] = await tx.select().from(staffMembers).where(eq(staffMembers.id, staffId));
  if (!staff) throw notFound("Staff member");
  const own = staff.userId === actor.userId;
  if (!(can(actor.role, "schedule:manage:any") || (own && can(actor.role, "schedule:manage:own")))) throw forbidden();
  return staff;
}

export async function getSchedule(tx: Tx, staffId: string) {
  const [hours, breakRows, absences] = await Promise.all([
    tx.select().from(workingHours).where(eq(workingHours.staffId, staffId)).orderBy(asc(workingHours.weekday), asc(workingHours.startTime)),
    tx.select().from(breaks).where(eq(breaks.staffId, staffId)).orderBy(asc(breaks.weekday), asc(breaks.startTime)),
    tx
      .select()
      .from(timeOff)
      .where(and(eq(timeOff.staffId, staffId), gte(timeOff.endsAt, new Date())))
      .orderBy(asc(timeOff.startsAt)),
  ]);
  const toWindow = (r: { weekday: number; startTime: string; endTime: string }) => ({
    weekday: r.weekday,
    start: r.startTime.slice(0, 5),
    end: r.endTime.slice(0, 5),
  });
  return { hours: hours.map(toWindow), breaks: breakRows.map(toWindow), timeOff: absences };
}

/** Replaces the weekly schedule atomically (it's a small set; diffing isn't worth it). */
export async function replaceSchedule(tx: Tx, actor: Actor, input: { staffId: string; hours: Window[]; breaks: Window[] }) {
  await assertCanManageSchedule(tx, actor, input.staffId);
  const orgId = actor.orgId;
  await tx.delete(workingHours).where(eq(workingHours.staffId, input.staffId));
  await tx.delete(breaks).where(eq(breaks.staffId, input.staffId));
  if (input.hours.length) {
    await tx.insert(workingHours).values(input.hours.map((w) => ({ orgId, staffId: input.staffId, weekday: w.weekday, startTime: w.start, endTime: w.end })));
  }
  if (input.breaks.length) {
    await tx.insert(breaks).values(input.breaks.map((w) => ({ orgId, staffId: input.staffId, weekday: w.weekday, startTime: w.start, endTime: w.end })));
  }
  await audit(tx, {
    orgId,
    actorUserId: actor.userId,
    action: "staff.schedule_updated",
    targetType: "staff",
    targetId: input.staffId,
    metadata: { hours: input.hours.length, breaks: input.breaks.length },
  });
}

export async function addTimeOff(tx: Tx, actor: Actor, input: { staffId: string | null; startsAt: Date; endsAt: Date; reason?: string }) {
  if (input.staffId) await assertCanManageSchedule(tx, actor, input.staffId);
  else if (!can(actor.role, "schedule:manage:any")) throw forbidden();
  const [row] = await tx
    .insert(timeOff)
    .values({ orgId: actor.orgId, staffId: input.staffId, startsAt: input.startsAt, endsAt: input.endsAt, reason: input.reason ?? null })
    .returning();
  return row!;
}

export async function addHoliday(tx: Tx, actor: Actor, input: { date: string; name: string }) {
  if (!can(actor.role, "schedule:manage:any")) throw forbidden();
  await tx.insert(holidays).values({ orgId: actor.orgId, date: input.date, name: input.name }).onConflictDoNothing();
}
