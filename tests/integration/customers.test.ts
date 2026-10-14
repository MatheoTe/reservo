import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it } from "vitest";

import { bookings, customers } from "@/db/schema";
import { withTenant } from "@/server/db/tenant";
import { listCustomers } from "@/server/services/customers";

import { createTestOrg, inDaysAt, type TestOrg, useCleanDatabase } from "./helpers";

type Status = "confirmed" | "pending_payment" | "cancelled" | "expired";

describe("customer list", () => {
  useCleanDatabase();
  let org: TestOrg;

  beforeEach(async () => {
    org = await createTestOrg("clinic");
  });

  async function addCustomer(name: string) {
    return withTenant({ orgId: org.orgId }, async (tx) => {
      const [row] = await tx
        .insert(customers)
        .values({ orgId: org.orgId, name, email: `${randomUUID()}@example.com` })
        .returning();
      return row!;
    });
  }

  async function book(customerId: string, start: Date, status: Status = "confirmed") {
    const end = new Date(start.getTime() + 60 * 60_000);
    await withTenant({ orgId: org.orgId }, (tx) =>
      tx.insert(bookings).values({
        orgId: org.orgId,
        staffId: org.ownerStaffId,
        serviceId: org.serviceId,
        customerId,
        status,
        source: "dashboard",
        startsAt: start,
        endsAt: end,
        blockedFrom: start,
        blockedUntil: end,
        priceCents: 5000,
        holdExpiresAt: status === "pending_payment" ? new Date(Date.now() + 15 * 60_000) : null,
        accessToken: randomUUID(),
      }),
    );
  }

  it("counts each customer's past confirmed visits and their latest one", async () => {
    const ana = await addCustomer("Ana");
    const bruno = await addCustomer("Bruno");
    const lastVisit = inDaysAt(-3, 10);
    await book(ana.id, inDaysAt(-10, 10));
    await book(ana.id, lastVisit);
    await book(ana.id, inDaysAt(-5, 10), "cancelled"); // not a visit
    await book(ana.id, inDaysAt(4, 10)); // upcoming, not a visit yet
    await book(bruno.id, inDaysAt(5, 10)); // only upcoming

    const rows = await withTenant({ orgId: org.orgId }, (tx) => listCustomers(tx));
    const byName = Object.fromEntries(rows.map((r) => [r.name, r]));

    expect(byName.Ana!.visits).toBe(2);
    expect(new Date(byName.Ana!.lastVisit!).getTime()).toBe(lastVisit.getTime());
    expect(byName.Bruno!.visits).toBe(0);
    expect(byName.Bruno!.lastVisit).toBeNull();
  });

  it("does not mix up visits between customers", async () => {
    const ana = await addCustomer("Ana");
    const bruno = await addCustomer("Bruno");
    await book(ana.id, inDaysAt(-2, 10));
    await book(bruno.id, inDaysAt(-4, 10));
    await book(bruno.id, inDaysAt(-6, 10));

    const rows = await withTenant({ orgId: org.orgId }, (tx) => listCustomers(tx));
    expect(rows.map((r) => [r.name, r.visits])).toEqual([
      ["Ana", 1],
      ["Bruno", 2],
    ]);
  });
});
