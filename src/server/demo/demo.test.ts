import { afterEach, describe, expect, it, vi } from "vitest";

import { normalizeDatabaseUrl } from "@/server/db/client";
import { LogMailer } from "@/server/mail/mailer";

import { isAuthorizedCron } from "./cron-auth";
import { isDemoMode } from "./mode";

const req = (auth?: string) =>
  new Request("http://x/api/cron/outbox", { headers: auth ? { authorization: auth } : {} });

describe("isAuthorizedCron", () => {
  it("accepts only the exact bearer secret", () => {
    expect(isAuthorizedCron(req("Bearer s3cret"), "s3cret")).toBe(true);
    expect(isAuthorizedCron(req("Bearer s3cre"), "s3cret")).toBe(false);
    expect(isAuthorizedCron(req("s3cret"), "s3cret")).toBe(false);
    expect(isAuthorizedCron(req(), "s3cret")).toBe(false);
  });

  it("fails closed when no secret is configured", () => {
    expect(isAuthorizedCron(req("Bearer "), "")).toBe(false);
    expect(isAuthorizedCron(req("Bearer undefined"), undefined)).toBe(false);
  });
});

describe("isDemoMode", () => {
  afterEach(() => vi.unstubAllEnvs());
  it.each([
    ["1", true],
    ["true", true],
    ["0", false],
    ["", false],
  ])("DEMO_MODE=%j -> %s", (value, expected) => {
    vi.stubEnv("DEMO_MODE", value);
    expect(isDemoMode()).toBe(expected);
  });
});

describe("LogMailer", () => {
  it("never sends, and doesn't log the full address", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    await new LogMailer().send({ to: "eva@example.com", subject: "Hi", text: "", html: "" });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("ev***@example.com"));
    expect(log.mock.calls[0]![0]).not.toContain("eva@example.com");
    log.mockRestore();
  });
});

describe("normalizeDatabaseUrl", () => {
  it("drops channel_binding but keeps sslmode", () => {
    expect(
      normalizeDatabaseUrl(
        "postgres://u:p@ep-x-pooler.neon.tech/db?sslmode=require&channel_binding=require",
      ),
    ).toBe("postgres://u:p@ep-x-pooler.neon.tech/db?sslmode=require");
  });
});
