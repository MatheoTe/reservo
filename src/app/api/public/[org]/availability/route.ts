import { NextResponse } from "next/server";

import { poolSlots } from "@/lib/availability";
import { availabilityQuerySchema } from "@/lib/validation";
import { orgIdBySlug, withTenant } from "@/server/db/tenant";
import { notFound } from "@/server/errors";
import { clientIp, errorResponse, parseOrThrow } from "@/server/http";
import { enforceRateLimit, RATE_LIMITS } from "@/server/rate-limit";
import { computeAvailability } from "@/server/services/availability";
import { loadOrg } from "@/server/services/bookings";

/**
 * GET /api/public/:org/availability?serviceId=&staffId=&from=YYYY-MM-DD&to=YYYY-MM-DD
 * Dates are in the organization's time zone; slots are returned as UTC ISO
 * instants so the client can render them in whatever zone the visitor wants.
 */
export async function GET(request: Request, { params }: { params: Promise<{ org: string }> }) {
  try {
    const { org: slug } = await params;
    await enforceRateLimit(
      `availability:${clientIp(request.headers)}`,
      RATE_LIMITS.publicAvailability,
    );
    const url = new URL(request.url);
    const query = parseOrThrow(availabilityQuerySchema, Object.fromEntries(url.searchParams));
    const orgId = await orgIdBySlug(slug);
    if (!orgId) throw notFound("Business");

    const result = await withTenant({ orgId }, async (tx) => {
      const org = await loadOrg(tx, orgId);
      const { slots, staff } = await computeAvailability(tx, { org, ...query, now: new Date() });
      return {
        timeZone: org.timeZone,
        slots: poolSlots(
          slots,
          staff.map((s) => s.id),
        ).map((s) => ({
          start: new Date(s.start).toISOString(),
          end: new Date(s.end).toISOString(),
          staffIds: s.staffIds,
        })),
      };
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
