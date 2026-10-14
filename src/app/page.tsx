import { ArrowRight, CalendarCheck2, CreditCard, Globe2, ShieldCheck, Sparkles, Users } from "lucide-react";
import Link from "next/link";

import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";

const features = [
  { icon: CalendarCheck2, title: "Zero double bookings", body: "Every slot is protected by a database constraint, not by hope. Two customers can't take the same chair." },
  { icon: Globe2, title: "Time zones done right", body: "Hours live in your zone, customers see theirs. Daylight saving changes are handled to the minute." },
  { icon: CreditCard, title: "Deposits that stick", body: "Collect a deposit at booking with Stripe. Unpaid holds are released automatically." },
  { icon: Users, title: "Your whole team", body: "Owners, admins and staff, each with the right permissions, split shifts, breaks and time off." },
  { icon: ShieldCheck, title: "Isolated by design", body: "Each business's data is fenced off by Postgres row-level security, and sensitive actions are audited." },
  { icon: Sparkles, title: "Emails that arrive", body: "Confirmations and reminders go through a retrying outbox, so a mail hiccup never loses a message." },
];

export default function LandingPage() {
  return (
    <div className="relative overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-40 h-[520px] bg-[radial-gradient(60%_60%_at_50%_0%,color-mix(in_oklch,var(--primary)_22%,transparent),transparent)]"
      />
      <header className="relative mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <Logo />
        <nav className="flex items-center gap-2">
          <Button variant="ghost" asChild>
            <Link href="/b/glow-studio">Live demo</Link>
          </Button>
          <Button variant="ghost" asChild>
            <Link href="/sign-in">Sign in</Link>
          </Button>
          <Button asChild>
            <Link href="/sign-up">Get started</Link>
          </Button>
        </nav>
      </header>

      <main className="relative">
        <section className="mx-auto max-w-4xl px-6 pt-16 pb-20 text-center sm:pt-24">
          <p className="mx-auto mb-5 inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1 text-xs text-muted-foreground shadow-xs">
            <span className="size-1.5 rounded-full bg-success" /> Built for clinics, salons and studios
          </p>
          <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-6xl">
            Bookings that never collide.
            <span className="block text-primary">A calendar your team trusts.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-pretty text-muted-foreground">
            Reservo gives every business a public booking page, a shared team calendar, deposits and automatic reminders, on
            infrastructure engineered for correctness.
          </p>
          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button size="lg" asChild>
              <Link href="/sign-up">
                Create your booking page <ArrowRight />
              </Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <Link href="/b/glow-studio">Book at the demo studio</Link>
            </Button>
          </div>
        </section>

        <section className="mx-auto grid max-w-6xl gap-4 px-6 pb-24 sm:grid-cols-2 lg:grid-cols-3">
          {features.map(({ icon: Icon, title, body }) => (
            <div key={title} className="rounded-xl border bg-card p-6 shadow-xs">
              <div className="mb-4 inline-flex rounded-lg bg-accent p-2 text-accent-foreground">
                <Icon className="size-5" />
              </div>
              <h2 className="font-semibold">{title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
            </div>
          ))}
        </section>
      </main>

      <footer className="border-t py-8 text-center text-sm text-muted-foreground">
        Built by{" "}
        <a className="font-medium text-foreground hover:underline" href="https://www.linkedin.com/in/matheo-telesca-084a20209/">
          Matheo Telesca
        </a>
      </footer>
    </div>
  );
}
