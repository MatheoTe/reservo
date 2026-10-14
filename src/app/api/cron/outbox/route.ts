import { NextResponse } from "next/server";

import { isAuthorizedCron } from "@/server/demo/cron-auth";
import { drainOutbox } from "@/server/outbox/drain";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/cron/outbox - one worker tick for serverless deployments (no
 * long-running worker): expire stale holds, dead-letter exhausted messages,
 * deliver due messages. Protected by CRON_SECRET (Vercel Cron sends it).
 */
async function handle(request: Request) {
  if (!isAuthorizedCron(request))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const result = await drainOutbox();
  return NextResponse.json({ ok: true, ...result });
}

export const GET = handle;
export const POST = handle;
