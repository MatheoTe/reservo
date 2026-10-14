import { expect, test } from "@playwright/test";

test.describe("public API hardening", () => {
  test("unknown organizations are 404 and invalid input is 422", async ({ request }) => {
    const missing = await request.get(
      "/api/public/does-not-exist-xyz/availability?serviceId=00000000-0000-4000-8000-000000000000&from=2026-01-01&to=2026-01-02",
    );
    expect(missing.status()).toBe(404);

    const invalid = await request.get(
      "/api/public/whatever/availability?serviceId=nope&from=2026-01-01&to=2026-01-02",
    );
    expect(invalid.status()).toBe(422);
    const body = await invalid.json();
    expect(body.error.code).toBe("VALIDATION");
    expect(body.error.fieldErrors.serviceId).toBeDefined();
  });

  test("health endpoint reports the database", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.ok()).toBe(true);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  test("webhook endpoint rejects unsigned payloads", async ({ request }) => {
    const res = await request.post("/api/webhooks/fake", {
      data: { id: "evt_1", type: "deposit.succeeded" },
    });
    expect(res.status()).toBe(400);
  });
});
