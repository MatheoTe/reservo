import { ClipboardList } from "lucide-react";
import Link from "next/link";

import { BookingStatusBadge } from "@/components/dashboard/booking-status";
import { Card } from "@/components/ui/card";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import type { BookingStatus } from "@/db/schema";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { todayIn } from "@/lib/calendar";
import { cn } from "@/lib/utils";
import { getOrgContext, type OrgContext, readInOrg } from "@/server/context";
import { formatMoney, formatTime } from "@/server/format";
import { listBookings } from "@/server/services/bookings";
import { listServices, listStaff } from "@/server/services/catalog";

import { CancelBookingButton } from "./cancel-booking";
import { NewBookingDialog } from "./new-booking";

const TABS = [
  { id: "upcoming", label: "Upcoming" },
  { id: "past", label: "Past" },
  { id: "cancelled", label: "Cancelled" },
] as const;

type Tab = (typeof TABS)[number]["id"];

async function loadBookings(ctx: OrgContext, tab: Tab, staffId: string | undefined) {
  const DAY = 86_400_000;
  const now = new Date();
  const window: Record<Tab, { from: Date; to: Date; statuses: BookingStatus[] }> = {
    upcoming: {
      from: now,
      to: new Date(now.getTime() + 365 * DAY),
      statuses: ["confirmed", "pending_payment"],
    },
    past: { from: new Date(now.getTime() - 365 * DAY), to: now, statuses: ["confirmed"] },
    cancelled: {
      from: new Date(now.getTime() - 365 * DAY),
      to: new Date(now.getTime() + 365 * DAY),
      statuses: ["cancelled", "expired"],
    },
  };
  return readInOrg(ctx, async (tx) => ({
    rows: await listBookings(tx, { ...window[tab], staffId }),
    services: await listServices(tx),
    staff: await listStaff(tx, { activeOnly: true }),
  }));
}

export default async function BookingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string }>;
  searchParams: Promise<{ tab?: string; focus?: string; new?: string }>;
}) {
  const { org: slug } = await params;
  const sp = await searchParams;
  const tab = TABS.find((t) => t.id === sp.tab)?.id ?? "upcoming";
  const ctx = await getOrgContext(slug);
  const tz = ctx.org.timeZone;
  const canAny = ctx.can("bookings:write:any");
  const staffFilter = canAny ? undefined : (ctx.staffId ?? undefined);

  const { rows, services, staff } = await loadBookings(ctx, tab, staffFilter);
  const ordered = tab === "upcoming" ? rows : rows.toReversed();

  return (
    <>
      <PageHeader
        title="Bookings"
        description={`Times shown in ${tz.replaceAll("_", " ")}`}
        actions={
          <NewBookingDialog
            orgSlug={slug}
            defaultOpen={sp.new === "1"}
            today={todayIn(tz).toString()}
            services={services.map((s) => ({
              id: s.id,
              name: s.name,
              durationMinutes: s.durationMinutes,
              staffIds: s.staffIds,
            }))}
            staff={staff
              .filter((s) => canAny || s.id === ctx.staffId)
              .map((s) => ({ id: s.id, name: s.displayName }))}
          />
        }
      />
      <div className="bg-card mb-4 inline-flex rounded-lg border p-1 shadow-xs">
        {TABS.map((t) => (
          <Link
            key={t.id}
            href={`/app/${slug}/bookings?tab=${t.id}`}
            className={cn(
              "text-muted-foreground rounded-md px-3 py-1.5 text-sm font-medium",
              tab === t.id && "bg-accent text-accent-foreground",
            )}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {ordered.length === 0 ? (
        <EmptyState
          icon={<ClipboardList />}
          title={`No ${tab} bookings`}
          description="Bookings made on your public page or by your team appear here."
        />
      ) : (
        <Card>
          <Table>
            <THead>
              <TR>
                <TH>When</TH>
                <TH>Customer</TH>
                <TH>Service</TH>
                <TH>Staff</TH>
                <TH>Status</TH>
                <TH className="text-right">Price</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {ordered.map((b) => {
                const canCancel =
                  (canAny || b.staffId === ctx.staffId) &&
                  (b.status === "confirmed" || b.status === "pending_payment");
                return (
                  <TR key={b.id} id={b.id} className={cn(sp.focus === b.id && "bg-accent/60")}>
                    <TD className="whitespace-nowrap">
                      <p className="font-medium">
                        {b.startsAt.toLocaleDateString("en-US", {
                          weekday: "short",
                          month: "short",
                          day: "numeric",
                          timeZone: tz,
                        })}
                      </p>
                      <p className="text-muted-foreground text-xs tabular-nums">
                        {formatTime(b.startsAt, tz)}-{formatTime(b.endsAt, tz)}
                      </p>
                    </TD>
                    <TD>
                      <Link
                        href={`/app/${slug}/customers/${b.customerId}`}
                        className="font-medium hover:underline"
                      >
                        {b.customerName}
                      </Link>
                      <p className="text-muted-foreground text-xs">{b.customerEmail}</p>
                    </TD>
                    <TD>{b.serviceName}</TD>
                    <TD>
                      <span className="inline-flex items-center gap-2">
                        <span
                          className="size-2.5 rounded-full"
                          style={{ backgroundColor: b.staffColor }}
                        />
                        {b.staffName}
                      </span>
                    </TD>
                    <TD>
                      <BookingStatusBadge status={b.status} />
                    </TD>
                    <TD className="text-right tabular-nums">
                      {formatMoney(b.priceCents, ctx.org.currency)}
                    </TD>
                    <TD className="text-right">
                      {canCancel ? (
                        <CancelBookingButton
                          orgSlug={slug}
                          bookingId={b.id}
                          customerName={b.customerName}
                        />
                      ) : null}
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </Card>
      )}
    </>
  );
}
