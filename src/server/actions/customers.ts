"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { audit } from "../audit";
import { updateCustomerNotes } from "../services/customers";
import { type ActionResult, runOrgAction } from "./run";

const schema = z.object({ customerId: z.uuid(), notes: z.string().trim().max(2000) });

export async function updateCustomerNotesAction(
  orgSlug: string,
  input: unknown,
): Promise<ActionResult> {
  const result = await runOrgAction(
    orgSlug,
    "customers:write",
    schema,
    input,
    async ({ tx, actor, input }) => {
      await updateCustomerNotes(tx, input.customerId, input.notes);
      await audit(tx, {
        orgId: actor.orgId,
        actorUserId: actor.userId,
        action: "customer.updated",
        targetType: "customer",
        targetId: input.customerId,
      });
    },
  );
  if (result.ok)
    revalidatePath(`/app/${orgSlug}/customers/${(input as { customerId?: string }).customerId}`);
  return result;
}
