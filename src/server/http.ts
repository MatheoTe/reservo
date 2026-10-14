import { NextResponse } from "next/server";
import { z } from "zod";

import { AppError, toAppError } from "./errors";

export interface ApiErrorBody {
  error: { code: string; message: string; fieldErrors?: Record<string, string[]> };
}

/** Single place where errors become HTTP responses for route handlers. */
export function errorResponse(err: unknown): NextResponse<ApiErrorBody> {
  const appError = toAppError(err);
  if (appError.code === "INTERNAL") console.error("[api] unhandled error", err);
  const headers = new Headers();
  if (appError.retryAfterSeconds) headers.set("Retry-After", String(appError.retryAfterSeconds));
  return NextResponse.json(
    { error: { code: appError.code, message: appError.message, fieldErrors: appError.fieldErrors } },
    { status: appError.status, headers },
  );
}

/** Field errors keyed by dotted path ("customer.email"), so nested forms can show them. */
export function validationError(error: z.ZodError): AppError {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.map(String).join(".") || "_form";
    (fieldErrors[key] ??= []).push(issue.message);
  }
  return new AppError("VALIDATION", "Please check the highlighted fields.", { fieldErrors });
}

export function parseOrThrow<S extends z.ZodType>(schema: S, input: unknown): z.infer<S> {
  const result = schema.safeParse(input);
  if (!result.success) throw validationError(result.error);
  return result.data;
}

/**
 * Best-effort client IP for rate limiting. Behind a trusted proxy (Vercel,
 * a load balancer) the left-most X-Forwarded-For entry is the client.
 */
export function clientIp(headers: Headers): string {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || "unknown";
}
