import { eq } from "drizzle-orm";

import { organizations, webhookEvents } from "@/db/schema";

import { audit } from "../audit";
import { withTenant } from "../db/tenant";
import { confirmDeposit, expireHold } from "../services/bookings";
import type { PaymentEvent, PaymentProvider } from "./types";

export type WebhookOutcome = "processed" | "duplicate" | "ignored";

/**
 * Applies a verified provider event exactly once.
 *
 * The event id is inserted into `webhook_events` in the *same transaction* as
 * the side effects. Consequences:
 *  - a redelivery after success hits the primary key -> "duplicate", no-op
 *  - two concurrent deliveries: the second INSERT waits on the first's row
 *    lock, then sees the conflict -> "duplicate"
 *  - a failure rolls back the ledger row too, so the provider's retry gets a
 *    clean second chance instead of being silently swallowed
 */
export async function applyPaymentEvent(
  provider: PaymentProvider["name"],
  event: PaymentEvent,
): Promise<WebhookOutcome> {
  if (event.type === "ignored") return "ignored";

  return withTenant({ orgId: event.orgId }, async (tx) => {
    const inserted = await tx
      .insert(webhookEvents)
      .values({ provider, eventId: event.id, type: event.type, orgId: event.orgId })
      .onConflictDoNothing()
      .returning({ eventId: webhookEvents.eventId });
    if (inserted.length === 0) return "duplicate";

    switch (event.type) {
      case "deposit.succeeded":
        await confirmDeposit(tx, {
          orgId: event.orgId,
          bookingId: event.bookingId,
          externalId: event.externalId,
          provider,
        });
        break;
      case "deposit.expired":
        await expireHold(tx, event.bookingId);
        break;
      case "subscription.activated":
        await tx
          .update(organizations)
          .set({
            plan: "pro",
            stripeCustomerId: event.customerId,
            stripeSubscriptionId: event.subscriptionId,
          })
          .where(eq(organizations.id, event.orgId));
        await audit(tx, {
          orgId: event.orgId,
          actorUserId: null,
          action: "billing.plan_changed",
          metadata: { plan: "pro" },
        });
        break;
      case "subscription.cancelled":
        await tx
          .update(organizations)
          .set({ plan: "free", stripeSubscriptionId: null })
          .where(eq(organizations.id, event.orgId));
        await audit(tx, {
          orgId: event.orgId,
          actorUserId: null,
          action: "billing.plan_changed",
          metadata: { plan: "free" },
        });
        break;
    }
    return "processed";
  });
}

/** Verify-then-apply, shared by the Stripe and fake webhook routes. */
export async function handleWebhook(
  provider: PaymentProvider,
  rawBody: string,
  signature: string | null,
): Promise<WebhookOutcome> {
  const event = provider.parseWebhook(rawBody, signature); // throws WebhookSignatureError
  return applyPaymentEvent(provider.name, event);
}
