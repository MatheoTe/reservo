/**
 * Seeds the demo data (see src/server/demo/seed.ts).
 *
 *   npm run seed            # once, on a migrated database
 *   npm run db:reset && npm run seed   # start over
 */
import "./load-env";

import postgres from "postgres";

import { closeDb, normalizeDatabaseUrl } from "@/server/db/client";
import { DEMO_ADMIN_EMAIL, DEMO_OWNER_EMAIL, DEMO_PASSWORD } from "@/server/demo/mode";
import { seedDemoData } from "@/server/demo/seed";

const adminUrl = process.env.DATABASE_ADMIN_URL;
if (!adminUrl) throw new Error("DATABASE_ADMIN_URL is not set");
const admin = postgres(normalizeDatabaseUrl(adminUrl), { max: 1, onnotice: () => {} });
try {
  const result = await seedDemoData(admin);
  if (!result.seeded) {
    console.log("Demo data already present. Run `npm run db:reset && npm run seed` to start over.");
  } else {
    for (const org of result.orgs)
      console.log(`Seeded ${org.name} (/b/${org.slug}) with ${org.bookings} bookings`);
    console.log(
      `\nSign in at http://localhost:3000/sign-in\n  owner: ${DEMO_OWNER_EMAIL} / ${DEMO_PASSWORD}\n  admin: ${DEMO_ADMIN_EMAIL} / ${DEMO_PASSWORD}`,
    );
  }
} finally {
  await admin.end();
  await closeDb();
}
