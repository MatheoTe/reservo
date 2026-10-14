import { randomUUID } from "node:crypto";

import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import {
  auditLog,
  bookings,
  customers,
  memberships,
  organizations,
  services,
  staffMembers,
  staffServices,
} from "@/db/schema";
import { getDb } from "@/server/db/client";
import { orgIdBySlug, withTenant, withUser } from "@/server/db/tenant";
import { pgError } from "@/server/errors";
import { listUserOrganizations } from "@/server/services/organizations";

import {
  admin,
  createTestOrg,
  insertBookingDirect,
  type TestOrg,
  tomorrowAt,
  useCleanDatabase,
} from "./helpers";

/**
 * These tests talk to Postgres as `reservo_app`, the same role the app uses.
 * They deliberately write "buggy" queries (no tenant filter, foreign ids) to
 * prove isolation does not depend on application code being correct.
 */
describe("row level security", () => {
  useCleanDatabase();

  let a: TestOrg;
  let b: TestOrg;

  beforeEach(async () => {
    a = await createTestOrg("org-a");
    b = await createTestOrg("org-b");
    await insertBookingDirect(a, { start: tomorrowAt(10) });
    await insertBookingDirect(b, { start: tomorrowAt(10) });
  });

  it("the app connects as a role that is neither superuser nor BYPASSRLS", async () => {
    const [role] = await getDb().execute<{
      rolname: string;
      rolsuper: boolean;
      rolbypassrls: boolean;
    }>(sql`select rolname, rolsuper, rolbypassrls from pg_roles where rolname = current_user`);
    expect(role).toEqual({ rolname: "reservo_app", rolsuper: false, rolbypassrls: false });
  });

  it("sees nothing at all without a tenant context (fails closed)", async () => {
    const db = getDb();
    expect(await db.select().from(services)).toHaveLength(0);
    expect(await db.select().from(bookings)).toHaveLength(0);
    expect(await db.select().from(organizations)).toHaveLength(0);
    // ...even though the rows exist:
    const n = (await admin<{ n: number }[]>`select count(*)::int as n from services`)[0]!.n;
    expect(n).toBe(2);
  });

  it("an unfiltered query only returns the current tenant's rows", async () => {
    const rows = await withTenant({ orgId: a.orgId }, async (tx) => ({
      services: await tx.select().from(services), // no WHERE on purpose
      bookings: await tx.select().from(bookings),
      customers: await tx.select().from(customers),
      staff: await tx.select().from(staffMembers),
      audit: await tx.select().from(auditLog),
      orgs: await tx.select().from(organizations),
    }));
    for (const [table, list] of Object.entries(rows)) {
      expect(list.length, `${table} should have rows`).toBeGreaterThan(0);
      for (const row of list) {
        const orgId = "orgId" in row ? row.orgId : (row as { id: string }).id;
        expect(orgId, `${table} leaked a row`).toBe(a.orgId);
      }
    }
  });

  it("can't read another tenant's row even by primary key", async () => {
    const found = await withTenant({ orgId: a.orgId }, (tx) =>
      tx.select().from(services).where(eq(services.id, b.serviceId)),
    );
    expect(found).toEqual([]);
  });

  it("can't insert a row into another tenant", async () => {
    const err = await withTenant({ orgId: a.orgId }, (tx) =>
      tx
        .insert(customers)
        .values({ orgId: b.orgId, name: "Intruder", email: "intruder@example.com" }),
    ).catch((e: unknown) => e);
    expect(pgError(err)?.code).toBe("42501"); // new row violates row-level security policy
    const n = (
      await admin<
        { n: number }[]
      >`select count(*)::int as n from customers where email = 'intruder@example.com'`
    )[0]!.n;
    expect(n).toBe(0);
  });

  it("can't update or delete another tenant's rows (silently matches zero rows)", async () => {
    const result = await withTenant({ orgId: a.orgId }, async (tx) => ({
      updated: await tx
        .update(services)
        .set({ name: "Hacked" })
        .where(eq(services.id, b.serviceId))
        .returning(),
      deleted: await tx
        .delete(staffServices)
        .where(eq(staffServices.serviceId, b.serviceId))
        .returning(),
    }));
    expect(result).toEqual({ updated: [], deleted: [] });
    const [row] = await admin`select name from services where id = ${b.serviceId}`;
    expect(row!.name).toBe("Consultation");
  });

  it("can't move its own row into another tenant", async () => {
    const err = await withTenant({ orgId: a.orgId }, (tx) =>
      tx.update(services).set({ orgId: b.orgId }).where(eq(services.id, a.serviceId)),
    ).catch((e: unknown) => e);
    expect(pgError(err)?.code).toBe("42501");
  });

  it("composite foreign keys stop cross-tenant references that RLS alone would miss", async () => {
    // The row itself belongs to org A (passes RLS) but points at org B's staff.
    const err = await withTenant({ orgId: a.orgId }, (tx) =>
      tx
        .insert(staffServices)
        .values({ orgId: a.orgId, staffId: b.ownerStaffId, serviceId: a.serviceId }),
    ).catch((e: unknown) => e);
    expect(pgError(err)?.code).toBe("23503");
  });

  it("the tenant context does not leak to the next transaction on a pooled connection", async () => {
    const db = getDb();
    // Run enough sequential tenant transactions to reuse pooled connections.
    for (let i = 0; i < 15; i++) {
      await withTenant({ orgId: i % 2 ? a.orgId : b.orgId }, (tx) => tx.select().from(services));
    }
    const leaked = await Promise.all(Array.from({ length: 15 }, () => db.select().from(services)));
    expect(leaked.flat()).toHaveLength(0);
    const settings = await db.execute<{ org: string | null }>(
      sql`select current_setting('app.current_org', true) as org`,
    );
    expect(settings[0]!.org || null).toBeNull();
  });

  it("a garbage tenant id errors instead of matching anything", async () => {
    const err = await withTenant({ orgId: "not-a-uuid" }, (tx) => tx.select().from(services)).catch(
      (e: unknown) => e,
    );
    expect(pgError(err)?.code).toBe("22P02"); // invalid_text_representation
  });

  it("users see only organizations they are members of", async () => {
    const orgs = await listUserOrganizations(a.owner.id);
    expect(orgs.map((o) => o.slug)).toEqual(["org-a"]);
    const memberRows = await withUser(a.owner.id, (tx) => tx.select().from(memberships));
    expect(memberRows.every((m) => m.userId === a.owner.id)).toBe(true);
  });

  it("inside a tenant, a user's memberships in other orgs are invisible (no role borrowing)", async () => {
    // Regression: owner of A operating inside B's context. A lookup that forgot
    // `org_id = B` used to find their *A* membership and grant owner rights on B.
    const rows = await withTenant({ orgId: b.orgId, userId: a.owner.id }, async (tx) => ({
      memberships: await tx.select().from(memberships).where(eq(memberships.userId, a.owner.id)),
      organizations: await tx.select().from(organizations),
    }));
    expect(rows.memberships).toEqual([]);
    expect(rows.organizations.map((o) => o.id)).toEqual([b.orgId]);
  });

  it("an organization can't be created under someone else's id", async () => {
    const err = await withTenant({ orgId: a.orgId }, (tx) =>
      tx
        .insert(organizations)
        .values({ id: randomUUID(), name: "Sneaky", slug: "sneaky", timeZone: "UTC" }),
    ).catch((e: unknown) => e);
    expect(pgError(err)?.code).toBe("42501");
  });

  it("the audit log is append-only for the application role", async () => {
    const err = await withTenant({ orgId: a.orgId }, (tx) =>
      tx.update(auditLog).set({ action: "tampered" }),
    ).catch((e: unknown) => e);
    expect(pgError(err)?.code).toBe("42501"); // permission denied for table audit_log
    const delErr = await withTenant({ orgId: a.orgId }, (tx) => tx.delete(auditLog)).catch(
      (e: unknown) => e,
    );
    expect(pgError(delErr)?.code).toBe("42501");
  });

  it("bookings can't be deleted by the application, only cancelled", async () => {
    const err = await withTenant({ orgId: a.orgId }, (tx) => tx.delete(bookings)).catch(
      (e: unknown) => e,
    );
    expect(pgError(err)?.code).toBe("42501");
  });

  it("the public slug lookup works without context but reveals only the id", async () => {
    expect(await orgIdBySlug("org-b")).toBe(b.orgId);
    expect(await orgIdBySlug("does-not-exist")).toBeNull();
  });

  it("the app role can't call SECURITY DEFINER functions it wasn't granted, nor create objects", async () => {
    const err = await getDb()
      .execute(sql`create table public.evil (id int)`)
      .catch((e: unknown) => e);
    expect(pgError(err)?.code).toBe("42501");
  });
});
