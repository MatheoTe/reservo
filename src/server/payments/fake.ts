import { randomBytes } from "node:crypto";

import { z } from "zod";

import { signPayload, verifySignature } from "./signature";
import {
  type CheckoutSession,
  type DepositCheckoutInput,
  type PaymentEvent,
  type PaymentProvider,
  type SubscriptionCheckoutInput,
  WebhookSignatureError,
} from "./types";

const fakeEventSchema = z.discriminatedUnion("type", [
  z.object({
    id: z.string(),
    type: z.literal("deposit.succeeded"),
    orgId: z.uuid(),
    bookingId: z.uuid(),
    externalId: z.string(),
  }),
  z.object({
    id: z.string(),
    type: z.literal("deposit.expired"),
    orgId: z.uuid(),
    bookingId: z.uuid(),
    externalId: z.string(),
  }),
  z.object({
    id: z.string(),
    type: z.literal("subscription.activated"),
    orgId: z.uuid(),
    customerId: z.string(),
    subscriptionId: z.string(),
  }),
  z.object({
    id: z.string(),
    type: z.literal("subscription.cancelled"),
    orgId: z.uuid(),
    subscriptionId: z.string(),
  }),
]);

export type FakeEvent = z.infer<typeof fakeEventSchema>;

/**
 * Local stand-in for Stripe. Checkout "sessions" are pages inside the app;
 * paying there sends a *signed* webhook to /api/webhooks/fake, which goes
 * through the same idempotent handler as Stripe events.
 */
export class FakePaymentProvider implements PaymentProvider {
  readonly name = "fake" as const;
  readonly refunds: string[] = [];

  constructor(
    private readonly appUrl: string,
    private readonly webhookSecret: string,
  ) {}

  async createDepositCheckout(input: DepositCheckoutInput): Promise<CheckoutSession> {
    const externalId = `fake_cs_${randomBytes(12).toString("hex")}`;
    const url = new URL(`/b/${input.orgSlug}/checkout/${input.bookingId}`, this.appUrl);
    url.searchParams.set("session", externalId);
    return { externalId, url: url.toString() };
  }

  async createSubscriptionCheckout(input: SubscriptionCheckoutInput): Promise<CheckoutSession> {
    const externalId = `fake_sub_cs_${randomBytes(12).toString("hex")}`;
    const url = new URL(input.successUrl);
    url.searchParams.set("fake_subscription", externalId);
    return { externalId, url: url.toString() };
  }

  async refundCheckout(externalId: string): Promise<void> {
    this.refunds.push(externalId);
  }

  parseWebhook(rawBody: string, signatureHeader: string | null): PaymentEvent {
    verifySignature(rawBody, signatureHeader, this.webhookSecret);
    let json: unknown;
    try {
      json = JSON.parse(rawBody);
    } catch {
      throw new WebhookSignatureError("Malformed JSON body");
    }
    const parsed = fakeEventSchema.safeParse(json);
    if (!parsed.success) return { id: "unknown", type: "ignored", providerType: "fake.unknown" };
    return parsed.data;
  }

  /** Builds a signed delivery, as the fake checkout page and tests do. */
  sign(event: FakeEvent): { body: string; signature: string } {
    const body = JSON.stringify(event);
    return { body, signature: signPayload(body, this.webhookSecret) };
  }
}

/**
 * Type guard by name, not `instanceof`: Next.js may bundle this module into
 * several server chunks, so the singleton's class identity can differ from the
 * one imported by the caller.
 */
export function isFakeProvider(provider: PaymentProvider): provider is FakePaymentProvider {
  return provider.name === "fake";
}
