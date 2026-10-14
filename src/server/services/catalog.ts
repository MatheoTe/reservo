import { and, asc, eq, inArray } from "drizzle-orm";

import { services, staffMembers, staffServices } from "@/db/schema";
import type { ServiceInput } from "@/lib/validation";

import { audit } from "../audit";
import type { Tx } from "../db/client";
import { notFound } from "../errors";
import type { Actor } from "./team";

export async function listServices(tx: Tx, opts: { includeArchived?: boolean } = {}) {
  const rows = await tx
    .select()
    .from(services)
    .where(opts.includeArchived ? undefined : eq(services.active, true))
    .orderBy(asc(services.name));
  const links = rows.length
    ? await tx
        .select()
        .from(staffServices)
        .where(
          inArray(
            staffServices.serviceId,
            rows.map((r) => r.id),
          ),
        )
    : [];
  return rows.map((s) => ({
    ...s,
    staffIds: links.filter((l) => l.serviceId === s.id).map((l) => l.staffId),
  }));
}

export async function listStaff(tx: Tx, opts: { activeOnly?: boolean } = {}) {
  return tx
    .select()
    .from(staffMembers)
    .where(opts.activeOnly ? eq(staffMembers.active, true) : undefined)
    .orderBy(asc(staffMembers.displayName));
}

export async function createService(tx: Tx, actor: Actor, input: ServiceInput) {
  const { staffIds, ...fields } = input;
  const [service] = await tx
    .insert(services)
    .values({ ...fields, orgId: actor.orgId })
    .returning();
  await setServiceStaff(tx, actor.orgId, service!.id, staffIds);
  await audit(tx, {
    orgId: actor.orgId,
    actorUserId: actor.userId,
    action: "service.created",
    targetType: "service",
    targetId: service!.id,
    metadata: { name: input.name },
  });
  return service!;
}

export async function updateService(tx: Tx, actor: Actor, serviceId: string, input: ServiceInput) {
  const { staffIds, ...fields } = input;
  const [service] = await tx
    .update(services)
    .set(fields)
    .where(eq(services.id, serviceId))
    .returning();
  if (!service) throw notFound("Service");
  await setServiceStaff(tx, actor.orgId, service.id, staffIds);
  await audit(tx, {
    orgId: actor.orgId,
    actorUserId: actor.userId,
    action: "service.updated",
    targetType: "service",
    targetId: service.id,
  });
  return service;
}

export async function archiveService(tx: Tx, actor: Actor, serviceId: string) {
  const [service] = await tx
    .update(services)
    .set({ active: false })
    .where(and(eq(services.id, serviceId), eq(services.active, true)))
    .returning({ id: services.id });
  if (!service) throw notFound("Service");
  await audit(tx, {
    orgId: actor.orgId,
    actorUserId: actor.userId,
    action: "service.archived",
    targetType: "service",
    targetId: service.id,
  });
}

async function setServiceStaff(tx: Tx, orgId: string, serviceId: string, staffIds: string[]) {
  await tx.delete(staffServices).where(eq(staffServices.serviceId, serviceId));
  if (staffIds.length > 0) {
    // Composite FK (org_id, staff_id) rejects staff ids from other tenants.
    await tx
      .insert(staffServices)
      .values(staffIds.map((staffId) => ({ orgId, staffId, serviceId })));
  }
}
