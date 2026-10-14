import { after } from "next/server";

import { isDemoMode } from "@/server/demo/mode";
import { getMailer } from "@/server/mail/mailer";
import { getPaymentProvider } from "@/server/payments";
import { createHandlers } from "@/worker/handlers";
import { type BatchResult, processOutboxBatch, runMaintenance } from "@/worker/processor";

/**
 * One worker tick, for platforms without a long-running process (Vercel):
 * housekeeping, then deliver whatever is due. Same code path as the worker.
 */
export async function drainOutbox(
  options: { batches?: number } = {},
): Promise<{ maintenance: Awaited<ReturnType<typeof runMaintenance>>; batches: BatchResult[] }> {
  const handlers = createHandlers({
    mailer: getMailer(),
    payments: getPaymentProvider(),
    appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  });
  const maintenance = await runMaintenance();
  const batches: BatchResult[] = [];
  for (let i = 0; i < (options.batches ?? 5); i++) {
    const result = await processOutboxBatch(handlers);
    batches.push(result);
    if (result.claimed === 0) break;
  }
  return { maintenance, batches };
}

/**
 * In demo mode there is no worker, so after a request that may have enqueued
 * messages, deliver them once the response is sent (`after`). The cron route
 * is the safety net for anything this misses (e.g. reminders that come due).
 */
export function drainOutboxAfterResponse(): void {
  if (!isDemoMode()) return;
  after(async () => {
    try {
      await drainOutbox({ batches: 1 });
    } catch (err) {
      console.error("[outbox] in-request drain failed", err);
    }
  });
}
