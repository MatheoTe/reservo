import { beforeEach, describe, expect, it } from "vitest";

import { FakePaymentProvider } from "@/server/payments/fake";
import { WebhookSignatureError } from "@/server/payments/types";
import { applyPaymentEvent, handleWebhook } from "@/server/payments/webhooks";
import { createPublicBooking } from "@/server/services/bookings";

import { admin, createTestOrg, insertBookingDirect, type TestOrg, tomorrowAt, useCleanDatabase } from "./helpers";

const provider = new FakePaymentProvider("http://localhost:3000", "test-fake-secret");

async function bookWithDeposit(org: TestOrg, hour = 10) {
  return createPublicBooking(
    org.slug,
    {
      serviceId: org.serviceId,
      staffId: null,
      start: tomorrowAt(hour).toISOString(),
      customer: { name: "Dana", email: "dana@example.com", phone: null },
    },
    { payments: provider },
  );
}

async function paymentFor(bookingId: string) {
  const [p] = await admin`select * from payments where booking_id = ${bookingId}`;
  return p!;
}

describe("payment webhooks", () => {
  useCleanDatabase();
  let org: TestOrg;

  beforeEach(async () => {
    org = await createTestOrg("spa", { depositCents: 2000 });
  });

  it("a deposit booking starts as a hold with a checkout URL", async () => {
    const result = await bookWithDeposit(org);
    expect(result.status).toBe("pending_payment");
    expect(result.checkoutUrl).toMatch(/\/b\/spa\/checkout\//);
    const payment = await paymentFor(result.bookingId);
    expect(payment.status).toBe("pending");
    expect(payment.amount_cents).toBe(2000);
  });

  it("a verified deposit.succeeded confirms the booking and schedules emails", async () => {
    const result = await bookWithDeposit(org);
    const payment = await paymentFor(result.bookingId);
    const { body, signature } = provider.sign({
      id: "evt_paid_1",
      type: "deposit.succeeded",
      orgId: org.orgId,
      bookingId: result.bookingId,
      externalId: payment.external_id,
    });

    await expect(handleWebhook(provider, body, signature)).resolves.toBe("processed");

    const [booking] = await admin`select status, hold_expires_at from bookings where id = ${result.bookingId}`;
    expect(booking).toMatchObject({ status: "confirmed", hold_expires_at: null });
    expect((await paymentFor(result.bookingId)).status).toBe("succeeded");
    const topics = await admin`select topic from outbox where org_id = ${org.orgId} order by id`;
    expect(topics.map((t) => t.topic)).toEqual(["booking.confirmed", "booking.reminder"]);
  });

  it("redelivery of the same event is a no-op", async () => {
    const result = await bookWithDeposit(org);
    const payment = await paymentFor(result.bookingId);
    const { body, signature } = provider.sign({
      id: "evt_dup",
      type: "deposit.succeeded",
      orgId: org.orgId,
      bookingId: result.bookingId,
      externalId: payment.external_id,
    });

    expect(await handleWebhook(provider, body, signature)).toBe("processed");
    expect(await handleWebhook(provider, body, signature)).toBe("duplicate");
    expect(await handleWebhook(provider, body, signature)).toBe("duplicate");

    const n = (await admin<{ n: number }[]>`select count(*)::int as n from outbox where topic = 'booking.confirmed'`)[0]!.n;
    expect(n).toBe(1);
    const events = await admin`select * from webhook_events`;
    expect(events).toHaveLength(1);
  });

  it("concurrent duplicate deliveries are applied exactly once", async () => {
    const result = await bookWithDeposit(org);
    const payment = await paymentFor(result.bookingId);
    const event = {
      id: "evt_race",
      type: "deposit.succeeded" as const,
      orgId: org.orgId,
      bookingId: result.bookingId,
      externalId: payment.external_id,
    };
    const outcomes = await Promise.all(Array.from({ length: 8 }, () => applyPaymentEvent("fake", event)));
    expect(outcomes.filter((o) => o === "processed")).toHaveLength(1);
    expect(outcomes.filter((o) => o === "duplicate")).toHaveLength(7);
    const n = (await admin<{ n: number }[]>`select count(*)::int as n from audit_log where action = 'booking.payment_confirmed'`)[0]!.n;
    expect(n).toBe(1);
  });

  it("rejects a bad signature before touching the database", async () => {
    const { body } = provider.sign({ id: "evt_forged", type: "subscription.cancelled", orgId: org.orgId, subscriptionId: "sub_1" });
    const forged = new FakePaymentProvider("http://x", "attacker-secret").sign(JSON.parse(body));
    expect(() => provider.parseWebhook(body, forged.signature)).toThrow(WebhookSignatureError);
    await expect(handleWebhook(provider, body, forged.signature)).rejects.toBeInstanceOf(WebhookSignatureError);
    expect(await admin`select * from webhook_events`).toHaveLength(0);
  });

  it("a failed handler rolls back the idempotency record so the retry can succeed", async () => {
    const event = {
      id: "evt_retry",
      type: "deposit.succeeded" as const,
      orgId: org.orgId,
      bookingId: "00000000-0000-4000-8000-000000000000",
      externalId: "cs_x",
    };
    // Unknown booking: handled gracefully (no throw) and recorded once.
    expect(await applyPaymentEvent("fake", event)).toBe("processed");
    // Now make the transaction fail after the ledger insert was attempted (invalid org id).
    const crash = applyPaymentEvent("fake", { ...event, id: "evt_crash", orgId: "not-a-uuid" });
    await expect(crash).rejects.toThrow();
    expect(await admin`select * from webhook_events where event_id = 'evt_crash'`).toHaveLength(0);
  });

  it("payment after the hold expired re-confirms when the slot is still free", async () => {
    const result = await bookWithDeposit(org);
    await admin`update bookings set status = 'expired' where id = ${result.bookingId}`;
    const payment = await paymentFor(result.bookingId);
    const outcome = await applyPaymentEvent("fake", {
      id: "evt_late_ok",
      type: "deposit.succeeded",
      orgId: org.orgId,
      bookingId: result.bookingId,
      externalId: payment.external_id,
    });
    expect(outcome).toBe("processed");
    const [b] = await admin`select status from bookings where id = ${result.bookingId}`;
    expect(b!.status).toBe("confirmed");
  });

  it("payment after the hold expired and the slot was taken schedules a refund", async () => {
    const result = await bookWithDeposit(org);
    await admin`update bookings set status = 'expired' where id = ${result.bookingId}`;
    await insertBookingDirect(org, { start: tomorrowAt(10) }); // someone else got the slot
    const payment = await paymentFor(result.bookingId);
    await applyPaymentEvent("fake", {
      id: "evt_late_taken",
      type: "deposit.succeeded",
      orgId: org.orgId,
      bookingId: result.bookingId,
      externalId: payment.external_id,
    });
    const [b] = await admin`select status from bookings where id = ${result.bookingId}`;
    expect(b!.status).toBe("expired");
    const refunds = await admin`select payload from outbox where topic = 'payment.refund_required'`;
    expect(refunds).toHaveLength(1);
  });

  it("deposit.expired releases the hold", async () => {
    const result = await bookWithDeposit(org);
    await applyPaymentEvent("fake", {
      id: "evt_expired",
      type: "deposit.expired",
      orgId: org.orgId,
      bookingId: result.bookingId,
      externalId: "cs_whatever",
    });
    const [b] = await admin`select status from bookings where id = ${result.bookingId}`;
    expect(b!.status).toBe("expired");
  });

  it("subscription events switch the plan", async () => {
    await applyPaymentEvent("fake", { id: "evt_sub_on", type: "subscription.activated", orgId: org.orgId, customerId: "cus_1", subscriptionId: "sub_1" });
    expect((await admin`select plan from organizations where id = ${org.orgId}`)[0]!.plan).toBe("pro");
    await applyPaymentEvent("fake", { id: "evt_sub_off", type: "subscription.cancelled", orgId: org.orgId, subscriptionId: "sub_1" });
    expect((await admin`select plan from organizations where id = ${org.orgId}`)[0]!.plan).toBe("free");
  });

  it("ignored event types are acknowledged without side effects", async () => {
    expect(await applyPaymentEvent("stripe", { id: "evt_x", type: "ignored", providerType: "charge.updated" })).toBe("ignored");
    expect(await admin`select * from webhook_events`).toHaveLength(0);
  });
});
