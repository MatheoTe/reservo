import "./load-env";

import { runMigrations } from "./migrate-lib";

const adminUrl = process.env.DATABASE_ADMIN_URL;
const appUrl = process.env.DATABASE_URL;
if (!adminUrl || !appUrl) {
  console.error("DATABASE_ADMIN_URL and DATABASE_URL must be set (copy .env.example to .env).");
  process.exit(1);
}

await runMigrations(adminUrl, appUrl);
console.log("Migrations applied; reservo_app role is ready.");
