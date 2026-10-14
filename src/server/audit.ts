import { auditLog } from "@/db/schema";

import type { Tx } from "./db/client";

export type AuditAction =
  | "org.created"
  | "org.settings_updated"
  | "billing.plan_changed"
  | "member.invited"
  | "member.joined"
  | "member.role_changed"
  | "member.removed"
  | "invitation.revoked"
  | "service.created"
  | "service.updated"
  | "service.archived"
  | "staff.created"
  | "staff.schedule_updated"
  | "booking.created"
  | "booking.cancelled"
  | "booking.payment_confirmed"
  | "customer.updated";

export interface AuditEntry {
  orgId: string;
  actorUserId: string | null;
  action: AuditAction;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
}

/**
 * Writes an audit row in the caller's transaction, so the log entry exists
 * if and only if the change it describes was committed.
 */
export async function audit(tx: Tx, entry: AuditEntry): Promise<void> {
  await tx.insert(auditLog).values({
    orgId: entry.orgId,
    actorUserId: entry.actorUserId,
    action: entry.action,
    targetType: entry.targetType ?? null,
    targetId: entry.targetId ?? null,
    metadata: entry.metadata ?? {},
    ipAddress: entry.ipAddress ?? null,
  });
}
