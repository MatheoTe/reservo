"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import type { ActionResult } from "@/server/actions/run";

/**
 * Wraps a server action call with pending state, field errors and toasts.
 * Server actions never throw for expected failures - they return a typed
 * ActionResult - so the UI handles every error code explicitly.
 */
export function useAction<T>(options: { success?: string; onSuccess?: (data: T) => void } = {}) {
  const [pending, startTransition] = useTransition();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  function run(call: () => Promise<ActionResult<T>>) {
    setFieldErrors({});
    startTransition(async () => {
      const result = await call();
      if (!result) return; // redirected
      if (result.ok) {
        if (options.success) toast.success(options.success);
        options.onSuccess?.(result.data);
      } else {
        setFieldErrors(result.error.fieldErrors ?? {});
        toast.error(result.error.message);
      }
    });
  }

  return { run, pending, fieldErrors };
}
