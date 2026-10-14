"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { serviceSchema } from "@/lib/validation";

import { archiveService, createService, updateService } from "../services/catalog";
import { type ActionResult, runOrgAction } from "./run";

export async function createServiceAction(orgSlug: string, input: unknown): Promise<ActionResult<{ id: string }>> {
  const result = await runOrgAction(orgSlug, "services:manage", serviceSchema, input, async ({ tx, actor, input }) => {
    const service = await createService(tx, actor, input);
    return { id: service.id };
  });
  if (result.ok) revalidatePath(`/app/${orgSlug}/services`);
  return result;
}

const updateSchema = z.object({ serviceId: z.uuid(), service: serviceSchema });

export async function updateServiceAction(orgSlug: string, input: unknown): Promise<ActionResult> {
  const result = await runOrgAction(orgSlug, "services:manage", updateSchema, input, async ({ tx, actor, input }) => {
    await updateService(tx, actor, input.serviceId, input.service);
  });
  if (result.ok) revalidatePath(`/app/${orgSlug}/services`);
  return result;
}

export async function archiveServiceAction(orgSlug: string, input: unknown): Promise<ActionResult> {
  const result = await runOrgAction(orgSlug, "services:manage", z.object({ serviceId: z.uuid() }), input, async ({ tx, actor, input }) => {
    await archiveService(tx, actor, input.serviceId);
  });
  if (result.ok) revalidatePath(`/app/${orgSlug}/services`);
  return result;
}
