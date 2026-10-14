"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { Temporal } from "temporal-polyfill";

import { bookings } from "@/db/schema";
import { cancelBookingSchema, dashboardBookingSchema } from "@/lib/validation";

import { can } from "../auth/rbac";
import { forbidden, notFound } from "../errors";
import { cancelBooking, loadOrg, reserveSlot } from "../services/bookings";
import { type ActionResult, runOrgAction } from "./run";

function revalidateBookings(orgSlug: string) {
  for (const p of ["", "/bookings", "/calendar", "/customers"])
    revalidatePath(`/app/${orgSlug}${p}`);
}

export async function createDashboardBookingAction(
  orgSlug: string,
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const result = await runOrgAction(
    orgSlug,
    "bookings:write:own",
    dashboardBookingSchema,
    input,
    async ({ tx, actor, input }) => {
      const org = await loadOrg(tx, actor.orgId);
      if (!can(actor.role, "bookings:write:any")) {
        // Staff may only add bookings to their own calendar.
        const ownStaff = await tx.query.staffMembers.findFirst({
          where: (s, { eq: e }) => e(s.userId, actor.userId),
        });
        if (ownStaff?.id !== input.staffId)
          throw forbidden("You can only add bookings to your own calendar.");
      }
      const start = Temporal.PlainDateTime.from(`${input.date}T${input.time}`).toZonedDateTime(
        org.timeZone,
        {
          disambiguation: "compatible",
        },
      );
      const booking = await reserveSlot(tx, {
        org,
        serviceId: input.serviceId,
        staffId: input.staffId,
        start: new Date(start.epochMilliseconds),
        customer: input.customer,
        notes: input.notes,
        source: "dashboard",
        actorUserId: actor.userId,
        now: new Date(),
      });
      return { id: booking.id };
    },
  );
  if (result.ok) revalidateBookings(orgSlug);
  return result;
}

export async function cancelBookingAction(orgSlug: string, input: unknown): Promise<ActionResult> {
  const result = await runOrgAction(
    orgSlug,
    "bookings:write:own",
    cancelBookingSchema,
    input,
    async ({ tx, actor, input }) => {
      const [booking] = await tx.select().from(bookings).where(eq(bookings.id, input.bookingId));
      if (!booking) throw notFound("Booking");
      if (!can(actor.role, "bookings:write:any")) {
        const ownStaff = await tx.query.staffMembers.findFirst({
          where: (s, { eq: e }) => e(s.userId, actor.userId),
        });
        if (booking.staffId !== ownStaff?.id)
          throw forbidden("You can only cancel your own bookings.");
      }
      await cancelBooking(tx, {
        bookingId: booking.id,
        by: "business",
        actorUserId: actor.userId,
        reason: input.reason,
      });
    },
  );
  if (result.ok) revalidateBookings(orgSlug);
  return result;
}
