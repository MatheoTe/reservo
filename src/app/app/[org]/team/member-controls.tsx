"use client";

import { useState } from "react";

import { useAction } from "@/components/use-action";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input, NativeSelect } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { changeRoleAction, inviteMemberAction, removeMemberAction, revokeInvitationAction } from "@/server/actions/team";

type Role = "owner" | "admin" | "staff";

export function InviteForm({ orgSlug, canInviteAdmin }: { orgSlug: string; canInviteAdmin: boolean }) {
  const [email, setEmail] = useState("");
  const { run, pending, fieldErrors } = useAction({ success: "Invitation sent", onSuccess: () => setEmail("") });
  return (
    <form className="grid gap-3" action={(fd) => run(() => inviteMemberAction(orgSlug, { email: fd.get("email"), role: fd.get("role") }))}>
      <Field label="Email" htmlFor="invite-email" error={fieldErrors.email}>
        <Input id="invite-email" name="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field label="Role" htmlFor="invite-role">
        <NativeSelect id="invite-role" name="role" defaultValue="staff">
          <option value="staff">Staff - their own calendar and schedule</option>
          {canInviteAdmin ? <option value="admin">Admin - manage services, team and settings</option> : null}
        </NativeSelect>
      </Field>
      <Button type="submit" disabled={pending}>
        {pending ? "Sending..." : "Send invitation"}
      </Button>
    </form>
  );
}

export function RevokeInvite({ orgSlug, invitationId }: { orgSlug: string; invitationId: string }) {
  const { run, pending } = useAction({ success: "Invitation revoked" });
  return (
    <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(() => revokeInvitationAction(orgSlug, { invitationId }))}>
      Revoke
    </Button>
  );
}

export function MemberActions({ orgSlug, membershipId, name, role, assignable }: { orgSlug: string; membershipId: string; name: string; role: Role; assignable: Role[] }) {
  const [open, setOpen] = useState(false);
  const [next, setNext] = useState<Role>(role);
  const { run, pending } = useAction({ success: "Member updated", onSuccess: () => setOpen(false) });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          Manage
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Manage {name}</DialogTitle>
          <DialogDescription>Role changes take effect immediately and are recorded in the audit log.</DialogDescription>
        </DialogHeader>
        <Field label="Role" htmlFor="member-role">
          <NativeSelect id="member-role" value={next} onChange={(e) => setNext(e.target.value as Role)}>
            {assignable.map((r) => (
              <option key={r} value={r}>
                {r[0]!.toUpperCase() + r.slice(1)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <DialogFooter>
          <Button variant="ghost" className="mr-auto text-destructive" disabled={pending} onClick={() => run(() => removeMemberAction(orgSlug, { membershipId }))}>
            Remove from team
          </Button>
          <Button disabled={pending || next === role} onClick={() => run(() => changeRoleAction(orgSlug, { membershipId, role: next }))}>
            Save role
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
