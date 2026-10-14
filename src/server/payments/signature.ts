import { createHmac, timingSafeEqual } from "node:crypto";

import { WebhookSignatureError } from "./types";

/**
 * Stripe-compatible signature scheme: header `t=<unix>,v1=<hex hmac>` where
 * the HMAC-SHA256 covers `${t}.${rawBody}`. Used by the fake provider so the
 * local flow exercises the same verification logic shape as production.
 */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

export function signPayload(rawBody: string, secret: string, timestampSeconds = Math.floor(Date.now() / 1000)): string {
  const mac = createHmac("sha256", secret).update(`${timestampSeconds}.${rawBody}`).digest("hex");
  return `t=${timestampSeconds},v1=${mac}`;
}

export function verifySignature(
  rawBody: string,
  header: string | null,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): void {
  if (!header) throw new WebhookSignatureError("Missing signature header");
  const parts = new Map(
    header.split(",").map((kv) => {
      const [k, ...v] = kv.split("=");
      return [k?.trim() ?? "", v.join("=")] as const;
    }),
  );
  const t = Number(parts.get("t"));
  const v1 = parts.get("v1");
  if (!Number.isInteger(t) || !v1) throw new WebhookSignatureError("Malformed signature header");
  if (Math.abs(nowSeconds - t) > SIGNATURE_TOLERANCE_SECONDS) {
    throw new WebhookSignatureError("Signature timestamp outside tolerance (possible replay)");
  }
  const expected = Buffer.from(createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex"), "hex");
  const received = Buffer.from(v1, "hex");
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    throw new WebhookSignatureError();
  }
}
