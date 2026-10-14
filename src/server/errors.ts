/**
 * Typed application errors. Everything thrown on purpose is an AppError with a
 * stable `code`; route handlers and server actions translate them to HTTP
 * statuses / ActionResults in exactly one place (see ./http.ts, ./actions).
 */
export type ErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION"
  | "CONFLICT"
  | "SLOT_UNAVAILABLE"
  | "RATE_LIMITED"
  | "PAYMENT_FAILED"
  | "INTERNAL";

export const HTTP_STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION: 422,
  CONFLICT: 409,
  SLOT_UNAVAILABLE: 409,
  RATE_LIMITED: 429,
  PAYMENT_FAILED: 502,
  INTERNAL: 500,
};

export type FieldErrors = Record<string, string[]>;

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly fieldErrors?: FieldErrors;
  readonly retryAfterSeconds?: number;

  constructor(code: ErrorCode, message: string, extra: { fieldErrors?: FieldErrors; retryAfterSeconds?: number; cause?: unknown } = {}) {
    super(message, { cause: extra.cause });
    this.name = "AppError";
    this.code = code;
    this.fieldErrors = extra.fieldErrors;
    this.retryAfterSeconds = extra.retryAfterSeconds;
  }

  get status(): number {
    return HTTP_STATUS[this.code];
  }
}

export const unauthenticated = () => new AppError("UNAUTHENTICATED", "You need to sign in.");
export const forbidden = (message = "You don't have permission to do that.") => new AppError("FORBIDDEN", message);
export const notFound = (what = "Resource") => new AppError("NOT_FOUND", `${what} not found.`);
export const conflict = (message: string) => new AppError("CONFLICT", message);
export const slotUnavailable = () =>
  new AppError("SLOT_UNAVAILABLE", "Sorry, that time was just taken. Please pick another slot.");

/** Postgres SQLSTATE codes we translate into domain errors. */
export const PG = {
  UNIQUE_VIOLATION: "23505",
  EXCLUSION_VIOLATION: "23P01",
  FOREIGN_KEY_VIOLATION: "23503",
  CHECK_VIOLATION: "23514",
  INSUFFICIENT_PRIVILEGE: "42501",
} as const;

interface PgErrorLike {
  code: string;
  constraint_name?: string;
}

/** Finds the underlying Postgres error through Drizzle's wrapping, if any. */
export function pgError(err: unknown): PgErrorLike | undefined {
  let current: unknown = err;
  for (let depth = 0; current && depth < 5; depth++) {
    if (typeof current === "object" && "code" in current && typeof current.code === "string" && /^[0-9A-Z]{5}$/.test(current.code)) {
      return current as PgErrorLike;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

export function isPgError(err: unknown, code: string, constraint?: string): boolean {
  const pg = pgError(err);
  return !!pg && pg.code === code && (constraint === undefined || pg.constraint_name === constraint);
}

/** Normalizes anything thrown into an AppError (unknown errors become INTERNAL). */
export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  const pg = pgError(err);
  if (pg?.code === PG.EXCLUSION_VIOLATION) return slotUnavailable();
  if (pg?.code === PG.UNIQUE_VIOLATION) return conflict("That already exists.");
  if (pg?.code === PG.INSUFFICIENT_PRIVILEGE) return forbidden();
  return new AppError("INTERNAL", "Something went wrong. Please try again.", { cause: err });
}
