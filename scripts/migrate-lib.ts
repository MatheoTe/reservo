import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { normalizeDatabaseUrl } from "../src/server/db/client";

/**
 * Applies migrations as the privileged user, then makes sure the application
 * role can log in with the credentials found in the app connection string.
 * Shared by `npm run db:migrate` and the integration-test global setup.
 */
export async function runMigrations(adminUrl: string, appUrl: string): Promise<void> {
  const sql = postgres(normalizeDatabaseUrl(adminUrl), { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(sql), { migrationsFolder: "drizzle" });

    const app = new URL(appUrl);
    if (app.username !== "reservo_app") {
      throw new Error(`DATABASE_URL must connect as "reservo_app" (got "${app.username}").`);
    }
    const password = decodeURIComponent(app.password);
    // Identifiers/literals can't be bound as parameters in ALTER ROLE.
    await sql.unsafe(`ALTER ROLE reservo_app WITH LOGIN PASSWORD ${quoteLiteral(password)}`);
  } finally {
    await sql.end();
  }
}

function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}
