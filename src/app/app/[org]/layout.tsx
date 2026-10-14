import { getOrgContext } from "@/server/context";
import { listUserOrganizations } from "@/server/services/organizations";

import { Sidebar } from "@/components/dashboard/sidebar";

export default async function OrgLayout({ children, params }: { children: React.ReactNode; params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const ctx = await getOrgContext(slug);
  const orgs = await listUserOrganizations(ctx.user.id);

  return (
    <div className="min-h-dvh bg-muted/30 lg:grid lg:grid-cols-[248px_1fr]">
      <Sidebar
        org={{ slug: ctx.org.slug, name: ctx.org.name, plan: ctx.org.plan }}
        orgs={orgs.map((o) => ({ slug: o.slug, name: o.name }))}
        user={{ name: ctx.user.name, email: ctx.user.email }}
        role={ctx.role}
        permissions={{
          services: ctx.can("services:manage"),
          team: ctx.can("team:manage") || ctx.can("schedule:manage:own"),
          settings: ctx.can("settings:manage"),
          customers: ctx.can("customers:read"),
        }}
      />
      <main className="min-w-0 px-4 py-6 sm:px-8 lg:py-10">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
