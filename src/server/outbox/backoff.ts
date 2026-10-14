export interface BackoffOptions {
  baseMs: number;
  maxMs: number;
  /** 0..1 - fraction of the delay that is randomized ("equal jitter"). */
  jitter: number;
}

export const DEFAULT_BACKOFF: BackoffOptions = { baseMs: 5_000, maxMs: 30 * 60_000, jitter: 0.2 };

/**
 * Exponential backoff with jitter for the n-th failed attempt (1-based):
 * 5s, 10s, 20s, 40s ... capped at 30 min. Jitter spreads retries of messages
 * that failed together (e.g. SMTP outage) so they don't stampede on recovery.
 */
export function backoffDelayMs(attempt: number, options: BackoffOptions = DEFAULT_BACKOFF, random: () => number = Math.random): number {
  const exp = Math.min(options.maxMs, options.baseMs * 2 ** Math.max(0, attempt - 1));
  const jitterSpan = exp * options.jitter;
  return Math.round(exp - jitterSpan + random() * jitterSpan);
}
