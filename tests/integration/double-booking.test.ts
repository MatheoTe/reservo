import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { bookings } from "@/db/schema";
import { withTenant } from "@/server/db/tenant";
import { AppError, pgError } from "@/server/errors";
import { createPublicBooking, type PublicBookingResult } from "@/server/services/bookings";

import { addStaff, admin, countBookings, createTestOrg, insertBookingDirect, type TestOrg, tomorrowAt, useCleanDatabase } from "./helpers";

const customer = (i: number) => ({ name: `Customer ${i}`, email: `customer${i}@example.com`, phone: null });

function book(org: TestOrg, start: Date, i: number, staffId: string | null = org.ownerStaffId) {
  return createPublicBooking(org.slug, {
    serviceId: org.serviceId,
    staffId,
    start: start.toISOString(),
    customer: customer(i),
  });
}

describe("no double booking: exclusion constraint", () => {
  useCleanDatabase();
  let org: TestOrg;

  beforeEach(async () => {
    org = await createTestOrg("clinic");
  });

  it("rejects an overlapping booking for the same staff member at the DB level", async () => {
    await insertBookingDirect(org, { start: tomorrowAt(10), minutes: 60 });
    const err = await insertBookingDirect(org, { start: tomorrowAt(10, 30), minutes: 60 }).catch((e: unknown) => e);
    expect(pgError(err)?.code).toBe("23P01");
  });

  it("allows back-to-back bookings (ranges are half-open)", async () => {
    await insertBookingDirect(org, { start: tomorrowAt(10) });
    await expect(insertBookingDirect(org, { start: tomorrowAt(11) })).resolves.toBeDefined();
  });

  it("allows the same time for different staff members", async () => {
    const bob = await addStaff(org, "Bob");
    await insertBookingDirect(org, { start: tomorrowAt(10) });
    await expect(insertBookingDirect(org, { staffId: bob.id, start: tomorrowAt(10) })).resolves.toBeDefined();
  });

  it("cancelled and expired bookings don't block the slot", async () => {
    await insertBookingDirect(org, { start: tomorrowAt(10), status: "cancelled" });
    await insertBookingDirect(org, { start: tomorrowAt(10), status: "expired" });
    await expect(insertBookingDirect(org, { start: tomorrowAt(10) })).resolves.toBeDefined();
  });

  it("re-activating a cancelled booking into an occupied slot is rejected too", async () => {
    const cancelled = await insertBookingDirect(org, { start: tomorrowAt(10), status: "cancelled" });
    await insertBookingDirect(org, { start: tomorrowAt(10) });
    const err = await withTenant({ orgId: org.orgId }, (tx) =>
      tx.update(bookings).set({ status: "confirmed" }).where(eq(bookings.id, cancelled.id)),
    ).catch((e: unknown) => e);
    expect(pgError(err)?.code).toBe("23P01");
  });

  it("buffers are part of the protected range", async () => {
    const buffered = await createTestOrg("salon", { bufferAfterMinutes: 30 });
    await book(buffered, tomorrowAt(10), 1); // blocks 10:00-11:30
    await expect(book(buffered, tomorrowAt(11), 2)).rejects.toMatchObject({ code: "SLOT_UNAVAILABLE" });
    // 12:00 is clear of the 30 minute cleanup.
    await expect(book(buffered, tomorrowAt(12), 3)).resolves.toMatchObject({ status: "confirmed" });
  });

  it("a pending-payment hold blocks the slot until it expires", async () => {
    await insertBookingDirect(org, { start: tomorrowAt(10), status: "pending_payment", holdExpiresAt: new Date(Date.now() + 60_000) });
    await expect(book(org, tomorrowAt(10), 1)).rejects.toMatchObject({ code: "SLOT_UNAVAILABLE" });
  });

  it("an expired hold is released and the slot can be booked", async () => {
    const stale = await insertBookingDirect(org, {
      start: tomorrowAt(10),
      status: "pending_payment",
      holdExpiresAt: new Date(Date.now() - 1000),
    });
    await expect(book(org, tomorrowAt(10), 1)).resolves.toMatchObject({ status: "confirmed" });
    const [row] = await admin`select status from bookings where id = ${stale.id}`;
    expect(row!.status).toBe("expired");
  });

  it("refuses times outside working hours even if nothing overlaps", async () => {
    await expect(book(org, tomorrowAt(20), 1)).rejects.toMatchObject({ code: "SLOT_UNAVAILABLE" });
    await expect(book(org, tomorrowAt(10, 7), 1)).rejects.toMatchObject({ code: "SLOT_UNAVAILABLE" }); // off-grid
  });
});

describe("no double booking: concurrency", () => {
  useCleanDatabase();

  it("exactly one of 25 parallel requests for the same slot succeeds", async () => {
    const org = await createTestOrg("busy-clinic");
    const start = tomorrowAt(14);
    const results = await Promise.allSettled(Array.from({ length: 25 }, (_, i) => book(org, start, i)));

    const ok = results.filter((r): r is PromiseFulfilledResult<PublicBookingResult> => r.status === "fulfilled");
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(24);
    for (const f of failed) {
      expect(f.reason).toBeInstanceOf(AppError);
      expect((f.reason as AppError).code).toBe("SLOT_UNAVAILABLE");
    }
    expect(await countBookings(org.orgId, "confirmed")).toBe(1);
  });

  it("with 'any staff', parallel requests fill each staff member exactly once", async () => {
    const org = await createTestOrg("team-clinic");
    const bob = await addStaff(org, "Bob");
    const carol = await addStaff(org, "Carol");
    const start = tomorrowAt(9);

    const results = await Promise.allSettled(Array.from({ length: 12 }, (_, i) => book(org, start, i, null)));
    const ok = results.filter((r) => r.status === "fulfilled");
    expect(ok).toHaveLength(3);

    const rows = await admin`select staff_id from bookings where org_id = ${org.orgId} and status = 'confirmed'`;
    expect(new Set(rows.map((r) => r.staff_id))).toEqual(new Set([org.ownerStaffId, bob.id, carol.id]));
  });

  it("parallel bookings for different slots all succeed", async () => {
    const org = await createTestOrg("calm-clinic");
    const hours = [9, 10, 11, 12, 13, 14, 15, 16];
    const results = await Promise.allSettled(hours.map((h, i) => book(org, tomorrowAt(h), i)));
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    expect(await countBookings(org.orgId, "confirmed")).toBe(hours.length);
  });
});
