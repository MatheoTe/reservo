"use client";

import { ArrowRight, Mail } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

function safeNext(value: string | null): string {
  // Only allow same-site relative paths (prevents open redirects).
  return value && value.startsWith("/") && !value.startsWith("//") ? value : "/app";
}

const DEMO_ERRORS: Record<string, string> = {
  unavailable: "The demo account isn't available right now. It's restored every night.",
  busy: "Too many demo sign-ins from your network. Try again in a few minutes.",
};

export function AuthForm({ mode, demo = false }: { mode: "sign-in" | "sign-up"; demo?: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const [pending, startTransition] = useTransition();
  const [magicSent, setMagicSent] = useState(false);
  const [error, setError] = useState<string | null>(
    () => DEMO_ERRORS[params.get("demo") ?? ""] ?? null,
  );

  function onSubmit(formData: FormData) {
    setError(null);
    const email = String(formData.get("email") ?? "");
    const password = String(formData.get("password") ?? "");
    const name = String(formData.get("name") ?? "");
    startTransition(async () => {
      const result =
        mode === "sign-up"
          ? await authClient.signUp.email({ email, password, name })
          : await authClient.signIn.email({ email, password });
      if (result.error) {
        setError(result.error.message ?? "Something went wrong.");
        return;
      }
      router.push(next);
      router.refresh();
    });
  }

  function sendMagicLink(formData: FormData) {
    setError(null);
    const email = String(formData.get("email") ?? "");
    startTransition(async () => {
      const result = await authClient.signIn.magicLink({ email, callbackURL: next });
      if (result.error) {
        setError(result.error.message ?? "Couldn't send the link.");
        return;
      }
      setMagicSent(true);
      toast.success("Check your inbox for a sign-in link.");
    });
  }

  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle className="text-xl">
          {mode === "sign-up" ? "Create your account" : "Welcome back"}
        </CardTitle>
        <CardDescription>
          {mode === "sign-up"
            ? "Start taking bookings in minutes."
            : "Sign in to manage your bookings."}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        {demo ? (
          <form
            action="/api/demo/sign-in"
            method="post"
            className="bg-accent text-accent-foreground grid gap-2 rounded-lg p-3 text-sm"
          >
            <p>
              {mode === "sign-up"
                ? "Live demo: accounts you create here are wiped every night."
                : "Just looking around? Skip the form."}
            </p>
            <Button type="submit">
              Sign in as the demo owner <ArrowRight />
            </Button>
          </form>
        ) : null}
        <form action={onSubmit} className="grid gap-4">
          {mode === "sign-up" ? (
            <Field label="Your name" htmlFor="name">
              <Input id="name" name="name" autoComplete="name" required minLength={2} />
            </Field>
          ) : null}
          <Field label="Email" htmlFor="email">
            <Input id="email" name="email" type="email" autoComplete="email" required />
          </Field>
          <Field
            label="Password"
            htmlFor="password"
            hint={mode === "sign-up" ? "At least 8 characters." : undefined}
          >
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
              required
              minLength={8}
            />
          </Field>
          {error ? (
            <p
              role="alert"
              className="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm"
            >
              {error}
            </p>
          ) : null}
          <Button type="submit" disabled={pending}>
            {pending ? "Please wait..." : mode === "sign-up" ? "Create account" : "Sign in"}
          </Button>
        </form>

        {mode === "sign-in" && !demo ? (
          <>
            <div className="text-muted-foreground flex items-center gap-3 text-xs">
              <span className="bg-border h-px flex-1" /> or{" "}
              <span className="bg-border h-px flex-1" />
            </div>
            {magicSent ? (
              <p className="bg-accent text-accent-foreground rounded-md px-3 py-2 text-center text-sm">
                Link sent. In development, open Mailpit at localhost:8025.
              </p>
            ) : (
              <form action={sendMagicLink} className="grid gap-2">
                <Input
                  name="email"
                  type="email"
                  placeholder="you@business.com"
                  aria-label="Email for magic link"
                  required
                />
                <Button type="submit" variant="outline" disabled={pending}>
                  <Mail /> Email me a sign-in link
                </Button>
              </form>
            )}
          </>
        ) : null}

        <p className="text-muted-foreground text-center text-sm">
          {mode === "sign-up" ? "Already have an account? " : "New to Slotsmith? "}
          <Link
            className="text-primary font-medium hover:underline"
            href={`${mode === "sign-up" ? "/sign-in" : "/sign-up"}${next !== "/app" ? `?next=${encodeURIComponent(next)}` : ""}`}
          >
            {mode === "sign-up" ? "Sign in" : "Create an account"}
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
