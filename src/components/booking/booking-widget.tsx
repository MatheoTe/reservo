"use client";

import {
  ArrowLeft,
  CalendarX2,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Globe2,
  Loader2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Temporal } from "temporal-polyfill";

import { useBrowserTimeZone } from "@/components/use-browser-time-zone";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Avatar } from "@/components/ui/misc";
import { groupByLocalDate, localTime } from "@/lib/availability/display";
import { cn } from "@/lib/utils";

interface StaffOption {
  id: string;
  name: string;
  color: string;
}

interface ServiceOption {
  id: string;
  name: string;
  description: string | null;
  durationMinutes: number;
  priceCents: number;
  depositCents: number;
  staff: StaffOption[];
}

interface ApiSlot {
  start: string;
  end: string;
  staffIds: string[];
}

const WINDOW_DAYS = 14;

function money(cents: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

export function BookingWidget({
  orgSlug,
  orgTimeZone,
  currency,
  services,
}: {
  orgSlug: string;
  orgTimeZone: string;
  currency: string;
  services: ServiceOption[];
}) {
  const router = useRouter();
  const [serviceId, setServiceId] = useState<string | null>(
    services.length === 1 ? services[0]!.id : null,
  );
  const [staffId, setStaffId] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [reloadCount, setReloadCount] = useState(0);
  const [result, setResult] = useState<{ key: string; slots: ApiSlot[] } | null>(null);
  const [pickedDate, setPickedDate] = useState<string | null>(null);
  const [selected, setSelected] = useState<ApiSlot | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  /** What the customer typed, kept across a slot conflict so they don't retype it. */
  const [draft, setDraft] = useState<Record<string, string>>({});
  const viewerZone = useBrowserTimeZone(orgTimeZone);
  const [useOrgZone, setUseOrgZone] = useState(false);

  const displayZone = useOrgZone ? orgTimeZone : viewerZone;
  // Browsers report CLDR-canonical ids ("America/Buenos_Aires") while the org may
  // store the IANA alias ("America/Argentina/Buenos_Aires"): compare canonical forms.
  const zonesDiffer = canonicalZone(viewerZone) !== canonicalZone(orgTimeZone);
  const service = services.find((s) => s.id === serviceId) ?? null;

  const range = useMemo(() => {
    const from = Temporal.Now.plainDateISO(orgTimeZone).add({ days: offset });
    return { from: from.toString(), to: from.add({ days: WINDOW_DAYS - 1 }).toString() };
  }, [offset, orgTimeZone]);

  const queryKey = serviceId
    ? `${serviceId}|${staffId ?? "any"}|${range.from}|${range.to}|${reloadCount}`
    : null;

  useEffect(() => {
    if (!serviceId || !queryKey) return;
    const controller = new AbortController();
    const q = new URLSearchParams({ serviceId, from: range.from, to: range.to });
    if (staffId) q.set("staffId", staffId);
    fetch(`/api/public/${orgSlug}/availability?${q}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error?.message ?? "Couldn't load availability");
        setResult({ key: queryKey, slots: body.slots });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        toast.error(err instanceof Error ? err.message : "Couldn't load availability");
        setResult({ key: queryKey, slots: [] });
      });
    return () => controller.abort();
  }, [orgSlug, queryKey, range, serviceId, staffId]);

  // Stale results (from a previous service/staff/week) are never shown.
  const slots = result && result.key === queryKey ? result.slots : null;
  const loading = Boolean(serviceId) && slots === null;

  // Group by calendar day *in the zone the visitor is reading*, not the org's.
  const days = useMemo(
    () =>
      groupByLocalDate(
        (slots ?? []).map((s) => ({ ...s, iso: s.start, start: Date.parse(s.start) })),
        displayZone,
      ),
    [slots, displayZone],
  );
  const selectedDate = days.some((d) => d.date === pickedDate)
    ? pickedDate
    : (days[0]?.date ?? null);
  const daySlots = days.find((d) => d.date === selectedDate)?.items ?? [];

  function resetSelection() {
    setSelected(null);
    setPickedDate(null);
  }

  async function submit(fd: FormData) {
    if (!service || !selected) return;
    const values = Object.fromEntries([...fd.entries()].map(([k, v]) => [k, String(v)]));
    setDraft(values);
    setSubmitting(true);
    setFieldErrors({});
    try {
      const res = await fetch(`/api/public/${orgSlug}/bookings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serviceId: service.id,
          staffId,
          start: selected.start,
          customerTimeZone: viewerZone,
          customer: { name: values.name, email: values.email, phone: values.phone || undefined },
          notes: values.notes || undefined,
          website: values.website || undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        const code = body.error?.code;
        if (code === "SLOT_UNAVAILABLE") {
          // Someone else won the race between viewing and confirming. Explain,
          // refresh availability, and keep what the customer already typed.
          toast.error("That time was just booked by someone else. Please pick another one.");
          setSelected(null);
          setReloadCount((n) => n + 1);
          return;
        }
        if (code === "VALIDATION") setFieldErrors(body.error.fieldErrors ?? {});
        toast.error(body.error?.message ?? "Booking failed. Please try again.");
        return;
      }
      if (body.checkoutUrl) {
        window.location.assign(body.checkoutUrl);
        return;
      }
      router.push(`/b/${orgSlug}/bookings/${body.accessToken}?new=1`);
    } finally {
      setSubmitting(false);
    }
  }

  if (services.length === 0) {
    return (
      <div className="bg-card rounded-xl border p-10 text-center shadow-sm">
        <CalendarX2 className="text-muted-foreground mx-auto mb-3 size-6" />
        <p className="font-medium">Online booking isn&apos;t open yet</p>
        <p className="text-muted-foreground mt-1 text-sm">Please check back soon.</p>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      {/* Step 1: service */}
      <section className="bg-card rounded-xl border p-5 shadow-sm" aria-labelledby="step-service">
        <h2
          id="step-service"
          className="text-muted-foreground mb-3 text-sm font-semibold tracking-wide uppercase"
        >
          1. Choose a service
        </h2>
        <div className="grid gap-2 sm:grid-cols-2">
          {services.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                setServiceId(s.id);
                setStaffId(null);
                setOffset(0);
                resetSelection();
              }}
              aria-pressed={serviceId === s.id}
              className={cn(
                "hover:border-primary/60 rounded-lg border p-4 text-left transition-colors",
                serviceId === s.id && "border-primary bg-accent/60 ring-primary ring-1",
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <p className="font-medium">{s.name}</p>
                <p className="font-semibold tabular-nums">{money(s.priceCents, currency)}</p>
              </div>
              <p className="text-muted-foreground mt-1 flex items-center gap-1.5 text-sm">
                <Clock className="size-3.5" /> {s.durationMinutes} min
                {s.depositCents > 0 ? (
                  <span>· {money(s.depositCents, currency)} deposit</span>
                ) : null}
              </p>
              {s.description ? (
                <p className="text-muted-foreground mt-2 line-clamp-2 text-sm">{s.description}</p>
              ) : null}
            </button>
          ))}
        </div>
      </section>

      {service ? (
        <section className="bg-card rounded-xl border p-5 shadow-sm" aria-labelledby="step-time">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2
              id="step-time"
              className="text-muted-foreground text-sm font-semibold tracking-wide uppercase"
            >
              2. Pick a time
            </h2>
            {zonesDiffer ? (
              <button
                type="button"
                onClick={() => setUseOrgZone((v) => !v)}
                className="hover:bg-muted inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs"
              >
                <Globe2 className="size-3.5" />
                Showing {useOrgZone ? "business" : "your"} time ({displayZone.replaceAll("_", " ")})
                · switch
              </button>
            ) : (
              <span className="text-muted-foreground inline-flex items-center gap-1.5 text-xs">
                <Globe2 className="size-3.5" /> {displayZone.replaceAll("_", " ")}
              </span>
            )}
          </div>

          {service.staff.length > 1 ? (
            <div className="mb-4 flex flex-wrap gap-2" role="radiogroup" aria-label="Staff">
              <StaffChip
                active={staffId === null}
                onClick={() => {
                  setStaffId(null);
                  resetSelection();
                }}
                label="Any available"
              />
              {service.staff.map((m) => (
                <StaffChip
                  key={m.id}
                  active={staffId === m.id}
                  onClick={() => {
                    setStaffId(m.id);
                    resetSelection();
                  }}
                  label={m.name}
                  color={m.color}
                />
              ))}
            </div>
          ) : null}

          <div className="mb-4 flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              aria-label="Earlier dates"
              disabled={offset === 0 || loading}
              onClick={() => {
                setOffset((o) => Math.max(0, o - WINDOW_DAYS));
                resetSelection();
              }}
            >
              <ChevronLeft />
            </Button>
            <div
              className="flex flex-1 gap-2 overflow-x-auto pb-1"
              role="tablist"
              aria-label="Dates"
            >
              {loading && !slots ? (
                <div className="text-muted-foreground flex h-16 items-center gap-2 text-sm">
                  <Loader2 className="size-4 animate-spin" /> Checking availability...
                </div>
              ) : days.length === 0 ? (
                <p className="text-muted-foreground py-4 text-sm">
                  No availability in these two weeks.
                </p>
              ) : (
                days.map((d) => {
                  const date = Temporal.PlainDate.from(d.date);
                  const js = new Date(Date.UTC(date.year, date.month - 1, date.day));
                  return (
                    <button
                      key={d.date}
                      role="tab"
                      aria-selected={selectedDate === d.date}
                      onClick={() => setPickedDate(d.date)}
                      className={cn(
                        "hover:border-primary/60 flex min-w-16 flex-col items-center rounded-lg border px-3 py-2 text-sm",
                        selectedDate === d.date &&
                          "border-primary bg-primary text-primary-foreground hover:border-primary",
                      )}
                    >
                      <span className="text-xs uppercase opacity-80">
                        {js.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" })}
                      </span>
                      <span className="text-lg font-semibold">{date.day}</span>
                      <span className="text-[11px] opacity-80">
                        {js.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" })}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
            <Button
              variant="outline"
              size="icon"
              aria-label="Later dates"
              disabled={loading}
              onClick={() => {
                setOffset((o) => o + WINDOW_DAYS);
                resetSelection();
              }}
            >
              <ChevronRight />
            </Button>
          </div>

          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5" aria-live="polite">
            {daySlots.map((s) => (
              <button
                key={s.iso}
                type="button"
                data-testid="slot"
                onClick={() => setSelected({ start: s.iso, end: s.end, staffIds: s.staffIds })}
                className={cn(
                  "hover:border-primary hover:text-primary rounded-md border py-2 text-sm font-medium tabular-nums transition-colors",
                  selected?.start === s.iso &&
                    "border-primary bg-primary text-primary-foreground hover:text-primary-foreground",
                )}
              >
                {localTime(s.start, displayZone)}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {service && selected ? (
        <section className="bg-card rounded-xl border p-5 shadow-sm" aria-labelledby="step-details">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2
                id="step-details"
                className="text-muted-foreground text-sm font-semibold tracking-wide uppercase"
              >
                3. Your details
              </h2>
              <p className="mt-1 text-sm">
                <span className="font-medium">{service.name}</span> ·{" "}
                {new Date(selected.start).toLocaleString("en-US", {
                  dateStyle: "full",
                  timeStyle: "short",
                  timeZone: displayZone,
                })}
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>
              <ArrowLeft /> Change
            </Button>
          </div>
          <form action={submit} className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Full name" htmlFor="name" error={fieldErrors["customer.name"]}>
                <Input
                  id="name"
                  name="name"
                  autoComplete="name"
                  required
                  minLength={2}
                  defaultValue={draft.name}
                />
              </Field>
              <Field
                label="Email"
                htmlFor="email"
                error={fieldErrors["customer.email"]}
                hint="We'll send your confirmation here."
              >
                <Input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  defaultValue={draft.email}
                />
              </Field>
            </div>
            <Field label="Phone (optional)" htmlFor="phone" error={fieldErrors["customer.phone"]}>
              <Input
                id="phone"
                name="phone"
                type="tel"
                autoComplete="tel"
                defaultValue={draft.phone}
              />
            </Field>
            <Field label="Anything we should know? (optional)" htmlFor="notes">
              <Textarea id="notes" name="notes" maxLength={1000} defaultValue={draft.notes} />
            </Field>
            {/* Honeypot: hidden from humans, irresistible to naive bots. */}
            <input
              type="text"
              name="website"
              tabIndex={-1}
              autoComplete="off"
              aria-hidden
              className="hidden"
            />
            <Button type="submit" size="lg" disabled={submitting}>
              {submitting ? (
                <>
                  <Loader2 className="animate-spin" /> Booking...
                </>
              ) : service.depositCents > 0 ? (
                `Continue to pay ${money(service.depositCents, currency)} deposit`
              ) : (
                <>
                  <Check /> Confirm booking
                </>
              )}
            </Button>
          </form>
        </section>
      ) : null}
    </div>
  );
}

function canonicalZone(timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone }).resolvedOptions().timeZone;
  } catch {
    return timeZone;
  }
}

function StaffChip({
  active,
  onClick,
  label,
  color,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  color?: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={cn(
        "hover:bg-muted inline-flex items-center gap-2 rounded-full border py-1 pr-3 pl-1 text-sm",
        active && "border-primary bg-accent",
        !color && "pl-3",
      )}
    >
      {color ? <Avatar name={label} color={color} className="size-6 text-[10px]" /> : null}
      {label}
    </button>
  );
}
