/**
 * Provider-agnostic payments port. The rest of the app only knows these
 * types; Stripe specifics live in ./stripe.ts, and ./fake.ts lets the whole
 * product (including webhooks) run locally with no keys.
 */
export interface DepositCheckoutInput {
  orgId: string;
  orgSlug: string;
  bookingId: string;
  amountCents: number;
  currency: string;
  customerEmail: string;
  description: string;
  successUrl: string;
  cancelUrl: string;
  expiresAt: Date;
}

export interface SubscriptionCheckoutInput {
  orgId: string;
  customerEmail: string;
  successUrl: string;
  cancelUrl: string;
}

export interface CheckoutSession {
  externalId: string;
  url: string;
}

/** Normalized webhook event. Anything we don't act on becomes `ignored`. */
export type PaymentEvent =
  | { id: string; type: "deposit.succeeded"; orgId: string; bookingId: string; externalId: string }
  | { id: string; type: "deposit.expired"; orgId: string; bookingId: string; externalId: string }
  | { id: string; type: "subscription.activated"; orgId: string; customerId: string; subscriptionId: string }
  | { id: string; type: "subscription.cancelled"; orgId: string; subscriptionId: string }
  | { id: string; type: "ignored"; providerType: string };

export interface PaymentProvider {
  readonly name: "stripe" | "fake";
  createDepositCheckout(input: DepositCheckoutInput): Promise<CheckoutSession>;
  createSubscriptionCheckout(input: SubscriptionCheckoutInput): Promise<CheckoutSession>;
  /** Refunds the payment made through the given checkout session. */
  refundCheckout(externalId: string): Promise<void>;
  /**
   * Verifies the signature and parses the event. Throws
   * WebhookSignatureError on any tampering, replay outside the tolerance
   * window, or malformed payload.
   */
  parseWebhook(rawBody: string, signatureHeader: string | null): PaymentEvent;
}

export class WebhookSignatureError extends Error {
  constructor(message = "Invalid webhook signature") {
    super(message);
    this.name = "WebhookSignatureError";
  }
}
