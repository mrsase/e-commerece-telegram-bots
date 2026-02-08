import type { PrismaClient } from "@prisma/client";
import { OrderStatus } from "@prisma/client";
import type { InviteService } from "../services/invite-service.js";
import { NotificationTexts } from "../i18n/index.js";

export interface TelegramNotificationClient {
  sendMessage(chatId: string | number, text: string): Promise<void>;
}

export interface SendInvitesJobDeps {
  prisma: PrismaClient;
  inviteService: InviteService;
  notifier: TelegramNotificationClient;
  checkoutChannelId: string;
}

export interface SendInvitesJobOptions {
  /**
   * Optional list of user IDs to restrict processing to. When omitted, all
   * approved orders without invites will be considered.
   */
  onlyUserIds?: number[];
}

export async function processSendInvitesBatch(
  deps: SendInvitesJobDeps,
  options: SendInvitesJobOptions = {},
): Promise<number> {
  const { prisma, inviteService, notifier, checkoutChannelId } = deps;

  const orders = await prisma.order.findMany({
    where: {
      status: OrderStatus.APPROVED,
      inviteLink: null,
      ...(options.onlyUserIds && options.onlyUserIds.length > 0
        ? { userId: { in: options.onlyUserIds } }
        : {}),
    },
    include: {
      user: true,
    },
    orderBy: { id: "asc" },
  });

  let processedCount = 0;

  for (const order of orders) {
    const { inviteLink } = await inviteService.createInviteForApprovedOrder({
      orderId: order.id,
      channelId: checkoutChannelId,
    });

    const chatId = order.user.tgUserId.toString();
    const text = NotificationTexts.orderApprovedWithInvite(order.id, inviteLink);

    await notifier.sendMessage(chatId, text);
    processedCount += 1;
  }

  return processedCount;
}
