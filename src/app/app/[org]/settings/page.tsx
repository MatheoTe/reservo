import { desc, gte } from "drizzle-orm";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { auditLog, holidays } from "@/db/schema";
import { todayIn } from "@/lib/calendar";
import { getOrgContext, readInOrg } from "@/server/context";
import { formatDateTime } from "@/server/format";
import { getPaymentProvider } from "@/server/payments";

import { BillingCard, HolidayForm, SettingsForm } from "./settings-forms";

export default async function SettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string }>;
  searchParams: Promise<{ fake_subscription?: string; upgraded?: string }>;
}) {
  const { org: slug } = await params;
  const sp = await searchParams;
  const ctx = await getOrgContext(slug);
  if (!ctx.can("settings:manage")) notFound();
  const tz = ctx.org.timeZone;

  const { holidayRows, audit } = await readInOrg(ctx, async (tx) => ({
    holidayRows: await tx.select().from(holidays).where(gte(holidays.date, todayIn(tz).toString())).orderBy(holidays.date),
    audit: ctx.can("audit:read") ? await tx.select().from(auditLog).orderBy(desc(auditLog.id)).limit(25) : [],
  }));

  return (
    <>
      <PageHeader title="Settings" description="Business details, booking rules and billing." />
      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Business & booking rules</CardTitle>
            <CardDescription>Changes apply to new availability immediately.</CardDescription>
          </CardHeader>
          <CardContent>
            <SettingsForm
              orgSlug={slug}
              initial={{
                name: ctx.org.name,
                timeZone: tz,
                slotIntervalMinutes: ctx.org.slotIntervalMinutes,
                minNoticeMinutes: ctx.org.minNoticeMinutes,
                maxAdvanceDays: ctx.org.maxAdvanceDays,
              }}
            />
          </CardContent>
        </Card>
        <div className="grid content-start gap-6">
          <BillingCard
            orgSlug={slug}
            plan={ctx.org.plan}
            canManage={ctx.can("billing:manage")}
            provider={getPaymentProvider().name}
            fakeSession={sp.fake_subscription ?? null}
          />
          <Card>
            <CardHeader>
              <CardTitle>Holidays</CardTitle>
              <CardDescription>Closed for everyone on these dates.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              {holidayRows.map((h) => (
                <div key={h.date} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                  <span>{h.name}</span>
                  <Badge variant="outline">{h.date}</Badge>
                </div>
              ))}
              <HolidayForm orgSlug={slug} />
            </CardContent>
          </Card>
        </div>
      </div>

      {ctx.can("audit:read") ? (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Audit log</CardTitle>
            <CardDescription>Append-only record of sensitive actions. The application role cannot edit or delete it.</CardDescription>
          </CardHeader>
          <Table>
            <THead>
              <TR>
                <TH>When</TH>
                <TH>Action</TH>
                <TH>Target</TH>
                <TH>Details</TH>
              </TR>
            </THead>
            <TBody>
              {audit.map((a) => (
                <TR key={a.id}>
                  <TD className="whitespace-nowrap text-muted-foreground">{formatDateTime(a.createdAt, tz)}</TD>
                  <TD>
                    <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{a.action}</code>
                  </TD>
                  <TD className="text-muted-foreground">{a.targetType ?? "-"}</TD>
                  <TD className="max-w-xs truncate font-mono text-xs text-muted-foreground">{JSON.stringify(a.metadata)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      ) : null}
    </>
  );
}
