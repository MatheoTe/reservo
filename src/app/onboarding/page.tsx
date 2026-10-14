import type { Metadata } from "next";

import { Logo } from "@/components/brand/logo";
import { requireUser } from "@/server/auth/session";

import { OnboardingForm } from "./onboarding-form";

export const metadata: Metadata = { title: "Set up your business" };

export default async function OnboardingPage() {
  const user = await requireUser("/onboarding");
  return (
    <div className="grid min-h-dvh place-items-center bg-muted/40 px-4 py-12">
      <div className="w-full max-w-lg">
        <div className="mb-8 flex justify-center">
          <Logo href="/app" />
        </div>
        <OnboardingForm firstName={user.name.split(" ")[0] ?? user.name} />
      </div>
    </div>
  );
}
