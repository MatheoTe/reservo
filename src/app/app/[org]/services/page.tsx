import { Clock, Scissors } from "lucide-react";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, EmptyState, PageHeader } from "@/components/ui/misc";
import { getOrgContext, readInOrg } from "@/server/context";
import { formatMoney } from "@/server/format";
import { listServices, listStaff } from "@/server/services/catalog";

import { ServiceDialog } from "./service-dialog";

export default async function ServicesPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const ctx = await getOrgContext(slug);
  if (!ctx.can("services:manage")) notFound();
  const { services, staff } = await readInOrg(ctx, async (tx) => ({
    services: await listServices(tx),
    staff: await listStaff(tx, { activeOnly: true }),
  }));
  const staffOptions = staff.map((s) => ({ id: s.id, name: s.displayName, color: s.color }));

  return (
    <>
      <PageHeader
        title="Services"
        description="What customers can book, how long it takes and what it costs."
        actions={<ServiceDialog orgSlug={slug} staff={staffOptions} currency={ctx.org.currency} />}
      />
      {services.length === 0 ? (
        <EmptyState
          icon={<Scissors />}
          title="No services yet"
          description="Add your first service to open your booking page."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {services.map((s) => (
            <Card key={s.id} className="flex flex-col">
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <CardTitle>{s.name}</CardTitle>
                  {s.depositCents > 0 ? (
                    <Badge variant="warning">
                      Deposit {formatMoney(s.depositCents, ctx.org.currency)}
                    </Badge>
                  ) : null}
                </div>
                {s.description ? (
                  <p className="text-muted-foreground line-clamp-2 text-sm">{s.description}</p>
                ) : null}
              </CardHeader>
              <CardContent className="mt-auto grid gap-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground inline-flex items-center gap-1.5">
                    <Clock className="size-4" /> {s.durationMinutes} min
                    {s.bufferAfterMinutes ? (
                      <span className="text-xs">(+{s.bufferAfterMinutes} cleanup)</span>
                    ) : null}
                  </span>
                  <span className="font-semibold tabular-nums">
                    {formatMoney(s.priceCents, ctx.org.currency)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex -space-x-2">
                    {staff
                      .filter((m) => s.staffIds.includes(m.id))
                      .map((m) => (
                        <Avatar
                          key={m.id}
                          name={m.displayName}
                          color={m.color}
                          className="ring-card size-7 ring-2"
                        />
                      ))}
                  </div>
                  <ServiceDialog
                    orgSlug={slug}
                    staff={staffOptions}
                    currency={ctx.org.currency}
                    service={{
                      id: s.id,
                      name: s.name,
                      description: s.description ?? "",
                      durationMinutes: s.durationMinutes,
                      priceCents: s.priceCents,
                      depositCents: s.depositCents,
                      bufferBeforeMinutes: s.bufferBeforeMinutes,
                      bufferAfterMinutes: s.bufferAfterMinutes,
                      staffIds: s.staffIds,
                    }}
                  />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
