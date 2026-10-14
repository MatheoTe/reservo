import { describe, expect, it } from "vitest";

import { backoffDelayMs, DEFAULT_BACKOFF } from "./backoff";

const noJitter = { ...DEFAULT_BACKOFF, jitter: 0 };

describe("backoffDelayMs", () => {
  it("doubles on each attempt", () => {
    expect([1, 2, 3, 4].map((n) => backoffDelayMs(n, noJitter))).toEqual([5_000, 10_000, 20_000, 40_000]);
  });

  it("is capped", () => {
    expect(backoffDelayMs(30, noJitter)).toBe(DEFAULT_BACKOFF.maxMs);
  });

  it("keeps jitter within [delay*(1-j), delay]", () => {
    expect(backoffDelayMs(3, DEFAULT_BACKOFF, () => 0)).toBe(16_000);
    expect(backoffDelayMs(3, DEFAULT_BACKOFF, () => 1)).toBe(20_000);
  });

  it("treats attempt 0 like the first attempt", () => {
    expect(backoffDelayMs(0, noJitter)).toBe(5_000);
  });
});
