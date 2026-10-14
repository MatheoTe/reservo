import { redirect } from "next/navigation";

import { requireUser } from "@/server/auth/session";
import { listUserOrganizations } from "@/server/services/organizations";

/** Post-login landing: first organization, or onboarding if there is none. */
export default async function AppIndex() {
  const user = await requireUser("/app");
  const orgs = await listUserOrganizations(user.id);
  redirect(orgs[0] ? `/app/${orgs[0].slug}` : "/onboarding");
}
