import { CalendarPlus, Clock } from "lucide-react";
import Link from "next/link";

import { BookingStatusBadge } from "@/components/dashboard/booking-status";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, EmptyState, PageHeader, Stat } from "@/components/ui/misc";
import { localRange, startOfWeek, todayIn } from "@/lib/calendar";
import { getOrgContext, readInOrg } from "@/server/context";
import { formatMoney, formatTime } from "@/server/format";
import { listBookings } from "@/server/services/bookings";
import { listCustomers } from "@/server/services/customers";

export default async function OverviewPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const ctx = await getOrgContext(slug);
  const tz = ctx.org.timeZone;
  const today = todayIn(tz);
  const todayRange = localRange(today, 1, tz);
  const week = localRange(startOfWeek(today), 7, tz);
  const staffOnly = ctx.can("bookings:write:any") ? undefined : (ctx.staffId ?? undefined);

  const { todays, weekBookings, upcoming, customers } = await readInOrg(ctx, async (tx) => ({
    todays: await listBookings(tx, { from: todayRange.start, to: todayRange.end, staffId: staffOnly, statuses: ["confirmed", "pending_payment"] }),
    weekBookings: await listBookings(tx, { from: week.start, to: week.end, staffId: staffOnly, statuses: ["confirmed"] }),
    upcoming: await listBookings(tx, {
      from: new Date(),
      to: new Date(Date.now() + 14 * 86_400_000),
      staffId: staffOnly,
      statuses: ["confirmed", "pending_payment"],
      limit: 6,
    }),
    customers: ctx.can("customers:read") ? (await listCustomers(tx, { limit: 1000 })).length : null,
  }));

  const weekRevenue = weekBookings.reduce((sum, b) => sum + b.priceCents, 0);

  return (
    <>
      <PageHeader
        title={`Good to see you, ${ctx.user.name.split(" ")[0]}`}
        description={`Here's what's happening at ${ctx.org.name} today.`}
        actions={
          <Button asChild>
            <Link href={`/app/${slug}/bookings?new=1`}>
              <CalendarPlus /> New booking
            </Link>
          </Button>
        }
      />
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Appointments today" value={todays.length} />
        <Stat label="Booked this week" value={weekBookings.length} />
        <Stat label="Booked revenue this week" value={formatMoney(weekRevenue, ctx.org.currency)} hint="Confirmed bookings" />
        <Stat label="Customers" value={customers ?? "-"} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Today</CardTitle>
            <CardDescription>All times in {tz.replaceAll("_", " ")}</CardDescription>
          </CardHeader>
          <CardContent>
            {todays.length === 0 ? (
              <EmptyState icon={<Clock />} title="Nothing scheduled today" description="New bookings from your public page show up here instantly." />
            ) : (
              <ul className="grid gap-2">
                {todays.map((b) => (
                  <li key={b.id} className="flex items-center gap-3 rounded-lg border px-3 py-2.5">
                    <span className="w-24 text-sm font-medium tabular-nums">
                      {formatTime(b.startsAt, tz)}-{formatTime(b.endsAt, tz)}
                    </span>
                    <span className="h-8 w-1 rounded-full" style={{ backgroundColor: b.staffColor }} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{b.customerName}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {b.serviceName} · {b.staffName}
                      </p>
                    </div>
                    <BookingStatusBadge status={b.status} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Coming up</CardTitle>
            <CardDescription>Next two weeks</CardDescription>
          </CardHeader>
          <CardContent>
            {upcoming.length === 0 ? (
              <p className="text-sm text-muted-foreground">No upcoming bookings yet. Share your booking page to get started.</p>
            ) : (
              <ul className="grid gap-3">
                {upcoming.map((b) => (
                  <li key={b.id} className="flex items-center gap-3">
                    <Avatar name={b.customerName} color={b.staffColor} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{b.customerName}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {b.startsAt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: tz })} ·{" "}
                        {formatTime(b.startsAt, tz)} · {b.serviceName}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
