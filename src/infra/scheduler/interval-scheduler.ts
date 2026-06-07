import type { PrismaClient } from "@prisma/client";
import { expireIdleCarts } from "../../jobs/cleanup-carts.worker.js";

export interface SchedulerDeps {
  prisma: PrismaClient;
}

export interface Scheduler {
  stop(): void;
}

/**
 * Simple setInterval-based scheduler that replaces BullMQ.
 * Runs periodic jobs using plain Node.js timers.
 */
function createGuardedJob(
  name: string,
  fn: () => Promise<void>,
  intervalMs: number,
  timers: ReturnType<typeof setInterval>[],
): void {
  let running = false;
  const timer = setInterval(async () => {
    if (running) {
      console.warn(`[Scheduler] ${name} skipped — previous run still in progress`);
      return;
    }
    running = true;
    try {
      await fn();
    } catch (err) {
      console.error(`[Scheduler] ${name} job failed:`, err);
    } finally {
      running = false;
    }
  }, intervalMs);
  timers.push(timer);
}

export function startScheduler(deps: SchedulerDeps): Scheduler {
  const timers: ReturnType<typeof setInterval>[] = [];

  // ── Cleanup idle carts: every hour ──
  createGuardedJob("cleanup-carts", async () => {
    await expireIdleCarts(
      { prisma: deps.prisma },
      { idleThresholdMs: 24 * 60 * 60 * 1000 },
    );
  }, 60 * 60 * 1000, timers);

  console.log("✓ Background scheduler started (setInterval-based)");

  return {
    stop() {
      for (const t of timers) clearInterval(t);
      console.log("✓ Background scheduler stopped");
    },
  };
}
