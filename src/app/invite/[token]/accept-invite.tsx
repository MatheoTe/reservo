"use client";

import { useAction } from "@/components/use-action";
import { Button } from "@/components/ui/button";
import { acceptInvitationAction } from "@/server/actions/team";

export function AcceptInvite({ token }: { token: string }) {
  const { run, pending } = useAction();
  return (
    <Button
      className="w-full"
      disabled={pending}
      onClick={() => run(() => acceptInvitationAction(token))}
    >
      {pending ? "Joining..." : "Accept invitation"}
    </Button>
  );
}
