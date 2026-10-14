import "server-only";

import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { cache } from "react";

import { type MemberRole, memberships, type Organization, organizations, staffMembers } from "@/db/schema";

import { can, type Permission } from "./auth/rbac";
import { requireUser, type SessionUser } from "./auth/session";
import { orgIdBySlug, withTenant } from "./db/tenant";
import type { Tx } from "./db/client";

export interface OrgContext {
  user: SessionUser;
  org: Organization;
  role: MemberRole;
  /** The user's own staff row, if they are bookable in this org. */
  staffId: string | null;
  can: (permission: Permission) => boolean;
}

/**
 * Resolves `/app/[org]` for the signed-in user. Non-members get a 404, not a
 * 403: we don't confirm that an organization exists to outsiders.
 */
export const getOrgContext = cache(async (slug: string): Promise<OrgContext> => {
  const user = await requireUser(`/app/${slug}`);
  const orgId = await orgIdBySlug(slug);
  if (!orgId) notFound();
  const ctx = await withTenant({ orgId, userId: user.id }, async (tx) => {
    // Filter by org explicitly; RLS also scopes memberships to the current tenant.
    const [membership] = await tx
      .select()
      .from(memberships)
      .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, user.id)));
    if (!membership) return null;
    const [org] = await tx.select().from(organizations).where(eq(organizations.id, orgId));
    const [staff] = await tx.select({ id: staffMembers.id }).from(staffMembers).where(eq(staffMembers.userId, user.id));
    return { org: org!, role: membership.role, staffId: staff?.id ?? null };
  });
  if (!ctx) notFound();
  return { user, ...ctx, can: (p: Permission) => can(ctx.role, p) };
});

/** Runs a read inside the org's RLS context for a page. */
export async function readInOrg<T>(ctx: OrgContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withTenant({ orgId: ctx.org.id, userId: ctx.user.id }, fn);
}
