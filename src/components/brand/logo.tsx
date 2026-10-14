import Link from "next/link";

import { cn } from "@/lib/utils";

export function Logo({ className, href = "/" }: { className?: string; href?: string }) {
  return (
    <Link
      href={href}
      className={cn("inline-flex items-center gap-2 font-semibold tracking-tight", className)}
    >
      <span className="bg-primary text-primary-foreground grid size-7 place-items-center rounded-lg shadow-sm">
        <svg
          viewBox="0 0 24 24"
          className="size-4"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.4}
          aria-hidden
        >
          <rect x="3.5" y="5" width="17" height="15" rx="3" />
          <path d="M8 3v4M16 3v4M8 13l2.5 2.5L16 10" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <span>Slotsmith</span>
    </Link>
  );
}
