import type { Metadata } from "next";
import { Suspense } from "react";

import { isDemoMode } from "@/server/demo/mode";

import { AuthForm } from "../auth-form";

export const metadata: Metadata = { title: "Create account" };

export default function SignUpPage() {
  return (
    <Suspense>
      <AuthForm mode="sign-up" demo={isDemoMode()} />
    </Suspense>
  );
}
