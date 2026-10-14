import { sql } from "drizzle-orm";
import type { Metadata } from "next";

import { Logo } from "@/components/brand/logo";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { hashToken } from "@/server/services/team";

import { AcceptInvite } from "./accept-invite";

export const metadata: Metadata = { title: "Join a team" };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const user = await requireUser(`/invite/${token}`);
  const rows = await getDb().execute<{ org_id: string | null }>(sql`select app.invitation_org_id(${hashToken(token)}) as org_id`);
  const valid = Boolean(rows[0]?.org_id);

  return (
    <div className="grid min-h-dvh place-items-center bg-muted/40 px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>
        <Card>
          <CardHeader>
            <CardTitle>{valid ? "You've been invited" : "Invitation unavailable"}</CardTitle>
            <CardDescription>
              {valid
                ? `Accept to join the team as ${user.email}.`
                : "This link is invalid, expired, or was already used. Ask your admin for a new one."}
            </CardDescription>
          </CardHeader>
          {valid ? (
            <CardContent>
              <AcceptInvite token={token} />
            </CardContent>
          ) : null}
        </Card>
      </div>
    </div>
  );
}
