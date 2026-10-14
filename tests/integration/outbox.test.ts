import { beforeEach, describe, expect, it } from "vitest";

import { withTenant } from "@/server/db/tenant";
import { MemoryMailer } from "@/server/mail/mailer";
import { enqueue } from "@/server/outbox/outbox";
import { formatDateTime } from "@/server/format";
import { FakePaymentProvider } from "@/server/payments/fake";
import { createPublicBooking } from "@/server/services/bookings";
import { inviteMember } from "@/server/services/team";
import { createHandlers } from "@/worker/handlers";
import { processOutboxBatch, runMaintenance } from "@/worker/processor";

import {
  admin,
  inDaysAt,
  createTestOrg,
  insertBookingDirect,
  type TestOrg,
  tomorrowAt,
  useCleanDatabase,
} from "./helpers";

const noJitterFast = { baseMs: 1_000, maxMs: 60_000, jitter: 0 };

describe("transactional outbox + worker", () => {
  useCleanDatabase();
  let org: TestOrg;
  let mailer: MemoryMailer;
  let handlers: ReturnType<typeof createHandlers>;

  beforeEach(async () => {
    org = await createTestOrg("dental");
    mailer = new MemoryMailer();
    handlers = createHandlers({
      mailer,
      payments: new FakePaymentProvider("http://x", "s"),
      appUrl: "https://reservo.test",
    });
  });

  async function book(hour: number) {
    return createPublicBooking(org.slug, {
      serviceId: org.serviceId,
      staffId: null,
      start: inDaysAt(3, hour).toISOString(),
      customer: { name: "Eva", email: "eva@example.com", phone: null },
      customerTimeZone: "Europe/Madrid",
    });
  }

  it("a booking and its confirmation message commit atomically", async () => {
    await book(10);
    const rows = await admin`select topic, status from outbox order by id`;
    expect(rows.map((r) => r.topic)).toEqual(["booking.confirmed", "booking.reminder"]);
  });

  it("a rolled-back transaction leaves no message behind", async () => {
    await withTenant({ orgId: org.orgId }, async (tx) => {
      await enqueue(tx, org.orgId, "booking.confirmed", {
        bookingId: "00000000-0000-4000-8000-000000000001",
      });
      throw new Error("boom");
    }).catch(() => undefined);
    expect(await admin`select * from outbox`).toHaveLength(0);
  });

  it("delivers the confirmation, formatted in the customer's time zone, and marks it done", async () => {
    await book(10);
    const result = await processOutboxBatch(handlers);
    expect(result).toMatchObject({ claimed: 1, succeeded: 1 }); // the reminder isn't due yet
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]!.to).toBe("eva@example.com");
    // Org is in Buenos Aires; the customer booked from Madrid and reads Madrid time.
    expect(mailer.sent[0]!.subject).toContain(formatDateTime(inDaysAt(3, 10), "Europe/Madrid"));
    expect(mailer.sent[0]!.subject).not.toContain(
      formatDateTime(inDaysAt(3, 10), "America/Argentina/Buenos_Aires"),
    );
    expect(mailer.sent[0]!.text).toContain("https://reservo.test/b/dental/bookings/");
    const [msg] =
      await admin`select status, processed_at from outbox where topic = 'booking.confirmed'`;
    expect(msg!.status).toBe("done");
    expect(msg!.processed_at).not.toBeNull();
  });

  it("does not deliver a reminder before it is due", async () => {
    await book(10);
    await processOutboxBatch(handlers);
    const [reminder] =
      await admin`select status, available_at from outbox where topic = 'booking.reminder'`;
    expect(reminder!.status).toBe("pending");
    expect(new Date(reminder!.available_at).getTime()).toBeGreaterThan(Date.now());
  });

  it("retries failures with exponential backoff, then dead-letters", async () => {
    await book(10);
    await admin`update outbox set max_attempts = 3 where topic = 'booking.confirmed'`;
    mailer.failNext = 10;

    for (let attempt = 1; attempt <= 3; attempt++) {
      const before = Date.now();
      const r = await processOutboxBatch(handlers, { backoff: noJitterFast });
      expect(r.claimed).toBe(1);
      const [m] =
        await admin`select status, attempts, available_at, last_error from outbox where topic = 'booking.confirmed'`;
      expect(m!.attempts).toBe(attempt);
      expect(m!.last_error).toMatch(/Simulated SMTP failure/);
      if (attempt < 3) {
        expect(m!.status).toBe("pending");
        const delay = new Date(m!.available_at).getTime() - before;
        expect(delay).toBeGreaterThanOrEqual(1_000 * 2 ** (attempt - 1) - 50);
        await admin`update outbox set available_at = now() where topic = 'booking.confirmed'`; // fast-forward
      } else {
        expect(m!.status).toBe("dead");
      }
    }
    expect(mailer.sent).toHaveLength(0);
    expect((await processOutboxBatch(handlers)).claimed).toBe(0); // dead messages are never claimed again
  });

  it("two workers polling concurrently never deliver the same message twice", async () => {
    for (const h of [9, 10, 11, 12, 13, 14]) await book(h);
    const [a, b] = await Promise.all([
      processOutboxBatch(handlers, { batchSize: 50 }),
      processOutboxBatch(handlers, { batchSize: 50 }),
    ]);
    expect(a.claimed + b.claimed).toBe(6);
    expect(mailer.sent).toHaveLength(6);
  });

  it("re-delivers a message whose lease expired (worker crashed mid-flight)", async () => {
    await book(10);
    // Worker 1 claims and "crashes" before acknowledging.
    await admin`select * from app.claim_outbox(10, 60)`;
    expect((await processOutboxBatch(handlers)).claimed).toBe(0); // leased
    await admin`update outbox set locked_until = now() - interval '1 second'`;
    expect((await processOutboxBatch(handlers)).succeeded).toBe(1);
  });

  it("skips the email when the booking was cancelled before delivery", async () => {
    const booking = await insertBookingDirect(org, { start: tomorrowAt(15) });
    await withTenant({ orgId: org.orgId }, (tx) =>
      enqueue(tx, org.orgId, "booking.confirmed", { bookingId: booking.id }),
    );
    await admin`update bookings set status = 'cancelled' where id = ${booking.id}`;
    await processOutboxBatch(handlers);
    expect(mailer.sent).toHaveLength(0);
  });

  it("dead-letters a payload that doesn't match its topic schema without retrying", async () => {
    await admin`insert into outbox (org_id, topic, payload) values (${org.orgId}, 'booking.confirmed', ${admin.json({ nope: true })})`;
    const r = await processOutboxBatch(handlers);
    expect(r.dead).toBe(1);
  });

  it("scrubs the invitation token from the row once the email is sent", async () => {
    await withTenant({ orgId: org.orgId, userId: org.owner.id }, (tx) =>
      inviteMember(
        tx,
        { orgId: org.orgId, userId: org.owner.id, role: "owner" },
        { email: "new@example.com", role: "staff" },
      ),
    );
    const [before] = await admin`select payload from outbox where topic = 'invitation.created'`;
    expect(before!.payload.token).toBeTruthy();
    await processOutboxBatch(handlers);
    expect(mailer.sent[0]!.text).toContain(`/invite/${before!.payload.token}`);
    const [after] =
      await admin`select payload, status from outbox where topic = 'invitation.created'`;
    expect(after!.status).toBe("done");
    expect(after!.payload.token).toBeUndefined();
  });

  it("maintenance expires abandoned holds across tenants", async () => {
    const other = await createTestOrg("vet");
    await insertBookingDirect(org, {
      start: tomorrowAt(9),
      status: "pending_payment",
      holdExpiresAt: new Date(Date.now() - 1000),
    });
    await insertBookingDirect(other, {
      start: tomorrowAt(9),
      status: "pending_payment",
      holdExpiresAt: new Date(Date.now() - 1000),
    });
    await insertBookingDirect(other, {
      start: tomorrowAt(11),
      status: "pending_payment",
      holdExpiresAt: new Date(Date.now() + 600_000),
    });
    expect((await runMaintenance()).expiredHolds).toBe(2);
  });
});
