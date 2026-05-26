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

  let messageDeleted = false;
  let linkRevoked = false;
  let userKicked = false;

  // 1) Delete the payment message from the channel
  if (channelMessageId) {
    try {
      await botApi.deleteMessage(checkoutChannelId, channelMessageId);
      messageDeleted = true;
    } catch (error) {
      console.error(`[ChannelCleanup] Failed to delete channel message ${channelMessageId} for order #${orderId}:`, error);
    }
  }

  // 2) Revoke the invite link
  if (inviteLink) {
    try {
      await botApi.revokeChatInviteLink(checkoutChannelId, inviteLink);
      linkRevoked = true;
    } catch (error) {
      console.error(`[ChannelCleanup] Failed to revoke invite link for order #${orderId}:`, error);
    }
  }

  // 3) Kick the user from the channel (ban then unban so they can be re-invited later)
  try {
    await botApi.banChatMember(checkoutChannelId, Number(userTgId));
    await botApi.unbanChatMember(checkoutChannelId, Number(userTgId), {
      only_if_banned: true,
    });
    userKicked = true;
  } catch (error) {
    // User might not have joined the channel — that's OK
    console.error(`[ChannelCleanup] Failed to kick user ${userTgId} from channel for order #${orderId}:`, error);
  }

  // 4) Only clear fields that were successfully cleaned up.
  //    If an operation failed, keep the field so retry can attempt again.
  const updateData: Record<string, null> = {};
  if (messageDeleted) updateData.channelMessageId = null;
  if (linkRevoked) updateData.inviteLink = null;
  if (userKicked) {
    // Clear all channel fields only after all critical operations succeed
    updateData.channelMessageId = null;
    updateData.inviteLink = null;
  }

  if (Object.keys(updateData).length > 0) {
    await prisma.order.update({
      where: { id: orderId },
      data: updateData,
    });
  }
}
