import { and, eq, inArray } from "drizzle-orm";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { BookingWidget } from "@/components/booking/booking-widget";
import { Logo } from "@/components/brand/logo";
import { organizations, services, staffMembers, staffServices } from "@/db/schema";
import { orgIdBySlug, withTenant } from "@/server/db/tenant";

async function load(slug: string) {
  const orgId = await orgIdBySlug(slug);
  if (!orgId) return null;
  return withTenant({ orgId }, async (tx) => {
    const [org] = await tx.select().from(organizations).where(eq(organizations.id, orgId));
    const serviceRows = await tx
      .select()
      .from(services)
      .where(eq(services.active, true))
      .orderBy(services.name);
    const links = serviceRows.length
      ? await tx
          .select({
            serviceId: staffServices.serviceId,
            staffId: staffMembers.id,
            name: staffMembers.displayName,
            color: staffMembers.color,
          })
          .from(staffServices)
          .innerJoin(
            staffMembers,
            and(eq(staffMembers.id, staffServices.staffId), eq(staffMembers.active, true)),
          )
          .where(
            inArray(
              staffServices.serviceId,
              serviceRows.map((s) => s.id),
            ),
          )
      : [];
    return {
      org: org!,
      services: serviceRows
        .map((s) => ({
          id: s.id,
          name: s.name,
          description: s.description,
          durationMinutes: s.durationMinutes,
          priceCents: s.priceCents,
          depositCents: s.depositCents,
          staff: links
            .filter((l) => l.serviceId === s.id)
            .map((l) => ({ id: l.staffId, name: l.name, color: l.color })),
        }))
        .filter((s) => s.staff.length > 0),
    };
  });
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ org: string }>;
}): Promise<Metadata> {
  const data = await load((await params).org);
  return { title: data ? `Book with ${data.org.name}` : "Not found" };
}

export default async function PublicBookingPage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string }>;
  searchParams: Promise<{ cancelled?: string }>;
}) {
  const { org: slug } = await params;
  const data = await load(slug);
  if (!data) notFound();
  const { cancelled } = await searchParams;

  return (
    <div className="bg-muted/40 min-h-dvh">
      <div className="h-36 bg-[linear-gradient(120deg,var(--primary),color-mix(in_oklch,var(--primary)_55%,#ec4899))]" />
      <main className="mx-auto -mt-20 max-w-3xl px-4 pb-16">
        <div className="bg-card mb-6 rounded-xl border p-6 shadow-sm">
          <p className="text-muted-foreground text-sm">Book an appointment with</p>
          <h1 className="text-2xl font-semibold tracking-tight">{data.org.name}</h1>
        </div>
        {cancelled ? (
          <p className="border-warning/40 bg-warning/10 mb-4 rounded-lg border px-4 py-3 text-sm">
            Payment was cancelled, so your slot was not reserved.
          </p>
        ) : null}
        <BookingWidget
          orgSlug={slug}
          orgTimeZone={data.org.timeZone}
          currency={data.org.currency}
          services={data.services}
        />
        <div className="mt-10 flex justify-center opacity-70">
          <Logo className="text-sm" />
        </div>
      </main>
    </div>
  );
}
