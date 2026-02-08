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
      // 1) Post payment message to channel
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

      // 2) Create time-limited invite link
      const now = new Date();
      const expiresAt = new Date(now.getTime() + effectiveExpiryMin * 60 * 1000);
      const expireUnix = Math.floor(expiresAt.getTime() / 1000);

      const result = await botApi.createChatInviteLink(checkoutChannelId, {
        member_limit: 1,
        name: `Order #${order.id}`,
        expire_date: expireUnix,
      });
      const inviteLink = result.invite_link;

      // 3) Update order
      await prisma.order.update({
        where: { id: order.id },
        data: {
          status: OrderStatus.INVITE_SENT,
          inviteLink,
          inviteSentAt: now,
          inviteExpiresAt: expiresAt,
          channelMessageId,
          events: {
            create: {
              actorType: "system",
              actorId: null,
              eventType: "invite_sent",
              payload: JSON.stringify({ inviteLink, channelMessageId, expiresAt: expiresAt.toISOString() }),
            },
          },
        },
      });

      // 4) Notify client
      await botApi.sendMessage(
        order.user.tgUserId.toString(),
        ClientTexts.orderApprovedWithInvite(order.id, inviteLink),
        { parse_mode: "Markdown" },
      );

      processedCount += 1;
    } catch (error) {
      console.error(`[SendInvites] Failed to process order #${order.id}:`, error);
    }
  }

  return processedCount;
}
