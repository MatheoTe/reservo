import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import postgres from "postgres";
import { Temporal } from "temporal-polyfill";
import { afterAll, beforeEach } from "vitest";

import {
  bookings,
  customers,
  organizations,
  services,
  staffMembers,
  staffServices,
  workingHours,
} from "@/db/schema";
import { closeDb } from "@/server/db/client";
import { withTenant } from "@/server/db/tenant";
import { createOrganization } from "@/server/services/organizations";

/** Superuser connection: bypasses RLS. Only for arranging data and asserting ground truth. */
export const admin = postgres(process.env.TEST_DATABASE_ADMIN_URL!, { max: 4, onnotice: () => {} });

const TABLES = [
  "audit_log",
  "outbox",
  "webhook_events",
  "payments",
  "bookings",
  "customers",
  "holidays",
  "time_off",
  "date_overrides",
  "breaks",
  "working_hours",
  "staff_services",
  "services",
  "staff_members",
  "invitations",
  "memberships",
  "organizations",
  "rate_limits",
  "auth_sessions",
  "auth_accounts",
  "auth_verifications",
  "auth_users",
];

export function useCleanDatabase() {
  beforeEach(async () => {
    await admin.unsafe(`truncate ${TABLES.join(", ")} restart identity cascade`);
  });
  afterAll(async () => {
    await closeDb();
  });
}

export async function createUser(
  name: string,
  email = `${name.toLowerCase().replaceAll(" ", ".")}@example.com`,
) {
  const id = randomUUID();
  await admin`insert into auth_users ${admin({ id, name, email, email_verified: true })}`;
  return { id, name, email };
}

export interface TestOrg {
  orgId: string;
  slug: string;
  owner: { id: string; name: string; email: string };
  ownerStaffId: string;
  serviceId: string;
}

/**
 * A realistic tenant built through the real services (so it goes through RLS):
 * owner + staff row with Mon-Sun 09:00-17:00 hours and one 60-minute service.
 */
export async function createTestOrg(
  slug: string,
  opts: {
    timeZone?: string;
    depositCents?: number;
    bufferAfterMinutes?: number;
    minNoticeMinutes?: number;
  } = {},
): Promise<TestOrg> {
  const owner = await createUser(`Owner ${slug}`, `owner@${slug}.test`);
  const { id: orgId } = await createOrganization(owner, {
    name: `Org ${slug}`,
    slug,
    timeZone: opts.timeZone ?? "America/Argentina/Buenos_Aires",
    currency: "usd",
  });
  return withTenant({ orgId, userId: owner.id }, async (tx) => {
    const [staff] = await tx.select().from(staffMembers).where(eq(staffMembers.userId, owner.id));
    await tx.delete(workingHours).where(eq(workingHours.staffId, staff!.id));
    await tx.insert(workingHours).values(
      [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
        orgId,
        staffId: staff!.id,
        weekday,
        startTime: "09:00",
        endTime: "17:00",
      })),
    );
    const [service] = await tx
      .insert(services)
      .values({
        orgId,
        name: "Consultation",
        durationMinutes: 60,
        priceCents: 5000,
        depositCents: opts.depositCents ?? 0,
        bufferAfterMinutes: opts.bufferAfterMinutes ?? 0,
      })
      .returning();
    await tx.insert(staffServices).values({ orgId, staffId: staff!.id, serviceId: service!.id });
    // Zero notice by default so tests can book "tomorrow" without caring about the clock.
    await tx
      .update(organizations)
      .set({ minNoticeMinutes: opts.minNoticeMinutes ?? 0 })
      .where(eq(organizations.id, orgId));
    return { orgId, slug, owner, ownerStaffId: staff!.id, serviceId: service!.id };
  });
}

export async function addStaff(org: TestOrg, name: string) {
  return withTenant({ orgId: org.orgId }, async (tx) => {
    const [staff] = await tx
      .insert(staffMembers)
      .values({ orgId: org.orgId, displayName: name })
      .returning();
    await tx.insert(workingHours).values(
      [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
        orgId: org.orgId,
        staffId: staff!.id,
        weekday,
        startTime: "09:00",
        endTime: "17:00",
      })),
    );
    await tx
      .insert(staffServices)
      .values({ orgId: org.orgId, staffId: staff!.id, serviceId: org.serviceId });
    return staff!;
  });
}

export async function insertBookingDirect(
  org: TestOrg,
  params: {
    staffId?: string;
    start: Date;
    minutes?: number;
    status?: "confirmed" | "pending_payment" | "cancelled" | "expired";
    holdExpiresAt?: Date | null;
  },
) {
  return withTenant({ orgId: org.orgId }, async (tx) => {
    const [customer] = await tx
      .insert(customers)
      .values({
        orgId: org.orgId,
        name: "Direct Customer",
        email: `direct-${randomUUID()}@example.com`,
      })
      .returning();
    const end = new Date(params.start.getTime() + (params.minutes ?? 60) * 60_000);
    const status = params.status ?? "confirmed";
    const [row] = await tx
      .insert(bookings)
      .values({
        orgId: org.orgId,
        staffId: params.staffId ?? org.ownerStaffId,
        serviceId: org.serviceId,
        customerId: customer!.id,
        status,
        source: "dashboard",
        startsAt: params.start,
        endsAt: end,
        blockedFrom: params.start,
        blockedUntil: end,
        priceCents: 5000,
        holdExpiresAt:
          params.holdExpiresAt ??
          (status === "pending_payment" ? new Date(Date.now() + 15 * 60_000) : null),
        accessToken: randomUUID(),
      })
      .returning();
    return row!;
  });
}

/**
 * `days` from today at a wall-clock hour in the test orgs' zone (Buenos Aires).
 * Tests that depend on the 24h reminder use >= 2 days so the result doesn't
 * depend on what time of day the suite runs.
 */
export function inDaysAt(days: number, hour: number, minute = 0): Date {
  // Calendar math in the org's zone, so the result is right even late at night
  // when the UTC date has already rolled over.
  const zone = "America/Argentina/Buenos_Aires";
  const local = Temporal.Now.plainDateISO(zone).add({ days }).toPlainDateTime({ hour, minute });
  return new Date(local.toZonedDateTime(zone).epochMilliseconds);
}

export const tomorrowAt = (hour: number, minute = 0) => inDaysAt(1, hour, minute);

export async function countBookings(orgId: string, status?: string) {
  const rows = status
    ? await admin`select count(*)::int as n from bookings where org_id = ${orgId} and status = ${status}`
    : await admin`select count(*)::int as n from bookings where org_id = ${orgId}`;
  return rows[0]!.n as number;
}
