import { z } from "zod";

/**
 * Every message the outbox can carry, with its payload schema. The worker
 * re-validates payloads on the way out, so a bad row fails loudly (and
 * dead-letters) instead of sending a half-filled email.
 */
export const outboxTopics = {
  "booking.confirmed": z.object({ bookingId: z.uuid() }),
  "booking.reminder": z.object({ bookingId: z.uuid() }),
  "booking.cancelled": z.object({
    bookingId: z.uuid(),
    cancelledBy: z.enum(["customer", "business"]),
  }),
  "invitation.created": z.object({ invitationId: z.uuid(), token: z.string().min(20).optional() }),
  "payment.refund_required": z.object({ paymentId: z.uuid(), reason: z.string() }),
} as const;

export type OutboxTopic = keyof typeof outboxTopics;
export type OutboxPayload<T extends OutboxTopic> = z.infer<(typeof outboxTopics)[T]>;

export function isOutboxTopic(value: string): value is OutboxTopic {
  return Object.hasOwn(outboxTopics, value);
}

/** Topics whose payload carries secrets that must not outlive delivery. */
export const SENSITIVE_TOPICS: ReadonlySet<OutboxTopic> = new Set(["invitation.created"]);
