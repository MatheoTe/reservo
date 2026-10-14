"use client";

import { Pencil, Plus } from "lucide-react";
import { useState } from "react";

import { useAction } from "@/components/use-action";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { archiveServiceAction, createServiceAction, updateServiceAction } from "@/server/actions/catalog";

interface ServiceValues {
  id: string;
  name: string;
  description: string;
  durationMinutes: number;
  priceCents: number;
  depositCents: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  staffIds: string[];
}

const toCents = (v: FormDataEntryValue | null) => Math.round(Number(v ?? 0) * 100);

export function ServiceDialog({
  orgSlug,
  staff,
  currency,
  service,
}: {
  orgSlug: string;
  staff: { id: string; name: string; color: string }[];
  currency: string;
  service?: ServiceValues;
}) {
  const [open, setOpen] = useState(false);
  const editing = Boolean(service);
  const { run, pending, fieldErrors } = useAction<unknown>({ success: editing ? "Service updated" : "Service created", onSuccess: () => setOpen(false) });

  function submit(fd: FormData) {
    const payload = {
      name: fd.get("name"),
      description: fd.get("description") || undefined,
      durationMinutes: fd.get("durationMinutes"),
      priceCents: toCents(fd.get("price")),
      depositCents: toCents(fd.get("deposit")),
      bufferBeforeMinutes: fd.get("bufferBeforeMinutes"),
      bufferAfterMinutes: fd.get("bufferAfterMinutes"),
      staffIds: fd.getAll("staffIds"),
    };
    run(() => (service ? updateServiceAction(orgSlug, { serviceId: service.id, service: payload }) : createServiceAction(orgSlug, payload)));
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {editing ? (
          <Button variant="ghost" size="sm">
            <Pencil /> Edit
          </Button>
        ) : (
          <Button>
            <Plus /> New service
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${service!.name}` : "New service"}</DialogTitle>
          <DialogDescription>Buffers block time before/after the appointment without showing it to customers.</DialogDescription>
        </DialogHeader>
        <form id={`service-${service?.id ?? "new"}`} action={submit} className="grid gap-4">
          <Field label="Name" htmlFor="name" error={fieldErrors.name}>
            <Input id="name" name="name" required defaultValue={service?.name} placeholder="Haircut & style" />
          </Field>
          <Field label="Description" htmlFor="description" error={fieldErrors.description}>
            <Textarea id="description" name="description" defaultValue={service?.description} maxLength={500} />
          </Field>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Field label="Duration (min)" htmlFor="durationMinutes" error={fieldErrors.durationMinutes}>
              <Input id="durationMinutes" name="durationMinutes" type="number" min={5} max={720} step={5} required defaultValue={service?.durationMinutes ?? 60} />
            </Field>
            <Field label={`Price (${currency.toUpperCase()})`} htmlFor="price" error={fieldErrors.priceCents}>
              <Input id="price" name="price" type="number" min={0} step="0.01" defaultValue={(service?.priceCents ?? 0) / 100} />
            </Field>
            <Field label="Deposit" htmlFor="deposit" error={fieldErrors.depositCents}>
              <Input id="deposit" name="deposit" type="number" min={0} step="0.01" defaultValue={(service?.depositCents ?? 0) / 100} />
            </Field>
            <Field label="Prep buffer (min)" htmlFor="bufferBeforeMinutes" error={fieldErrors.bufferBeforeMinutes}>
              <Input id="bufferBeforeMinutes" name="bufferBeforeMinutes" type="number" min={0} max={240} step={5} defaultValue={service?.bufferBeforeMinutes ?? 0} />
            </Field>
            <Field label="Cleanup buffer (min)" htmlFor="bufferAfterMinutes" error={fieldErrors.bufferAfterMinutes}>
              <Input id="bufferAfterMinutes" name="bufferAfterMinutes" type="number" min={0} max={240} step={5} defaultValue={service?.bufferAfterMinutes ?? 0} />
            </Field>
          </div>
          <fieldset className="grid gap-2">
            <legend className="text-sm font-medium">Who performs it</legend>
            <div className="flex flex-wrap gap-2">
              {staff.map((s) => (
                <label key={s.id} className="inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1 text-sm has-checked:border-primary has-checked:bg-accent">
                  <input type="checkbox" name="staffIds" value={s.id} defaultChecked={service ? service.staffIds.includes(s.id) : true} className="accent-[var(--primary)]" />
                  <span className="size-2 rounded-full" style={{ backgroundColor: s.color }} />
                  {s.name}
                </label>
              ))}
            </div>
          </fieldset>
        </form>
        <DialogFooter>
          {service ? (
            <Button
              variant="ghost"
              className="mr-auto text-destructive"
              disabled={pending}
              onClick={() => run(() => archiveServiceAction(orgSlug, { serviceId: service.id }))}
            >
              Archive
            </Button>
          ) : null}
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="submit" form={`service-${service?.id ?? "new"}`} disabled={pending}>
            {pending ? "Saving..." : "Save service"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
