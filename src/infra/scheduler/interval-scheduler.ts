import type { PrismaClient } from "@prisma/client";
import type { AnyBot } from "../telegram/bots.js";
import { processSendInvitesBatch } from "../../jobs/send-invites.worker.js";
import { expireIdleCarts } from "../../jobs/cleanup-carts.worker.js";
import { processExpiredInvites } from "../../jobs/expire-invites.worker.js";

export interface SchedulerDeps {
  prisma: PrismaClient;
  clientBot: AnyBot;
  checkoutChannelId?: string;
  checkoutImageFileId?: string;
  inviteExpiryMinutes: number;
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

  // ── Send invites: every 60 seconds ──
  // Picks up APPROVED orders missing invite links (fallback for inline failures)
  if (deps.checkoutChannelId) {
    createGuardedJob("send-invites", async () => {
      await processSendInvitesBatch(
        {
          prisma: deps.prisma,
          botApi: deps.clientBot.api,
          checkoutChannelId: deps.checkoutChannelId!,
          checkoutImageFileId: deps.checkoutImageFileId,
          inviteExpiryMinutes: deps.inviteExpiryMinutes,
        },
        {},
      );
    }, 60_000, timers);
  }

  // ── Cleanup idle carts: every hour ──
  createGuardedJob("cleanup-carts", async () => {
    await expireIdleCarts(
      { prisma: deps.prisma },
      { idleThresholdMs: 24 * 60 * 60 * 1000 },
    );
  }, 60 * 60 * 1000, timers);

  // ── Expire invites: every 2 minutes ──
  if (deps.checkoutChannelId) {
    createGuardedJob("expire-invites", async () => {
      await processExpiredInvites({
        prisma: deps.prisma,
        botApi: deps.clientBot.api,
        checkoutChannelId: deps.checkoutChannelId!,
      });
    }, 2 * 60_000, timers);
  }

  console.log("✓ Background scheduler started (setInterval-based)");

  return {
    stop() {
      for (const t of timers) clearInterval(t);
      console.log("✓ Background scheduler stopped");
    },
  };
}
