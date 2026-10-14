import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { BookingStatusBadge } from "@/components/dashboard/booking-status";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar } from "@/components/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { AppError } from "@/server/errors";
import { getOrgContext, readInOrg } from "@/server/context";
import { formatDateTime, formatMoney } from "@/server/format";
import { getCustomer } from "@/server/services/customers";

import { CustomerNotes } from "./notes";

export default async function CustomerPage({
  params,
}: {
  params: Promise<{ org: string; id: string }>;
}) {
  const { org: slug, id } = await params;
  const ctx = await getOrgContext(slug);
  if (!ctx.can("customers:read") || !z.uuid().safeParse(id).success) notFound();
  const data = await readInOrg(ctx, (tx) => getCustomer(tx, id)).catch((err: unknown) => {
    if (err instanceof AppError && err.code === "NOT_FOUND") notFound();
    throw err;
  });
  const { customer, history } = data;

  return (
    <>
      <Link
        href={`/app/${slug}/customers`}
        className="text-muted-foreground hover:text-foreground mb-4 inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-4" /> Customers
      </Link>
      <div className="mb-6 flex items-center gap-4">
        <Avatar name={customer.name} className="size-12 text-base" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{customer.name}</h1>
          <p className="text-muted-foreground text-sm">
            {customer.email}
            {customer.phone ? ` · ${customer.phone}` : ""}
          </p>
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Booking history</CardTitle>
          </CardHeader>
          <Table>
            <THead>
              <TR>
                <TH>When</TH>
                <TH>Service</TH>
                <TH>Status</TH>
                <TH className="text-right">Price</TH>
              </TR>
            </THead>
            <TBody>
              {history.map((b) => (
                <TR key={b.id}>
                  <TD className="whitespace-nowrap">
                    {formatDateTime(b.startsAt, ctx.org.timeZone)}
                  </TD>
                  <TD>{b.serviceName}</TD>
                  <TD>
                    <BookingStatusBadge status={b.status} />
                  </TD>
                  <TD className="text-right tabular-nums">
                    {formatMoney(b.priceCents, ctx.org.currency)}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Private notes</CardTitle>
          </CardHeader>
          <CardContent>
            <CustomerNotes
              orgSlug={slug}
              customerId={customer.id}
              initial={customer.notes ?? ""}
              canEdit={ctx.can("customers:write")}
            />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
