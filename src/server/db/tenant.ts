import { sql } from "drizzle-orm";

import { getDb, type Tx } from "./client";

export interface TenantContext {
  orgId: string;
  /** The authenticated user, when there is one (public booking has none). */
  userId?: string | null;
}

/**
 * Runs `fn` in a transaction bound to one tenant.
 *
 * `set_config(..., true)` scopes the settings to this transaction only, which
 * is what makes it safe with a connection pool: there is no code path that
 * can forget to "reset" the tenant, because COMMIT/ROLLBACK does it.
 *
 * This is the *only* way application code should touch tenant tables. Even if
 * a query inside `fn` forgets a `where org_id = ...`, Row Level Security
 * filters it to the current org.
 */
export async function withTenant<T>(ctx: TenantContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return getDb().transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.current_org', ${ctx.orgId}, true), set_config('app.current_user', ${ctx.userId ?? ""}, true)`,
    );
    return fn(tx);
  });
}

/**
 * A transaction with only the user bound (no tenant). RLS then exposes just
 * the user's own memberships and the organizations behind them - used by the
 * org switcher and post-login redirect.
 */
export async function withUser<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_user', ${userId}, true)`);
    return fn(tx);
  });
}

/** Resolves a public slug to an org id through the SECURITY DEFINER function. */
export async function orgIdBySlug(slug: string): Promise<string | null> {
  const rows = await getDb().execute<{ id: string | null }>(sql`select app.org_id_by_slug(${slug}) as id`);
  return rows[0]?.id ?? null;
}
