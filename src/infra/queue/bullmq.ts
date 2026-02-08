import type { PrismaClient } from "@prisma/client";
import { Queue, Worker } from "bullmq";
import { Redis as IORedis } from "ioredis";
import type { AnyBot } from "../telegram/bots.js";
import {
  InviteService,
  type TelegramInviteClient,
} from "../../services/invite-service.js";
import {
  processSendInvitesBatch,
  type TelegramNotificationClient,
} from "../../jobs/send-invites.worker.js";
import { expireIdleCarts } from "../../jobs/cleanup-carts.worker.js";

export interface QueueSetupDeps {
  prisma: PrismaClient;
  redisUrl: string;
  clientBot: AnyBot;
  checkoutChannelId: string;
}

export interface QueueManager {
  sendInvitesQueue: Queue;
  cleanupCartsQueue: Queue;
  close(): Promise<void>;
}

export async function setupQueues(deps: QueueSetupDeps): Promise<QueueManager> {
  const connection = new IORedis(deps.redisUrl);

  const sendInvitesQueue = new Queue("send_invites", { connection });
  const cleanupCartsQueue = new Queue("cleanup_carts", { connection });

  const telegramInviteClient: TelegramInviteClient = {
    async createInviteLink({ chatId }) {
      const res = await deps.clientBot.api.createChatInviteLink(chatId as never);
      return { inviteLink: res.invite_link };
    },
  };

  const notifier: TelegramNotificationClient = {
    async sendMessage(chatId, text) {
      await deps.clientBot.api.sendMessage(chatId, text);
    },
  };

  const inviteService = new InviteService(deps.prisma, telegramInviteClient);

  const sendInvitesWorker = new Worker(
    "send_invites",
    async (job) => {
      await processSendInvitesBatch(
        {
          prisma: deps.prisma,
          inviteService,
          notifier,
          checkoutChannelId: deps.checkoutChannelId,
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

  // Simple repeatable jobs: invites every minute, cart cleanup hourly.
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

  return {
    sendInvitesQueue,
    cleanupCartsQueue,
    async close() {
      await Promise.all([
        sendInvitesWorker.close(),
        cleanupCartsWorker.close(),
        sendInvitesQueue.close(),
        cleanupCartsQueue.close(),
        connection.quit(),
      ]);
    },
  };
}
