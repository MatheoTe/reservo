import { eq, sql } from "drizzle-orm";

import { outbox } from "@/db/schema";
import { getDb } from "@/server/db/client";
import { withTenant } from "@/server/db/tenant";
import { backoffDelayMs, type BackoffOptions, DEFAULT_BACKOFF } from "@/server/outbox/backoff";
import {
  isOutboxTopic,
  type OutboxPayload,
  type OutboxTopic,
  outboxTopics,
  SENSITIVE_TOPICS,
} from "@/server/outbox/topics";

export interface ClaimedMessage {
  id: number;
  orgId: string;
  topic: string;
  payload: unknown;
  attempts: number;
  maxAttempts: number;
}

export type OutboxHandlers = {
  [T in OutboxTopic]: (payload: OutboxPayload<T>, message: ClaimedMessage) => Promise<void>;
};

export interface BatchResult {
  claimed: number;
  succeeded: number;
  retried: number;
  dead: number;
}

/** Thrown by handlers for errors that retrying can never fix. */
export class PermanentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentError";
  }
}

interface ClaimRow extends Record<string, unknown> {
  id: string | number;
  org_id: string;
  topic: string;
  payload: unknown;
  attempts: number;
  max_attempts: number;
}

/**
 * Claims a batch with a lease, delivers each message, and records the outcome.
 * Delivery is at-least-once: a crash after sending but before `markDone`
 * re-delivers when the lease expires, so handlers must be idempotent or
 * tolerate the rare duplicate (an extra confirmation email is acceptable; a
 * double refund is not - refunds use a provider idempotency key).
 */
export async function processOutboxBatch(
  handlers: OutboxHandlers,
  options: { batchSize?: number; leaseSeconds?: number; backoff?: BackoffOptions } = {},
): Promise<BatchResult> {
  const rows = await getDb().execute<ClaimRow>(
    sql`select * from app.claim_outbox(${options.batchSize ?? 20}, ${options.leaseSeconds ?? 60})`,
  );
  const result: BatchResult = { claimed: rows.length, succeeded: 0, retried: 0, dead: 0 };

  for (const row of rows) {
    const message: ClaimedMessage = {
      id: Number(row.id),
      orgId: row.org_id,
      topic: row.topic,
      payload: row.payload,
      attempts: row.attempts,
      maxAttempts: row.max_attempts,
    };
    try {
      await deliver(handlers, message);
      await markDone(message);
      result.succeeded++;
    } catch (err) {
      const dead = await markFailed(message, err, options.backoff ?? DEFAULT_BACKOFF);
      if (dead) result.dead++;
      else result.retried++;
    }
  }
  return result;
}

async function deliver(handlers: OutboxHandlers, message: ClaimedMessage): Promise<void> {
  if (!isOutboxTopic(message.topic)) throw new PermanentError(`Unknown topic "${message.topic}"`);
  const topic = message.topic;
  const parsed = outboxTopics[topic].safeParse(message.payload);
  if (!parsed.success)
    throw new PermanentError(`Invalid payload for ${topic}: ${parsed.error.message}`);
  const handler = handlers[topic] as (payload: unknown, m: ClaimedMessage) => Promise<void>;
  await handler(parsed.data, message);
}

async function markDone(message: ClaimedMessage): Promise<void> {
  const scrub = isOutboxTopic(message.topic) && SENSITIVE_TOPICS.has(message.topic);
  await withTenant({ orgId: message.orgId }, (tx) =>
    tx
      .update(outbox)
      .set({
        status: "done",
        processedAt: new Date(),
        lockedUntil: null,
        lastError: null,
        ...(scrub ? { payload: sql`${outbox.payload} - 'token'` } : {}),
      })
      .where(eq(outbox.id, message.id)),
  );
}

/** Returns true when the message was dead-lettered. */
async function markFailed(
  message: ClaimedMessage,
  err: unknown,
  backoff: BackoffOptions,
): Promise<boolean> {
  const permanent = err instanceof PermanentError;
  const exhausted = message.attempts >= message.maxAttempts;
  const dead = permanent || exhausted;
  const errorText = (err instanceof Error ? `${err.name}: ${err.message}` : String(err)).slice(
    0,
    2000,
  );
  await withTenant({ orgId: message.orgId }, (tx) =>
    tx
      .update(outbox)
      .set({
        status: dead ? "dead" : "pending",
        lockedUntil: null,
        lastError: errorText,
        availableAt: dead
          ? undefined
          : new Date(Date.now() + backoffDelayMs(message.attempts, backoff)),
      })
      .where(eq(outbox.id, message.id)),
  );
  if (dead)
    console.error(`[outbox] message ${message.id} (${message.topic}) dead-lettered: ${errorText}`);
  return dead;
}

/** Periodic housekeeping across tenants, via the SECURITY DEFINER functions. */
export async function runMaintenance(): Promise<{ expiredHolds: number; deadLettered: number }> {
  const db = getDb();
  const [holds] = await db.execute<{ n: number }>(sql`select app.expire_stale_holds() as n`);
  const [dead] = await db.execute<{ n: number }>(
    sql`select app.dead_letter_exhausted_outbox() as n`,
  );
  return { expiredHolds: holds?.n ?? 0, deadLettered: dead?.n ?? 0 };
}
