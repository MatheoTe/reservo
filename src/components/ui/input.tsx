import type * as React from "react";

import { cn } from "@/lib/utils";

export function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "border-input bg-card placeholder:text-muted-foreground aria-invalid:border-destructive flex h-9 w-full min-w-0 rounded-md border px-3 py-1 text-sm shadow-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "border-input bg-card placeholder:text-muted-foreground aria-invalid:border-destructive flex min-h-20 w-full rounded-md border px-3 py-2 text-sm shadow-xs disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="select"
      className={cn(
        "border-input bg-card aria-invalid:border-destructive flex h-9 w-full rounded-md border px-3 text-sm shadow-xs disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
