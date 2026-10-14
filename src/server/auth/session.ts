import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { unauthenticated } from "../errors";
import { getAuth } from "./auth";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
}

/** Deduplicated per request via React cache(). */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) return null;
  return { id: session.user.id, name: session.user.name, email: session.user.email };
});

/** For pages: redirect anonymous visitors to sign in. */
export async function requireUser(returnTo?: string): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect(returnTo ? `/sign-in?next=${encodeURIComponent(returnTo)}` : "/sign-in");
  return user;
}

/** For actions and route handlers: throw a typed error instead of redirecting. */
export async function requireUserOrThrow(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw unauthenticated();
  return user;
}
