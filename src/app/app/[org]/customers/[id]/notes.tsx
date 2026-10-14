"use client";

import { useState } from "react";

import { useAction } from "@/components/use-action";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { updateCustomerNotesAction } from "@/server/actions/customers";

export function CustomerNotes({
  orgSlug,
  customerId,
  initial,
  canEdit,
}: {
  orgSlug: string;
  customerId: string;
  initial: string;
  canEdit: boolean;
}) {
  const [notes, setNotes] = useState(initial);
  const { run, pending } = useAction({ success: "Notes saved" });
  if (!canEdit)
    return (
      <p className="text-muted-foreground text-sm whitespace-pre-wrap">{initial || "No notes."}</p>
    );
  return (
    <div className="grid gap-3">
      <Textarea
        rows={6}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Allergies, preferences, anything useful..."
        maxLength={2000}
      />
      <Button
        className="justify-self-end"
        size="sm"
        disabled={pending || notes === initial}
        onClick={() => run(() => updateCustomerNotesAction(orgSlug, { customerId, notes }))}
      >
        Save notes
      </Button>
    </div>
  );
}
