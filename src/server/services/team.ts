import { createHash, randomBytes } from "node:crypto";

import { and, asc, eq, isNull, sql } from "drizzle-orm";

import { authUsers, invitations, type MemberRole, memberships, staffMembers } from "@/db/schema";

import { audit } from "../audit";
import { canAssignRole } from "../auth/rbac";
import type { Tx } from "../db/client";
import { getDb } from "../db/client";
import { withTenant } from "../db/tenant";
import { AppError, conflict, forbidden, notFound } from "../errors";
import { enqueue } from "../outbox/outbox";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export interface Actor {
  userId: string;
  role: MemberRole;
  orgId: string;
}

export async function inviteMember(
  tx: Tx,
  actor: Actor,
  input: { email: string; role: "admin" | "staff" },
  now = new Date(),
) {
  if (!canAssignRole(actor.role, null, input.role)) throw forbidden();
  const [existing] = await tx
    .select({ id: memberships.id })
    .from(memberships)
    .innerJoin(authUsers, eq(authUsers.id, memberships.userId))
    .where(sql`lower(${authUsers.email}) = ${input.email}`);
  if (existing) throw conflict("That person is already a member.");

  const token = randomBytes(32).toString("base64url");
  const [invitation] = await tx
    .insert(invitations)
    .values({
      orgId: actor.orgId,
      email: input.email,
      role: input.role,
      tokenHash: hashToken(token),
      invitedBy: actor.userId,
      expiresAt: new Date(now.getTime() + INVITE_TTL_MS),
    })
    .returning();
  // The raw token travels only through the outbox; the worker strips it from
  // the row once the email is delivered.
  await enqueue(tx, actor.orgId, "invitation.created", { invitationId: invitation!.id, token });
  await audit(tx, {
    orgId: actor.orgId,
    actorUserId: actor.userId,
    action: "member.invited",
    targetType: "invitation",
    targetId: invitation!.id,
    metadata: { email: input.email, role: input.role },
  });
  return { invitation: invitation!, token };
}

export async function revokeInvitation(
  tx: Tx,
  actor: Actor,
  invitationId: string,
  now = new Date(),
) {
  const [row] = await tx
    .update(invitations)
    .set({ revokedAt: now })
    .where(
      and(
        eq(invitations.id, invitationId),
        isNull(invitations.acceptedAt),
        isNull(invitations.revokedAt),
      ),
    )
    .returning({ id: invitations.id });
  if (!row) throw notFound("Invitation");
  await audit(tx, {
    orgId: actor.orgId,
    actorUserId: actor.userId,
    action: "invitation.revoked",
    targetType: "invitation",
    targetId: row.id,
  });
}

/**
 * Accepting crosses the tenant boundary exactly once: the token hash is
 * resolved to an org id by a SECURITY DEFINER function, then everything else
 * happens inside that tenant's RLS context.
 */
export async function acceptInvitation(
  token: string,
  user: { id: string; email: string; name: string },
): Promise<{ orgId: string }> {
  const tokenHash = hashToken(token);
  const rows = await getDb().execute<{ org_id: string | null }>(
    sql`select app.invitation_org_id(${tokenHash}) as org_id`,
  );
  const orgId = rows[0]?.org_id;
  if (!orgId) throw new AppError("NOT_FOUND", "This invitation is invalid or has expired.");

  return withTenant({ orgId, userId: user.id }, async (tx) => {
    const [invitation] = await tx
      .select()
      .from(invitations)
      .where(eq(invitations.tokenHash, tokenHash))
      .for("update");
    if (!invitation || invitation.acceptedAt || invitation.revokedAt) {
      throw new AppError("NOT_FOUND", "This invitation is invalid or has expired.");
    }
    if (invitation.email.toLowerCase() !== user.email.toLowerCase()) {
      throw forbidden(
        `This invitation was sent to ${invitation.email}. Sign in with that address to accept it.`,
      );
    }
    await tx
      .insert(memberships)
      .values({ orgId, userId: user.id, role: invitation.role })
      .onConflictDoNothing();
    await tx
      .insert(staffMembers)
      .values({ orgId, userId: user.id, displayName: user.name, email: user.email })
      .onConflictDoNothing();
    await tx
      .update(invitations)
      .set({ acceptedAt: new Date() })
      .where(eq(invitations.id, invitation.id));
    await audit(tx, {
      orgId,
      actorUserId: user.id,
      action: "member.joined",
      targetType: "user",
      targetId: user.id,
      metadata: { role: invitation.role },
    });
    return { orgId };
  });
}

export async function changeRole(
  tx: Tx,
  actor: Actor,
  input: { membershipId: string; role: MemberRole },
) {
  const [target] = await tx
    .select()
    .from(memberships)
    .where(eq(memberships.id, input.membershipId))
    .for("update");
  if (!target) throw notFound("Member");
  if (!canAssignRole(actor.role, target.role, input.role)) throw forbidden();
  if (target.role === "owner" && input.role !== "owner") await assertNotLastOwner(tx);
  await tx.update(memberships).set({ role: input.role }).where(eq(memberships.id, target.id));
  await audit(tx, {
    orgId: actor.orgId,
    actorUserId: actor.userId,
    action: "member.role_changed",
    targetType: "user",
    targetId: target.userId,
    metadata: { from: target.role, to: input.role },
  });
}

export async function removeMember(tx: Tx, actor: Actor, membershipId: string) {
  const [target] = await tx
    .select()
    .from(memberships)
    .where(eq(memberships.id, membershipId))
    .for("update");
  if (!target) throw notFound("Member");
  // Removing someone requires being allowed to (re)assign their current role.
  if (!canAssignRole(actor.role, target.role, target.role)) throw forbidden();
  if (target.role === "owner") await assertNotLastOwner(tx);
  await tx.delete(memberships).where(eq(memberships.id, target.id));
  // Keep their staff row (bookings reference it) but make it unbookable.
  await tx
    .update(staffMembers)
    .set({ active: false, userId: null })
    .where(eq(staffMembers.userId, target.userId));
  await audit(tx, {
    orgId: actor.orgId,
    actorUserId: actor.userId,
    action: "member.removed",
    targetType: "user",
    targetId: target.userId,
  });
}

async function assertNotLastOwner(tx: Tx) {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(memberships)
    .where(eq(memberships.role, "owner"));
  if ((row?.n ?? 0) <= 1) throw conflict("An organization needs at least one owner.");
}

export async function listTeam(tx: Tx) {
  const members = await tx
    .select({
      membershipId: memberships.id,
      userId: memberships.userId,
      role: memberships.role,
      name: authUsers.name,
      email: authUsers.email,
      joinedAt: memberships.createdAt,
    })
    .from(memberships)
    .innerJoin(authUsers, eq(authUsers.id, memberships.userId))
    .orderBy(asc(authUsers.name));
  const pending = await tx
    .select()
    .from(invitations)
    .where(
      and(
        isNull(invitations.acceptedAt),
        isNull(invitations.revokedAt),
        sql`${invitations.expiresAt} > now()`,
      ),
    )
    .orderBy(asc(invitations.createdAt));
  return { members, pending };
}
