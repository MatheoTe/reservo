import "./load-env";

import postgres from "postgres";

const adminUrl = process.env.DATABASE_ADMIN_URL;
if (!adminUrl) throw new Error("DATABASE_ADMIN_URL is not set");
if (process.env.NODE_ENV === "production")
  throw new Error("Refusing to reset a production database.");

const sql = postgres(adminUrl, { max: 1, onnotice: () => {} });
await sql.unsafe(`
  DROP SCHEMA IF EXISTS public CASCADE;
  DROP SCHEMA IF EXISTS app CASCADE;
  DROP SCHEMA IF EXISTS drizzle CASCADE;
  CREATE SCHEMA public;
`);
await sql.end();
console.log("Database reset.");
