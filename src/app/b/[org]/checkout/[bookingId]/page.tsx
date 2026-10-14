import { eq } from "drizzle-orm";
import { CreditCard, FlaskConical } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { bookings, services } from "@/db/schema";
import { orgIdBySlug, withTenant } from "@/server/db/tenant";
import { formatDateTime, formatMoney } from "@/server/format";
import { getPaymentProvider } from "@/server/payments";
import { loadOrg } from "@/server/services/bookings";

import { PayButton } from "./pay-button";

export const metadata: Metadata = { title: "Test checkout", robots: { index: false } };

/** Stand-in for Stripe Checkout when no Stripe keys are configured. */
export default async function FakeCheckoutPage({
  params,
}: {
  params: Promise<{ org: string; bookingId: string }>;
}) {
  const { org: slug, bookingId } = await params;
  if (getPaymentProvider().name !== "fake" || !z.uuid().safeParse(bookingId).success) notFound();
  const orgId = await orgIdBySlug(slug);
  if (!orgId) notFound();
  const data = await withTenant({ orgId }, async (tx) => {
    const [row] = await tx
      .select({ booking: bookings, serviceName: services.name })
      .from(bookings)
      .innerJoin(services, eq(services.id, bookings.serviceId))
      .where(eq(bookings.id, bookingId));
    return row ? { ...row, org: await loadOrg(tx, orgId) } : null;
  });
  if (!data) notFound();
  const { booking, org } = data;

  return (
    <div className="bg-muted/40 grid min-h-dvh place-items-center px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <p className="bg-warning/15 mb-2 inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium">
            <FlaskConical className="size-3.5" /> Test mode - no real money moves
          </p>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="size-5" /> Pay deposit to {org.name}
          </CardTitle>
          <CardDescription>
            {data.serviceName} ·{" "}
            {formatDateTime(booking.startsAt, booking.customerTimeZone ?? org.timeZone)}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <p className="text-3xl font-semibold tabular-nums">
            {formatMoney(booking.depositCents, org.currency)}
          </p>
          {booking.status === "pending_payment" ? (
            <>
              <p className="text-muted-foreground text-sm">
                Your slot is held until{" "}
                {formatDateTime(booking.holdExpiresAt!, booking.customerTimeZone ?? org.timeZone)}.
              </p>
              <PayButton orgSlug={slug} bookingId={booking.id} />
            </>
          ) : (
            <p className="text-muted-foreground text-sm">
              This checkout is no longer active ({booking.status.replace("_", " ")}).
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
