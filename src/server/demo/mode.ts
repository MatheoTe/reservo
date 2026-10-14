/**
 * Public live-demo mode (`DEMO_MODE=1`): one-click sign-in as the seeded
 * owner, fake payments, no real email, outbox processed in-request and by
 * cron, and a nightly reset. Off by default; nothing changes without it.
 */
export function isDemoMode(): boolean {
  const value = process.env.DEMO_MODE?.trim().toLowerCase();
  return value === "1" || value === "true";
}

export const DEMO_OWNER_EMAIL = "demo@reservo.dev";
export const DEMO_ADMIN_EMAIL = "admin@reservo.dev";
/** Fictional accounts on fictional data; the nightly reset restores it anyway. */
export const DEMO_PASSWORD = "reservo-demo-2026";
export const DEMO_ORG_SLUG = "glow-studio";
export const REPO_URL = "https://github.com/MatheoTe/reservo";
