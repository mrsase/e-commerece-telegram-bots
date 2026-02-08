import type { PrismaClient } from "@prisma/client";
import { OrderStatus } from "@prisma/client";
import type { Api } from "grammy";
import { cleanupChannelForOrder } from "../services/channel-cleanup-service.js";

export interface ExpireInvitesDeps {
  prisma: PrismaClient;
  botApi: Api;
  checkoutChannelId: string;
}

/**
 * Find all orders whose invite has expired (inviteExpiresAt < now) and
 * status is still INVITE_SENT or AWAITING_RECEIPT, then:
 *  1. Delete the channel payment message
 *  2. Revoke the invite link
 *  3. Kick the user from the channel
 *  4. Update the order status to CANCELLED
 *
 * Only cancels if the user has NO pending receipts for that order.
 */
export async function processExpiredInvites(
  deps: ExpireInvitesDeps,
): Promise<number> {
  const { prisma, botApi, checkoutChannelId } = deps;
  const now = new Date();

  const expiredOrders = await prisma.order.findMany({
    where: {
      inviteExpiresAt: { lt: now },
      status: { in: [OrderStatus.INVITE_SENT, OrderStatus.AWAITING_RECEIPT] },
      inviteLink: { not: null },
    },
    include: {
      user: true,
      receipts: {
        where: { reviewStatus: "PENDING" },
      },
    },
    orderBy: { id: "asc" },
  });

  let processedCount = 0;

  for (const order of expiredOrders) {
    // Skip if there's a pending receipt — manager should review it first
    if (order.receipts.length > 0) {
      continue;
    }

    // Cleanup channel resources
    await cleanupChannelForOrder(
      { prisma, botApi, checkoutChannelId },
      {
        orderId: order.id,
        channelMessageId: order.channelMessageId,
        inviteLink: order.inviteLink,
        userTgId: order.user.tgUserId,
      },
    );

    // Cancel the order
    await prisma.order.update({
      where: { id: order.id },
      data: {
        status: OrderStatus.CANCELLED,
        events: {
          create: {
            actorType: "system",
            actorId: null,
            eventType: "invite_expired",
            payload: JSON.stringify({
              expiredAt: order.inviteExpiresAt?.toISOString(),
            }),
          },
        },
      },
    });

    // Notify client that their invite expired
    try {
      await botApi.sendMessage(
        order.user.tgUserId.toString(),
        `⏳ مهلت پرداخت سفارش #${order.id} به پایان رسید و سفارش لغو شد.\n\nدر صورت تمایل، سفارش جدید ثبت کنید.`,
      );
    } catch (error) {
      console.error(`[ExpireInvites] Failed to notify user ${order.user.tgUserId} about order #${order.id} expiry:`, error);
    }

    processedCount += 1;
  }

  return processedCount;
}
