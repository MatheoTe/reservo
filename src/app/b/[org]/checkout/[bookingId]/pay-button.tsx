"use client";

import { useAction } from "@/components/use-action";
import { Button } from "@/components/ui/button";
import { payFakeCheckoutAction } from "@/server/actions/public";

export function PayButton({ orgSlug, bookingId }: { orgSlug: string; bookingId: string }) {
  const { run, pending } = useAction();
  return (
    <Button size="lg" disabled={pending} onClick={() => run(() => payFakeCheckoutAction(orgSlug, bookingId))}>
      {pending ? "Processing..." : "Pay with test card 4242"}
    </Button>
  );
}
