import "../../scripts/load-env";

import { closeDb } from "@/server/db/client";
import { getMailer } from "@/server/mail/mailer";
import { getPaymentProvider } from "@/server/payments";
import { purgeExpiredRateLimits } from "@/server/rate-limit";

import { createHandlers } from "./handlers";
import { processOutboxBatch, runMaintenance } from "./processor";

const POLL_INTERVAL_MS = Number(process.env.WORKER_POLL_MS ?? 1000);
const MAINTENANCE_INTERVAL_MS = 60_000;

const handlers = createHandlers({
  mailer: getMailer(),
  payments: getPaymentProvider(),
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
});

let running = true;
let wake: (() => void) | undefined;

function shutdown(signal: string) {
  console.info(`[worker] ${signal} received, finishing current batch...`);
  running = false;
  wake?.();
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    wake = () => {
      clearTimeout(t);
      resolve();
    };
  });

async function main() {
  console.info(`[worker] started (poll ${POLL_INTERVAL_MS}ms)`);
  let lastMaintenance = 0;
  while (running) {
    try {
      if (Date.now() - lastMaintenance > MAINTENANCE_INTERVAL_MS) {
        const m = await runMaintenance();
        await purgeExpiredRateLimits(new Date(Date.now() - 24 * 3600_000));
        if (m.expiredHolds || m.deadLettered) console.info("[worker] maintenance", m);
        lastMaintenance = Date.now();
      }
      const r = await processOutboxBatch(handlers);
      if (r.claimed > 0) console.info("[worker] batch", r);
      if (r.claimed === 0) await sleep(POLL_INTERVAL_MS);
    } catch (err) {
      console.error("[worker] loop error", err);
      await sleep(POLL_INTERVAL_MS * 5);
    }
  }
  await closeDb();
  console.info("[worker] stopped");
}

void main();
