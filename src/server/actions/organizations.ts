"use server";

import { redirect } from "next/navigation";

import { createOrganizationSchema } from "@/lib/validation";

import { requireUserOrThrow } from "../auth/session";
import { parseOrThrow } from "../http";
import { createOrganization } from "../services/organizations";
import { type ActionResult, toActionError } from "./run";

export async function createOrganizationAction(input: unknown): Promise<ActionResult<{ slug: string }>> {
  let slug: string;
  try {
    const user = await requireUserOrThrow();
    const data = parseOrThrow(createOrganizationSchema, input);
    ({ slug } = await createOrganization(user, data));
  } catch (err) {
    return toActionError(err);
  }
  redirect(`/app/${slug}`); // outside try: redirect() works by throwing
}
