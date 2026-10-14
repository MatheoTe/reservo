"use client";

import * as Dropdown from "@radix-ui/react-dropdown-menu";
import {
  CalendarDays,
  ChevronsUpDown,
  ClipboardList,
  ExternalLink,
  LayoutDashboard,
  LogOut,
  Menu,
  Plus,
  Scissors,
  Settings,
  UserRound,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

import { Logo } from "@/components/brand/logo";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/misc";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

interface Props {
  org: { slug: string; name: string; plan: "free" | "pro" };
  orgs: { slug: string; name: string }[];
  user: { name: string; email: string };
  role: "owner" | "admin" | "staff";
  permissions: { services: boolean; team: boolean; settings: boolean; customers: boolean };
}

export function Sidebar({ org, orgs, user, role, permissions }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const base = `/app/${org.slug}`;

  const items = [
    { href: base, label: "Overview", icon: LayoutDashboard, show: true },
    { href: `${base}/calendar`, label: "Calendar", icon: CalendarDays, show: true },
    { href: `${base}/bookings`, label: "Bookings", icon: ClipboardList, show: true },
    { href: `${base}/customers`, label: "Customers", icon: UserRound, show: permissions.customers },
    { href: `${base}/services`, label: "Services", icon: Scissors, show: permissions.services },
    { href: `${base}/team`, label: "Team", icon: Users, show: permissions.team },
    { href: `${base}/settings`, label: "Settings", icon: Settings, show: permissions.settings },
  ].filter((i) => i.show);

  const nav = (
    <nav className="grid gap-0.5" aria-label="Main">
      {items.map(({ href, label, icon: Icon }) => {
        const active = href === base ? pathname === base : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            onClick={() => setOpen(false)}
            aria-current={active ? "page" : undefined}
            className={cn(
              "text-muted-foreground hover:bg-muted hover:text-foreground flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              active &&
                "bg-accent text-accent-foreground hover:bg-accent hover:text-accent-foreground",
            )}
          >
            <Icon className="size-4" />
            {label}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <>
      <div className="bg-card flex items-center justify-between border-b px-4 py-3 lg:hidden">
        <Logo href={base} />
        <button
          className="hover:bg-muted rounded-md p-2"
          onClick={() => setOpen((v) => !v)}
          aria-label="Toggle navigation"
        >
          <Menu className="size-5" />
        </button>
      </div>
      <aside
        className={cn(
          "bg-card flex-col gap-6 border-r px-3 py-5 lg:sticky lg:top-0 lg:flex lg:h-dvh",
          open ? "flex" : "hidden",
        )}
      >
        <div className="hidden px-2 lg:block">
          <Logo href={base} />
        </div>

        <Dropdown.Root>
          <Dropdown.Trigger className="bg-background hover:bg-muted flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left text-sm shadow-xs">
            <span className="bg-primary/10 text-primary grid size-7 place-items-center rounded-md text-xs font-semibold">
              {org.name.slice(0, 1).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{org.name}</span>
              <span className="text-muted-foreground block text-xs capitalize">{role}</span>
            </span>
            <ChevronsUpDown className="text-muted-foreground size-4" />
          </Dropdown.Trigger>
          <Dropdown.Portal>
            <Dropdown.Content
              align="start"
              sideOffset={6}
              className="bg-card z-50 min-w-56 rounded-lg border p-1 shadow-lg"
            >
              {orgs.map((o) => (
                <Dropdown.Item key={o.slug} asChild>
                  <Link
                    href={`/app/${o.slug}`}
                    className="data-highlighted:bg-muted flex cursor-pointer items-center rounded-md px-2 py-1.5 text-sm outline-none"
                  >
                    {o.name}
                  </Link>
                </Dropdown.Item>
              ))}
              <Dropdown.Separator className="bg-border my-1 h-px" />
              <Dropdown.Item asChild>
                <Link
                  href="/onboarding"
                  className="data-highlighted:bg-muted flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none"
                >
                  <Plus className="size-4" /> New business
                </Link>
              </Dropdown.Item>
            </Dropdown.Content>
          </Dropdown.Portal>
        </Dropdown.Root>

        {nav}

        <div className="mt-auto grid gap-3">
          <Link
            href={`/b/${org.slug}`}
            target="_blank"
            className="text-muted-foreground hover:border-primary hover:text-primary flex items-center justify-between rounded-lg border border-dashed px-3 py-2 text-sm"
          >
            Public booking page <ExternalLink className="size-3.5" />
          </Link>
          <div className="flex items-center gap-3 rounded-lg px-2 py-1">
            <Avatar name={user.name} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{user.name}</p>
              <p className="text-muted-foreground truncate text-xs">{user.email}</p>
            </div>
            {org.plan === "pro" ? <Badge>Pro</Badge> : null}
            <button
              aria-label="Sign out"
              className="text-muted-foreground hover:bg-muted hover:text-foreground rounded-md p-1.5"
              onClick={async () => {
                await authClient.signOut();
                router.push("/sign-in");
                router.refresh();
              }}
            >
              <LogOut className="size-4" />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
