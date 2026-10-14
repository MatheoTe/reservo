"use client";

import { CalendarPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { useAction } from "@/components/use-action";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { createDashboardBookingAction } from "@/server/actions/bookings";

interface Props {
  orgSlug: string;
  today: string;
  defaultOpen?: boolean;
  services: { id: string; name: string; durationMinutes: number; staffIds: string[] }[];
  staff: { id: string; name: string }[];
}

export function NewBookingDialog({ orgSlug, today, defaultOpen, services, staff }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(Boolean(defaultOpen));
  const [serviceId, setServiceId] = useState(services[0]?.id ?? "");
  const eligible = staff.filter((s) => services.find((x) => x.id === serviceId)?.staffIds.includes(s.id));
  const { run, pending, fieldErrors } = useAction<{ id: string }>({
    success: "Booking created",
    onSuccess: () => {
      setOpen(false);
      router.refresh();
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <CalendarPlus /> New booking
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New booking</DialogTitle>
          <DialogDescription>Availability rules still apply: hours, breaks, time off and existing bookings.</DialogDescription>
        </DialogHeader>
        {services.length === 0 ? (
          <p className="text-sm text-muted-foreground">Create a service first.</p>
        ) : (
          <form
            id="new-booking"
            className="grid gap-4"
            action={(fd) =>
              run(() =>
                createDashboardBookingAction(orgSlug, {
                  serviceId,
                  staffId: fd.get("staffId"),
                  date: fd.get("date"),
                  time: fd.get("time"),
                  customer: { name: fd.get("name"), email: fd.get("email"), phone: fd.get("phone") || undefined },
                  notes: fd.get("notes") || undefined,
                }),
              )
            }
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Service" htmlFor="serviceId">
                <NativeSelect id="serviceId" value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
                  {services.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.durationMinutes} min)
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Staff" htmlFor="staffId" error={fieldErrors.staffId}>
                <NativeSelect id="staffId" name="staffId" required>
                  {eligible.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Date" htmlFor="date" error={fieldErrors.date}>
                <Input id="date" name="date" type="date" min={today} defaultValue={today} required />
              </Field>
              <Field label="Start time" htmlFor="time" error={fieldErrors.time}>
                <Input id="time" name="time" type="time" step={300} defaultValue="10:00" required />
              </Field>
              <Field label="Customer name" htmlFor="name" error={fieldErrors["customer.name"]}>
                <Input id="name" name="name" required />
              </Field>
              <Field label="Customer email" htmlFor="email" error={fieldErrors["customer.email"]}>
                <Input id="email" name="email" type="email" required />
              </Field>
            </div>
            <Field label="Phone (optional)" htmlFor="phone">
              <Input id="phone" name="phone" type="tel" />
            </Field>
            <Field label="Notes (optional)" htmlFor="notes">
              <Textarea id="notes" name="notes" maxLength={1000} />
            </Field>
          </form>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Close
          </Button>
          <Button type="submit" form="new-booking" disabled={pending || services.length === 0}>
            {pending ? "Booking..." : "Create booking"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
