import type { PrismaClient } from "@prisma/client";
import { Queue, Worker } from "bullmq";
import { Redis as IORedis } from "ioredis";
import type { AnyBot } from "../telegram/bots.js";
import { processSendInvitesBatch } from "../../jobs/send-invites.worker.js";
import { expireIdleCarts } from "../../jobs/cleanup-carts.worker.js";
import { processExpiredInvites } from "../../jobs/expire-invites.worker.js";

export interface QueueSetupDeps {
  prisma: PrismaClient;
  redisUrl: string;
  clientBot: AnyBot;
  checkoutChannelId: string;
  checkoutImageFileId?: string;
  inviteExpiryMinutes: number;
}

export interface QueueManager {
  sendInvitesQueue: Queue;
  cleanupCartsQueue: Queue;
  expireInvitesQueue: Queue;
  close(): Promise<void>;
}

export async function setupQueues(deps: QueueSetupDeps): Promise<QueueManager> {
  const connection = new IORedis(deps.redisUrl);

  const sendInvitesQueue = new Queue("send_invites", { connection });
  const cleanupCartsQueue = new Queue("cleanup_carts", { connection });

  const sendInvitesWorker = new Worker(
    "send_invites",
    async (job) => {
      await processSendInvitesBatch(
        {
          prisma: deps.prisma,
          botApi: deps.clientBot.api,
          checkoutChannelId: deps.checkoutChannelId,
          checkoutImageFileId: deps.checkoutImageFileId,
          inviteExpiryMinutes: deps.inviteExpiryMinutes,
        },
        (job.data?.options as { onlyUserIds?: number[] } | undefined) ?? {},
      );
    },
    { connection },
  );

  const cleanupCartsWorker = new Worker(
    "cleanup_carts",
    async (job) => {
      const idleMs = typeof job.data?.idleThresholdMs === "number" && job.data.idleThresholdMs > 0
        ? job.data.idleThresholdMs
        : 24 * 60 * 60 * 1000; // default 24h

      await expireIdleCarts(
        { prisma: deps.prisma },
        { idleThresholdMs: idleMs },
      );
    },
    { connection },
  );

  const expireInvitesQueue = new Queue("expire_invites", { connection });

  const expireInvitesWorker = new Worker(
    "expire_invites",
    async () => {
      await processExpiredInvites({
        prisma: deps.prisma,
        botApi: deps.clientBot.api,
        checkoutChannelId: deps.checkoutChannelId,
      });
    },
    { connection },
  );

  // Simple repeatable jobs: invites every minute, cart cleanup hourly, expire check every 2 min.
  await sendInvitesQueue.add(
    "send_invites",
    { options: {} },
    { repeat: { every: 60_000 }, jobId: "send_invites_every_minute" },
  );

  await cleanupCartsQueue.add(
    "cleanup_carts",
    { idleThresholdMs: 24 * 60 * 60 * 1000 },
    { repeat: { every: 60 * 60 * 1000 }, jobId: "cleanup_carts_hourly" },
  );

  await expireInvitesQueue.add(
    "expire_invites",
    {},
    { repeat: { every: 2 * 60_000 }, jobId: "expire_invites_every_2min" },
  );

  return {
    sendInvitesQueue,
    cleanupCartsQueue,
    expireInvitesQueue,
    async close() {
      await Promise.all([
        sendInvitesWorker.close(),
        cleanupCartsWorker.close(),
        expireInvitesWorker.close(),
        sendInvitesQueue.close(),
        cleanupCartsQueue.close(),
        expireInvitesQueue.close(),
        connection.quit(),
      ]);
    },
  };
}
