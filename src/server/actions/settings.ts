"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { organizations } from "@/db/schema";
import { isoDateSchema, orgSettingsSchema } from "@/lib/validation";

import { audit } from "../audit";
import { getPaymentProvider } from "../payments";
import { FakePaymentProvider } from "../payments/fake";
import { applyPaymentEvent } from "../payments/webhooks";
import { addHoliday } from "../services/schedule";
import { type ActionResult, runOrgAction } from "./run";

export async function updateSettingsAction(orgSlug: string, input: unknown): Promise<ActionResult> {
  const result = await runOrgAction(orgSlug, "settings:manage", orgSettingsSchema, input, async ({ tx, actor, input, ip }) => {
    await tx.update(organizations).set(input).where(eq(organizations.id, actor.orgId));
    await audit(tx, { orgId: actor.orgId, actorUserId: actor.userId, action: "org.settings_updated", metadata: input, ipAddress: ip });
  });
  if (result.ok) revalidatePath(`/app/${orgSlug}`, "layout");
  return result;
}

export async function addHolidayAction(orgSlug: string, input: unknown): Promise<ActionResult> {
  const schema = z.object({ date: isoDateSchema, name: z.string().trim().min(2).max(80) });
  const result = await runOrgAction(orgSlug, "schedule:manage:any", schema, input, async ({ tx, actor, input }) => {
    await addHoliday(tx, actor, input);
  });
  if (result.ok) revalidatePath(`/app/${orgSlug}/settings`);
  return result;
}

export async function startUpgradeAction(orgSlug: string): Promise<ActionResult> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const result = await runOrgAction(orgSlug, "billing:manage", z.undefined(), undefined, async ({ actor, user }) => {
    const session = await getPaymentProvider().createSubscriptionCheckout({
      orgId: actor.orgId,
      customerEmail: user.email,
      successUrl: `${appUrl}/app/${orgSlug}/settings?upgraded=1`,
      cancelUrl: `${appUrl}/app/${orgSlug}/settings`,
    });
    return session.url;
  });
  if (!result.ok) return result;
  redirect(result.data);
}

/**
 * Local-only: completes a fake subscription checkout by pushing a signed
 * event through the same idempotent webhook pipeline Stripe would use.
 */
export async function completeFakeUpgradeAction(orgSlug: string, sessionId: string): Promise<ActionResult> {
  const provider = getPaymentProvider();
  if (!(provider instanceof FakePaymentProvider)) return { ok: false, error: { code: "FORBIDDEN", message: "Not available." } };
  const result = await runOrgAction(orgSlug, "billing:manage", z.string().min(10), sessionId, async ({ actor }) => actor.orgId);
  if (!result.ok) return result;
  const { body, signature } = provider.sign({
    id: `evt_${sessionId}`,
    type: "subscription.activated",
    orgId: result.data,
    customerId: `fake_cus_${result.data.slice(0, 8)}`,
    subscriptionId: `fake_sub_${sessionId.slice(-8)}`,
  });
  await applyPaymentEvent("fake", provider.parseWebhook(body, signature));
  revalidatePath(`/app/${orgSlug}`, "layout");
  return { ok: true, data: undefined };
}
