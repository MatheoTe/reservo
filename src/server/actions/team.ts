"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { changeRoleSchema, inviteSchema, scheduleSchema, timeOffSchema } from "@/lib/validation";

import { requireUserOrThrow } from "../auth/session";
import { listUserOrganizations } from "../services/organizations";
import { addTimeOff, replaceSchedule } from "../services/schedule";
import {
  acceptInvitation,
  changeRole,
  inviteMember,
  removeMember,
  revokeInvitation,
} from "../services/team";
import { type ActionResult, runOrgAction, toActionError } from "./run";

const revalidateTeam = (orgSlug: string) => revalidatePath(`/app/${orgSlug}/team`);

export async function inviteMemberAction(orgSlug: string, input: unknown): Promise<ActionResult> {
  const result = await runOrgAction(
    orgSlug,
    "team:manage",
    inviteSchema,
    input,
    async ({ tx, actor, input }) => {
      await inviteMember(tx, actor, input);
    },
  );
  if (result.ok) revalidateTeam(orgSlug);
  return result;
}

export async function revokeInvitationAction(
  orgSlug: string,
  input: unknown,
): Promise<ActionResult> {
  const result = await runOrgAction(
    orgSlug,
    "team:manage",
    z.object({ invitationId: z.uuid() }),
    input,
    async ({ tx, actor, input }) => {
      await revokeInvitation(tx, actor, input.invitationId);
    },
  );
  if (result.ok) revalidateTeam(orgSlug);
  return result;
}

export async function changeRoleAction(orgSlug: string, input: unknown): Promise<ActionResult> {
  const result = await runOrgAction(
    orgSlug,
    "team:manage",
    changeRoleSchema,
    input,
    async ({ tx, actor, input }) => {
      await changeRole(tx, actor, input);
    },
  );
  if (result.ok) revalidateTeam(orgSlug);
  return result;
}

export async function removeMemberAction(orgSlug: string, input: unknown): Promise<ActionResult> {
  const result = await runOrgAction(
    orgSlug,
    "team:manage",
    z.object({ membershipId: z.uuid() }),
    input,
    async ({ tx, actor, input }) => {
      await removeMember(tx, actor, input.membershipId);
    },
  );
  if (result.ok) revalidateTeam(orgSlug);
  return result;
}

// Fine-grained (own vs any) checks happen inside the service.
export async function saveScheduleAction(orgSlug: string, input: unknown): Promise<ActionResult> {
  const result = await runOrgAction(
    orgSlug,
    "schedule:manage:own",
    scheduleSchema,
    input,
    async ({ tx, actor, input }) => {
      await replaceSchedule(tx, actor, input);
    },
  );
  if (result.ok) revalidateTeam(orgSlug);
  return result;
}

export async function addTimeOffAction(orgSlug: string, input: unknown): Promise<ActionResult> {
  const result = await runOrgAction(
    orgSlug,
    "schedule:manage:own",
    timeOffSchema,
    input,
    async ({ tx, actor, input }) => {
      await addTimeOff(tx, actor, input);
    },
  );
  if (result.ok) revalidateTeam(orgSlug);
  return result;
}

export async function acceptInvitationAction(token: string): Promise<ActionResult> {
  let slug: string;
  try {
    const user = await requireUserOrThrow();
    const { orgId } = await acceptInvitation(z.string().min(20).max(100).parse(token), user);
    slug = (await listUserOrganizations(user.id)).find((o) => o.id === orgId)!.slug;
  } catch (err) {
    return toActionError(err);
  }
  redirect(`/app/${slug}`);
}
