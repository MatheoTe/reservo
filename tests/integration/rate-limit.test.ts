import { describe, expect, it } from "vitest";

import { AppError } from "@/server/errors";
import { enforceRateLimit, hitRateLimit, windowStart } from "@/server/rate-limit";

import { useCleanDatabase } from "./helpers";

describe("rate limiting (Postgres fixed window)", () => {
  useCleanDatabase();
  const rule = { limit: 3, windowSeconds: 60 };
  const now = Date.parse("2026-10-14T12:00:30Z");

  it("allows up to the limit and then rejects with Retry-After", async () => {
    for (let i = 0; i < 3; i++) await expect(enforceRateLimit("ip:1", rule, now)).resolves.toMatchObject({ allowed: true });
    const err = await enforceRateLimit("ip:1", rule, now).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({ code: "RATE_LIMITED", retryAfterSeconds: 30 });
  });

  it("keys are independent", async () => {
    for (let i = 0; i < 3; i++) await hitRateLimit("ip:1", rule, now);
    await expect(hitRateLimit("ip:2", rule, now)).resolves.toMatchObject({ allowed: true, remaining: 2 });
  });

  it("a new window starts fresh", async () => {
    for (let i = 0; i < 4; i++) await hitRateLimit("ip:1", rule, now);
    await expect(hitRateLimit("ip:1", rule, now + 60_000)).resolves.toMatchObject({ allowed: true });
  });

  it("is exact under concurrency (atomic upsert)", async () => {
    const results = await Promise.all(Array.from({ length: 20 }, () => hitRateLimit("burst", { limit: 5, windowSeconds: 60 }, now)));
    expect(results.filter((r) => r.allowed)).toHaveLength(5);
  });

  it("aligns windows to fixed boundaries", () => {
    expect(windowStart(now, 60).toISOString()).toBe("2026-10-14T12:00:00.000Z");
  });
});
