import postgres from "postgres";

import { runMigrations } from "../../scripts/migrate-lib";

const ADMIN_URL =
  process.env.TEST_DATABASE_ADMIN_URL ?? "postgres://postgres:postgres@localhost:5433/reservo_test";
const APP_URL =
  process.env.TEST_DATABASE_URL ??
  "postgres://reservo_app:reservo_app_dev_password@localhost:5433/reservo_test";

/**
 * Recreates the test schema from the real migrations once per run, so the
 * tests exercise the exact RLS policies / constraints / grants we ship.
 */
export default async function setup() {
  const target = new URL(ADMIN_URL);
  const dbName = target.pathname.slice(1);
  if (!dbName.endsWith("_test")) throw new Error(`Refusing to reset non-test database "${dbName}"`);

  const maintenance = new URL(ADMIN_URL);
  maintenance.pathname = "/postgres";
  const root = postgres(maintenance.toString(), { max: 1, onnotice: () => {} });
  try {
    const exists = await root`select 1 from pg_database where datname = ${dbName}`;
    if (exists.length === 0) await root.unsafe(`create database "${dbName}"`);
  } finally {
    await root.end();
  }

  const admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`
      drop schema if exists public cascade;
      drop schema if exists app cascade;
      drop schema if exists drizzle cascade;
      create schema public;
    `);
  } finally {
    await admin.end();
  }
  await runMigrations(ADMIN_URL, APP_URL);
}
