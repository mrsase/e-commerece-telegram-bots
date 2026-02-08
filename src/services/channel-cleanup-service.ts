import type { PrismaClient } from "@prisma/client";
import type { Api } from "grammy";

/**
 * Handles cleanup of checkout channel resources when an order's payment
 * phase ends (receipt approved, invite expired, order cancelled, etc.).
 *
 * Operations:
 *  1. Delete the payment message from the channel
 *  2. Revoke the invite link
 *  3. Kick (unban after ban) the user from the channel
 *  4. Clear channel-related fields on the order
 */

export interface ChannelCleanupDeps {
  prisma: PrismaClient;
  botApi: Api;
  checkoutChannelId: string;
}

export interface ChannelCleanupTarget {
  orderId: number;
  channelMessageId: number | null;
  inviteLink: string | null;
  userTgId: bigint;
}

export async function cleanupChannelForOrder(
  deps: ChannelCleanupDeps,
  target: ChannelCleanupTarget,
): Promise<void> {
  const { botApi, checkoutChannelId, prisma } = deps;
  const { orderId, channelMessageId, inviteLink, userTgId } = target;

  // 1) Delete the payment message from the channel
  if (channelMessageId) {
    try {
      await botApi.deleteMessage(checkoutChannelId, channelMessageId);
    } catch (error) {
      console.error(`[ChannelCleanup] Failed to delete channel message ${channelMessageId} for order #${orderId}:`, error);
    }
  }

  // 2) Revoke the invite link
  if (inviteLink) {
    try {
      await botApi.revokeChatInviteLink(checkoutChannelId, inviteLink);
    } catch (error) {
      console.error(`[ChannelCleanup] Failed to revoke invite link for order #${orderId}:`, error);
    }
  }

  // 3) Kick the user from the channel (ban then unban so they can be re-invited later)
  try {
    await botApi.banChatMember(checkoutChannelId, Number(userTgId));
    // Immediately unban so they aren't permanently blocked from the channel
    await botApi.unbanChatMember(checkoutChannelId, Number(userTgId), {
      only_if_banned: true,
    });
  } catch (error) {
    // User might not have joined the channel — that's OK
    console.error(`[ChannelCleanup] Failed to kick user ${userTgId} from channel for order #${orderId}:`, error);
  }

  // 4) Clear channel fields on the order so we don't try again
  await prisma.order.update({
    where: { id: orderId },
    data: {
      channelMessageId: null,
      inviteLink: null,
    },
  });
}
