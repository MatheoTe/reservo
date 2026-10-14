import type * as React from "react";

import { cn } from "@/lib/utils";

export function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label className={cn("text-sm leading-none font-medium select-none", className)} {...props} />
  );
}

/** Label + control + error, wired with aria attributes. */
export function Field({
  label,
  htmlFor,
  error,
  hint,
  children,
  className,
}: {
  label: string;
  htmlFor: string;
  error?: string[] | string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const message = Array.isArray(error) ? error[0] : error;
  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {message ? (
        <p id={`${htmlFor}-error`} role="alert" className="text-destructive text-xs">
          {message}
        </p>
      ) : hint ? (
        <p className="text-muted-foreground text-xs">{hint}</p>
      ) : null}
    </div>
  );
}
