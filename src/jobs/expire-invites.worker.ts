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
    try {
      // Skip if there's a pending receipt — manager should review it first
      if (order.receipts.length > 0) {
        continue;
      }

      // Notify client FIRST (before DB mutation) so a notification failure
      // doesn't leave the order cancelled without the user knowing.
      if (!order.user) {
        console.error(`[ExpireInvites] Order #${order.id} has no user — skipping`);
        continue;
      }

      try {
        await botApi.sendMessage(
          order.user.tgUserId.toString(),
          `⏳ مهلت پرداخت سفارش #${order.id} به پایان رسید و سفارش لغو شد.\n\nدر صورت تمایل، سفارش جدید ثبت کنید.`,
        );
      } catch (notifyError) {
        console.error(`[ExpireInvites] Failed to notify user ${order.user.tgUserId} about order #${order.id} expiry:`, notifyError);
        // Continue with cleanup even if notification fails — will retry notification on next cycle
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

      // Cancel the order — only if still in a cancellable status
      const cancelled = await prisma.order.updateMany({
        where: {
          id: order.id,
          status: { in: [OrderStatus.INVITE_SENT, OrderStatus.AWAITING_RECEIPT] },
        },
        data: {
          status: OrderStatus.CANCELLED,
        },
      });

      if (cancelled.count === 0) {
        console.error(`[ExpireInvites] Order #${order.id} status changed before cancellation — skipping`);
        continue;
      }

      await prisma.orderEvent.create({
        data: {
          orderId: order.id,
          actorType: "system",
          actorId: null,
          eventType: "invite_expired",
          payload: JSON.stringify({
            expiredAt: order.inviteExpiresAt?.toISOString(),
          }),
        },
      });

      processedCount += 1;
    } catch (err) {
      console.error(`[ExpireInvites] Failed to process order #${order.id}:`, err);
    }
  }

  return processedCount;
}
