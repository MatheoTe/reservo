import { describe, expect, it } from "vitest";

import { can, canAssignRole, PERMISSIONS } from "./rbac";

describe("can", () => {
  it("gives owners every permission", () => {
    for (const p of PERMISSIONS) expect(can("owner", p)).toBe(true);
  });

  it("keeps billing owner-only", () => {
    expect(can("admin", "billing:manage")).toBe(false);
    expect(can("staff", "billing:manage")).toBe(false);
  });

  it("limits staff to their own bookings and schedule", () => {
    expect(can("staff", "bookings:write:own")).toBe(true);
    expect(can("staff", "bookings:write:any")).toBe(false);
    expect(can("staff", "schedule:manage:any")).toBe(false);
    expect(can("staff", "services:manage")).toBe(false);
    expect(can("staff", "team:manage")).toBe(false);
    expect(can("staff", "audit:read")).toBe(false);
  });

  it("lets admins run the business but not the subscription", () => {
    expect(can("admin", "team:manage")).toBe(true);
    expect(can("admin", "settings:manage")).toBe(true);
    expect(can("admin", "audit:read")).toBe(true);
  });
});

describe("canAssignRole", () => {
  it.each([
    ["owner", "staff", "owner", true],
    ["owner", "owner", "staff", true],
    ["admin", "staff", "admin", true],
    ["admin", null, "staff", true],
    ["admin", null, "admin", true],
    ["admin", "staff", "owner", false],
    ["admin", "owner", "staff", false],
    ["staff", "staff", "staff", false],
    ["staff", null, "staff", false],
  ] as const)("%s changing %s -> %s = %s", (actor, current, next, expected) => {
    expect(canAssignRole(actor, current, next)).toBe(expected);
  });
});
