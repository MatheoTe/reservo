import { timingSafeEqual } from "node:crypto";

/**
 * Vercel Cron calls with `Authorization: Bearer $CRON_SECRET`. Without a
 * configured secret every call is rejected: these endpoints fail closed.
 */
export function isAuthorizedCron(request: Request, secret = process.env.CRON_SECRET): boolean {
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
