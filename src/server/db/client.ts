import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "@/db/schema";

export type Database = ReturnType<typeof createDatabase>["db"];
export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
/** Either the root handle or a transaction - for helpers that work in both. */
export type Queryable = Database | Tx;

export function createDatabase(url: string, options: { max?: number } = {}) {
  const client = postgres(url, {
    max: options.max ?? 10,
    // Silence NOTICE messages (e.g. "relation already exists, skipping").
    onnotice: () => {},
  });
  return { client, db: drizzle(client, { schema }) };
}

// One pool per process. In dev, Next.js hot reload re-evaluates modules, so
// the pool lives on globalThis to avoid leaking connections on every edit.
const globalForDb = globalThis as unknown as { __reservoDb?: ReturnType<typeof createDatabase> };

export function getDb(): Database {
  if (!globalForDb.__reservoDb) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    globalForDb.__reservoDb = createDatabase(url);
  }
  return globalForDb.__reservoDb.db;
}

export async function closeDb(): Promise<void> {
  await globalForDb.__reservoDb?.client.end({ timeout: 5 });
  globalForDb.__reservoDb = undefined;
}
