import { describe, expect, it } from "vitest";

import {
  createOrganizationSchema,
  publicBookingSchema,
  serviceSchema,
  slugSchema,
  weeklyWindowSchema,
} from "./validation";

describe("slugSchema", () => {
  it.each(["glow-studio", "abc", "clinic-24"])("accepts %s", (s) => {
    expect(slugSchema.safeParse(s).success).toBe(true);
  });

  it.each(["ab", "-start", "end-", "has space", "UPPER_case", "ñandu"])("rejects %s", (s) => {
    expect(slugSchema.safeParse(s).success).toBe(false);
  });

  it("normalizes case and whitespace", () => {
    expect(slugSchema.parse("  Glow-Studio ")).toBe("glow-studio");
  });
});

describe("createOrganizationSchema", () => {
  it("rejects reserved slugs and unknown zones", () => {
    const r = createOrganizationSchema.safeParse({
      name: "Acme",
      slug: "api",
      timeZone: "Nowhere/City",
    });
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => i.path.join("."))).toEqual(
      expect.arrayContaining(["slug", "timeZone"]),
    );
  });
});

describe("serviceSchema", () => {
  const base = {
    name: "Cut",
    durationMinutes: 30,
    priceCents: 3000,
    depositCents: 0,
    bufferBeforeMinutes: 0,
    bufferAfterMinutes: 5,
  };

  it("coerces form strings", () => {
    expect(serviceSchema.parse({ ...base, durationMinutes: "45" }).durationMinutes).toBe(45);
  });

  it("rejects a deposit above the price", () => {
    expect(serviceSchema.safeParse({ ...base, depositCents: 5000 }).success).toBe(false);
  });
});

describe("weeklyWindowSchema", () => {
  it("rejects inverted windows", () => {
    expect(weeklyWindowSchema.safeParse({ weekday: 1, start: "17:00", end: "09:00" }).success).toBe(
      false,
    );
  });

  it("allows 24:00 as end of day", () => {
    expect(weeklyWindowSchema.safeParse({ weekday: 1, start: "20:00", end: "24:00" }).success).toBe(
      true,
    );
  });
});

describe("publicBookingSchema", () => {
  const valid = {
    serviceId: "8d3c1f9e-4b8a-4c1d-9f2e-1a2b3c4d5e6f",
    staffId: null,
    start: "2026-03-10T14:30:00-03:00",
    customer: { name: "Ana Pérez", email: "ANA@Example.com " },
  };

  it("normalizes the email", () => {
    expect(publicBookingSchema.parse(valid).customer.email).toBe("ana@example.com");
  });

  it("requires an explicit offset on the start time", () => {
    expect(publicBookingSchema.safeParse({ ...valid, start: "2026-03-10T14:30:00" }).success).toBe(
      false,
    );
  });

  it("rejects bots that fill the honeypot", () => {
    expect(publicBookingSchema.safeParse({ ...valid, website: "http://spam" }).success).toBe(false);
  });
});
