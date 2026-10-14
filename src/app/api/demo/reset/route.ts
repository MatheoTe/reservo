import { NextResponse } from "next/server";

import { isAuthorizedCron } from "@/server/demo/cron-auth";
import { isDemoMode } from "@/server/demo/mode";
import { resetDemoData } from "@/server/demo/reset";

export const dynamic = "force-dynamic";
// Re-seeding goes through the real services: a few hundred small transactions.
export const maxDuration = 300;

/**
 * Nightly demo reset (Vercel Cron, see vercel.json): wipe everything and
 * re-seed. Requires DEMO_MODE=1 *and* the cron secret.
 */
async function handle(request: Request) {
  if (!isDemoMode()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!isAuthorizedCron(request))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const adminUrl = process.env.DATABASE_ADMIN_URL;
  if (!adminUrl)
    return NextResponse.json({ error: "DATABASE_ADMIN_URL is not set" }, { status: 500 });

  const started = Date.now();
  const result = await resetDemoData(adminUrl);
  console.info("[demo] reset", { ...result, ms: Date.now() - started });
  return NextResponse.json({ ok: true, ...result, ms: Date.now() - started });
}

export const GET = handle;
export const POST = handle;
