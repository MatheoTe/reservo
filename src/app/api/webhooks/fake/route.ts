import { NextResponse } from "next/server";

import { getPaymentProvider, WebhookSignatureError } from "@/server/payments";
import { drainOutboxAfterResponse } from "@/server/outbox/drain";
import { handleWebhook } from "@/server/payments/webhooks";

/** Local fake-payments webhook. Same contract as the Stripe route. */
export async function POST(request: Request) {
  const provider = getPaymentProvider();
  if (provider.name !== "fake") return NextResponse.json({ error: "Not found" }, { status: 404 });
  const rawBody = await request.text();
  try {
    const outcome = await handleWebhook(provider, rawBody, request.headers.get("x-fake-signature"));
    drainOutboxAfterResponse();
    return NextResponse.json({ received: true, outcome });
  } catch (err) {
    if (err instanceof WebhookSignatureError)
      return NextResponse.json({ error: err.message }, { status: 400 });
    console.error("[webhooks/fake] processing failed", err);
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }
}
