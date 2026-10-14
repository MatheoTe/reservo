import { NextResponse } from "next/server";

import { publicBookingSchema } from "@/lib/validation";
import { AppError } from "@/server/errors";
import { clientIp, errorResponse, parseOrThrow } from "@/server/http";
import { drainOutboxAfterResponse } from "@/server/outbox/drain";
import { enforceRateLimit, RATE_LIMITS } from "@/server/rate-limit";
import { createPublicBooking } from "@/server/services/bookings";

/**
 * POST /api/public/:org/bookings
 * Public, unauthenticated: rate limited per IP and per IP+org, honeypot field,
 * strict zod validation, and SLOT_UNAVAILABLE (409) when someone else won.
 */
export async function POST(request: Request, { params }: { params: Promise<{ org: string }> }) {
  try {
    const { org: slug } = await params;
    const ip = clientIp(request.headers);
    await enforceRateLimit(`booking:${ip}:${slug}`, RATE_LIMITS.publicBooking);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new AppError("VALIDATION", "Request body must be JSON.");
    }
    const input = parseOrThrow(publicBookingSchema, body);
    const result = await createPublicBooking(slug, input);
    drainOutboxAfterResponse();
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
