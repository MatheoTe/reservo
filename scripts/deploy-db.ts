/**
 * Build-time database step for hosted deploys (`npm run vercel-build`):
 * apply migrations and, in demo mode, seed an empty database. Skips quietly
 * when DATABASE_ADMIN_URL isn't configured (e.g. a preview without a DB), so
 * the build itself never depends on it.
 */
import "./load-env";

import postgres from "postgres";

import { closeDb, normalizeDatabaseUrl } from "@/server/db/client";
import { isDemoMode } from "@/server/demo/mode";
import { seedDemoData } from "@/server/demo/seed";

import { runMigrations } from "./migrate-lib";

const adminUrl = process.env.DATABASE_ADMIN_URL;
const appUrl = process.env.DATABASE_URL;
if (!adminUrl || !appUrl) {
  console.log("[deploy-db] DATABASE_ADMIN_URL / DATABASE_URL not set; skipping migrations.");
  process.exit(0);
}

await runMigrations(adminUrl, appUrl);
console.log("[deploy-db] migrations applied");

if (isDemoMode()) {
  const admin = postgres(normalizeDatabaseUrl(adminUrl), { max: 1, onnotice: () => {} });
  try {
    const result = await seedDemoData(admin);
    console.log(result.seeded ? "[deploy-db] demo data seeded" : "[deploy-db] demo data present");
  } finally {
    await admin.end();
    await closeDb();
  }
}
