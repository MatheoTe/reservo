import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap", {
  variants: {
    variant: {
      default: "border-transparent bg-accent text-accent-foreground",
      outline: "text-muted-foreground",
      success: "border-transparent bg-success/15 text-success",
      warning: "border-transparent bg-warning/20 text-[color-mix(in_oklch,var(--warning)_60%,black)] dark:text-warning",
      destructive: "border-transparent bg-destructive/12 text-destructive",
      muted: "border-transparent bg-muted text-muted-foreground",
    },
  },
  defaultVariants: { variant: "default" },
});

export function Badge({ className, variant, ...props }: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
