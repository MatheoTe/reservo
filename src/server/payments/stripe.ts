import Stripe from "stripe";

import {
  type CheckoutSession,
  type DepositCheckoutInput,
  type PaymentEvent,
  type PaymentProvider,
  type SubscriptionCheckoutInput,
  WebhookSignatureError,
} from "./types";

/** Stripe requires checkout sessions to live at least 30 minutes. */
const STRIPE_MIN_SESSION_MS = 30 * 60_000;

export class StripePaymentProvider implements PaymentProvider {
  readonly name = "stripe" as const;
  private readonly stripe: Stripe;

  constructor(
    secretKey: string,
    private readonly webhookSecret: string,
    private readonly proPriceId?: string,
  ) {
    this.stripe = new Stripe(secretKey, { appInfo: { name: "Slotsmith" } });
  }

  async createDepositCheckout(input: DepositCheckoutInput): Promise<CheckoutSession> {
    const expiresAt = Math.max(
      input.expiresAt.getTime(),
      Date.now() + STRIPE_MIN_SESSION_MS + 60_000,
    );
    const session = await this.stripe.checkout.sessions.create(
      {
        mode: "payment",
        customer_email: input.customerEmail,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: input.currency,
              unit_amount: input.amountCents,
              product_data: { name: input.description },
            },
          },
        ],
        // The webhook trusts these only after verifying Stripe's signature.
        metadata: { orgId: input.orgId, bookingId: input.bookingId, kind: "deposit" },
        payment_intent_data: { metadata: { orgId: input.orgId, bookingId: input.bookingId } },
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        expires_at: Math.floor(expiresAt / 1000),
      },
      // Retrying our own request (e.g. after a timeout) never creates two sessions.
      { idempotencyKey: `deposit-${input.bookingId}` },
    );
    if (!session.url) throw new Error("Stripe did not return a checkout URL");
    return { externalId: session.id, url: session.url };
  }

  async createSubscriptionCheckout(input: SubscriptionCheckoutInput): Promise<CheckoutSession> {
    if (!this.proPriceId) throw new Error("STRIPE_PRO_PRICE_ID is not configured");
    const session = await this.stripe.checkout.sessions.create({
      mode: "subscription",
      customer_email: input.customerEmail,
      line_items: [{ price: this.proPriceId, quantity: 1 }],
      metadata: { orgId: input.orgId, kind: "subscription" },
      subscription_data: { metadata: { orgId: input.orgId } },
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
    });
    if (!session.url) throw new Error("Stripe did not return a checkout URL");
    return { externalId: session.id, url: session.url };
  }

  async refundCheckout(externalId: string): Promise<void> {
    const session = await this.stripe.checkout.sessions.retrieve(externalId);
    const paymentIntent =
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent?.id;
    if (!paymentIntent) throw new Error(`Checkout session ${externalId} has no payment intent`);
    await this.stripe.refunds.create(
      { payment_intent: paymentIntent },
      { idempotencyKey: `refund-${externalId}` },
    );
  }

  parseWebhook(rawBody: string, signatureHeader: string | null): PaymentEvent {
    if (!signatureHeader) throw new WebhookSignatureError("Missing Stripe-Signature header");
    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(rawBody, signatureHeader, this.webhookSecret);
    } catch (err) {
      throw new WebhookSignatureError(err instanceof Error ? err.message : "Invalid signature");
    }
    return normalizeStripeEvent(event);
  }
}

export function normalizeStripeEvent(event: Stripe.Event): PaymentEvent {
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const s = event.data.object;
      const orgId = s.metadata?.orgId;
      if (!orgId) break;
      if (s.mode === "payment" && s.metadata?.bookingId && s.payment_status === "paid") {
        return {
          id: event.id,
          type: "deposit.succeeded",
          orgId,
          bookingId: s.metadata.bookingId,
          externalId: s.id,
        };
      }
      if (
        s.mode === "subscription" &&
        typeof s.customer === "string" &&
        typeof s.subscription === "string"
      ) {
        return {
          id: event.id,
          type: "subscription.activated",
          orgId,
          customerId: s.customer,
          subscriptionId: s.subscription,
        };
      }
      break;
    }
    case "checkout.session.expired": {
      const s = event.data.object;
      if (s.metadata?.orgId && s.metadata.bookingId) {
        return {
          id: event.id,
          type: "deposit.expired",
          orgId: s.metadata.orgId,
          bookingId: s.metadata.bookingId,
          externalId: s.id,
        };
      }
      break;
    }
    case "customer.subscription.deleted": {
      const sub = event.data.object;
      if (sub.metadata?.orgId)
        return {
          id: event.id,
          type: "subscription.cancelled",
          orgId: sub.metadata.orgId,
          subscriptionId: sub.id,
        };
      break;
    }
  }
  return { id: event.id, type: "ignored", providerType: event.type };
}
