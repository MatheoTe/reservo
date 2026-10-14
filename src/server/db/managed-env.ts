/**
 * Maps the variables a managed Postgres integration provides (Neon on Vercel:
 * an owner role, pooled `DATABASE_URL` + direct `DATABASE_URL_UNPOOLED`) onto
 * the two connections Reservo needs:
 *
 * - `DATABASE_ADMIN_URL`: the owner, direct host - migrations, seed, reset.
 * - `DATABASE_URL`: the least-privilege `reservo_app` role, pooled host. Built
 *   from the pooled URL with `DATABASE_APP_PASSWORD`; migrations create the role
 *   with that password.
 *
 * Explicitly set variables always win. Idempotent.
 */
export function applyManagedPostgresEnv(
  env: Record<string, string | undefined> = process.env,
): void {
  if (!env.DATABASE_ADMIN_URL && env.DATABASE_URL_UNPOOLED) {
    env.DATABASE_ADMIN_URL = env.DATABASE_URL_UNPOOLED;
  }
  const password = env.DATABASE_APP_PASSWORD;
  if (!password || !env.DATABASE_URL) return;
  const url = new URL(env.DATABASE_URL);
  if (url.username === "reservo_app") return;
  url.username = "reservo_app";
  url.password = encodeURIComponent(password);
  env.DATABASE_URL = url.toString();
}
