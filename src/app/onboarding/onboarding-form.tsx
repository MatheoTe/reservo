"use client";

import { useState } from "react";

import { useAction } from "@/components/use-action";
import { useBrowserTimeZone, useTimeZoneList } from "@/components/use-browser-time-zone";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, NativeSelect } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { createOrganizationAction } from "@/server/actions/organizations";

const slugify = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

export function OnboardingForm({ firstName }: { firstName: string }) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const detectedZone = useBrowserTimeZone("UTC");
  const zones = useTimeZoneList();
  const [pickedZone, setPickedZone] = useState<string | null>(null);
  const timeZone = pickedZone ?? detectedZone;
  const { run, pending, fieldErrors } = useAction<{ slug: string }>();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Hi {firstName}, let&apos;s set up your business</CardTitle>
        <CardDescription>You can change all of this later in Settings.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-5"
          action={(fd) =>
            run(() =>
              createOrganizationAction({
                name: fd.get("name"),
                slug: fd.get("slug"),
                timeZone: fd.get("timeZone"),
                currency: fd.get("currency"),
              }),
            )
          }
        >
          <Field label="Business name" htmlFor="name" error={fieldErrors.name}>
            <Input
              id="name"
              name="name"
              required
              placeholder="Glow Studio"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (!slugTouched) setSlug(slugify(e.target.value));
              }}
            />
          </Field>
          <Field
            label="Booking page URL"
            htmlFor="slug"
            error={fieldErrors.slug}
            hint="Lowercase letters, numbers and dashes."
          >
            <div className="border-input bg-muted/50 text-muted-foreground flex items-center rounded-md border pl-3 text-sm shadow-xs">
              <span className="whitespace-nowrap">slotsmith.app/b/</span>
              <Input
                id="slug"
                name="slug"
                required
                className="border-0 shadow-none"
                value={slug}
                onChange={(e) => {
                  setSlugTouched(true);
                  setSlug(slugify(e.target.value));
                }}
              />
            </div>
          </Field>
          <div className="grid gap-5 sm:grid-cols-[1fr_120px]">
            <Field
              label="Time zone"
              htmlFor="timeZone"
              error={fieldErrors.timeZone}
              hint="Your opening hours are interpreted in this zone."
            >
              <NativeSelect
                id="timeZone"
                name="timeZone"
                value={timeZone}
                onChange={(e) => setPickedZone(e.target.value)}
              >
                {zones.map((z) => (
                  <option key={z} value={z}>
                    {z.replaceAll("_", " ")}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Currency" htmlFor="currency">
              <NativeSelect id="currency" name="currency" defaultValue="usd">
                {["usd", "eur", "gbp", "ars", "mxn"].map((c) => (
                  <option key={c} value={c}>
                    {c.toUpperCase()}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
          <Button type="submit" size="lg" disabled={pending}>
            {pending ? "Creating..." : "Create business"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
