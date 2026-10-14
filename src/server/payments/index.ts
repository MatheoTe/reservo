import { FakePaymentProvider } from "./fake";
import { StripePaymentProvider } from "./stripe";
import type { PaymentProvider } from "./types";

export * from "./types";

const globalForPayments = globalThis as unknown as { __reservoPayments?: PaymentProvider };

/**
 * Stripe when keys are configured, otherwise the local fake. The choice is
 * made once per process; nothing else in the app branches on it.
 */
export function getPaymentProvider(): PaymentProvider {
  if (!globalForPayments.__reservoPayments) {
    const key = process.env.STRIPE_SECRET_KEY;
    globalForPayments.__reservoPayments = key
      ? new StripePaymentProvider(key, process.env.STRIPE_WEBHOOK_SECRET ?? "", process.env.STRIPE_PRO_PRICE_ID || undefined)
      : new FakePaymentProvider(
          process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
          process.env.FAKE_PAYMENTS_WEBHOOK_SECRET ?? "dev-fake-webhook-secret",
        );
  }
  return globalForPayments.__reservoPayments;
}

export function setPaymentProvider(provider: PaymentProvider): void {
  globalForPayments.__reservoPayments = provider;
}
