import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/misc";
import { formatDay, formatRangeLabel, localDateOf, localRange, parseDateParam, startOfWeek, todayIn, wallMinutes } from "@/lib/calendar";
import { cn } from "@/lib/utils";
import { getOrgContext, readInOrg } from "@/server/context";
import { formatTime } from "@/server/format";
import { type BookingRow, listBookings } from "@/server/services/bookings";
import { listStaff } from "@/server/services/catalog";

const HOUR_PX = 56;

interface Positioned {
  booking: BookingRow;
  top: number;
  height: number;
  lane: number;
  lanes: number;
}

/** Greedy lane assignment so overlapping bookings (different staff) sit side by side. */
function layoutDay(rows: BookingRow[], tz: string, startHour: number): Positioned[] {
  const items = rows
    .map((b) => {
      const start = wallMinutes(b.startsAt, tz);
      const end = Math.max(start + 15, localDateOf(b.endsAt, tz) === localDateOf(b.startsAt, tz) ? wallMinutes(b.endsAt, tz) : 24 * 60);
      return { booking: b, start, end };
    })
    .sort((a, b) => a.start - b.start);
  const laneEnds: number[] = [];
  const placed = items.map((it) => {
    let lane = laneEnds.findIndex((end) => end <= it.start);
    if (lane === -1) lane = laneEnds.push(it.end) - 1;
    else laneEnds[lane] = it.end;
    return { ...it, lane };
  });
  return placed.map((p) => ({
    booking: p.booking,
    top: ((p.start - startHour * 60) / 60) * HOUR_PX,
    height: Math.max(22, ((p.end - p.start) / 60) * HOUR_PX - 2),
    lane: p.lane,
    lanes: laneEnds.length,
  }));
}

export default async function CalendarPage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string }>;
  searchParams: Promise<{ week?: string; staff?: string }>;
}) {
  const { org: slug } = await params;
  const sp = await searchParams;
  const ctx = await getOrgContext(slug);
  const tz = ctx.org.timeZone;
  const weekStart = startOfWeek(parseDateParam(sp.week, tz));
  const days = Array.from({ length: 7 }, (_, i) => weekStart.add({ days: i }));
  const range = localRange(weekStart, 7, tz);
  const today = todayIn(tz).toString();

  const { bookings, staff } = await readInOrg(ctx, async (tx) => ({
    bookings: await listBookings(tx, { from: range.start, to: range.end, staffId: sp.staff, statuses: ["confirmed", "pending_payment"] }),
    staff: await listStaff(tx, { activeOnly: true }),
  }));

  const minutes = bookings.flatMap((b) => [wallMinutes(b.startsAt, tz), wallMinutes(b.endsAt, tz)]);
  const startHour = Math.min(8, ...minutes.map((m) => Math.floor(m / 60)));
  const endHour = Math.max(20, ...minutes.map((m) => Math.ceil(m / 60)));
  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i);

  const link = (overrides: { week?: string; staff?: string | null }) => {
    const q = new URLSearchParams();
    const week = overrides.week ?? weekStart.toString();
    q.set("week", week);
    const staffId = overrides.staff === undefined ? sp.staff : overrides.staff;
    if (staffId) q.set("staff", staffId);
    return `/app/${slug}/calendar?${q}`;
  };

  return (
    <>
      <PageHeader
        title="Calendar"
        description={`${formatRangeLabel(days[0]!, days[6]!)} · ${tz.replaceAll("_", " ")}`}
        actions={
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" asChild>
              <Link href={link({ week: weekStart.subtract({ days: 7 }).toString() })} aria-label="Previous week">
                <ChevronLeft />
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href={link({ week: today })}>Today</Link>
            </Button>
            <Button variant="outline" size="icon" asChild>
              <Link href={link({ week: weekStart.add({ days: 7 }).toString() })} aria-label="Next week">
                <ChevronRight />
              </Link>
            </Button>
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <Link
          href={link({ staff: null })}
          className={cn("rounded-full border px-3 py-1 text-sm", !sp.staff ? "border-primary bg-accent text-accent-foreground" : "bg-card hover:bg-muted")}
        >
          Everyone
        </Link>
        {staff.map((s) => (
          <Link
            key={s.id}
            href={link({ staff: s.id })}
            className={cn(
              "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm",
              sp.staff === s.id ? "border-primary bg-accent text-accent-foreground" : "bg-card hover:bg-muted",
            )}
          >
            <span className="size-2.5 rounded-full" style={{ backgroundColor: s.color }} />
            {s.displayName}
          </Link>
        ))}
      </div>

      <div className="overflow-x-auto rounded-xl border bg-card shadow-xs">
        <div className="grid min-w-[860px] grid-cols-[56px_repeat(7,1fr)]">
          <div className="border-b" />
          {days.map((d) => {
            const f = formatDay(d);
            const isToday = d.toString() === today;
            return (
              <div key={d.toString()} className="border-b border-l px-2 py-2 text-center">
                <p className="text-xs text-muted-foreground uppercase">{f.weekday}</p>
                <p className={cn("mx-auto mt-0.5 grid size-8 place-items-center rounded-full text-sm font-semibold", isToday && "bg-primary text-primary-foreground")}>
                  {f.day}
                </p>
              </div>
            );
          })}

          <div className="relative">
            {hours.map((h) => (
              <div key={h} style={{ height: HOUR_PX }} className="pr-2 text-right text-[11px] text-muted-foreground tabular-nums">
                <span className="relative -top-2">{String(h).padStart(2, "0")}:00</span>
              </div>
            ))}
          </div>

          {days.map((d) => {
            const dayBookings = bookings.filter((b) => localDateOf(b.startsAt, tz) === d.toString());
            return (
              <div key={d.toString()} className="relative border-l" style={{ height: hours.length * HOUR_PX }}>
                {hours.map((h) => (
                  <div key={h} style={{ top: (h - startHour) * HOUR_PX }} className="absolute inset-x-0 border-t border-border/60" />
                ))}
                {layoutDay(dayBookings, tz, startHour).map(({ booking: b, top, height, lane, lanes }) => (
                  <Link
                    key={b.id}
                    href={`/app/${slug}/bookings?focus=${b.id}`}
                    title={`${b.customerName} · ${b.serviceName} · ${b.staffName}`}
                    className={cn(
                      "absolute overflow-hidden rounded-md border-l-[3px] px-1.5 py-1 text-[11px] leading-tight shadow-xs transition-shadow hover:shadow-md",
                      b.status === "pending_payment" && "opacity-70 [background-image:repeating-linear-gradient(45deg,transparent_0_6px,rgb(0_0_0/0.04)_6px_12px)]",
                    )}
                    style={{
                      top,
                      height,
                      left: `calc(${(lane / lanes) * 100}% + 2px)`,
                      width: `calc(${100 / lanes}% - 4px)`,
                      borderLeftColor: b.staffColor,
                      backgroundColor: `color-mix(in oklch, ${b.staffColor} 14%, var(--card))`,
                    }}
                  >
                    <p className="truncate font-semibold">{b.customerName}</p>
                    <p className="truncate text-muted-foreground">
                      {formatTime(b.startsAt, tz)} · {b.serviceName}
                    </p>
                  </Link>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
