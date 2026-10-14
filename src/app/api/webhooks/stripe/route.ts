import { NextResponse } from "next/server";

import { getPaymentProvider, WebhookSignatureError } from "@/server/payments";
import { handleWebhook } from "@/server/payments/webhooks";

/**
 * Stripe webhook endpoint. The raw body is required for signature checks, so
 * we read text() and never JSON-parse before verification.
 * 2xx = processed / duplicate / ignored (Stripe stops retrying)
 * 400 = bad signature (don't retry)   5xx = our failure (Stripe retries)
 */
export async function POST(request: Request) {
  const provider = getPaymentProvider();
  if (provider.name !== "stripe")
    return NextResponse.json({ error: "Stripe is not configured" }, { status: 404 });
  const rawBody = await request.text();
  try {
    const outcome = await handleWebhook(provider, rawBody, request.headers.get("stripe-signature"));
    return NextResponse.json({ received: true, outcome });
  } catch (err) {
    if (err instanceof WebhookSignatureError)
      return NextResponse.json({ error: err.message }, { status: 400 });
    console.error("[webhooks/stripe] processing failed", err);
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }
}
