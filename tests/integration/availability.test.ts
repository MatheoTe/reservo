import { Temporal } from "temporal-polyfill";
import { beforeEach, describe, expect, it } from "vitest";

import { holidays, timeOff } from "@/db/schema";
import { localTime } from "@/lib/availability";
import { withTenant } from "@/server/db/tenant";
import { loadOrg } from "@/server/services/bookings";
import { computeAvailability } from "@/server/services/availability";

import {
  createTestOrg,
  insertBookingDirect,
  type TestOrg,
  tomorrowAt,
  useCleanDatabase,
} from "./helpers";

const BA = "America/Argentina/Buenos_Aires";

describe("availability service (DB -> engine)", () => {
  useCleanDatabase();
  let org: TestOrg;
  const tomorrow = () => Temporal.Now.plainDateISO(BA).add({ days: 1 }).toString();

  beforeEach(async () => {
    org = await createTestOrg("physio");
  });

  async function slotsTomorrow() {
    return withTenant({ orgId: org.orgId }, async (tx) => {
      const o = await loadOrg(tx, org.orgId);
      const { slots } = await computeAvailability(tx, {
        org: o,
        serviceId: org.serviceId,
        from: tomorrow(),
        to: tomorrow(),
        now: new Date(),
      });
      return slots.map((s) => localTime(s.start, BA));
    });
  }

  it("offers the full day from stored working hours", async () => {
    const slots = await slotsTomorrow();
    // 09:00-17:00 on a 15 minute grid for a 60 minute service: 09:00 ... 16:00
    expect(slots).toHaveLength(29);
    expect(slots.slice(0, 3)).toEqual(["09:00", "09:15", "09:30"]);
    expect(slots.at(-1)).toBe("16:00");
  });

  it("removes times taken by a confirmed booking but not by a cancelled one", async () => {
    await insertBookingDirect(org, { start: tomorrowAt(10) });
    await insertBookingDirect(org, { start: tomorrowAt(14), status: "cancelled" });
    const slots = await slotsTomorrow();
    expect(slots).not.toContain("10:00");
    expect(slots).not.toContain("09:30"); // would run into the 10:00 booking
    expect(slots).toContain("11:00");
    expect(slots).toContain("14:00");
  });

  it("respects org-wide holidays and staff time off", async () => {
    await withTenant({ orgId: org.orgId }, (tx) =>
      tx.insert(timeOff).values({
        orgId: org.orgId,
        staffId: org.ownerStaffId,
        startsAt: tomorrowAt(9),
        endsAt: tomorrowAt(12),
      }),
    );
    expect((await slotsTomorrow())[0]).toBe("12:00");
    await withTenant({ orgId: org.orgId }, (tx) =>
      tx.insert(holidays).values({ orgId: org.orgId, date: tomorrow(), name: "Holiday" }),
    );
    expect(await slotsTomorrow()).toEqual([]);
  });
});
