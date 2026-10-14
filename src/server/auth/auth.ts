import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { magicLink } from "better-auth/plugins";

import { authAccounts, authSessions, authUsers, authVerifications } from "@/db/schema";
import { env } from "@/env";

import { getDb } from "../db/client";
import { isDemoMode } from "../demo/mode";
import { getMailer } from "../mail/mailer";
import { magicLinkEmail } from "../mail/templates";

function createAuth() {
  const config = env();
  return betterAuth({
    appName: "Slotsmith",
    secret: config.BETTER_AUTH_SECRET,
    baseURL: config.BETTER_AUTH_URL,
    // In the public demo everyone shares one account: nobody gets to lock the
    // others out by changing its password or email (the app has no UI for these).
    disabledPaths: isDemoMode()
      ? [
          "/change-password",
          "/change-email",
          "/update-user",
          "/delete-user",
          "/revoke-sessions",
          "/revoke-other-sessions",
        ]
      : [],
    database: drizzleAdapter(getDb(), {
      provider: "pg",
      schema: {
        user: authUsers,
        session: authSessions,
        account: authAccounts,
        verification: authVerifications,
      },
    }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      autoSignIn: true,
    },
    session: {
      expiresIn: 60 * 60 * 24 * 14,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: true, maxAge: 60 * 5 },
    },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 30,
      customRules: {
        "/sign-in/email": { window: 60, max: 10 },
        "/sign-in/magic-link": { window: 60, max: 5 },
      },
    },
    plugins: [
      magicLink({
        expiresIn: 60 * 5,
        // Auth emails are sent inline, not through the outbox: the user is
        // waiting on this screen, and there's no tenant transaction to join.
        sendMagicLink: async ({ email, url }) => {
          await getMailer().send(magicLinkEmail({ to: email, url }));
        },
      }),
      nextCookies(), // must be last: lets server actions set auth cookies
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;

const globalForAuth = globalThis as unknown as { __slotsmithAuth?: Auth };

/** Lazily constructed so `next build` doesn't need secrets to import routes. */
export function getAuth(): Auth {
  globalForAuth.__slotsmithAuth ??= createAuth();
  return globalForAuth.__slotsmithAuth;
}
