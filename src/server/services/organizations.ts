import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";

import { memberships, organizations, staffMembers, workingHours } from "@/db/schema";
import type { CreateOrganizationInput } from "@/lib/validation";

import { audit } from "../audit";
import { type TenantContext, withTenant, withUser } from "../db/tenant";
import { conflict, isPgError, PG } from "../errors";

export const DEFAULT_HOURS = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start: "09:00", end: "17:00" }));

/**
 * Creates an organization with its owner. The id is generated up front so the
 * RLS context can be set *before* the first insert: the organizations INSERT
 * policy only accepts rows whose id equals app.current_org.
 */
export async function createOrganization(
  user: { id: string; name: string; email: string },
  input: CreateOrganizationInput,
): Promise<{ id: string; slug: string }> {
  const orgId = randomUUID();
  const ctx: TenantContext = { orgId, userId: user.id };
  try {
    return await withTenant(ctx, async (tx) => {
      await tx.insert(organizations).values({
        id: orgId,
        name: input.name,
        slug: input.slug,
        timeZone: input.timeZone,
        currency: input.currency,
      });
      await tx.insert(memberships).values({ orgId, userId: user.id, role: "owner" });
      const [staff] = await tx
        .insert(staffMembers)
        .values({ orgId, userId: user.id, displayName: user.name, email: user.email })
        .returning({ id: staffMembers.id });
      await tx
        .insert(workingHours)
        .values(DEFAULT_HOURS.map((h) => ({ orgId, staffId: staff!.id, weekday: h.weekday, startTime: h.start, endTime: h.end })));
      await audit(tx, { orgId, actorUserId: user.id, action: "org.created", targetType: "organization", targetId: orgId });
      return { id: orgId, slug: input.slug };
    });
  } catch (err) {
    if (isPgError(err, PG.UNIQUE_VIOLATION, "organizations_slug_key")) {
      throw conflict("That URL is already taken. Try another one.");
    }
    throw err;
  }
}

export interface UserOrganization {
  id: string;
  slug: string;
  name: string;
  role: "owner" | "admin" | "staff";
}

/** Organizations the user belongs to; RLS exposes only their own memberships. */
export async function listUserOrganizations(userId: string): Promise<UserOrganization[]> {
  return withUser(userId, (tx) =>
    tx
      .select({ id: organizations.id, slug: organizations.slug, name: organizations.name, role: memberships.role })
      .from(memberships)
      .innerJoin(organizations, eq(organizations.id, memberships.orgId))
      .where(eq(memberships.userId, userId))
      .orderBy(organizations.name),
  );
}
