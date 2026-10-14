import { outbox } from "@/db/schema";

import type { Tx } from "../db/client";
import { type OutboxPayload, type OutboxTopic, outboxTopics } from "./topics";

export interface EnqueueOptions {
  /** Deliver no earlier than this instant (e.g. a reminder 24h before). */
  availableAt?: Date;
  /** Logical identity; a second enqueue with the same key is a no-op. */
  dedupeKey?: string;
}

/**
 * Adds a message to the outbox *inside the caller's transaction*.
 *
 * This is the whole point of the pattern: the booking row and "send the
 * confirmation" commit or roll back together. There is no window where the
 * booking exists but the email was never scheduled, or the email went out
 * for a booking that was rolled back.
 */
export async function enqueue<T extends OutboxTopic>(
  tx: Tx,
  orgId: string,
  topic: T,
  payload: OutboxPayload<T>,
  options: EnqueueOptions = {},
): Promise<void> {
  const parsed = outboxTopics[topic].parse(payload);
  await tx
    .insert(outbox)
    .values({
      orgId,
      topic,
      payload: parsed,
      availableAt: options.availableAt ?? new Date(),
      dedupeKey: options.dedupeKey ?? null,
    })
    .onConflictDoNothing({ target: [outbox.orgId, outbox.dedupeKey] });
}
