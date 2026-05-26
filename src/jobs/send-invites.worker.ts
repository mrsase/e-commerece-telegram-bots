import type { PrismaClient } from "@prisma/client";
import { OrderStatus } from "@prisma/client";
import type { Api } from "grammy";
import { ClientTexts, ChannelTexts } from "../i18n/index.js";
import { BotSettingsService } from "../services/bot-settings-service.js";

export interface SendInvitesJobDeps {
  prisma: PrismaClient;
  botApi: Api;
  checkoutChannelId: string;
  checkoutImageFileId?: string;
  inviteExpiryMinutes: number;
}

export interface SendInvitesJobOptions {
  /**
   * Optional list of user IDs to restrict processing to. When omitted, all
   * approved orders without invites will be considered.
   */
  onlyUserIds?: number[];
}

/**
 * Fallback worker: picks up APPROVED orders that don't have an invite yet
 * (e.g. because the inline creation in the approval handler failed) and
 * performs the full channel workflow:
 *  1. Post payment message to checkout channel
 *  2. Create time-limited invite link
 *  3. Store channelMessageId, inviteLink, inviteExpiresAt on order
 *  4. Notify the client
 */
export async function processSendInvitesBatch(
  deps: SendInvitesJobDeps,
  options: SendInvitesJobOptions = {},
): Promise<number> {
  const { prisma, botApi, checkoutChannelId, checkoutImageFileId, inviteExpiryMinutes } = deps;
  const settingsService = new BotSettingsService(prisma);

  // Read runtime settings (DB overrides env)
  const effectiveImageFileId = await settingsService.getCheckoutImageFileId(checkoutImageFileId);
  const effectiveExpiryMin = await settingsService.getInviteExpiryMinutes(inviteExpiryMinutes);

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
      items: { include: { product: true } },
    },
    orderBy: { id: "asc" },
  });

  let processedCount = 0;

  for (const order of orders) {
    try {
      // 1) Create time-limited invite link FIRST (before channel message)
      //    so that any failure after this point won't cause duplicate messages on retry.
      const now = new Date();
      const expiresAt = new Date(now.getTime() + effectiveExpiryMin * 60 * 1000);
      const expireUnix = Math.floor(expiresAt.getTime() / 1000);

      const result = await botApi.createChatInviteLink(checkoutChannelId, {
        member_limit: 1,
        name: `Order #${order.id}`,
        expire_date: expireUnix,
      });
      const inviteLink = result.invite_link;

      // 2) Post payment message to channel
      const paymentCaption = ChannelTexts.paymentMessage(
        order.id,
        order.grandTotal,
        order.items[0]?.product?.currency ?? "IRR",
      );

      let channelMessageId: number | null = null;
      try {
        if (effectiveImageFileId) {
          const msg = await botApi.sendPhoto(checkoutChannelId, effectiveImageFileId, {
            caption: paymentCaption,
            parse_mode: "Markdown",
          });
          channelMessageId = msg.message_id;
        } else {
          const msg = await botApi.sendMessage(checkoutChannelId, paymentCaption, {
            parse_mode: "Markdown",
          });
          channelMessageId = msg.message_id;
        }
      } catch (error) {
        console.error(`[SendInvites] Failed to post channel message for order #${order.id}:`, error);
      }

      // 3) Notify client FIRST (before DB mutation) so a notification failure
      //    doesn't leave the order stuck in INVITE_SENT with no user awareness.
      if (!order.user) {
        console.error(`[SendInvites] Order #${order.id} has no user — skipping`);
        continue;
      }

      try {
        await botApi.sendMessage(
          order.user.tgUserId.toString(),
          ClientTexts.orderApprovedWithInvite(order.id, inviteLink),
          { parse_mode: "Markdown" },
        );
      } catch (notifyError) {
        console.error(`[SendInvites] Failed to notify user for order #${order.id}:`, notifyError);
        // Continue anyway — the invite exists and the scheduler will retry.
      }

      // 4) Update order (persist invite + optional channelMessageId)
      // Use updateMany with status guard to prevent duplicate processing
      const updateResult = await prisma.order.updateMany({
        where: { id: order.id, status: OrderStatus.APPROVED },
        data: {
          status: OrderStatus.INVITE_SENT,
          inviteLink,
          inviteSentAt: now,
          inviteExpiresAt: expiresAt,
          channelMessageId,
        },
      });

      if (updateResult.count === 0) {
        console.error(`[SendInvites] Order #${order.id} was already processed (status changed) — skipping`);
        continue;
      }

      await prisma.orderEvent.create({
        data: {
          orderId: order.id,
          actorType: "system",
          actorId: null,
          eventType: "invite_sent",
          payload: JSON.stringify({ inviteLink, channelMessageId, expiresAt: expiresAt.toISOString() }),
        },
      });

      processedCount += 1;
    } catch (error) {
      console.error(`[SendInvites] Failed to process order #${order.id}:`, error);
    }
  }

  return processedCount;
}
