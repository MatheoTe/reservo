import { eq } from "drizzle-orm";

import {
  authUsers,
  bookings,
  customers,
  invitations,
  organizations,
  payments,
  services,
  staffMembers,
} from "@/db/schema";
import type { Tx } from "@/server/db/client";
import { withTenant } from "@/server/db/tenant";
import { formatDateTime } from "@/server/format";
import type { Mailer } from "@/server/mail/mailer";
import {
  type BookingEmailData,
  bookingCancelledEmail,
  bookingConfirmedEmail,
  bookingReminderEmail,
  invitationEmail,
} from "@/server/mail/templates";
import type { PaymentProvider } from "@/server/payments";

import { type OutboxHandlers, PermanentError } from "./processor";

async function loadBooking(tx: Tx, bookingId: string, appUrl: string) {
  const [row] = await tx
    .select({
      booking: bookings,
      orgName: organizations.name,
      orgSlug: organizations.slug,
      orgTimeZone: organizations.timeZone,
      serviceName: services.name,
      staffName: staffMembers.displayName,
      customerName: customers.name,
      customerEmail: customers.email,
    })
    .from(bookings)
    .innerJoin(organizations, eq(organizations.id, bookings.orgId))
    .innerJoin(services, eq(services.id, bookings.serviceId))
    .innerJoin(staffMembers, eq(staffMembers.id, bookings.staffId))
    .innerJoin(customers, eq(customers.id, bookings.customerId))
    .where(eq(bookings.id, bookingId));
  if (!row) throw new PermanentError(`Booking ${bookingId} not found`);
  const zone = row.booking.customerTimeZone ?? row.orgTimeZone;
  const email: BookingEmailData = {
    to: row.customerEmail,
    customerName: row.customerName,
    orgName: row.orgName,
    serviceName: row.serviceName,
    staffName: row.staffName,
    when: formatDateTime(row.booking.startsAt, zone),
    manageUrl: `${appUrl}/b/${row.orgSlug}/bookings/${row.booking.accessToken}`,
  };
  return { booking: row.booking, email };
}

export function createHandlers(deps: {
  mailer: Mailer;
  payments: PaymentProvider;
  appUrl: string;
  now?: () => Date;
}): OutboxHandlers {
  const now = deps.now ?? (() => new Date());
  return {
    "booking.confirmed": async ({ bookingId }, msg) => {
      const data = await withTenant({ orgId: msg.orgId }, (tx) =>
        loadBooking(tx, bookingId, deps.appUrl),
      );
      if (data.booking.status !== "confirmed") return; // cancelled before we got to it
      await deps.mailer.send(bookingConfirmedEmail(data.email));
    },

    "booking.reminder": async ({ bookingId }, msg) => {
      const data = await withTenant({ orgId: msg.orgId }, (tx) =>
        loadBooking(tx, bookingId, deps.appUrl),
      );
      if (data.booking.status !== "confirmed" || data.booking.startsAt <= now()) return;
      await deps.mailer.send(bookingReminderEmail(data.email));
    },

    "booking.cancelled": async ({ bookingId, cancelledBy }, msg) => {
      const data = await withTenant({ orgId: msg.orgId }, (tx) =>
        loadBooking(tx, bookingId, deps.appUrl),
      );
      await deps.mailer.send(bookingCancelledEmail(data.email, cancelledBy));
    },

    "invitation.created": async ({ invitationId, token }, msg) => {
      if (!token) return; // already delivered and scrubbed
      const row = await withTenant({ orgId: msg.orgId }, async (tx) => {
        const [r] = await tx
          .select({
            invitation: invitations,
            orgName: organizations.name,
            inviterName: authUsers.name,
          })
          .from(invitations)
          .innerJoin(organizations, eq(organizations.id, invitations.orgId))
          .leftJoin(authUsers, eq(authUsers.id, invitations.invitedBy))
          .where(eq(invitations.id, invitationId));
        return r;
      });
      if (!row) throw new PermanentError(`Invitation ${invitationId} not found`);
      if (row.invitation.acceptedAt || row.invitation.revokedAt) return;
      await deps.mailer.send(
        invitationEmail({
          to: row.invitation.email,
          orgName: row.orgName,
          inviterName: row.inviterName ?? "A teammate",
          role: row.invitation.role,
          url: `${deps.appUrl}/invite/${token}`,
        }),
      );
    },

    "payment.refund_required": async ({ paymentId }, msg) => {
      const payment = await withTenant({ orgId: msg.orgId }, async (tx) => {
        const [p] = await tx.select().from(payments).where(eq(payments.id, paymentId));
        return p;
      });
      if (!payment) throw new PermanentError(`Payment ${paymentId} not found`);
      if (payment.status === "refunded") return;
      await deps.payments.refundCheckout(payment.externalId);
      await withTenant({ orgId: msg.orgId }, (tx) =>
        tx.update(payments).set({ status: "refunded" }).where(eq(payments.id, paymentId)),
      );
    },
  };
}
