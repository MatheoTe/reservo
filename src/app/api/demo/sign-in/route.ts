import { NextResponse } from "next/server";

import { getAuth } from "@/server/auth/auth";
import { DEMO_ORG_SLUG, DEMO_OWNER_EMAIL, DEMO_PASSWORD, isDemoMode } from "@/server/demo/mode";
import { AppError } from "@/server/errors";
import { clientIp } from "@/server/http";
import { enforceRateLimit } from "@/server/rate-limit";

export const dynamic = "force-dynamic";

/**
 * POST /api/demo/sign-in - "Try the demo" button. Only exists with
 * DEMO_MODE=1: the session for the seeded owner is created here, on the
 * server, so visitors never type (or see) a password. A plain form POST, not
 * a link, so prefetchers and crawlers don't mint sessions.
 */
export async function POST(request: Request) {
  if (!isDemoMode()) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const back = (reason: string) =>
    NextResponse.redirect(new URL(`/sign-in?demo=${reason}`, request.url), 303);
  try {
    await enforceRateLimit(`demo-sign-in:${clientIp(request.headers)}`, {
      limit: 20,
      windowSeconds: 600,
    });
    const auth = await getAuth().api.signInEmail({
      body: { email: DEMO_OWNER_EMAIL, password: DEMO_PASSWORD },
      headers: request.headers,
      asResponse: true,
    });
    if (!auth.ok) return back("unavailable");

    const response = NextResponse.redirect(new URL(`/app/${DEMO_ORG_SLUG}`, request.url), 303);
    for (const cookie of auth.headers.getSetCookie()) response.headers.append("set-cookie", cookie);
    return response;
  } catch (err) {
    if (err instanceof AppError && err.code === "RATE_LIMITED") return back("busy");
    console.error("[demo] sign-in failed", err);
    return back("unavailable");
  }
}
