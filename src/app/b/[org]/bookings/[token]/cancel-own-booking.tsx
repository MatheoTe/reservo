"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { useAction } from "@/components/use-action";
import { Button } from "@/components/ui/button";
import { cancelPublicBookingAction } from "@/server/actions/public";

export function CancelOwnBooking({ orgSlug, token }: { orgSlug: string; token: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const { run, pending } = useAction({ success: "Your booking was cancelled.", onSuccess: () => router.refresh() });
  if (!confirming) {
    return (
      <Button variant="outline" onClick={() => setConfirming(true)}>
        Cancel booking
      </Button>
    );
  }
  return (
    <div className="grid gap-2">
      <p className="text-sm text-muted-foreground">Are you sure? This can&apos;t be undone.</p>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" onClick={() => setConfirming(false)}>
          Keep it
        </Button>
        <Button variant="destructive" disabled={pending} onClick={() => run(() => cancelPublicBookingAction(orgSlug, token))}>
          Yes, cancel
        </Button>
      </div>
    </div>
  );
}
