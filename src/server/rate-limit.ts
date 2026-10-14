import { sql } from "drizzle-orm";

import { getDb } from "./db/client";
import { AppError } from "./errors";

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: Date;
}

export interface RateLimitRule {
  /** Max hits per window. */
  limit: number;
  windowSeconds: number;
}

export function windowStart(nowMs: number, windowSeconds: number): Date {
  const size = windowSeconds * 1000;
  return new Date(Math.floor(nowMs / size) * size);
}

/**
 * Fixed-window counter in Postgres. One atomic upsert per hit, shared by every
 * app instance (an in-memory limiter is useless behind a load balancer), and
 * no extra infrastructure. The trade-off vs. a sliding window is a possible 2x
 * burst at a window boundary, which is acceptable for abuse protection.
 */
export async function hitRateLimit(key: string, rule: RateLimitRule, nowMs = Date.now()): Promise<RateLimitResult> {
  const start = windowStart(nowMs, rule.windowSeconds);
  const rows = await getDb().execute<{ count: number }>(sql`
    insert into rate_limits (key, window_start, count)
    values (${key}, ${start.toISOString()}, 1)
    on conflict (key, window_start) do update set count = rate_limits.count + 1
    returning count
  `);
  const count = Number(rows[0]?.count ?? 1);
  return {
    allowed: count <= rule.limit,
    limit: rule.limit,
    remaining: Math.max(0, rule.limit - count),
    resetAt: new Date(start.getTime() + rule.windowSeconds * 1000),
  };
}

export async function enforceRateLimit(key: string, rule: RateLimitRule, nowMs = Date.now()): Promise<RateLimitResult> {
  const result = await hitRateLimit(key, rule, nowMs);
  if (!result.allowed) {
    throw new AppError("RATE_LIMITED", "Too many requests. Please wait a moment and try again.", {
      retryAfterSeconds: Math.max(1, Math.ceil((result.resetAt.getTime() - nowMs) / 1000)),
    });
  }
  return result;
}

/** Housekeeping, run by the worker. */
export async function purgeExpiredRateLimits(olderThan: Date): Promise<void> {
  await getDb().execute(sql`delete from rate_limits where window_start < ${olderThan.toISOString()}`);
}

export const RATE_LIMITS = {
  publicBooking: { limit: 5, windowSeconds: 10 * 60 },
  publicAvailability: { limit: 120, windowSeconds: 60 },
} satisfies Record<string, RateLimitRule>;
