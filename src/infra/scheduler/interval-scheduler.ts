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
export function startScheduler(deps: SchedulerDeps): Scheduler {
  const timers: ReturnType<typeof setInterval>[] = [];

  // ── Send invites: every 60 seconds ──
  // Picks up APPROVED orders missing invite links (fallback for inline failures)
  if (deps.checkoutChannelId) {
    const sendInvitesTimer = setInterval(async () => {
      try {
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
      } catch (err) {
        console.error("[Scheduler] send-invites job failed:", err);
      }
    }, 60_000);
    timers.push(sendInvitesTimer);
  }

  // ── Cleanup idle carts: every hour ──
  const cleanupCartsTimer = setInterval(async () => {
    try {
      await expireIdleCarts(
        { prisma: deps.prisma },
        { idleThresholdMs: 24 * 60 * 60 * 1000 },
      );
    } catch (err) {
      console.error("[Scheduler] cleanup-carts job failed:", err);
    }
  }, 60 * 60 * 1000);
  timers.push(cleanupCartsTimer);

  // ── Expire invites: every 2 minutes ──
  if (deps.checkoutChannelId) {
    const expireInvitesTimer = setInterval(async () => {
      try {
        await processExpiredInvites({
          prisma: deps.prisma,
          botApi: deps.clientBot.api,
          checkoutChannelId: deps.checkoutChannelId!,
        });
      } catch (err) {
        console.error("[Scheduler] expire-invites job failed:", err);
      }
    }, 2 * 60_000);
    timers.push(expireInvitesTimer);
  }

  console.log("✓ Background scheduler started (setInterval-based)");

  return {
    stop() {
      for (const t of timers) clearInterval(t);
      console.log("✓ Background scheduler stopped");
    },
  };
}
