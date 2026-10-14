import { Search, UserRound } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Avatar, EmptyState, PageHeader } from "@/components/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { getOrgContext, readInOrg } from "@/server/context";
import { listCustomers } from "@/server/services/customers";

export default async function CustomersPage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { org: slug } = await params;
  const { q } = await searchParams;
  const ctx = await getOrgContext(slug);
  if (!ctx.can("customers:read")) notFound();
  const customers = await readInOrg(ctx, (tx) => listCustomers(tx, { search: q?.slice(0, 100) }));

  return (
    <>
      <PageHeader title="Customers" description="Everyone who has booked with you." />
      <form className="relative mb-4 max-w-sm">
        <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
        <Input
          name="q"
          defaultValue={q}
          placeholder="Search by name or email"
          className="pl-9"
          aria-label="Search customers"
        />
      </form>
      {customers.length === 0 ? (
        <EmptyState
          icon={<UserRound />}
          title={q ? "No matches" : "No customers yet"}
          description="Customers are created automatically when they book."
        />
      ) : (
        <Card>
          <Table>
            <THead>
              <TR>
                <TH>Name</TH>
                <TH>Phone</TH>
                <TH className="text-right">Visits</TH>
                <TH className="text-right">Last visit</TH>
              </TR>
            </THead>
            <TBody>
              {customers.map((c) => (
                <TR key={c.id}>
                  <TD>
                    <Link
                      href={`/app/${slug}/customers/${c.id}`}
                      className="flex items-center gap-3"
                    >
                      <Avatar name={c.name} />
                      <span>
                        <span className="block font-medium hover:underline">{c.name}</span>
                        <span className="text-muted-foreground block text-xs">{c.email}</span>
                      </span>
                    </Link>
                  </TD>
                  <TD className="text-muted-foreground">{c.phone ?? "-"}</TD>
                  <TD className="text-right tabular-nums">{c.visits}</TD>
                  <TD className="text-muted-foreground text-right">
                    {c.lastVisit
                      ? new Date(c.lastVisit).toLocaleDateString("en-US", {
                          dateStyle: "medium",
                          timeZone: ctx.org.timeZone,
                        })
                      : "-"}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}
    </>
  );
}
