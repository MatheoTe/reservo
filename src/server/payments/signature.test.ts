import { describe, expect, it } from "vitest";

import { signPayload, verifySignature } from "./signature";
import { WebhookSignatureError } from "./types";

const secret = "whsec_test";
const body = JSON.stringify({ id: "evt_1", type: "deposit.succeeded" });
const now = 1_800_000_000;

describe("webhook signatures", () => {
  it("accepts a valid signature", () => {
    expect(() => verifySignature(body, signPayload(body, secret, now), secret, now)).not.toThrow();
  });

  it("rejects a tampered body", () => {
    const header = signPayload(body, secret, now);
    expect(() => verifySignature(body.replace("evt_1", "evt_2"), header, secret, now)).toThrow(
      WebhookSignatureError,
    );
  });

  it("rejects the wrong secret", () => {
    expect(() => verifySignature(body, signPayload(body, "other", now), secret, now)).toThrow(
      WebhookSignatureError,
    );
  });

  it("rejects replays outside the tolerance window", () => {
    expect(() => verifySignature(body, signPayload(body, secret, now - 301), secret, now)).toThrow(
      /tolerance/,
    );
  });

  it.each([null, "", "garbage", "t=abc,v1=00", "t=1800000000"])(
    "rejects malformed header %j",
    (header) => {
      expect(() => verifySignature(body, header, secret, now)).toThrow(WebhookSignatureError);
    },
  );

  it("rejects a signature of the wrong length without throwing a crypto error", () => {
    expect(() => verifySignature(body, `t=${now},v1=abcd`, secret, now)).toThrow(
      WebhookSignatureError,
    );
  });
});
