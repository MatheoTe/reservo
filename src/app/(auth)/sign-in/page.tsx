import type { Metadata } from "next";
import { Suspense } from "react";

import { isDemoMode } from "@/server/demo/mode";

import { AuthForm } from "../auth-form";

export const metadata: Metadata = { title: "Sign in" };

export default function SignInPage() {
  return (
    <Suspense>
      <AuthForm mode="sign-in" demo={isDemoMode()} />
    </Suspense>
  );
}
