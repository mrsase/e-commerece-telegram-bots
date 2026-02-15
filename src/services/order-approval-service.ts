import type { PrismaClient } from "@prisma/client";
import { OrderStatus } from "@prisma/client";
import type { Api } from "grammy";
import { ChannelTexts, ClientTexts } from "../i18n/index.js";
import { BotSettingsService, SettingKeys } from "./bot-settings-service.js";
import { crossBotFile } from "../utils/cross-bot-file.js";

export interface OrderApprovalServiceDeps {
  prisma: PrismaClient;
  clientBotApi: Api;
  managerBotApi: Api;
  managerBotToken: string;
  managerId: number;
  checkoutChannelId?: string;
  checkoutImageFileId?: string;
  inviteExpiryMinutes: number;
}

export interface OrderApprovalResult {
  success: boolean;
  status: OrderStatus;
  inviteLink?: string | null;
  directMessageId?: number | null;
  error?: string;
}

export class OrderApprovalService {
  private settingsService: BotSettingsService;

  constructor(private readonly deps: OrderApprovalServiceDeps) {
    this.settingsService = new BotSettingsService(deps.prisma);
  }

  async approveOrder(orderId: number): Promise<OrderApprovalResult> {
    const {
      prisma,
      clientBotApi,
      managerBotApi,
      managerBotToken,
      managerId,
      checkoutChannelId,
      checkoutImageFileId,
      inviteExpiryMinutes,
    } = this.deps;

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { user: true, items: { include: { product: true } } },
    });

    if (!order) {
      return {
        success: false,
        status: OrderStatus.AWAITING_MANAGER_APPROVAL,
        error: "Order not found",
      };
    }

    if (order.status !== OrderStatus.AWAITING_MANAGER_APPROVAL) {
      return {
        success: false,
        status: order.status,
        error: `Order status is ${order.status}, expected AWAITING_MANAGER_APPROVAL`,
      };
    }

    if (!order.user) {
      return {
        success: false,
        status: order.status,
        error: "Order has no associated user",
      };
    }

    const payMethod = await this.settingsService.getPaymentMethod();
    const effectiveImageFileId =
      await this.settingsService.getCheckoutImageFileId(checkoutImageFileId);
    const effectiveExpiryMin =
      await this.settingsService.getInviteExpiryMinutes(inviteExpiryMinutes);

    const paymentCaption = ChannelTexts.paymentMessage(
      orderId,
      order.grandTotal,
      order.items[0]?.product?.currency ?? "IRR",
    );

    await prisma.order.update({
      where: { id: orderId },
      data: {
        status: OrderStatus.APPROVED,
        events: {
          create: {
            actorType: "manager",
            actorId: managerId,
            eventType: "order_approved",
          },
        },
      },
    });

    if (payMethod === "channel") {
      return await this.handleChannelMethod(
        orderId,
        order.user.tgUserId.toString(),
        paymentCaption,
        effectiveImageFileId ?? undefined,
        effectiveExpiryMin,
      );
    } else {
      return await this.handleDirectMethod(
        orderId,
        order.user.tgUserId.toString(),
        paymentCaption,
        effectiveImageFileId ?? undefined,
        effectiveExpiryMin,
      );
    }
  }

  private async handleChannelMethod(
    orderId: number,
    userTgId: string,
    paymentCaption: string,
    imageFileId: string | undefined,
    expiryMinutes: number,
  ): Promise<OrderApprovalResult> {
    const {
      prisma,
      clientBotApi,
      managerBotApi,
      managerBotToken,
      managerId,
      checkoutChannelId,
    } = this.deps;

    if (!checkoutChannelId) {
      await prisma.order.update({
        where: { id: orderId },
        data: {
          status: OrderStatus.AWAITING_RECEIPT,
          events: {
            create: {
              actorType: "manager",
              actorId: managerId,
              eventType: "approval_fallback_direct",
            },
          },
        },
      });
      return {
        success: true,
        status: OrderStatus.AWAITING_RECEIPT,
        error:
          "CHECKOUT_CHANNEL_ID not configured. Order set to AWAITING_RECEIPT for direct payment.",
      };
    }

    let checkoutImageInput: import("grammy").InputFile | null = null;
    if (imageFileId) {
      try {
        checkoutImageInput = await crossBotFile(
          managerBotApi,
          managerBotToken,
          imageFileId,
        );
      } catch (err) {
        console.error("[OrderApproval] Failed to get checkout image:", err);
      }
    }

    let channelMessageId: number | null = null;
    try {
      if (checkoutImageInput) {
        const msg = await clientBotApi.sendPhoto(
          checkoutChannelId,
          checkoutImageInput,
          {
            caption: paymentCaption,
            parse_mode: "Markdown",
          },
        );
        channelMessageId = msg.message_id;
      } else {
        const msg = await clientBotApi.sendMessage(
          checkoutChannelId,
          paymentCaption,
          {
            parse_mode: "Markdown",
          },
        );
        channelMessageId = msg.message_id;
      }
    } catch (err) {
      console.error("[OrderApproval] Failed to post channel message:", err);
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + expiryMinutes * 60 * 1000);
    const expireUnix = Math.floor(expiresAt.getTime() / 1000);

    let inviteLink: string | null = null;
    try {
      const result = await clientBotApi.createChatInviteLink(
        checkoutChannelId,
        {
          member_limit: 1,
          name: `Order #${orderId}`,
          expire_date: expireUnix,
        },
      );
      inviteLink = result.invite_link;
    } catch (err) {
      console.error("[OrderApproval] Failed to create invite link:", err);
    }

    if (!inviteLink) {
      await prisma.order.update({
        where: { id: orderId },
        data: {
          status: OrderStatus.APPROVED,
          channelMessageId,
          events: {
            create: {
              actorType: "manager",
              actorId: managerId,
              eventType: "invite_creation_failed",
              payload: JSON.stringify({ channelMessageId }),
            },
          },
        },
      });
      return {
        success: false,
        status: OrderStatus.APPROVED,
        error:
          "Failed to create invite link. Order remains APPROVED for worker retry.",
      };
    }

    await prisma.order.update({
      where: { id: orderId },
      data: {
        status: OrderStatus.INVITE_SENT,
        inviteLink,
        inviteSentAt: now,
        inviteExpiresAt: expiresAt,
        channelMessageId,
        events: {
          create: {
            actorType: "manager",
            actorId: managerId,
            eventType: "invite_sent",
            payload: JSON.stringify({
              inviteLink,
              channelMessageId,
              expiresAt: expiresAt.toISOString(),
            }),
          },
        },
      },
    });

    try {
      await clientBotApi.sendMessage(
        userTgId,
        ClientTexts.orderApprovedWithInvite(orderId, inviteLink),
        { parse_mode: "Markdown" },
      );
      // Also instruct client to send receipt after paying
      await clientBotApi.sendMessage(
        userTgId,
        `پس از پرداخت، لطفاً عکس رسید را در همین ربات ارسال کنید.`,
      );
    } catch (err) {
      console.error("[OrderApproval] Failed to send invite to client:", err);
    }

    return {
      success: true,
      status: OrderStatus.INVITE_SENT,
      inviteLink,
    };
  }

  private async handleDirectMethod(
    orderId: number,
    userTgId: string,
    paymentCaption: string,
    imageFileId: string | undefined,
    expiryMinutes: number,
  ): Promise<OrderApprovalResult> {
    const { prisma, clientBotApi, managerBotApi, managerBotToken, managerId } =
      this.deps;

    let checkoutImageInput: import("grammy").InputFile | null = null;
    if (imageFileId) {
      try {
        checkoutImageInput = await crossBotFile(
          managerBotApi,
          managerBotToken,
          imageFileId,
        );
      } catch (err) {
        console.error("[OrderApproval] Failed to get checkout image:", err);
      }
    }

    let directMessageId: number | null = null;

    try {
      if (checkoutImageInput) {
        const msg = await clientBotApi.sendPhoto(userTgId, checkoutImageInput, {
          caption: paymentCaption,
          parse_mode: "Markdown",
        });
        directMessageId = msg.message_id;
      } else {
        const msg = await clientBotApi.sendMessage(userTgId, paymentCaption, {
          parse_mode: "Markdown",
        });
        directMessageId = msg.message_id;
      }
    } catch (err) {
      console.error(
        "[OrderApproval] Failed to send payment details to client:",
        err,
      );
      try {
        const msg = await clientBotApi.sendMessage(
          userTgId,
          paymentCaption.replace(/[*_`\[]/g, ""),
        );
        directMessageId = msg.message_id;
      } catch (err2) {
        console.error("[OrderApproval] Retry also failed:", err2);
      }
    }

    try {
      await clientBotApi.sendMessage(
        userTgId,
        `✅ سفارش #${orderId} تأیید شد.\n\nپس از پرداخت، عکس رسید را همینجا ارسال کنید.`,
      );
    } catch (err) {
      console.error("[OrderApproval] Failed to send receipt instruction:", err);
    }

    await prisma.order.update({
      where: { id: orderId },
      data: {
        status: OrderStatus.AWAITING_RECEIPT,
        channelMessageId: directMessageId,
        inviteSentAt: new Date(),
        events: {
          create: {
            actorType: "manager",
            actorId: managerId,
            eventType: "payment_details_sent_direct",
            payload: JSON.stringify({ directMessageId }),
          },
        },
      },
    });

    if (directMessageId) {
      const deleteDelayMs = expiryMinutes * 60 * 1000;
      setTimeout(async () => {
        try {
          await clientBotApi.deleteMessage(userTgId, directMessageId!);
          console.log(
            `[AUTO-DELETE] Deleted payment message ${directMessageId} for order #${orderId}`,
          );
        } catch (err) {
          console.error(
            `[AUTO-DELETE] Failed to delete message ${directMessageId}:`,
            err,
          );
        }
      }, deleteDelayMs);
    }

    return {
      success: true,
      status: OrderStatus.AWAITING_RECEIPT,
      directMessageId,
    };
  }
}
