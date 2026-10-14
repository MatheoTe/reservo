import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "@/db/schema";

export type Database = ReturnType<typeof createDatabase>["db"];
export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
/** Either the root handle or a transaction - for helpers that work in both. */
export type Queryable = Database | Tx;

/**
 * Managed-Postgres URLs (Neon) may carry `channel_binding`, which postgres.js
 * would forward to the server as an unknown runtime parameter. TLS still comes
 * from `sslmode`.
 */
export function normalizeDatabaseUrl(url: string): string {
  const parsed = new URL(url);
  if (!parsed.searchParams.has("channel_binding")) return url;
  parsed.searchParams.delete("channel_binding");
  return parsed.toString();
}

/** PgBouncer-style poolers in transaction mode (Neon's `-pooler` host) can't keep named prepared statements. */
export function isPooledUrl(url: string): boolean {
  return new URL(url).hostname.includes("-pooler") || process.env.DATABASE_POOLED === "1";
}

export function createDatabase(url: string, options: { max?: number } = {}) {
  const client = postgres(normalizeDatabaseUrl(url), {
    max: options.max ?? (process.env.VERCEL ? 5 : 10),
    prepare: !isPooledUrl(url),
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
