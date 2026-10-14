"use client";

import { Check, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";

import { useAction } from "@/components/use-action";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { addHolidayAction, completeFakeUpgradeAction, startUpgradeAction, updateSettingsAction } from "@/server/actions/settings";

interface Settings {
  name: string;
  timeZone: string;
  slotIntervalMinutes: number;
  minNoticeMinutes: number;
  maxAdvanceDays: number;
}

export function SettingsForm({ orgSlug, initial }: { orgSlug: string; initial: Settings }) {
  const { run, pending, fieldErrors } = useAction({ success: "Settings saved" });
  return (
    <form
      className="grid gap-4"
      action={(fd) =>
        run(() =>
          updateSettingsAction(orgSlug, {
            name: fd.get("name"),
            timeZone: fd.get("timeZone"),
            slotIntervalMinutes: fd.get("slotIntervalMinutes"),
            minNoticeMinutes: Number(fd.get("minNoticeHours")) * 60,
            maxAdvanceDays: fd.get("maxAdvanceDays"),
          }),
        )
      }
    >
      <Field label="Business name" htmlFor="name" error={fieldErrors.name}>
        <Input id="name" name="name" defaultValue={initial.name} required />
      </Field>
      <Field label="Time zone (IANA)" htmlFor="timeZone" error={fieldErrors.timeZone} hint="e.g. America/Argentina/Buenos_Aires">
        <Input id="timeZone" name="timeZone" defaultValue={initial.timeZone} required />
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Slot interval (min)" htmlFor="slotIntervalMinutes" error={fieldErrors.slotIntervalMinutes}>
          <Input id="slotIntervalMinutes" name="slotIntervalMinutes" type="number" min={5} max={240} step={5} defaultValue={initial.slotIntervalMinutes} />
        </Field>
        <Field label="Minimum notice (h)" htmlFor="minNoticeHours" error={fieldErrors.minNoticeMinutes}>
          <Input id="minNoticeHours" name="minNoticeHours" type="number" min={0} max={336} step="0.5" defaultValue={initial.minNoticeMinutes / 60} />
        </Field>
        <Field label="Book up to (days)" htmlFor="maxAdvanceDays" error={fieldErrors.maxAdvanceDays}>
          <Input id="maxAdvanceDays" name="maxAdvanceDays" type="number" min={1} max={365} defaultValue={initial.maxAdvanceDays} />
        </Field>
      </div>
      <Button type="submit" className="justify-self-start" disabled={pending}>
        {pending ? "Saving..." : "Save changes"}
      </Button>
    </form>
  );
}

export function HolidayForm({ orgSlug }: { orgSlug: string }) {
  const { run, pending, fieldErrors } = useAction({ success: "Holiday added" });
  return (
    <form className="grid grid-cols-[1fr_auto] items-end gap-2" action={(fd) => run(() => addHolidayAction(orgSlug, { date: fd.get("date"), name: fd.get("name") }))}>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Date" htmlFor="holiday-date" error={fieldErrors.date}>
          <Input id="holiday-date" name="date" type="date" required />
        </Field>
        <Field label="Name" htmlFor="holiday-name" error={fieldErrors.name}>
          <Input id="holiday-name" name="name" placeholder="Bank holiday" required />
        </Field>
      </div>
      <Button type="submit" variant="outline" disabled={pending}>
        Add
      </Button>
    </form>
  );
}

export function BillingCard({
  orgSlug,
  plan,
  canManage,
  provider,
  fakeSession,
}: {
  orgSlug: string;
  plan: "free" | "pro";
  canManage: boolean;
  provider: "stripe" | "fake";
  fakeSession: string | null;
}) {
  const router = useRouter();
  const { run, pending } = useAction({
    success: "Welcome to Pro!",
    onSuccess: () => router.replace(`/app/${orgSlug}/settings`),
  });
  const upgrade = useAction();

  return (
    <Card className={plan === "pro" ? "border-primary/40" : undefined}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Plan <Badge variant={plan === "pro" ? "default" : "muted"}>{plan === "pro" ? "Pro" : "Free"}</Badge>
        </CardTitle>
        <CardDescription>
          {provider === "fake" ? "Payments run in local fake mode (no Stripe keys configured)." : "Billing is handled securely by Stripe."}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <ul className="grid gap-1.5 text-sm text-muted-foreground">
          {["Unlimited staff and services", "Deposits at booking", "Automated reminders"].map((f) => (
            <li key={f} className="flex items-center gap-2">
              <Check className="size-4 text-success" /> {f}
            </li>
          ))}
        </ul>
        {fakeSession && plan !== "pro" && canManage ? (
          <Button disabled={pending} onClick={() => run(() => completeFakeUpgradeAction(orgSlug, fakeSession))}>
            Confirm test subscription
          </Button>
        ) : plan === "free" && canManage ? (
          <Button disabled={upgrade.pending} onClick={() => upgrade.run(() => startUpgradeAction(orgSlug))}>
            <Sparkles /> Upgrade to Pro
          </Button>
        ) : null}
        {!canManage ? <p className="text-xs text-muted-foreground">Only owners can change the plan.</p> : null}
      </CardContent>
    </Card>
  );
}
