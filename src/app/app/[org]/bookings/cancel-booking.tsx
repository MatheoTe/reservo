"use client";

import { useState } from "react";

import { useAction } from "@/components/use-action";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cancelBookingAction } from "@/server/actions/bookings";

export function CancelBookingButton({ orgSlug, bookingId, customerName }: { orgSlug: string; bookingId: string; customerName: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const { run, pending } = useAction({ success: "Booking cancelled. The customer will be notified.", onSuccess: () => setOpen(false) });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive">
          Cancel
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel this booking?</DialogTitle>
          <DialogDescription>{customerName} will receive a cancellation email. The slot becomes available immediately.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="reason">Reason (optional, internal)</Label>
          <Textarea id="reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Keep booking
          </Button>
          <Button variant="destructive" disabled={pending} onClick={() => run(() => cancelBookingAction(orgSlug, { bookingId, reason: reason || undefined }))}>
            {pending ? "Cancelling..." : "Cancel booking"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
