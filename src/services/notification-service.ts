import type { Bot } from "grammy";
import { InlineKeyboard } from "grammy";
import type { PrismaClient } from "@prisma/client";
import { safeSendMessage } from "../utils/safe-reply.js";
import { ClientTexts } from "../i18n/index.js";
import { formatPrice } from "../utils/format-price.js";
import { escapeMarkdown } from "../utils/escape-markdown.js";

export interface NotificationServiceDeps {
  prisma: PrismaClient;
  clientBot?: Bot;
  managerBot?: Bot;
  courierBot?: Bot;
}

/**
 * Centralized cross-bot notification service.
 * All inter-bot messaging goes through here.
 */
export interface OrderItemInfo {
  title: string;
  qty: number;
  lineTotal: number;
}

export class NotificationService {
  constructor(private readonly deps: NotificationServiceDeps) {}

  // ─── Notify managers ────────────────────────────────────

  /** Notify all active managers about a new order with full details */
  async notifyManagersNewOrder(
    orderId: number,
    userName: string,
    phone: string | null,
    address: string | null,
    subtotal: number,
    discountTotal: number,
    grandTotal: number,
    items: OrderItemInfo[],
  ): Promise<void> {
    const bot = this.deps.managerBot;
    if (!bot) return;

    const managers = await this.deps.prisma.manager.findMany({
      where: { isActive: true },
    });

    const esc = escapeMarkdown;
    let text = `🔔 *سفارش جدید #${orderId}*\n`;
    text += `━━━━━━━━━━━━━━━\n`;
    text += `👤 مشتری: ${esc(userName)}\n`;
    text += `📱 تلفن: ${phone ? esc(phone) : '—'}\n`;
    text += `🏠 آدرس: ${address ? esc(address) : '—'}\n\n`;
    text += `*اقلام:*\n`;
    for (const item of items) {
      text += `  ${esc(item.title)} x${item.qty} = ${formatPrice(item.lineTotal)}\n`;
    }
    text += `\nجمع: ${formatPrice(subtotal)}\n`;
    if (discountTotal > 0) text += `تخفیف: ${formatPrice(discountTotal)}\n`;
    text += `*نهایی: ${formatPrice(grandTotal)}*\n`;

    const keyboard = new InlineKeyboard()
      .text("📋 مشاهده سفارش", `mgr:order:${orderId}`);

    for (const mgr of managers) {
      try {
        await safeSendMessage(bot.api, mgr.tgUserId.toString(), text, {
          parse_mode: "Markdown",
          reply_markup: keyboard,
        });
      } catch (err) {
        console.error(`[Notification] Failed to notify manager ${mgr.tgUserId} about new order:`, err);
      }
    }
  }

  /** Notify all active managers about a new receipt submission */
  async notifyManagersNewReceipt(orderId: number, userLabel: string, receiptId: number): Promise<void> {
    const bot = this.deps.managerBot;
    if (!bot) return;

    const managers = await this.deps.prisma.manager.findMany({
      where: { isActive: true },
    });

    const text = NotificationServiceTexts.newReceiptForManager(orderId, userLabel);
    const keyboard = new InlineKeyboard()
      .text("🖼 مشاهده رسید", `mgr:receipt:show:${receiptId}`)
      .row()
      .text("✅ تأیید رسید", `mgr:receipt:approve:${receiptId}`)
      .text("❌ رد رسید", `mgr:receipt:reject:${receiptId}`)
      .row()
      .text("📋 مشاهده سفارش", `mgr:order:${orderId}`);

    for (const mgr of managers) {
      try {
        await safeSendMessage(bot.api, mgr.tgUserId.toString(), text, { reply_markup: keyboard });
      } catch (err) {
        console.error(`[Notification] Failed to notify manager ${mgr.tgUserId} about new receipt:`, err);
      }
    }
  }

  /** Notify all active managers about a new support message */
  async notifyManagersNewSupportMessage(conversationId: number, userLabel: string, messageText: string): Promise<void> {
    const bot = this.deps.managerBot;
    if (!bot) return;

    const managers = await this.deps.prisma.manager.findMany({
      where: { isActive: true },
    });

    const text = `💬 *پیام جدید پشتیبانی*\n` +
      `گفتگو #${conversationId}\n` +
      `از: ${escapeMarkdown(userLabel)}\n\n` +
      `${escapeMarkdown(messageText)}`;

    const keyboard = new InlineKeyboard()
      .text("✍️ پاسخ", `mgr:support:reply:${conversationId}`);

    for (const mgr of managers) {
      try {
        await safeSendMessage(bot.api, mgr.tgUserId.toString(), text, {
          parse_mode: "Markdown",
          reply_markup: keyboard,
        });
      } catch (err) {
        console.error(`[Notification] Failed to notify manager ${mgr.tgUserId} about new support message:`, err);
      }
    }
  }

  // ─── Notify client ──────────────────────────────────────

  /** Notify client that their order was rejected */
  async notifyClientOrderRejected(userTgId: bigint, orderId: number, reason?: string): Promise<void> {
    const bot = this.deps.clientBot;
    if (!bot) return;

    const text = ClientTexts.orderRejected(orderId, reason);
    await safeSendMessage(bot.api, userTgId.toString(), text);
  }

  /** Notify client that their receipt was approved */
  async notifyClientReceiptApproved(userTgId: bigint, orderId: number, etaText?: string): Promise<void> {
    const bot = this.deps.clientBot;
    if (!bot) return;

    const text = ClientTexts.receiptApproved(orderId, etaText);
    await safeSendMessage(bot.api, userTgId.toString(), text);
  }

  /** Notify client that their receipt was rejected */
  async notifyClientReceiptRejected(userTgId: bigint, orderId: number, reason?: string): Promise<void> {
    const bot = this.deps.clientBot;
    if (!bot) return;

    const text = ClientTexts.receiptRejected(orderId, reason);
    await safeSendMessage(bot.api, userTgId.toString(), text);
  }

  /** Notify client about delivery status update */
  async notifyClientDeliveryUpdate(userTgId: bigint, orderId: number, statusLabel: string, extraText?: string): Promise<void> {
    const bot = this.deps.clientBot;
    if (!bot) return;

    const text = NotificationServiceTexts.deliveryStatusForClient(orderId, statusLabel, extraText);
    await safeSendMessage(bot.api, userTgId.toString(), text);
  }

  /** Notify client about support reply from manager */
  async notifyClientSupportReply(userTgId: bigint, replyText: string, conversationId: number): Promise<void> {
    const bot = this.deps.clientBot;
    if (!bot) return;

    const text = ClientTexts.supportReplyFromManager(replyText);
    const keyboard = new InlineKeyboard()
      .text("✍️ پاسخ به پشتیبان", `client:support:reply:${conversationId}`);
    await safeSendMessage(bot.api, userTgId.toString(), text, { reply_markup: keyboard });
  }

  /** Notify client that support conversation was closed */
  async notifyClientSupportClosed(userTgId: bigint): Promise<void> {
    const bot = this.deps.clientBot;
    if (!bot) return;

    await safeSendMessage(bot.api, userTgId.toString(), ClientTexts.supportClosed());
  }

  // ─── Notify courier ─────────────────────────────────────

  /** Notify courier about a new delivery assignment */
  async notifyCourierNewDelivery(
    courierTgId: bigint,
    orderId: number,
    customerName: string,
    phone: string,
    address: string,
  ): Promise<void> {
    const bot = this.deps.courierBot;
    if (!bot) return;

    const text = NotificationServiceTexts.newDeliveryForCourier(orderId, customerName, phone, address);
    await safeSendMessage(bot.api, courierTgId.toString(), text);
  }

  /** Notify managers about delivery failure */
  async notifyManagersDeliveryFailed(orderId: number, reason: string): Promise<void> {
    const bot = this.deps.managerBot;
    if (!bot) return;

    const managers = await this.deps.prisma.manager.findMany({
      where: { isActive: true },
    });

    const text = NotificationServiceTexts.deliveryFailedForManager(orderId, reason);
    const keyboard = new InlineKeyboard()
      .text("📋 مشاهده سفارش", `mgr:order:${orderId}`);

    for (const mgr of managers) {
      try {
        await safeSendMessage(bot.api, mgr.tgUserId.toString(), text, { reply_markup: keyboard });
      } catch (err) {
        console.error(`[Notification] Failed to notify manager ${mgr.tgUserId} about delivery failure:`, err);
      }
    }
  }

  /** Notify managers about any delivery status change */
  async notifyManagersDeliveryStatusChange(orderId: number, statusLabel: string, courierLabel: string): Promise<void> {
    const bot = this.deps.managerBot;
    if (!bot) return;

    const managers = await this.deps.prisma.manager.findMany({
      where: { isActive: true },
    });

    const text = NotificationServiceTexts.deliveryStatusForManager(orderId, statusLabel, courierLabel);
    for (const mgr of managers) {
      try {
        await safeSendMessage(bot.api, mgr.tgUserId.toString(), text);
      } catch (err) {
        console.error(`[Notification] Failed to notify manager ${mgr.tgUserId} about delivery status:`, err);
      }
    }
  }
}

// ─── Notification-specific texts (added to centralized i18n later) ──

export const NotificationServiceTexts = {
  newOrderForManager: (orderId: number, userLabel: string, grandTotal: number) =>
    `🔔 سفارش جدید!\n\nسفارش #${orderId}\nکاربر: ${userLabel}\nمبلغ: ${formatPrice(grandTotal)}`,

  newReceiptForManager: (orderId: number, userLabel: string) =>
    `🧾 رسید جدید!\n\nسفارش #${orderId}\nکاربر: ${userLabel}`,

  deliveryStatusForClient: (orderId: number, statusLabel: string, extraText?: string) =>
    `📦 بروزرسانی ارسال سفارش #${orderId}\n\nوضعیت: ${statusLabel}${extraText ? `\n\n${extraText}` : ''}`,

  newDeliveryForCourier: (orderId: number, customerName: string, phone: string, address: string) =>
    `🚚 ارسال جدید!\n\nسفارش #${orderId}\nمشتری: ${customerName}\nتلفن: ${phone}\nآدرس: ${address}\n\nبرای بروزرسانی وضعیت از منوی ربات استفاده کنید.`,

  deliveryFailedForManager: (orderId: number, reason: string) =>
    `⚠️ ارسال ناموفق!\n\nسفارش #${orderId}\nعلت: ${reason}`,

  deliveryStatusForManager: (orderId: number, statusLabel: string, courierLabel: string) =>
    `🚚 بروزرسانی ارسال\n\nسفارش #${orderId}\nپیک: ${courierLabel}\nوضعیت: ${statusLabel}`,
};
