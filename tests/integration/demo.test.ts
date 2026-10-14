import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as cronOutboxPost, GET as cronOutbox } from "@/app/api/cron/outbox/route";
import { GET as demoReset } from "@/app/api/demo/reset/route";
import { POST as demoSignIn } from "@/app/api/demo/sign-in/route";
import { getAuth } from "@/server/auth/auth";
import { DEMO_ORG_SLUG, DEMO_OWNER_EMAIL, DEMO_PASSWORD } from "@/server/demo/mode";
import { getMailer, MemoryMailer } from "@/server/mail/mailer";
import { createPublicBooking } from "@/server/services/bookings";

import { admin, createTestOrg, inDaysAt, useCleanDatabase } from "./helpers";

const SECRET = "test-cron-secret-0123456789";
const BASE = "http://localhost:3000";

function request(path: string, init: RequestInit & { secret?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.secret !== undefined) headers.set("authorization", `Bearer ${init.secret}`);
  headers.set("x-forwarded-for", "203.0.113.7");
  return new Request(`${BASE}${path}`, { ...init, headers });
}

async function createDemoOwner() {
  await getAuth().api.signUpEmail({
    body: { name: "Demo Owner", email: DEMO_OWNER_EMAIL, password: DEMO_PASSWORD },
  });
  await admin`delete from auth_sessions`; // sign-up signs in; start from none
}

describe("public demo mode", () => {
  useCleanDatabase();
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("one-click demo sign-in", () => {
    it("does not exist unless DEMO_MODE=1", async () => {
      await createDemoOwner();
      const res = await demoSignIn(request("/api/demo/sign-in", { method: "POST" }));
      expect(res.status).toBe(404);
      expect(res.headers.getSetCookie()).toHaveLength(0);
      expect(await admin`select * from auth_sessions`).toHaveLength(0);
    });

    it("with DEMO_MODE=1 creates a session server-side and lands in the demo dashboard", async () => {
      vi.stubEnv("DEMO_MODE", "1");
      await createDemoOwner();
      const res = await demoSignIn(request("/api/demo/sign-in", { method: "POST" }));
      expect(res.status).toBe(303);
      expect(res.headers.get("location")).toBe(`${BASE}/app/${DEMO_ORG_SLUG}`);
      const cookies = res.headers.getSetCookie().join("\n");
      expect(cookies).toMatch(/session_token=/);
      const sessions = await admin`
        select s.id from auth_sessions s join auth_users u on u.id = s.user_id
        where u.email = ${DEMO_OWNER_EMAIL}`;
      expect(sessions).toHaveLength(1);
    });

    it("sends the visitor back to sign-in when the demo account is missing", async () => {
      vi.stubEnv("DEMO_MODE", "1");
      const res = await demoSignIn(request("/api/demo/sign-in", { method: "POST" }));
      expect(res.status).toBe(303);
      expect(res.headers.get("location")).toBe(`${BASE}/sign-in?demo=unavailable`);
      expect(res.headers.getSetCookie()).toHaveLength(0);
    });
  });

  describe("cron endpoints", () => {
    beforeEach(() => {
      vi.stubEnv("CRON_SECRET", SECRET);
    });

    it("outbox cron rejects missing and wrong secrets", async () => {
      expect((await cronOutbox(request("/api/cron/outbox"))).status).toBe(401);
      expect((await cronOutbox(request("/api/cron/outbox", { secret: "nope" }))).status).toBe(401);
      expect(
        (
          await cronOutboxPost(
            request("/api/cron/outbox", { method: "POST", secret: `${SECRET}x` }),
          )
        ).status,
      ).toBe(401);
    });

    it("cron endpoints fail closed when CRON_SECRET is not configured", async () => {
      vi.stubEnv("CRON_SECRET", "");
      vi.stubEnv("DEMO_MODE", "1");
      expect((await cronOutbox(request("/api/cron/outbox", { secret: "" }))).status).toBe(401);
      expect((await demoReset(request("/api/demo/reset", { secret: "" }))).status).toBe(401);
    });

    it("outbox cron delivers due messages and marks them done", async () => {
      const org = await createTestOrg("cron-salon");
      await createPublicBooking(org.slug, {
        serviceId: org.serviceId,
        staffId: null,
        start: inDaysAt(3, 10).toISOString(),
        customer: { name: "Eva", email: "eva@example.com", phone: null },
        customerTimeZone: "Europe/Madrid",
      });
      const mailer = getMailer() as MemoryMailer;
      expect(mailer).toBeInstanceOf(MemoryMailer);
      mailer.sent.length = 0;

      const res = await cronOutbox(request("/api/cron/outbox", { secret: SECRET }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.batches[0]).toMatchObject({ claimed: 1, succeeded: 1 });
      expect(mailer.sent.map((m) => m.to)).toEqual(["eva@example.com"]);
      const rows = await admin`select topic, status from outbox order by id`;
      expect(rows).toEqual([
        { topic: "booking.confirmed", status: "done" },
        { topic: "booking.reminder", status: "pending" }, // not due yet
      ]);
    });

    it("demo reset is 404 outside demo mode and 401 without the secret", async () => {
      expect((await demoReset(request("/api/demo/reset", { secret: SECRET }))).status).toBe(404);
      vi.stubEnv("DEMO_MODE", "1");
      expect((await demoReset(request("/api/demo/reset"))).status).toBe(401);
      expect((await demoReset(request("/api/demo/reset", { secret: "nope" }))).status).toBe(401);
    });

    it(
      "demo reset wipes visitor data and restores the seeded tenants",
      { timeout: 180_000 },
      async () => {
        vi.stubEnv("DEMO_MODE", "1");
        vi.stubEnv("DATABASE_ADMIN_URL", process.env.TEST_DATABASE_ADMIN_URL!);
        await createTestOrg("visitor-made");

        const res = await demoReset(request("/api/demo/reset", { secret: SECRET }));
        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({ ok: true, seeded: true });

        const slugs = await admin`select slug from organizations order by slug`;
        expect(slugs.map((r) => r.slug)).toEqual(["glow-studio", "northside-physio"]);
        const [{ n }] = (await admin`select count(*)::int as n from bookings`) as [{ n: number }];
        expect(n).toBeGreaterThan(50);
        // Seed-time messages are not delivered to fictional customers.
        expect(await admin`select 1 from outbox where status <> 'done'`).toHaveLength(0);

        const signIn = await demoSignIn(request("/api/demo/sign-in", { method: "POST" }));
        expect(signIn.headers.get("location")).toBe(`${BASE}/app/${DEMO_ORG_SLUG}`);
      },
    );
  });
});
