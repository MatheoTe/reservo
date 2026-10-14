import { randomBytes } from "node:crypto";

import { and, asc, eq, gte, inArray, lt, lte, sql } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";

import {
  type Booking,
  bookings,
  customers,
  type Organization,
  organizations,
  payments,
  services,
  staffMembers,
} from "@/db/schema";
import { computeSlots } from "@/lib/availability";
import type { PublicBookingInput } from "@/lib/validation";

import { audit } from "../audit";
import type { Tx } from "../db/client";
import { orgIdBySlug, withTenant } from "../db/tenant";
import { AppError, isPgError, notFound, PG, slotUnavailable } from "../errors";
import { enqueue } from "../outbox/outbox";
import { getPaymentProvider, type PaymentProvider } from "../payments";
import { activeService, loadAvailabilityQuery, staffForService } from "./availability";

const MINUTE = 60_000;
const REMINDER_LEAD_MS = 24 * 60 * MINUTE;

export interface ReserveInput {
  org: Organization;
  serviceId: string;
  /** Explicit staff member, or null for "any available". */
  staffId: string | null;
  start: Date;
  customer: { name: string; email: string; phone: string | null };
  customerTimeZone?: string;
  notes?: string;
  source: "public" | "dashboard";
  actorUserId?: string | null;
  now: Date;
}

/**
 * Reserves a slot inside the caller's tenant transaction.
 *
 * Two layers of protection against double booking:
 *  1. The availability engine re-validates the requested start against
 *     working hours, breaks, time off and current bookings (business rules).
 *  2. The INSERT is guarded by the `bookings_no_overlap` exclusion
 *     constraint. If a concurrent request won the race between (1) and (2),
 *     Postgres raises 23P01 and we try the next candidate staff member, or
 *     report SLOT_UNAVAILABLE. Correctness never depends on (1).
 */
export async function reserveSlot(tx: Tx, input: ReserveInput): Promise<Booking> {
  const { org, now } = input;
  const service = await activeService(tx, input.serviceId);
  const offering = await staffForService(tx, service.id);
  let candidates = offering.map((s) => s.id);
  if (input.staffId) {
    if (!candidates.includes(input.staffId)) throw notFound("Staff member");
    candidates = [input.staffId];
  }
  if (candidates.length === 0) throw slotUnavailable();

  // Contention control, not correctness: queue writers per staff member so the
  // availability check below reads committed state and most losers get a
  // clean SLOT_UNAVAILABLE without touching the constraint. Locks are taken
  // in a global (sorted) order, so two requests can never deadlock on them.
  await lockStaffSchedules(tx, candidates);

  // Abandoned checkouts must not keep blocking the slot.
  await tx
    .update(bookings)
    .set({ status: "expired" })
    .where(
      and(
        inArray(bookings.staffId, candidates),
        eq(bookings.status, "pending_payment"),
        lte(bookings.holdExpiresAt, now),
      ),
    );

  const localDate = Temporal.Instant.fromEpochMilliseconds(input.start.getTime())
    .toZonedDateTimeISO(org.timeZone)
    .toPlainDate()
    .toString();
  const query = await loadAvailabilityQuery(tx, {
    org,
    service,
    staffIds: candidates,
    from: localDate,
    to: localDate,
    now,
  });

  // "Any staff": prefer whoever has the fewest bookings that day.
  const ordered = input.staffId ? candidates : await orderByLoad(tx, candidates, org, localDate);
  const startMs = input.start.getTime();
  const free = new Set(
    computeSlots(query)
      .filter((s) => s.start === startMs)
      .map((s) => s.staffId),
  );
  const available = ordered.filter((id) => free.has(id));
  if (available.length === 0) throw slotUnavailable();

  const customerId = await upsertCustomer(tx, org.id, input.customer);
  const needsDeposit = service.depositCents > 0 && input.source === "public";
  const startsAt = input.start;
  const endsAt = new Date(startsAt.getTime() + service.durationMinutes * MINUTE);

  for (const staffId of available) {
    for (let attempt = 1; ; attempt++) {
      try {
        // Savepoint: a constraint violation must not abort the outer transaction.
        const booking = await tx.transaction(async (sp) => {
          const [row] = await sp
            .insert(bookings)
            .values({
              orgId: org.id,
              staffId,
              serviceId: service.id,
              customerId,
              status: needsDeposit ? "pending_payment" : "confirmed",
              source: input.source,
              startsAt,
              endsAt,
              blockedFrom: new Date(startsAt.getTime() - service.bufferBeforeMinutes * MINUTE),
              blockedUntil: new Date(endsAt.getTime() + service.bufferAfterMinutes * MINUTE),
              priceCents: service.priceCents,
              depositCents: needsDeposit ? service.depositCents : 0,
              holdExpiresAt: needsDeposit
                ? new Date(now.getTime() + org.holdMinutes * MINUTE)
                : null,
              customerTimeZone: input.customerTimeZone ?? null,
              notes: input.notes ?? null,
              accessToken: randomBytes(24).toString("base64url"),
            })
            .returning();
          return row!;
        });

        if (booking.status === "confirmed") await scheduleConfirmationMessages(tx, booking, now);
        await audit(tx, {
          orgId: org.id,
          actorUserId: input.actorUserId ?? null,
          action: "booking.created",
          targetType: "booking",
          targetId: booking.id,
          metadata: {
            source: input.source,
            status: booking.status,
            staffId,
            serviceId: service.id,
          },
        });
        return booking;
      } catch (err) {
        // Lost the race for this staff member: someone else's booking committed first.
        if (isPgError(err, PG.EXCLUSION_VIOLATION)) break;
        // Exclusion constraints (unlike unique indexes) have no speculative
        // insertion: two in-flight inserts of overlapping ranges can wait on
        // each other and Postgres aborts one as a deadlock victim. Only the
        // savepoint is rolled back, so re-checking the same staff member is
        // safe and resolves to either success or a clean 23P01.
        if (isPgError(err, PG.DEADLOCK_DETECTED) && attempt < 3) continue;
        throw err;
      }
    }
  }
  throw slotUnavailable();
}

/**
 * Transaction-scoped advisory locks keyed by staff id, acquired in sorted
 * order. Released automatically on COMMIT/ROLLBACK.
 */
export async function lockStaffSchedules(tx: Tx, staffIds: readonly string[]): Promise<void> {
  for (const id of [...staffIds].sort()) {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`staff-schedule:${id}`}, 0))`,
    );
  }
}

async function orderByLoad(
  tx: Tx,
  staffIds: string[],
  org: Organization,
  localDate: string,
): Promise<string[]> {
  const dayStart = new Date(
    Temporal.PlainDate.from(localDate).toZonedDateTime(org.timeZone).epochMilliseconds,
  );
  const dayEnd = new Date(
    Temporal.PlainDate.from(localDate).add({ days: 1 }).toZonedDateTime(org.timeZone)
      .epochMilliseconds,
  );
  const loads = await tx
    .select({ staffId: bookings.staffId, count: sql<number>`count(*)::int` })
    .from(bookings)
    .where(
      and(
        inArray(bookings.staffId, staffIds),
        inArray(bookings.status, ["confirmed", "pending_payment"]),
        gte(bookings.startsAt, dayStart),
        lt(bookings.startsAt, dayEnd),
      ),
    )
    .groupBy(bookings.staffId);
  const load = new Map(loads.map((l) => [l.staffId, l.count]));
  return staffIds.toSorted((a, b) => (load.get(a) ?? 0) - (load.get(b) ?? 0));
}

export async function upsertCustomer(
  tx: Tx,
  orgId: string,
  c: { name: string; email: string; phone: string | null },
): Promise<string> {
  const [row] = await tx
    .insert(customers)
    .values({ orgId, name: c.name, email: c.email.toLowerCase(), phone: c.phone })
    .onConflictDoUpdate({
      target: [customers.orgId, customers.email],
      set: { name: sql`excluded.name`, phone: sql`coalesce(excluded.phone, ${customers.phone})` },
    })
    .returning({ id: customers.id });
  return row!.id;
}

async function scheduleConfirmationMessages(tx: Tx, booking: Booking, now: Date): Promise<void> {
  await enqueue(
    tx,
    booking.orgId,
    "booking.confirmed",
    { bookingId: booking.id },
    { dedupeKey: `confirmed:${booking.id}` },
  );
  const reminderAt = booking.startsAt.getTime() - REMINDER_LEAD_MS;
  if (reminderAt > now.getTime()) {
    await enqueue(
      tx,
      booking.orgId,
      "booking.reminder",
      { bookingId: booking.id },
      { availableAt: new Date(reminderAt), dedupeKey: `reminder:${booking.id}` },
    );
  }
}

// ---------------------------------------------------------------------------
// Public booking flow
// ---------------------------------------------------------------------------

export interface PublicBookingResult {
  bookingId: string;
  accessToken: string;
  status: Booking["status"];
  checkoutUrl: string | null;
}

/**
 * Two-phase when a deposit is required: the hold is committed *before*
 * calling the payment provider, so no DB transaction (and no row lock) is
 * held open across a network call. If creating the checkout fails, the hold
 * is released immediately instead of waiting for it to expire.
 */
export async function createPublicBooking(
  orgSlug: string,
  input: PublicBookingInput,
  deps: { now?: Date; payments?: PaymentProvider; appUrl?: string } = {},
): Promise<PublicBookingResult> {
  const now = deps.now ?? new Date();
  const orgId = await orgIdBySlug(orgSlug);
  if (!orgId) throw notFound("Business");

  const { booking, org, serviceName } = await withTenant({ orgId }, async (tx) => {
    const org = await loadOrg(tx, orgId);
    const booking = await reserveSlot(tx, {
      org,
      serviceId: input.serviceId,
      staffId: input.staffId,
      start: new Date(input.start),
      customer: input.customer,
      customerTimeZone: input.customerTimeZone,
      notes: input.notes,
      source: "public",
      now,
    });
    const [service] = await tx
      .select({ name: services.name })
      .from(services)
      .where(eq(services.id, booking.serviceId));
    return { booking, org, serviceName: service?.name ?? "Appointment" };
  });

  if (booking.status !== "pending_payment") {
    return {
      bookingId: booking.id,
      accessToken: booking.accessToken,
      status: booking.status,
      checkoutUrl: null,
    };
  }

  const provider = deps.payments ?? getPaymentProvider();
  const appUrl = deps.appUrl ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const bookingUrl = `${appUrl}/b/${orgSlug}/bookings/${booking.accessToken}`;
  try {
    const session = await provider.createDepositCheckout({
      orgId,
      orgSlug,
      bookingId: booking.id,
      amountCents: booking.depositCents,
      currency: org.currency,
      customerEmail: input.customer.email,
      description: `Deposit - ${serviceName} at ${org.name}`,
      successUrl: `${bookingUrl}?paid=1`,
      cancelUrl: `${appUrl}/b/${orgSlug}?cancelled=1`,
      expiresAt: booking.holdExpiresAt!,
    });
    await withTenant({ orgId }, (tx) =>
      tx.insert(payments).values({
        orgId,
        bookingId: booking.id,
        provider: provider.name,
        externalId: session.externalId,
        amountCents: booking.depositCents,
        currency: org.currency,
      }),
    );
    return {
      bookingId: booking.id,
      accessToken: booking.accessToken,
      status: booking.status,
      checkoutUrl: session.url,
    };
  } catch (err) {
    await withTenant({ orgId }, (tx) =>
      tx
        .update(bookings)
        .set({ status: "expired" })
        .where(and(eq(bookings.id, booking.id), eq(bookings.status, "pending_payment"))),
    );
    throw new AppError("PAYMENT_FAILED", "We couldn't start the payment. Please try again.", {
      cause: err,
    });
  }
}

export async function loadOrg(tx: Tx, orgId: string): Promise<Organization> {
  const [org] = await tx.select().from(organizations).where(eq(organizations.id, orgId));
  if (!org) throw notFound("Business");
  return org;
}

// ---------------------------------------------------------------------------
// Payment confirmation (called from the idempotent webhook handler)
// ---------------------------------------------------------------------------

export type DepositOutcome =
  "confirmed" | "already_confirmed" | "refund_required" | "unknown_booking";

export async function confirmDeposit(
  tx: Tx,
  event: { orgId: string; bookingId: string; externalId: string; provider: string },
  now = new Date(),
): Promise<DepositOutcome> {
  const [booking] = await tx
    .select()
    .from(bookings)
    .where(eq(bookings.id, event.bookingId))
    .for("update");
  if (!booking) return "unknown_booking";
  const org = await loadOrg(tx, event.orgId);

  const [payment] = await tx
    .insert(payments)
    .values({
      orgId: event.orgId,
      bookingId: booking.id,
      provider: event.provider,
      externalId: event.externalId,
      amountCents: booking.depositCents,
      currency: org.currency,
      status: "succeeded",
    })
    .onConflictDoUpdate({
      target: [payments.provider, payments.externalId],
      set: { status: "succeeded" },
    })
    .returning({ id: payments.id });

  if (booking.status === "confirmed") return "already_confirmed";

  // Paid after the hold expired (or after a cancel): try to revive the slot.
  // If someone else has it now, the exclusion constraint says so and we refund.
  await lockStaffSchedules(tx, [booking.staffId]);
  try {
    const confirmed = await tx.transaction(async (sp) => {
      const [row] = await sp
        .update(bookings)
        .set({ status: "confirmed", holdExpiresAt: null })
        .where(eq(bookings.id, booking.id))
        .returning();
      return row!;
    });
    await scheduleConfirmationMessages(tx, confirmed, now);
    await audit(tx, {
      orgId: event.orgId,
      actorUserId: null,
      action: "booking.payment_confirmed",
      targetType: "booking",
      targetId: booking.id,
      metadata: { previousStatus: booking.status },
    });
    return "confirmed";
  } catch (err) {
    if (!isPgError(err, PG.EXCLUSION_VIOLATION)) throw err;
    await enqueue(
      tx,
      event.orgId,
      "payment.refund_required",
      { paymentId: payment!.id, reason: "Slot was taken after the hold expired" },
      { dedupeKey: `refund:${payment!.id}` },
    );
    return "refund_required";
  }
}

export async function expireHold(tx: Tx, bookingId: string): Promise<void> {
  await tx
    .update(bookings)
    .set({ status: "expired" })
    .where(and(eq(bookings.id, bookingId), eq(bookings.status, "pending_payment")));
}

// ---------------------------------------------------------------------------
// Cancellation & queries
// ---------------------------------------------------------------------------

export async function cancelBooking(
  tx: Tx,
  params: {
    bookingId: string;
    by: "customer" | "business";
    actorUserId: string | null;
    reason?: string;
    now?: Date;
  },
): Promise<Booking> {
  const [booking] = await tx
    .select()
    .from(bookings)
    .where(eq(bookings.id, params.bookingId))
    .for("update");
  if (!booking) throw notFound("Booking");
  if (booking.status === "cancelled" || booking.status === "expired") {
    throw new AppError("CONFLICT", "This booking is no longer active.");
  }
  const now = params.now ?? new Date();
  if (params.by === "customer" && booking.startsAt <= now) {
    throw new AppError("CONFLICT", "Past appointments can't be cancelled online.");
  }
  const [updated] = await tx
    .update(bookings)
    .set({ status: "cancelled", cancelledAt: now, cancellationReason: params.reason ?? null })
    .where(eq(bookings.id, booking.id))
    .returning();
  if (booking.status === "confirmed") {
    await enqueue(tx, booking.orgId, "booking.cancelled", {
      bookingId: booking.id,
      cancelledBy: params.by,
    });
  }
  await audit(tx, {
    orgId: booking.orgId,
    actorUserId: params.actorUserId,
    action: "booking.cancelled",
    targetType: "booking",
    targetId: booking.id,
    metadata: { by: params.by, reason: params.reason ?? null },
  });
  return updated!;
}

export interface BookingRow {
  id: string;
  status: Booking["status"];
  source: Booking["source"];
  startsAt: Date;
  endsAt: Date;
  priceCents: number;
  depositCents: number;
  notes: string | null;
  staffId: string;
  staffName: string;
  staffColor: string;
  serviceName: string;
  customerId: string;
  customerName: string;
  customerEmail: string;
}

export async function listBookings(
  tx: Tx,
  params: {
    from: Date;
    to: Date;
    staffId?: string;
    statuses?: Booking["status"][];
    limit?: number;
  },
): Promise<BookingRow[]> {
  const conditions = [gte(bookings.startsAt, params.from), lt(bookings.startsAt, params.to)];
  if (params.staffId) conditions.push(eq(bookings.staffId, params.staffId));
  if (params.statuses?.length) conditions.push(inArray(bookings.status, params.statuses));
  return tx
    .select({
      id: bookings.id,
      status: bookings.status,
      source: bookings.source,
      startsAt: bookings.startsAt,
      endsAt: bookings.endsAt,
      priceCents: bookings.priceCents,
      depositCents: bookings.depositCents,
      notes: bookings.notes,
      staffId: bookings.staffId,
      staffName: staffMembers.displayName,
      staffColor: staffMembers.color,
      serviceName: services.name,
      customerId: bookings.customerId,
      customerName: customers.name,
      customerEmail: customers.email,
    })
    .from(bookings)
    .innerJoin(staffMembers, eq(staffMembers.id, bookings.staffId))
    .innerJoin(services, eq(services.id, bookings.serviceId))
    .innerJoin(customers, eq(customers.id, bookings.customerId))
    .where(and(...conditions))
    .orderBy(asc(bookings.startsAt))
    .limit(params.limit ?? 500);
}

export async function findBookingByToken(tx: Tx, accessToken: string) {
  const [row] = await tx
    .select({
      booking: bookings,
      serviceName: services.name,
      staffName: staffMembers.displayName,
      customerName: customers.name,
      customerEmail: customers.email,
    })
    .from(bookings)
    .innerJoin(services, eq(services.id, bookings.serviceId))
    .innerJoin(staffMembers, eq(staffMembers.id, bookings.staffId))
    .innerJoin(customers, eq(customers.id, bookings.customerId))
    .where(eq(bookings.accessToken, accessToken));
  return row ?? null;
}
