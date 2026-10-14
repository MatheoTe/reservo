import "server-only";

import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import type { z } from "zod";

import { memberships } from "@/db/schema";

import { can, type Permission } from "../auth/rbac";
import { requireUserOrThrow, type SessionUser } from "../auth/session";
import type { Tx } from "../db/client";
import { orgIdBySlug, withTenant } from "../db/tenant";
import { type ErrorCode, forbidden, notFound, toAppError } from "../errors";
import { clientIp, parseOrThrow } from "../http";
import type { Actor } from "../services/team";

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: { code: ErrorCode; message: string; fieldErrors?: Record<string, string[]> };
    };

export interface OrgActionContext<I> {
  tx: Tx;
  actor: Actor;
  user: SessionUser;
  input: I;
  ip: string;
}

/**
 * The one entry point for tenant-scoped mutations from the dashboard:
 *   authenticate -> validate input (zod) -> resolve tenant -> load membership
 *   inside RLS -> check permission -> run in the same transaction
 * and convert every failure into a typed ActionResult. Nothing reaches the
 * handler without passing all of these, so individual actions can't forget one.
 */
export async function runOrgAction<S extends z.ZodType, R>(
  orgSlug: string,
  permission: Permission,
  schema: S,
  rawInput: unknown,
  handler: (ctx: OrgActionContext<z.infer<S>>) => Promise<R>,
): Promise<ActionResult<R>> {
  try {
    const user = await requireUserOrThrow();
    const input = parseOrThrow(schema, rawInput);
    const orgId = await orgIdBySlug(orgSlug);
    if (!orgId) throw notFound("Organization");
    const ip = clientIp(await headers());

    const data = await withTenant({ orgId, userId: user.id }, async (tx) => {
      const [membership] = await tx
        .select()
        .from(memberships)
        .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, user.id)));
      if (!membership) throw notFound("Organization");
      if (!can(membership.role, permission)) throw forbidden();
      return handler({
        tx,
        actor: { orgId, userId: user.id, role: membership.role },
        user,
        input,
        ip,
      });
    });
    return { ok: true, data };
  } catch (err) {
    return toActionError(err);
  }
}

export function toActionError(err: unknown): {
  ok: false;
  error: { code: ErrorCode; message: string; fieldErrors?: Record<string, string[]> };
} {
  const appError = toAppError(err);
  if (appError.code === "INTERNAL") console.error("[action] unhandled error", err);
  return {
    ok: false,
    error: { code: appError.code, message: appError.message, fieldErrors: appError.fieldErrors },
  };
}
