import postgres from "postgres";

import { normalizeDatabaseUrl } from "@/server/db/client";

import { seedDemoData, type SeedResult } from "./seed";

/** Every application table, children first. Migrations metadata is untouched. */
export const DATA_TABLES = [
  "audit_log",
  "outbox",
  "webhook_events",
  "payments",
  "bookings",
  "customers",
  "holidays",
  "time_off",
  "date_overrides",
  "breaks",
  "working_hours",
  "staff_services",
  "services",
  "staff_members",
  "invitations",
  "memberships",
  "organizations",
  "rate_limits",
  "auth_sessions",
  "auth_accounts",
  "auth_verifications",
  "auth_users",
] as const;

/**
 * Wipes all data (including visitors' sign-ups and sessions) and re-seeds the
 * demo tenants. Runs as the privileged migration owner because TRUNCATE is not
 * granted to the application role - on purpose.
 */
export async function resetDemoData(adminUrl: string): Promise<SeedResult> {
  const admin = postgres(normalizeDatabaseUrl(adminUrl), { max: 1, onnotice: () => {} });
  try {
    // One reset at a time: a second caller waits, then re-seeds over a fresh wipe.
    await admin`select pg_advisory_lock(hashtext('reservo:demo-reset'))`;
    try {
      await admin.unsafe(`truncate ${DATA_TABLES.join(", ")} restart identity cascade`);
      return await seedDemoData(admin);
    } finally {
      await admin`select pg_advisory_unlock(hashtext('reservo:demo-reset'))`;
    }
  } finally {
    await admin.end();
  }
}
