import { describe, expect, it } from "vitest";

import { applyManagedPostgresEnv } from "./managed-env";

const pooled =
  "postgres://neondb_owner:ownerpw@ep-x-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require";
const direct =
  "postgres://neondb_owner:ownerpw@ep-x.us-east-1.aws.neon.tech/neondb?sslmode=require";

describe("applyManagedPostgresEnv", () => {
  it("derives the admin URL and the reservo_app URL from Neon's variables", () => {
    const env: Record<string, string | undefined> = {
      DATABASE_URL: pooled,
      DATABASE_URL_UNPOOLED: direct,
      DATABASE_APP_PASSWORD: "apppw",
    };
    applyManagedPostgresEnv(env);
    expect(env.DATABASE_ADMIN_URL).toBe(direct);
    const app = new URL(env.DATABASE_URL!);
    expect(app.username).toBe("reservo_app");
    expect(app.password).toBe("apppw");
    expect(app.hostname).toBe("ep-x-pooler.us-east-1.aws.neon.tech");
    expect(app.searchParams.get("sslmode")).toBe("require");
  });

  it("is idempotent and never overrides explicit variables", () => {
    const env: Record<string, string | undefined> = {
      DATABASE_URL: pooled,
      DATABASE_URL_UNPOOLED: direct,
      DATABASE_ADMIN_URL: "postgres://a@h/d",
      DATABASE_APP_PASSWORD: "apppw",
    };
    applyManagedPostgresEnv(env);
    const once = env.DATABASE_URL;
    applyManagedPostgresEnv(env);
    expect(env.DATABASE_URL).toBe(once);
    expect(env.DATABASE_ADMIN_URL).toBe("postgres://a@h/d");
  });

  it("leaves a plain local setup untouched", () => {
    const env: Record<string, string | undefined> = {
      DATABASE_URL: "postgres://reservo_app:x@localhost:5433/reservo",
    };
    applyManagedPostgresEnv(env);
    expect(env).toEqual({ DATABASE_URL: "postgres://reservo_app:x@localhost:5433/reservo" });
  });
});
