"use server";

import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { bookings, payments } from "@/db/schema";

import { orgIdBySlug, withTenant } from "../db/tenant";
import { AppError, notFound } from "../errors";
import { clientIp } from "../http";
import { getPaymentProvider } from "../payments";
import { isFakeProvider } from "../payments/fake";
import { handleWebhook } from "../payments/webhooks";
import { enforceRateLimit } from "../rate-limit";
import { cancelBooking, findBookingByToken } from "../services/bookings";
import { type ActionResult, toActionError } from "./run";

const tokenSchema = z.string().min(20).max(64);

/** Customer self-service cancellation via the secret link in their email. */
export async function cancelPublicBookingAction(
  orgSlug: string,
  accessToken: string,
): Promise<ActionResult> {
  try {
    await enforceRateLimit(`cancel:${clientIp(await headers())}`, {
      limit: 10,
      windowSeconds: 600,
    });
    const token = tokenSchema.parse(accessToken);
    const orgId = await orgIdBySlug(orgSlug);
    if (!orgId) throw notFound("Booking");
    await withTenant({ orgId }, async (tx) => {
      const found = await findBookingByToken(tx, token);
      if (!found) throw notFound("Booking");
      await cancelBooking(tx, { bookingId: found.booking.id, by: "customer", actorUserId: null });
    });
    return { ok: true, data: undefined };
  } catch (err) {
    return toActionError(err);
  }
}

/**
 * Local fake checkout: builds a *signed* event and runs it through the same
 * verify -> idempotent apply pipeline as a real Stripe webhook.
 */
export async function payFakeCheckoutAction(
  orgSlug: string,
  bookingId: string,
): Promise<ActionResult> {
  let accessToken: string;
  try {
    const provider = getPaymentProvider();
    if (!isFakeProvider(provider)) throw new AppError("NOT_FOUND", "Not available.");
    const id = z.uuid().parse(bookingId);
    const orgId = await orgIdBySlug(orgSlug);
    if (!orgId) throw notFound("Booking");
    const found = await withTenant({ orgId }, async (tx) => {
      const [row] = await tx
        .select({ booking: bookings, externalId: payments.externalId })
        .from(bookings)
        .innerJoin(
          payments,
          and(eq(payments.bookingId, bookings.id), eq(payments.provider, "fake")),
        )
        .where(eq(bookings.id, id));
      return row;
    });
    if (!found) throw notFound("Checkout");
    accessToken = found.booking.accessToken;
    const { body, signature } = provider.sign({
      id: `evt_fake_${found.externalId}`,
      type: "deposit.succeeded",
      orgId,
      bookingId: id,
      externalId: found.externalId,
    });
    await handleWebhook(provider, body, signature);
  } catch (err) {
    return toActionError(err);
  }
  redirect(`/b/${orgSlug}/bookings/${accessToken}?paid=1`);
}
