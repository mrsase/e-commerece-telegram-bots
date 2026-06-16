import { Bot, Context, InlineKeyboard } from "grammy";

function safeId(value: string | undefined, fallback = 0): number {
  const n = parseInt(value ?? "", 10);
  return Number.isFinite(n) ? n : fallback;
}
import type { PrismaClient, Manager } from "@prisma/client";
import { OrderStatus, ReceiptReviewStatus, SupportConversationStatus, SupportSenderType } from "@prisma/client";
import { ManagerTexts, ClientTexts, ChannelTexts } from "../../i18n/index.js";
import { ManagerKeyboards } from "../../utils/keyboards.js";
import { formatPrice } from "../../utils/format-price.js";

import { SessionStore } from "../../utils/session-store.js";
import { crossBotFile } from "../../utils/cross-bot-file.js";

// Session state for multi-step flows
type SessionState = 
  | "product:add:title"
  | "product:add:description"
  | "product:add:price"
  | "product:add:stock"
  | "product:add:image"
  | "product:edit:title"
  | "product:edit:description"
  | "product:edit:price"
  | "product:edit:stock"
  | "product:edit:image"
  | "user:search"
  | "referral:create:score"
  | "receipt:reject:reason"
  | "receipt:approve:eta"
  | "support:reply"
  | "settings:image"
  | "settings:expiry"
  | "settings:card"
  | "settings:deliverymsg"
  | "courier:add"
  | "user:setscore"
  | "user:discount"
  | "user:setmaxcodes";

interface ManagerSession {
  state: SessionState;
  data?: Record<string, unknown>;
}

const managerSessions = new SessionStore<ManagerSession>();

interface ManagerBotDeps {
  prisma: PrismaClient;
  clientBot?: Bot;
  courierBot?: Bot;
  checkoutImageFileId?: string;
}

import { createReferralCodeWithRetry } from "../../utils/referral-utils.js";
import { NotificationService } from "../../services/notification-service.js";
import { orderStatusLabel, eventTypeLabel, receiptStatusLabel, deliveryStatusLabel } from "../../utils/order-status.js";
import { ReferralAnalyticsService, formatReferralTree } from "../../services/referral-analytics-service.js";
import { safeRender } from "../../utils/safe-reply.js";
import { escapeMarkdown } from "../../utils/escape-markdown.js";
import { BotSettingsService, SettingKeys } from "../../services/bot-settings-service.js";

/**
 * Check if user is an authorized manager
 */
async function getManager(ctx: Context, prisma: PrismaClient): Promise<Manager | null> {
  if (!ctx.from) return null;

  const tgUserId = BigInt(ctx.from.id);
  const manager = await prisma.manager.findUnique({
    where: { tgUserId },
  });

  if (!manager || !manager.isActive) return null;
  return manager;
}

/**
 * Build a formatted order detail text with Persian labels for all statuses.
 */
function buildOrderDetailText(order: {
  id: number; status: OrderStatus; createdAt: Date;
  subtotal: number; discountTotal: number; grandTotal: number;
  user: { firstName: string | null; username: string | null; phone: string | null; address: string | null; locationLat: number | null; locationLng: number | null; locationText: string | null };
  items: { product: { title: string }; qty: number; lineTotal: number }[];
  receipts: { reviewStatus: string }[];
  delivery: { status: string; assignedCourier: { username: string | null; id: number } | null } | null;
  events: { createdAt: Date; eventType: string }[];
}): string {
  const esc = escapeMarkdown;
  let text = `📦 *سفارش #${order.id}*\n`;
  text += `وضعیت: ${esc(orderStatusLabel(order.status))}\n`;
  text += `تاریخ: ${order.createdAt.toISOString().split("T")[0]}\n\n`;

  // User info
  const u = order.user;
  text += `*مشتری:* ${esc(u.firstName)} (@${esc(u.username)})\n`;
  text += `تلفن: ${esc(u.phone) || "-"}\n`;
  text += `آدرس: ${esc(u.address) || "-"}\n`;
  if (u.locationLat != null) text += `📍 موقعیت ثبت شده\n`;
  else if (u.locationText) text += `📍 موقعیت: ${esc(u.locationText)}\n`;
  text += "\n";

  // Items
  text += `*اقلام:*\n`;
  order.items.forEach((item) => {
    text += `  ${esc(item.product.title)} x${item.qty} = ${formatPrice(item.lineTotal)}\n`;
  });
  text += `\nجمع: ${formatPrice(order.subtotal)}\n`;
  if (order.discountTotal > 0) text += `تخفیف: ${formatPrice(order.discountTotal)}\n`;
  text += `*نهایی: ${formatPrice(order.grandTotal)}*\n`;

  // Receipts
  if (order.receipts.length > 0) {
    text += `\n🧾 رسیدها: ${order.receipts.length} عدد (آخرین: ${esc(receiptStatusLabel(order.receipts[0].reviewStatus))})\n`;
  }

  // Delivery
  if (order.delivery) {
    const d = order.delivery;
    text += `\n🚚 ارسال: ${esc(deliveryStatusLabel(d.status))}`;
    if (d.assignedCourier) text += ` (پیک: @${esc(d.assignedCourier.username) || d.assignedCourier.id})`;
    text += "\n";
  }

  // Events
  if (order.events.length > 0) {
    text += `\n📋 *تاریخچه:*\n`;
    order.events.forEach((e) => {
      text += `  ${e.createdAt.toISOString().split("T")[0]} · ${esc(eventTypeLabel(e.eventType))}\n`;
    });
  }

  return text;
}

/**
 * Register all interactive handlers for manager bot
 */
export function registerInteractiveManagerBot(bot: Bot, deps: ManagerBotDeps): void {
  const { prisma, clientBot, courierBot, checkoutImageFileId } = deps;
  const notificationService = new NotificationService({ prisma, clientBot, courierBot });
  const settingsService = new BotSettingsService(prisma);

  // Global error handler to prevent crashes
  bot.catch((err) => {
    console.error("Manager bot error:", err.message || err);
  });

  // ===========================================
  // START COMMAND
  // ===========================================
  bot.command("start", async (ctx) => {
    const manager = await getManager(ctx, prisma);
    if (!manager) {
      await ctx.reply(ManagerTexts.notAuthorized());
      return;
    }

    const pendingReceiptsCount = await prisma.receipt.count({
      where: { reviewStatus: ReceiptReviewStatus.PENDING },
    });

    await ctx.reply(
      `${ManagerTexts.mainMenuTitle()}\n\n🧾 رسیدهای در انتظار بررسی: ${pendingReceiptsCount}`,
      {
        parse_mode: "Markdown",
        reply_markup: ManagerKeyboards.mainMenu(),
      }
    );
  });

  // ===========================================
  // TEXT MESSAGE HANDLER - For multi-step flows
  // ===========================================
  bot.on("message:text", async (ctx) => {
    const manager = await getManager(ctx, prisma);
    if (!manager) return;

    const session = managerSessions.get(ctx.from.id);
    if (!session) return;

    const text = ctx.message.text.trim();

    // PRODUCT CREATION FLOW
    if (session.state === "product:add:title") {
      session.data = { ...session.data, title: text };
      session.state = "product:add:description";
      managerSessions.set(ctx.from.id, session);
      await ctx.reply(ManagerTexts.enterProductDescription());
      return;
    }

    if (session.state === "product:add:description") {
      session.data = { ...session.data, description: text === "/skip" ? null : text };
      session.state = "product:add:price";
      managerSessions.set(ctx.from.id, session);
      await ctx.reply(ManagerTexts.enterProductPrice());
      return;
    }

    if (session.state === "product:add:price") {
      const price = parseInt(text);
      if (isNaN(price) || price <= 0) {
        await ctx.reply(ManagerTexts.invalidNumber());
        return;
      }
      session.data = { ...session.data, price };
      session.state = "product:add:stock";
      managerSessions.set(ctx.from.id, session);
      await ctx.reply(ManagerTexts.enterProductStock());
      return;
    }

    if (session.state === "product:add:stock") {
      const stock = text === "/skip" ? null : parseInt(text);
      if (text !== "/skip" && (isNaN(stock!) || stock! < 0)) {
        await ctx.reply(ManagerTexts.invalidNumber());
        return;
      }
      session.data = { ...session.data, stock };
      session.state = "product:add:image";
      managerSessions.set(ctx.from.id, session);
      await ctx.reply(ManagerTexts.sendProductImage());
      return;
    }

    if (session.state === "product:add:image" && text === "/skip") {
      // Create product without image
      const data = session.data!;
      await prisma.product.create({
        data: {
          title: data.title as string,
          description: data.description as string | null,
          price: data.price as number,
          stock: data.stock as number | null,
          currency: "IRR",
          isActive: true,
        },
      });

      managerSessions.delete(ctx.from.id);
      await ctx.reply(ManagerTexts.productCreated(data.title as string), {
        reply_markup: ManagerKeyboards.backToMenu(),
      });
      return;
    }

    // PRODUCT EDIT FLOWS
    if (session.state.startsWith("product:edit:")) {
      const productId = session.data?.productId as number;
      const field = session.state.split(":")[2];

      // P1-5 Fix: When editing image field, ignore text messages (only accept photos or /cancel)
      if (field === "image") {
        if (text === "/cancel") {
          managerSessions.delete(ctx.from.id);
          await ctx.reply(ManagerTexts.actionCancelled(), {
            reply_markup: ManagerKeyboards.productEdit(productId),
          });
          return;
        }
        // Ignore text input when waiting for image - remind user
        await ctx.reply(ManagerTexts.sendProductImage() + "\n\n(برای لغو /cancel را ارسال کنید)");
        return;
      }

      const updateData: Record<string, unknown> = {};

      if (field === "title") {
        updateData.title = text;
      } else if (field === "desc") {
        updateData.description = text === "/skip" ? null : text;
      } else if (field === "price") {
        const price = parseInt(text);
        if (isNaN(price) || price <= 0) {
          await ctx.reply(ManagerTexts.invalidNumber());
          return;
        }
        updateData.price = price;
      } else if (field === "stock") {
        const stock = text === "/skip" ? null : parseInt(text);
        if (text !== "/skip" && (isNaN(stock!) || stock! < 0)) {
          await ctx.reply(ManagerTexts.invalidNumber());
          return;
        }
        updateData.stock = stock;
      }

      await prisma.product.update({
        where: { id: productId },
        data: updateData,
      });

      managerSessions.delete(ctx.from.id);
      await ctx.reply(ManagerTexts.productUpdated(), {
        reply_markup: ManagerKeyboards.productEdit(productId),
      });
      return;
    }

    // USER SEARCH
    if (session.state === "user:search") {
      const query = text;
      let users;

      if (/^\d+$/.test(query)) {
        // Search by Telegram ID
        users = await prisma.user.findMany({
          where: { tgUserId: BigInt(query) },
          take: 10,
        });
      } else {
        // Search by username
        users = await prisma.user.findMany({
          where: { username: { contains: query } },
          take: 10,
        });
      }

      managerSessions.delete(ctx.from.id);

      if (users.length === 0) {
        await ctx.reply(ManagerTexts.noUsers(), {
          reply_markup: ManagerKeyboards.backToMenu(),
        });
        return;
      }

      await ctx.reply(ManagerTexts.userListTitle(), {
        parse_mode: "Markdown",
        reply_markup: ManagerKeyboards.userList(users),
      });
      return;
    }

    // REFERRAL CODE CREATION — prompt for score, then create (1 use per code)
    if (session.state === "referral:create:score") {
      const score = text === "/skip" ? 0 : parseInt(text);
      if (text !== "/skip" && (!Number.isFinite(score) || score < 0 || score > 10)) {
        await ctx.reply(ManagerTexts.invalidScore());
        return;
      }

      const code = await createReferralCodeWithRetry(prisma, {
        createdByManagerId: manager.id,
        maxUses: 1,
        loyaltyScore: score,
        prefix: "MGR_",
        length: 6,
      });

      managerSessions.delete(ctx.from.id);
      await ctx.reply(ManagerTexts.referralCodeCreated(code), {
        parse_mode: "Markdown",
        reply_markup: ManagerKeyboards.backToMenu(),
      });
      return;
    }

    // RECEIPT REJECTION REASON
    if (session.state === "receipt:reject:reason") {
      const receiptId = session.data?.receiptId as number;
      const input = ctx.message.text.trim();

      if (input === "/cancel") {
        managerSessions.delete(ctx.from.id);
        await ctx.reply(ManagerTexts.actionCancelled(), { reply_markup: ManagerKeyboards.backToMenu() });
        return;
      }

      const reason = input === "/skip" ? null : input;

      // Atomically claim the receipt for rejection
      const claimed = await prisma.receipt.updateMany({
        where: { id: receiptId, reviewStatus: ReceiptReviewStatus.PENDING },
        data: {
          reviewStatus: ReceiptReviewStatus.REJECTED,
          reviewedById: manager.id,
          reviewNotes: reason,
        },
      });

      if (claimed.count === 0) {
        managerSessions.delete(ctx.from.id);
        await ctx.reply("این رسید قبلاً بررسی شده است.", { reply_markup: ManagerKeyboards.backToMenu() });
        return;
      }

      const receipt = await prisma.receipt.findUnique({
        where: { id: receiptId },
        include: { order: true },
      });

      if (!receipt) {
        managerSessions.delete(ctx.from.id);
        await ctx.reply("رسید یافت نشد.", { reply_markup: ManagerKeyboards.backToMenu() });
        return;
      }

      // Only regress order status if it's still awaiting receipt
      if (receipt.order.status === OrderStatus.AWAITING_RECEIPT || receipt.order.status === OrderStatus.INVITE_SENT) {
        await prisma.order.update({
          where: { id: receipt.orderId },
          data: {
            status: OrderStatus.AWAITING_RECEIPT,
            events: {
              create: {
                actorType: "manager",
                actorId: manager.id,
                eventType: "receipt_rejected",
                payload: reason ? JSON.stringify({ reason }) : null,
              },
            },
          },
        });
      }

      managerSessions.delete(ctx.from.id);

      // Notify client about rejection (best-effort)
      const orderWithUser = await prisma.order.findUnique({
        where: { id: receipt.orderId },
        include: { user: true },
      });
      if (clientBot && orderWithUser?.user) {
        try {
          await clientBot.api.sendMessage(
            orderWithUser.user.tgUserId.toString(),
            ClientTexts.receiptRejected(receipt.orderId, reason || undefined)
          );
        } catch (error) {
          console.error("Failed to notify client of receipt rejection:", error);
        }
      }

      await ctx.reply(ManagerTexts.receiptRejected(receipt.orderId), {
        reply_markup: ManagerKeyboards.backToMenu(),
      });
      return;
    }

    // RECEIPT APPROVAL — ETA text handler
    if (session.state === "receipt:approve:eta") {
      const receiptId = session.data?.receiptId as number;
      const input = ctx.message.text.trim();

      if (input === "/cancel") {
        managerSessions.delete(ctx.from.id);
        await ctx.reply(ManagerTexts.actionCancelled(), { reply_markup: ManagerKeyboards.backToMenu() });
        return;
      }

      const etaText = input === "/skip" ? undefined : input;

      const receipt = await prisma.receipt.findUnique({
        where: { id: receiptId },
        include: { order: { include: { user: true } } },
      });

      if (!receipt) {
        managerSessions.delete(ctx.from.id);
        await ctx.reply("رسید یافت نشد.", { reply_markup: ManagerKeyboards.backToMenu() });
        return;
      }

      // Atomically claim the receipt
      const claimed = await prisma.receipt.updateMany({
        where: { id: receiptId, reviewStatus: ReceiptReviewStatus.PENDING },
        data: {
          reviewStatus: ReceiptReviewStatus.ACCEPTED,
          reviewedById: manager.id,
        },
      });

      if (claimed.count === 0) {
        managerSessions.delete(ctx.from.id);
        await ctx.reply("این رسید قبلاً بررسی شده است.", { reply_markup: ManagerKeyboards.backToMenu() });
        return;
      }

      // Update order + create delivery inside a transaction
      const txResult = await prisma.$transaction(async (tx) => {
        const activeCourier = await tx.courier.findFirst({
          where: { isActive: true },
        });

        await tx.order.update({
          where: { id: receipt.orderId },
          data: {
            status: OrderStatus.PAID,
            events: {
              create: {
                actorType: "manager",
                actorId: manager.id,
                eventType: "receipt_approved",
              },
            },
          },
        });

        if (activeCourier) {
          await tx.delivery.create({
            data: {
              orderId: receipt.orderId,
              assignedCourierId: activeCourier.id,
            },
          });
        }

        return { courier: activeCourier };
      });

      // Cleanup — delete the payment DM sent to the user
      if (clientBot && receipt.order.channelMessageId) {
        try {
          await clientBot.api.deleteMessage(
            receipt.order.user.tgUserId.toString(),
            receipt.order.channelMessageId,
          );
        } catch (err) {
          console.error(`[RECEIPT APPROVE] Failed to delete payment DM for order #${receipt.orderId}:`, err);
        }
        await prisma.order.update({
          where: { id: receipt.orderId },
          data: { channelMessageId: null },
        });
      }

      // Notify client with ETA text
      if (receipt.order.user) {
        await notificationService.notifyClientReceiptApproved(
          receipt.order.user.tgUserId,
          receipt.orderId,
          etaText,
        );
      }

      // Notify courier if assigned
      if (txResult.courier) {
        const orderUser = receipt.order.user;
        await notificationService.notifyCourierNewDelivery(
          txResult.courier.tgUserId,
          receipt.orderId,
          `${orderUser?.firstName ?? ""} ${orderUser?.lastName ?? ""}`.trim() || "-",
          orderUser?.phone ?? "-",
          orderUser?.address ?? "-",
        );
      }

      managerSessions.delete(ctx.from.id);

      await ctx.reply(ManagerTexts.receiptApproved(receipt.orderId), {
        reply_markup: new InlineKeyboard()
          .text("📋 مشاهده سفارش", `mgr:order:${receipt.orderId}`)
          .text("« بازگشت به منو", "mgr:menu"),
      });
      return;
    }

    // SETTINGS EXPIRY
    if (session.state === "settings:expiry") {
      const input = ctx.message.text.trim();
      const minutes = parseInt(input, 10);

      if (!Number.isFinite(minutes) || minutes <= 0) {
        await ctx.reply(ManagerTexts.settingsExpiryInvalid());
        return;
      }

      await settingsService.set(SettingKeys.INVITE_EXPIRY_MINUTES, String(minutes));
      managerSessions.delete(ctx.from.id);

      await ctx.reply(ManagerTexts.settingsExpiryUpdated(minutes), {
        reply_markup: ManagerKeyboards.settingsMenu(
          !!(await settingsService.getCheckoutImageFileId(checkoutImageFileId)),
        ),
      });
      return;
    }

    if (session.state === "settings:card") {
      const input = ctx.message.text.trim().replace(/\s+/g, '');

      if (input === "/delete") {
        await settingsService.delete(SettingKeys.PAYMENT_CARD_NUMBER);
        managerSessions.delete(ctx.from.id);

        const imageFileId = await settingsService.getCheckoutImageFileId(checkoutImageFileId);
        const cardStatus = null;
        await ctx.reply(ManagerTexts.settingsCardDeleted(), {
          reply_markup: ManagerKeyboards.settingsMenu(!!imageFileId),
        });
        return;
      }

      if (!/^\d{16}$/.test(input)) {
        await ctx.reply(ManagerTexts.settingsCardInvalid());
        return;
      }

      await settingsService.set(SettingKeys.PAYMENT_CARD_NUMBER, input);
      managerSessions.delete(ctx.from.id);

      const imageFileId = await settingsService.getCheckoutImageFileId(checkoutImageFileId);
      const imageStatus = imageFileId ? "✅ تنظیم شده" : "❌ تنظیم نشده";

      await ctx.reply(ManagerTexts.settingsCardUpdated(input), {
        parse_mode: "Markdown",
        reply_markup: ManagerKeyboards.settingsMenu(!!imageFileId),
      });
      return;
    }

    if (session.state === "settings:deliverymsg") {
      const input = ctx.message.text.trim();

      if (input === "/delete") {
        await settingsService.delete(SettingKeys.OUT_FOR_DELIVERY_MESSAGE);
        managerSessions.delete(ctx.from.id);

        await ctx.reply(ManagerTexts.settingsDeliveryMsgDeleted(), {
          reply_markup: ManagerKeyboards.settingsMenu(
            !!(await settingsService.getCheckoutImageFileId(checkoutImageFileId)),
          ),
        });
        return;
      }

      await settingsService.set(SettingKeys.OUT_FOR_DELIVERY_MESSAGE, input);
      managerSessions.delete(ctx.from.id);

      await ctx.reply(ManagerTexts.settingsDeliveryMsgUpdated(input), {
        reply_markup: ManagerKeyboards.settingsMenu(
          !!(await settingsService.getCheckoutImageFileId(checkoutImageFileId)),
        ),
      });
      return;
    }

    // USER SCORE OVERRIDE
    if (session.state === "user:setscore") {
      const input = ctx.message.text.trim();
      const score = parseInt(input, 10);

      if (!Number.isFinite(score) || score < 0 || score > 10) {
        await ctx.reply(ManagerTexts.invalidScore());
        return;
      }

      const userId = session.data?.userId as number;
      await prisma.user.update({
        where: { id: userId },
        data: { loyaltyScoreOverride: score },
      });

      managerSessions.delete(ctx.from.id);
      await ctx.reply(ManagerTexts.userScoreUpdated(score), {
        reply_markup: ManagerKeyboards.backToMenu(),
      });
      return;
    }

    // USER DISCOUNT PERCENTAGE
    if (session.state === "user:discount") {
      const input = ctx.message.text.trim();
      const percent = parseInt(input, 10);

      if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
        await ctx.reply(ManagerTexts.invalidDiscountPercent());
        return;
      }

      const userId = session.data?.userId as number;
      await prisma.user.update({
        where: { id: userId },
        data: { discountPercent: percent > 0 ? percent : null },
      });

      managerSessions.delete(ctx.from.id);
      await ctx.reply(percent > 0
        ? `✅ تخفیف ${percent}% برای کاربر اعمال شد.`
        : "✅ تخفیف کاربر حذف شد.",
        {
          reply_markup: ManagerKeyboards.backToMenu(),
        }
      );
      return;
    }

    // USER MAX REFERRAL CODES
    if (session.state === "user:setmaxcodes") {
      const input = ctx.message.text.trim();
      const maxCodes = parseInt(input, 10);

      if (!Number.isFinite(maxCodes) || maxCodes < 0 || maxCodes > 100) {
        await ctx.reply(ManagerTexts.invalidMaxReferralCodes());
        return;
      }

      const userId = session.data?.userId as number;
      await prisma.user.update({
        where: { id: userId },
        data: { maxReferralCodes: maxCodes },
      });

      managerSessions.delete(ctx.from.id);
      await ctx.reply(ManagerTexts.userMaxCodesUpdated(maxCodes), {
        reply_markup: ManagerKeyboards.backToMenu(),
      });
      return;
    }

    // COURIER ADD BY TG ID
    if (session.state === "courier:add") {
      const input = ctx.message.text.trim();

      if (!input || !/^\d+$/.test(input)) {
        await ctx.reply(ManagerTexts.invalidTgId());
        return;
      }

      const tgUserId = BigInt(input);

      const existing = await prisma.courier.findUnique({
        where: { tgUserId },
      });

      if (existing) {
        managerSessions.delete(ctx.from.id);
        await ctx.reply(ManagerTexts.courierAlreadyExists(), {
          reply_markup: ManagerKeyboards.courierManagement(),
        });
        return;
      }

      await prisma.courier.create({
        data: { tgUserId, isActive: true },
      });

      managerSessions.delete(ctx.from.id);
      await ctx.reply(ManagerTexts.courierAdded(input), {
        reply_markup: ManagerKeyboards.courierManagement(),
      });
      return;
    }

    // SUPPORT REPLY
    if (session.state === "support:reply") {
      const conversationId = session.data?.conversationId as number;
      const replyText = ctx.message.text.trim();
      if (!replyText) return;

      const conversation = await prisma.supportConversation.findUnique({
        where: { id: conversationId },
        include: { user: true },
      });

      if (!conversation) {
        managerSessions.delete(ctx.from.id);
        await ctx.reply("گفتگو یافت نشد.", { reply_markup: ManagerKeyboards.backToMenu() });
        return;
      }

      await prisma.$transaction([
        prisma.supportMessage.create({
          data: {
            conversationId,
            senderType: SupportSenderType.MANAGER,
            senderManagerId: manager.id,
            text: replyText,
          },
        }),
        prisma.supportConversation.update({
          where: { id: conversationId },
          data: { lastMessageAt: new Date() },
        }),
      ]);

      await notificationService.notifyClientSupportReply(conversation.user.tgUserId, replyText, conversation.id);

      managerSessions.delete(ctx.from.id);
      await ctx.reply(ManagerTexts.supportReplySent(), {
        reply_markup: ManagerKeyboards.backToMenu(),
      });
      return;
    }
  });

  // ===========================================
  // PHOTO HANDLER - For product images
  // ===========================================
  bot.on("message:photo", async (ctx) => {
    const manager = await getManager(ctx, prisma);
    if (!manager) return;

    const session = managerSessions.get(ctx.from.id);
    if (!session) return;

    if (session.state === "product:add:image") {
      const photo = ctx.message.photo;
      const fileId = photo[photo.length - 1].file_id; // Get largest photo

      const data = session.data!;
      await prisma.product.create({
        data: {
          title: data.title as string,
          description: data.description as string | null,
          price: data.price as number,
          stock: data.stock as number | null,
          currency: "IRR",
          isActive: true,
          photoFileId: fileId,
        },
      });

      managerSessions.delete(ctx.from.id);
      await ctx.reply(ManagerTexts.productCreated(data.title as string), {
        reply_markup: ManagerKeyboards.backToMenu(),
      });
      return;
    }

    if (session.state === "product:edit:image") {
      const productId = session.data?.productId as number;
      const photo = ctx.message.photo;
      const fileId = photo[photo.length - 1].file_id;

      await prisma.product.update({
        where: { id: productId },
        data: { photoFileId: fileId },
      });

      managerSessions.delete(ctx.from.id);
      await ctx.reply(ManagerTexts.productUpdated(), {
        reply_markup: ManagerKeyboards.productEdit(productId),
      });
      return;
    }

    if (session.state === "settings:image") {
      const photo = ctx.message.photo;
      const fileId = photo[photo.length - 1].file_id;

      await settingsService.set(SettingKeys.CHECKOUT_IMAGE_FILE_ID, fileId);
      managerSessions.delete(ctx.from.id);

      await ctx.reply(ManagerTexts.settingsImageUpdated(), {
        reply_markup: ManagerKeyboards.settingsMenu(true),
      });
      return;
    }
  });

  // ===========================================
  // DOCUMENT HANDLER - For product images sent as files
  // ===========================================
  bot.on("message:document", async (ctx) => {
    const manager = await getManager(ctx, prisma);
    if (!manager) return;

    const session = managerSessions.get(ctx.from.id);
    if (!session) return;

    // Only handle image documents
    const doc = ctx.message.document;
    const mime = doc.mime_type ?? "";
    if (!mime.startsWith("image/")) {
      if (session.state === "product:add:image" || session.state === "product:edit:image" || session.state === "settings:image") {
        await ctx.reply("⚠️ لطفاً یک تصویر ارسال کنید (فرمت JPEG، PNG و…)\n\nبرای رد شدن /skip را ارسال کنید.");
      }
      return;
    }

    const fileId = doc.file_id;

    if (session.state === "product:add:image") {
      const data = session.data!;
      await prisma.product.create({
        data: {
          title: data.title as string,
          description: data.description as string | null,
          price: data.price as number,
          stock: data.stock as number | null,
          currency: "IRR",
          isActive: true,
          photoFileId: fileId,
        },
      });

      managerSessions.delete(ctx.from.id);
      await ctx.reply(ManagerTexts.productCreated(data.title as string), {
        reply_markup: ManagerKeyboards.backToMenu(),
      });
      return;
    }

    if (session.state === "product:edit:image") {
      const productId = session.data?.productId as number;

      await prisma.product.update({
        where: { id: productId },
        data: { photoFileId: fileId },
      });

      managerSessions.delete(ctx.from.id);
      await ctx.reply(ManagerTexts.productUpdated(), {
        reply_markup: ManagerKeyboards.productEdit(productId),
      });
      return;
    }

    if (session.state === "settings:image") {
      await settingsService.set(SettingKeys.CHECKOUT_IMAGE_FILE_ID, fileId);
      managerSessions.delete(ctx.from.id);

      await ctx.reply(ManagerTexts.settingsImageUpdated(), {
        reply_markup: ManagerKeyboards.settingsMenu(true),
      });
      return;
    }
  });

  // ===========================================
  // CALLBACK QUERY HANDLERS
  // ===========================================
  bot.on("callback_query:data", async (ctx) => {
    const manager = await getManager(ctx, prisma);
    
    // P0-3 Fix: Track if we've answered the callback to avoid multiple answers
    let callbackAnswered = false;
    const answerCallback = async (options?: { text?: string; show_alert?: boolean }) => {
      if (!callbackAnswered) {
        callbackAnswered = true;
        try {
          await ctx.answerCallbackQuery(options);
        } catch {
          // Ignore stale/expired callback query errors
        }
      }
    };
    
    if (!manager) {
      await answerCallback({ text: ManagerTexts.notAuthorized() });
      return;
    }

    try {
    const data = ctx.callbackQuery.data;
    const parts = data.split(":");

    // MAIN MENU
    if (data === "mgr:menu") {
      const pendingReceiptsCount = await prisma.receipt.count({
        where: { reviewStatus: ReceiptReviewStatus.PENDING },
      });

      await safeRender(ctx, 
        `${ManagerTexts.mainMenuTitle()}\n\n🧾 رسیدهای در انتظار بررسی: ${pendingReceiptsCount}`,
        {
          parse_mode: "Markdown",
          reply_markup: ManagerKeyboards.mainMenu(),
        }
      );
      return;
    }

    // ===========================================
    // ORDERS (now shows orders with pending receipts for verification)
    // ===========================================
    if (data === "mgr:orders" || data.startsWith("mgr:orders:")) {
      // Show orders that have pending receipts
      const receipts = await prisma.receipt.findMany({
        where: { reviewStatus: ReceiptReviewStatus.PENDING },
        include: { order: true, user: { select: { id: true, username: true, firstName: true } } },
        orderBy: { submittedAt: "asc" },
      });

      if (receipts.length === 0) {
        await safeRender(ctx, ManagerTexts.noPendingOrders(), {
          reply_markup: ManagerKeyboards.backToMenu(),
        });
        return;
      }

      let text = "🧾 *سفارش‌های دارای رسید در انتظار:*\n\n";
      receipts.forEach((r) => {
        const label = r.user.username || r.user.firstName || `#${r.user.id}`;
        text += `سفارش #${r.orderId} - ${escapeMarkdown(label)} - ${formatPrice(r.order.grandTotal)}\n`;
      });

      const kb = new InlineKeyboard();
      receipts.forEach((r) => {
        kb.text(`📋 سفارش #${r.orderId}`, `mgr:order:${r.orderId}`).row();
      });
      kb.text("« بازگشت به منو", "mgr:menu");

      await safeRender(ctx, text, {
        parse_mode: "Markdown",
        reply_markup: kb,
      });
      return;
    }

    // APPROVE ORDER - (deprecated - no longer needed, payment is automatic)
    if (data.startsWith("mgr:approve:")) {
      const orderId = safeId(parts[2]);

      const order = await prisma.order.findUnique({ 
        where: { id: orderId },
        include: { user: true, items: { include: { product: true } } },
      });
      if (!order || order.status !== OrderStatus.AWAITING_MANAGER_APPROVAL) {
        await answerCallback({ text: ManagerTexts.orderNotFound(), show_alert: true });
        return;
      }

      if (!clientBot) {
        await answerCallback({ text: "خطا: ربات مشتری در دسترس نیست.", show_alert: true });
        return;
      }

      try {
        const effectiveImageFileId = await settingsService.getCheckoutImageFileId(checkoutImageFileId);
        const cardNumber = await settingsService.getPaymentCardNumber();

        // Checkout image was uploaded to the manager bot — file_ids are bot-specific.
        // Download from manager bot and re-upload via client bot.
        let checkoutImageInput: import("grammy").InputFile | null = null;
        if (effectiveImageFileId) {
          try {
            checkoutImageInput = await crossBotFile(bot.api, bot.token, effectiveImageFileId);
          } catch (err) {
            console.error("[APPROVE] Failed to download checkout image from manager bot:", err);
          }
        }

        const paymentCaption = ChannelTexts.paymentMessage(
          orderId,
          order.grandTotal,
          cardNumber ?? undefined,
          order.items[0]?.product?.currency ?? "IRR",
        );

        // 1) Atomically claim the order — only succeeds if still AWAITING_MANAGER_APPROVAL
        const claimed = await prisma.order.updateMany({
          where: { id: orderId, status: OrderStatus.AWAITING_MANAGER_APPROVAL },
          data: { status: OrderStatus.APPROVED },
        });

        if (claimed.count === 0) {
          await answerCallback({
            text: "این سفارش قبلاً توسط مدیر دیگر تأیید یا رد شده است.",
            show_alert: true,
          });
          return;
        }

        await prisma.orderEvent.create({
          data: {
            orderId,
            actorType: "manager",
            actorId: manager.id,
            eventType: "order_approved",
          },
        });

        // ── Send payment details directly to client via DM ──
        const userTgId = order.user.tgUserId.toString();
        let directMessageId: number | null = null;

        try {
          if (checkoutImageInput) {
            const msg = await clientBot.api.sendPhoto(userTgId, checkoutImageInput, {
              caption: paymentCaption, parse_mode: "Markdown",
            });
            directMessageId = msg.message_id;
          } else {
            const msg = await clientBot.api.sendMessage(userTgId, paymentCaption, {
              parse_mode: "Markdown",
            });
            directMessageId = msg.message_id;
          }
        } catch (err) {
          console.error("[APPROVE] Failed to send payment details to client:", err);
          // Retry without Markdown and without image
          try {
            const msg = await clientBot.api.sendMessage(userTgId, paymentCaption.replace(/[*_`\[]/g, ""));
            directMessageId = msg.message_id;
          } catch (err2) {
            console.error("[APPROVE] Retry also failed:", err2);
          }
        }

        // Also send instruction to upload receipt
        try {
          await clientBot.api.sendMessage(
            userTgId,
            `✅ سفارش #${orderId} تأیید شد.\n\nپس از پرداخت، عکس رسید را همینجا ارسال کنید.`,
          );
        } catch (err) {
          console.error("[APPROVE] Failed to send receipt instruction:", err);
        }

        // Update order to AWAITING_RECEIPT
        await prisma.order.update({
          where: { id: orderId },
          data: {
            status: OrderStatus.AWAITING_RECEIPT,
            channelMessageId: directMessageId,
            inviteSentAt: new Date(),
            events: {
              create: {
                actorType: "manager", actorId: manager.id, eventType: "payment_details_sent_direct",
                payload: JSON.stringify({ directMessageId }),
              },
            },
          },
        });

        // Schedule auto-delete of the payment message after expiry
        const effectiveExpiryMin = await settingsService.getInviteExpiryMinutes(60);
        if (directMessageId) {
          const deleteDelayMs = effectiveExpiryMin * 60 * 1000;
          setTimeout(async () => {
            try {
              await clientBot!.api.deleteMessage(userTgId, directMessageId!);
              console.log(`[AUTO-DELETE] Deleted payment message ${directMessageId} for order #${orderId}`);
            } catch (err) {
              console.error(`[AUTO-DELETE] Failed to delete message ${directMessageId}:`, err);
            }
          }, deleteDelayMs);
        }

        await answerCallback({
          text: `✅ سفارش #${orderId} تأیید شد و اطلاعات پرداخت ارسال شد.`,
          show_alert: true,
        });

        // Refresh order list
        const orders = await prisma.order.findMany({
          where: { status: OrderStatus.AWAITING_MANAGER_APPROVAL },
          orderBy: { id: "asc" },
          take: 5,
        });

        if (orders.length === 0) {
          await safeRender(ctx, ManagerTexts.noPendingOrders(), {
            reply_markup: ManagerKeyboards.backToMenu(),
          });
        } else {
          await safeRender(ctx, ManagerTexts.pendingOrdersHeader(), {
            reply_markup: ManagerKeyboards.orderList(orders, 0, 1),
          });
        }
      } catch (error) {
        console.error(`[APPROVE ORDER #${orderId}] Error:`, error);
        await answerCallback({ 
          text: `❌ خطا در تأیید سفارش #${orderId}: ${error instanceof Error ? error.message : 'خطای ناشناخته'}`,
          show_alert: true,
        });
      }
      return;
    }

    // REJECT ORDER
    if (data.startsWith("mgr:reject:")) {
      const orderId = safeId(parts[2]);

      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: { user: true },
      });
      if (!order || order.status !== OrderStatus.AWAITING_MANAGER_APPROVAL) {
        await answerCallback({ text: ManagerTexts.orderNotFound() });
        return;
      }

      const rejected = await prisma.order.updateMany({
        where: { id: orderId, status: OrderStatus.AWAITING_MANAGER_APPROVAL },
        data: { status: OrderStatus.CANCELLED },
      });

      if (rejected.count === 0) {
        await answerCallback({ text: "این سفارش قبلاً توسط مدیر دیگر تأیید یا رد شده است.", show_alert: true });
        return;
      }

      await prisma.orderEvent.create({
        data: {
          orderId,
          actorType: "manager",
          actorId: manager.id,
          eventType: "order_rejected",
        },
      });

      // Notify client about rejection
      if (order.user) {
        await notificationService.notifyClientOrderRejected(order.user.tgUserId, orderId);
      }

      await answerCallback({ 
        text: ManagerTexts.orderRejected(orderId),
        show_alert: true,
      });

      // Refresh order list
      const orders = await prisma.order.findMany({
        where: { status: OrderStatus.AWAITING_MANAGER_APPROVAL },
        orderBy: { id: "asc" },
        take: 5,
      });

      if (orders.length === 0) {
        await safeRender(ctx, ManagerTexts.noPendingOrders(), {
          reply_markup: ManagerKeyboards.backToMenu(),
        });
      } else {
        await safeRender(ctx, ManagerTexts.pendingOrdersHeader(), {
          reply_markup: ManagerKeyboards.orderList(orders, 0, 1),
        });
      }
      return;
    }

    // ===========================================
    // CANCEL/DELETE ORDER — Show confirmation
    // ===========================================
    if (data.startsWith("mgr:order:cancel:") && !data.startsWith("mgr:order:cancel:confirm:")) {
      const orderId = safeId(parts[3]);
      const order = await prisma.order.findUnique({ where: { id: orderId } });
      if (!order || order.status === OrderStatus.CANCELLED) {
        await answerCallback({ text: "این سفارش قبلاً لغو شده است.", show_alert: true });
        return;
      }

      const isCompleted = order.status === OrderStatus.COMPLETED;
      const actionLabel = isCompleted ? "حذف" : "لغو";

      const confirmKb = new InlineKeyboard()
        .text(`✅ بله، ${actionLabel} شود`, `mgr:order:cancel:confirm:${orderId}`)
        .row()
        .text("❌ خیر", `mgr:order:${orderId}`);

      await safeRender(ctx, `⚠️ *آیا از ${actionLabel} سفارش #${orderId} مطمئن هستید؟*\n\nوضعیت فعلی: ${orderStatusLabel(order.status)}\n\nاین اقدام قابل بازگشت نیست.`, {
        parse_mode: "Markdown",
        reply_markup: confirmKb,
      });
      return;
    }

    // ===========================================
    // CANCEL/DELETE ORDER — Execute
    // ===========================================
    if (data.startsWith("mgr:order:cancel:confirm:")) {
      const orderId = safeId(parts[4]);
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: { user: true },
      });

      if (!order) {
        await answerCallback({ text: "سفارش یافت نشد.", show_alert: true });
        return;
      }

      if (order.status === OrderStatus.CANCELLED) {
        await answerCallback({ text: "این سفارش قبلاً لغو شده است.", show_alert: true });
        return;
      }

      const isCompleted = order.status === OrderStatus.COMPLETED;

      await prisma.order.update({
        where: { id: orderId },
        data: {
          status: OrderStatus.CANCELLED,
          events: {
            create: {
              actorType: "manager",
              actorId: manager.id,
              eventType: isCompleted ? "order_deleted" : "order_cancelled",
            },
          },
        },
      });

      // Notify client
      try {
        await clientBot?.api.sendMessage(
          order.user.tgUserId.toString(),
          isCompleted
            ? `❌ سفارش #${orderId} توسط مدیریت حذف شد.`
            : `❌ سفارش #${orderId} توسط مدیریت لغو شد.`
        );
      } catch (err) {
        console.error(`[CANCEL ORDER] Failed to notify client for order #${orderId}:`, err);
      }

      const doneLabel = isCompleted ? "حذف" : "لغو";
      await answerCallback({ text: `✅ سفارش #${orderId} ${doneLabel} شد.`, show_alert: true });

      await safeRender(ctx, `✅ سفارش #${orderId} با موفقیت ${doneLabel} شد.`, {
        reply_markup: new InlineKeyboard()
          .text("📋 مشاهده سفارش", `mgr:order:${orderId}`)
          .text("📊 همه سفارش‌ها", "mgr:allorders")
          .row()
          .text("« منو", "mgr:menu"),
      });
      return;
    }

    // ===========================================
    // DELETE ORDER — Show confirmation
    // ===========================================
    if (data.startsWith("mgr:order:delete:") && !data.startsWith("mgr:order:delete:confirm:")) {
      const orderId = safeId(parts[3]);
      const order = await prisma.order.findUnique({ where: { id: orderId } });
      if (!order) {
        await answerCallback({ text: "سفارش یافت نشد.", show_alert: true });
        return;
      }

      const confirmKb = new InlineKeyboard()
        .text("✅ بله، حذف شود", `mgr:order:delete:confirm:${orderId}`)
        .row()
        .text("❌ خیر", `mgr:order:${orderId}`);

      await safeRender(ctx, `⚠️ *آیا از حذف سفارش #${orderId} مطمئن هستید؟*\n\nوضعیت فعلی: ${orderStatusLabel(order.status)}\n\nاین اقدام قابل بازگشت نیست.`, {
        parse_mode: "Markdown",
        reply_markup: confirmKb,
      });
      return;
    }

    // ===========================================
    // DELETE ORDER — Execute
    // ===========================================
    if (data.startsWith("mgr:order:delete:confirm:")) {
      const orderId = safeId(parts[4]);
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: { user: true },
      });

      if (!order) {
        await answerCallback({ text: "سفارش یافت نشد.", show_alert: true });
        return;
      }

      await prisma.order.update({
        where: { id: orderId },
        data: {
          status: OrderStatus.CANCELLED,
          events: {
            create: {
              actorType: "manager",
              actorId: manager.id,
              eventType: "order_deleted",
            },
          },
        },
      });

      // Notify client
      try {
        await clientBot?.api.sendMessage(
          order.user.tgUserId.toString(),
          `❌ سفارش #${orderId} توسط مدیریت حذف شد.`
        );
      } catch (err) {
        console.error(`[DELETE ORDER] Failed to notify client for order #${orderId}:`, err);
      }

      await answerCallback({ text: `✅ سفارش #${orderId} حذف شد.`, show_alert: true });

      await safeRender(ctx, `✅ سفارش #${orderId} با موفقیت حذف شد.`, {
        reply_markup: new InlineKeyboard()
          .text("📋 مشاهده سفارش", `mgr:order:${orderId}`)
          .text("📊 همه سفارش‌ها", "mgr:allorders")
          .row()
          .text("« منو", "mgr:menu"),
      });
      return;
    }

    // ===========================================
    // ORDER DETAIL
    // ===========================================
    if (data.startsWith("mgr:order:") && !data.startsWith("mgr:orders") && !data.startsWith("mgr:order:location:") && !data.startsWith("mgr:order:cancel:") && !data.startsWith("mgr:order:delete:")) {
      const orderId = safeId(parts[2]);
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: {
          items: { include: { product: true } },
          user: { select: { id: true, username: true, firstName: true, phone: true, address: true, locationLat: true, locationLng: true, locationText: true } },
          events: { orderBy: { createdAt: "asc" }, take: 10 },
          receipts: { orderBy: { submittedAt: "desc" }, take: 3 },
          delivery: { include: { assignedCourier: true } },
        },
      });

      if (!order) {
        await answerCallback({ text: ManagerTexts.orderNotFound() });
        return;
      }

      const detailText = buildOrderDetailText(order);
      const detailKb = new InlineKeyboard();
      const pendingReceipt = order.receipts.find(r => r.reviewStatus === ReceiptReviewStatus.PENDING);
      if (pendingReceipt) {
        detailKb
          .text("✅ تأیید رسید", `mgr:receipt:approve:${pendingReceipt.id}`)
          .text("❌ رد رسید", `mgr:receipt:reject:${pendingReceipt.id}`)
          .row();
      }
      if (order.user.locationLat != null && order.user.locationLng != null) {
      }
      if (order.status !== OrderStatus.CANCELLED) {
        detailKb.text("❌ لغو سفارش", `mgr:order:cancel:${order.id}`);
      }
      detailKb.text("🗑️ حذف سفارش", `mgr:order:delete:${order.id}`).row();
      detailKb.text("📊 همه سفارش‌ها", "mgr:allorders").text("« منو", "mgr:menu");

      await safeRender(ctx, detailText, {
        parse_mode: "Markdown",
        reply_markup: detailKb,
      });
      return;
    }

    // ── SEND LOCATION — sends location pin to manager ──
    if (data.startsWith("mgr:order:location:")) {
      const orderId = safeId(parts[3]);
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: { user: { select: { locationLat: true, locationLng: true, locationText: true } } },
      });
      if (!order) {
        await answerCallback({ text: ManagerTexts.orderNotFound() });
        return;
      }
      const u = order.user;
      if (u.locationLat != null && u.locationLng != null) {
        await answerCallback();
        await ctx.replyWithLocation(u.locationLat, u.locationLng);
      } else if (u.locationText) {
        await answerCallback();
        await ctx.reply(`📍 موقعیت مشتری: ${u.locationText}`);
      } else {
        await answerCallback({ text: "موقعیت مشتری ثبت نشده است." });
      }
      return;
    }

    // ===========================================
    // ALL ORDERS WITH STATUS FILTER & PAGINATION
    // ===========================================
    // Callback data formats:
    //   mgr:allorders                       -> no filter, page 0
    //   mgr:allorders:1                     -> no filter, page 1
    //   mgr:allorders:AWAITING_RECEIPT      -> filter, page 0
    //   mgr:allorders:AWAITING_RECEIPT:2    -> filter, page 2
    if (data === "mgr:allorders" || data.startsWith("mgr:allorders:")) {
      // Parse: distinguish status enum values from page numbers
      const rawParam = parts[2];
      const isValidStatus = rawParam && Object.values(OrderStatus).includes(rawParam as OrderStatus);
      const statusFilter = isValidStatus ? (rawParam as OrderStatus) : null;
      const page = isValidStatus ? safeId(parts[3]) : safeId(parts[2]);
      const pageSize = 5;

      const where: Record<string, unknown> = statusFilter ? { status: statusFilter } : {};
      if (!statusFilter) {
        where.NOT = { events: { some: { eventType: "order_deleted" } } };
      } else if (statusFilter === OrderStatus.CANCELLED) {
        where.NOT = { events: { some: { eventType: "order_deleted" } } };
      }

      const [orders, total] = await Promise.all([
        prisma.order.findMany({
          where,
          orderBy: { createdAt: "desc" },
          include: { user: { select: { username: true, firstName: true } } },
          skip: page * pageSize,
          take: pageSize,
        }),
        prisma.order.count({ where }),
      ]);

      const totalPages = Math.max(1, Math.ceil(total / pageSize));

      let text = `📊 *همه سفارش‌ها*`;
      if (statusFilter) text += ` (فیلتر: ${orderStatusLabel(statusFilter)})`;
      text += `\n${total} سفارش یافت شد.\n\n`;

      if (orders.length === 0) {
        text += "هیچ سفارشی با این فیلتر یافت نشد.\n";
      } else {
        orders.forEach((o) => {
          const userLabel = escapeMarkdown(o.user.username || o.user.firstName) || `کاربر #${o.userId}`;
          text += `#${o.id} · ${userLabel} · ${escapeMarkdown(orderStatusLabel(o.status))} · ${formatPrice(o.grandTotal)}\n`;
        });
      }

      const allKb = new InlineKeyboard();

      // Status filter buttons (2 rows of 3)
      allKb
        .text("⏳ در انتظار تأیید", "mgr:allorders:AWAITING_MANAGER_APPROVAL:0")
        .text("🧾 در انتظار رسید", "mgr:allorders:AWAITING_RECEIPT:0")
        .text("✅ تأیید شده", "mgr:allorders:APPROVED:0")
        .row()
        .text("💰 پرداخت شده", "mgr:allorders:PAID:0")
        .text("✅ تکمیل شده", "mgr:allorders:COMPLETED:0")
        .text("❌ لغو شده", "mgr:allorders:CANCELLED:0")
        .text("🗑️ حذف شده‌ها", "mgr:deletedorders:0")
        .row();

      // Per-order detail buttons (3 per row)
      orders.forEach((o, i) => {
        allKb.text(`📋 #${o.id}`, `mgr:order:${o.id}`);
        if ((i + 1) % 3 === 0 && i < orders.length - 1) allKb.row();
      });
      if (orders.length > 0) allKb.row();

      // Pagination row with "All" button
      const filterPart = statusFilter ? `:${statusFilter}` : "";
      if (page > 0) allKb.text("« قبلی", `mgr:allorders${filterPart}:${page - 1}`);
      allKb.text(`${page + 1}/${totalPages}`, "noop");
      if (page < totalPages - 1) allKb.text("بعدی »", `mgr:allorders${filterPart}:${page + 1}`);
      allKb.text("📋 همه", "mgr:allorders");
      allKb.row();

      allKb.text("« منو", "mgr:menu");

      await safeRender(ctx, text, {
        parse_mode: "Markdown",
        reply_markup: allKb,
      });
      return;
    }

    // ===========================================
    // DELETED ORDERS
    // ===========================================
    if (data.startsWith("mgr:deletedorders")) {
      const page = safeId(parts[2]) || 0;
      const pageSize = 5;

      const where = {
        status: OrderStatus.CANCELLED,
        events: { some: { eventType: "order_deleted" } },
      };

      const [orders, total] = await Promise.all([
        prisma.order.findMany({
          where,
          orderBy: { createdAt: "desc" },
          include: { user: { select: { username: true, firstName: true } } },
          skip: page * pageSize,
          take: pageSize,
        }),
        prisma.order.count({ where }),
      ]);

      const totalPages = Math.max(1, Math.ceil(total / pageSize));
      let text = `🗑️ *سفارش‌های حذف شده*\n${total} سفارش.\n\n`;
      if (orders.length === 0) {
        text += "هیچ سفارش حذف شده‌ای یافت نشد.\n";
      } else {
        orders.forEach((o) => {
          const userLabel = escapeMarkdown(o.user.username || o.user.firstName) || `کاربر #${o.userId}`;
          text += `#${o.id} · ${userLabel} · ${formatPrice(o.grandTotal)}\n`;
        });
      }

      const delKb = new InlineKeyboard();
      orders.forEach((o, i) => {
        delKb.text(`📋 #${o.id}`, `mgr:order:${o.id}`);
        if ((i + 1) % 3 === 0 && i < orders.length - 1) delKb.row();
      });
      if (orders.length > 0) delKb.row();

      if (page > 0) delKb.text("« قبلی", `mgr:deletedorders:${page - 1}`);
      delKb.text(`${page + 1}/${totalPages}`, "noop");
      if (page < totalPages - 1) delKb.text("بعدی »", `mgr:deletedorders:${page + 1}`);
      delKb.row();

      delKb.text("📊 همه سفارش‌ها", "mgr:allorders").text("« منو", "mgr:menu");

      await safeRender(ctx, text, {
        parse_mode: "Markdown",
        reply_markup: delKb,
      });
      return;
    }

    // USER'S ORDERS
    if (data.startsWith("mgr:user:orders:")) {
      const userId = safeId(parts[3]);
      const userOrders = await prisma.order.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: 10,
      });

      const targetUser = await prisma.user.findUnique({
        where: { id: userId },
        select: { username: true, firstName: true },
      });
      const label = targetUser?.username || targetUser?.firstName || `#${userId}`;

      let text = `📦 *سفارش‌های ${escapeMarkdown(label)}*\n\n`;
      if (userOrders.length === 0) {
        text += "سفارشی یافت نشد.\n";
      } else {
        userOrders.forEach((o) => {
          text += `#${o.id} · ${orderStatusLabel(o.status)} · ${formatPrice(o.grandTotal)}\n`;
        });
      }

      const userKb = new InlineKeyboard();
      userOrders.forEach((o) => {
        userKb.text(`📋 #${o.id}`, `mgr:order:${o.id}`).row();
      });
      userKb.text("« کاربر", `mgr:user:${userId}`).text("« منو", "mgr:menu");

      await safeRender(ctx, text, {
        parse_mode: "Markdown",
        reply_markup: userKb,
      });
      return;
    }

    // USER'S REFERRALS
    if (data.startsWith("mgr:user:referrals:")) {
      const userId = safeId(parts[3]);

      const targetUser = await prisma.user.findUnique({
        where: { id: userId },
        select: { username: true, firstName: true },
      });
      const label = targetUser?.username || targetUser?.firstName || `#${userId}`;

      const referralCodes = await prisma.referralCode.findMany({
        where: { createdByUserId: userId },
      });

      const referredUsers = await prisma.user.findMany({
        where: { referredById: userId },
        select: { id: true, username: true, firstName: true },
      });

      let text = `🔗 *معرفی‌های ${escapeMarkdown(label)}*\n\n`;

      if (referralCodes.length > 0) {
        text += "*کدهای معرفی:*\n";
        referralCodes.forEach((c) => {
          text += `\`${c.code}\` · ${c.usedCount} استفاده\n`;
        });
      }

      text += `\n*کاربران معرفی شده:* ${referredUsers.length}\n`;
      referredUsers.forEach((u) => {
        text += `  ${escapeMarkdown(u.username || u.firstName || `#${u.id}`)}\n`;
      });

      await safeRender(ctx, text, {
        parse_mode: "Markdown",
        reply_markup: ManagerKeyboards.backToMenu(),
      });
      return;
    }

    // ===========================================
    // PRODUCTS
    // ===========================================
    if (data === "mgr:products") {
      await safeRender(ctx, ManagerTexts.productsMenuTitle(), {
        parse_mode: "Markdown",
        reply_markup: ManagerKeyboards.productManagement(),
      });
      return;
    }

    if (data === "mgr:products:list" || data.startsWith("mgr:products:list:")) {
      const page = safeId(parts[3]);
      const pageSize = 5;

      const [products, total] = await Promise.all([
        prisma.product.findMany({
          orderBy: { id: "desc" },
          skip: page * pageSize,
          take: pageSize,
        }),
        prisma.product.count(),
      ]);

      if (products.length === 0) {
        await safeRender(ctx, ManagerTexts.noProducts(), {
          reply_markup: ManagerKeyboards.backToMenu(),
        });
        return;
      }

      const totalPages = Math.ceil(total / pageSize);
      await safeRender(ctx, ManagerTexts.productListTitle(), {
        parse_mode: "Markdown",
        reply_markup: ManagerKeyboards.productList(products, page, totalPages),
      });
      return;
    }

    if (data === "mgr:products:add") {
      managerSessions.set(ctx.from.id, { state: "product:add:title", data: {} });
      await safeRender(ctx, ManagerTexts.enterProductTitle());
      return;
    }

    if (data.startsWith("mgr:product:edit:") && parts.length === 4) {
      const productId = safeId(parts[3]);
      const product = await prisma.product.findUnique({ where: { id: productId } });

      if (!product) {
        await answerCallback({ text: "محصول یافت نشد" });
        return;
      }

      const text = `*ویرایش محصول: ${escapeMarkdown(product.title)}*\n\n` +
        `📝 عنوان: ${escapeMarkdown(product.title)}\n` +
        `📄 توضیحات: ${product.description ? escapeMarkdown(product.description) : '—'}\n` +
        `💰 قیمت: ${formatPrice(product.price)}\n` +
        `📦 موجودی: ${product.stock ?? 'نامحدود'}\n` +
        `🖼️ تصویر: ${product.photoFileId ? 'دارد' : 'ندارد'}\n` +
        `وضعیت: ${product.isActive ? '✅ فعال' : '❌ غیرفعال'}`;

      await safeRender(ctx, text, {
        parse_mode: "Markdown",
        reply_markup: ManagerKeyboards.productEdit(productId, !!product.photoFileId),
      });
      return;
    }

    if (data.startsWith("mgr:product:edit:") && parts.length === 5) {
      const productId = safeId(parts[3]);
      const field = parts[4];

      // Handle remove image immediately (no user input needed)
      if (field === "removeimage") {
        await prisma.product.update({
          where: { id: productId },
          data: { photoFileId: null },
        });

        const product = await prisma.product.findUnique({ where: { id: productId } });
        if (!product) {
          await answerCallback({ text: "محصول یافت نشد" });
          return;
        }
        const text = `*ویرایش محصول: ${escapeMarkdown(product.title)}*\n\n` +
          `📝 عنوان: ${escapeMarkdown(product.title)}\n` +
          `📄 توضیحات: ${product.description ? escapeMarkdown(product.description) : '—'}\n` +
          `💰 قیمت: ${formatPrice(product.price)}\n` +
          `📦 موجودی: ${product.stock ?? 'نامحدود'}\n` +
          `🖼️ تصویر: ندارد\n` +
          `وضعیت: ${product.isActive ? '✅ فعال' : '❌ غیرفعال'}`;

        await safeRender(ctx, text, {
          parse_mode: "Markdown",
          reply_markup: ManagerKeyboards.productEdit(productId, false),
        });
        return;
      }

      // For other fields, set session to await user input
      managerSessions.set(ctx.from.id, { 
        state: `product:edit:${field}` as SessionState,
        data: { productId },
      });

      if (field === "title") await safeRender(ctx, ManagerTexts.enterProductTitle());
      else if (field === "desc") await safeRender(ctx, ManagerTexts.enterProductDescription());
      else if (field === "price") await safeRender(ctx, ManagerTexts.enterProductPrice());
      else if (field === "stock") await safeRender(ctx, ManagerTexts.enterProductStock());
      else if (field === "image") await safeRender(ctx, ManagerTexts.sendProductImage());
      return;
    }

    if (data.startsWith("mgr:product:toggle:")) {
      const productId = safeId(parts[3]);
      const product = await prisma.product.findUnique({ where: { id: productId } });

      if (!product) {
        await answerCallback({ text: "محصول یافت نشد" });
        return;
      }

      await prisma.product.update({
        where: { id: productId },
        data: { isActive: !product.isActive },
      });

      await answerCallback({ 
        text: product.isActive ? "محصول غیرفعال شد" : "محصول فعال شد",
      });

      // Refresh edit view
      const updated = await prisma.product.findUnique({ where: { id: productId } });
      if (!updated) {
        await answerCallback({ text: "محصول یافت نشد" });
        return;
      }
      const text = `*ویرایش محصول: ${escapeMarkdown(updated.title)}*\n\n` +
        `📝 عنوان: ${escapeMarkdown(updated.title)}\n` +
        `📄 توضیحات: ${escapeMarkdown(updated.description) || '—'}\n` +
        `💰 قیمت: ${formatPrice(updated.price)}\n` +
        `📦 موجودی: ${updated.stock ?? 'نامحدود'}\n` +
        `🖼️ تصویر: ${updated.photoFileId ? 'دارد' : 'ندارد'}\n` +
        `وضعیت: ${updated.isActive ? '✅ فعال' : '❌ غیرفعال'}`;

      await safeRender(ctx, text, {
        parse_mode: "Markdown",
        reply_markup: ManagerKeyboards.productEdit(productId, !!updated.photoFileId),
      });
      return;
    }

    // ===========================================
    // USERS
    // ===========================================
    if (data === "mgr:users") {
      await safeRender(ctx, ManagerTexts.usersMenuTitle(), {
        parse_mode: "Markdown",
        reply_markup: ManagerKeyboards.userManagement(),
      });
      return;
    }

    if (data === "mgr:users:list" || data.startsWith("mgr:users:list:")) {
      const page = safeId(parts[3]);
      const pageSize = 10;

      const [users, total] = await Promise.all([
        prisma.user.findMany({
          orderBy: { id: "desc" },
          skip: page * pageSize,
          take: pageSize,
        }),
        prisma.user.count(),
      ]);

      if (users.length === 0) {
        await safeRender(ctx, ManagerTexts.noUsers(), {
          reply_markup: ManagerKeyboards.backToMenu(),
        });
        return;
      }

      const totalPages = Math.ceil(total / pageSize);
      await safeRender(ctx, ManagerTexts.userListTitle(), {
        parse_mode: "Markdown",
        reply_markup: ManagerKeyboards.userList(users, page, totalPages),
      });
      return;
    }

    if (data === "mgr:users:search") {
      managerSessions.set(ctx.from.id, { state: "user:search" });
      await safeRender(ctx, ManagerTexts.enterSearchQuery(), {
        reply_markup: new InlineKeyboard()
          .text("« کاربران", "mgr:users")
          .text("« منو", "mgr:menu"),
      });
      return;
    }

    if (data.startsWith("mgr:user:") && !["toggle", "toggleref", "orders", "referrals", "contact", "delete", "setscore", "setdiscount", "setmaxcodes", "message"].includes(parts[2])) {
      const userId = safeId(parts[2]);
      const user = await prisma.user.findUnique({ where: { id: userId } });

      if (!user) {
        await answerCallback({ text: "کاربر یافت نشد" });
        return;
      }

      const orderCount = await prisma.order.count({ where: { userId } });
      const effectiveScore = user.loyaltyScoreOverride ?? user.loyaltyScore;
      const hasOverride = user.loyaltyScoreOverride != null;

      await safeRender(ctx, 
        ManagerTexts.userDetails(user.id, user.username, user.isActive, orderCount, user.canCreateReferral, effectiveScore, hasOverride, user.discountPercent, user.maxReferralCodes),
        {
          parse_mode: "Markdown",
          reply_markup: ManagerKeyboards.userActions(userId, user.isActive, user.canCreateReferral, user.discountPercent, user.maxReferralCodes),
        }
      );
      return;
    }

    if (data.startsWith("mgr:user:toggle:")) {
      const userId = safeId(parts[3]);
      const user = await prisma.user.findUnique({ where: { id: userId } });

      if (!user) {
        await answerCallback({ text: "کاربر یافت نشد" });
        return;
      }

      await prisma.user.update({
        where: { id: userId },
        data: { isActive: !user.isActive },
      });

      const message = user.isActive 
        ? ManagerTexts.userBlocked(user.username)
        : ManagerTexts.userUnblocked(user.username);

      await answerCallback({ text: message, show_alert: true });

      // Refresh user view
      const updated = await prisma.user.findUnique({ where: { id: userId } });
      if (!updated) {
        await answerCallback({ text: "کاربر یافت نشد" });
        return;
      }
      const orderCount = await prisma.order.count({ where: { userId } });
      const eScore = updated.loyaltyScoreOverride ?? updated.loyaltyScore;
      const hasOvr = updated.loyaltyScoreOverride != null;

      await safeRender(ctx, 
        ManagerTexts.userDetails(updated.id, updated.username, updated.isActive, orderCount, updated.canCreateReferral, eScore, hasOvr, updated.discountPercent, updated.maxReferralCodes),
        {
          parse_mode: "Markdown",
          reply_markup: ManagerKeyboards.userActions(userId, updated.isActive, updated.canCreateReferral, updated.discountPercent, updated.maxReferralCodes),
        }
      );
      return;
    }

    // TOGGLE USER REFERRAL PERMISSION
    if (data.startsWith("mgr:user:toggleref:")) {
      const userId = safeId(parts[3]);
      const user = await prisma.user.findUnique({ where: { id: userId } });

      if (!user) {
        await answerCallback({ text: "کاربر یافت نشد" });
        return;
      }

      await prisma.user.update({
        where: { id: userId },
        data: { canCreateReferral: !user.canCreateReferral },
      });

      const message = user.canCreateReferral
        ? ManagerTexts.userReferralRevoked(user.username)
        : ManagerTexts.userReferralGranted(user.username);

      await answerCallback({ text: message, show_alert: true });

      const updated = await prisma.user.findUnique({ where: { id: userId } });
      if (!updated) {
        await answerCallback({ text: "کاربر یافت نشد" });
        return;
      }
      const orderCount = await prisma.order.count({ where: { userId } });
      const eScore2 = updated.loyaltyScoreOverride ?? updated.loyaltyScore;
      const hasOvr2 = updated.loyaltyScoreOverride != null;

      await safeRender(ctx, 
        ManagerTexts.userDetails(updated.id, updated.username, updated.isActive, orderCount, updated.canCreateReferral, eScore2, hasOvr2, updated.discountPercent, updated.maxReferralCodes),
        {
          parse_mode: "Markdown",
          reply_markup: ManagerKeyboards.userActions(userId, updated.isActive, updated.canCreateReferral, updated.discountPercent, updated.maxReferralCodes),
        }
      );
      return;
    }

    // USER CONTACT INFO
    if (data.startsWith("mgr:user:contact:")) {
      const userId = safeId(parts[3]);
      const user = await prisma.user.findUnique({ where: { id: userId } });

      if (!user) {
        await answerCallback({ text: "کاربر یافت نشد" });
        return;
      }

      await safeRender(ctx,
        ManagerTexts.userContactInfo(user.phone, user.address, user.locationLat, user.locationLng, user.locationText),
        {
          parse_mode: "Markdown",
          reply_markup: ManagerKeyboards.userActions(userId, user.isActive, user.canCreateReferral, user.discountPercent, user.maxReferralCodes),
        }
      );
      return;
    }

    // SET USER LOYALTY SCORE (override)
    if (data.startsWith("mgr:user:setscore:")) {
      const userId = safeId(parts[3]);
      managerSessions.set(ctx.from.id, { state: "user:setscore", data: { userId } });
      await safeRender(ctx, ManagerTexts.enterUserScore(), {
        reply_markup: new InlineKeyboard()
          .text("« کاربر", `mgr:user:${userId}`)
          .text("« منو", "mgr:menu"),
      });
      return;
    }

    // SET USER DISCOUNT PERCENTAGE
    if (data.startsWith("mgr:user:setdiscount:")) {
      const userId = safeId(parts[3]);
      managerSessions.set(ctx.from.id, { state: "user:discount", data: { userId } });
      const user = await prisma.user.findUnique({ where: { id: userId } });
      const current = user?.discountPercent;
      await safeRender(ctx,
        current != null
          ? `🎯 تخفیف فعلی این کاربر: ${current}%\n\nدرصد تخفیف جدید را وارد کنید (۰ = حذف تخفیف):`
          : ManagerTexts.enterUserDiscount(),
        {
          reply_markup: new InlineKeyboard()
            .text("« کاربر", `mgr:user:${userId}`)
            .text("« منو", "mgr:menu"),
        }
      );
      return;
    }

    // SET USER MAX REFERRAL CODES
    if (data.startsWith("mgr:user:setmaxcodes:")) {
      const userId = safeId(parts[3]);
      const user = await prisma.user.findUnique({ where: { id: userId } });

      if (!user) {
        await answerCallback({ text: "کاربر یافت نشد" });
        return;
      }

      managerSessions.set(ctx.from.id, { state: "user:setmaxcodes", data: { userId } });
      await safeRender(ctx, ManagerTexts.enterMaxReferralCodes(user.maxReferralCodes), {
        reply_markup: new InlineKeyboard()
          .text("« کاربر", `mgr:user:${userId}`)
          .text("« منو", "mgr:menu"),
      });
      return;
    }

    // INITIATE SUPPORT CONVERSATION WITH USER
    if (data.startsWith("mgr:user:message:")) {
      const userId = safeId(parts[3]);
      const user = await prisma.user.findUnique({ where: { id: userId } });

      if (!user) {
        await answerCallback({ text: "کاربر یافت نشد" });
        return;
      }

      // Find or create an open conversation for this user
      let conversation = await prisma.supportConversation.findFirst({
        where: { userId, status: SupportConversationStatus.OPEN },
        orderBy: { createdAt: "desc" },
      });

      if (!conversation) {
        conversation = await prisma.supportConversation.create({
          data: { userId },
        });
      }

      managerSessions.set(ctx.from.id, {
        state: "support:reply",
        data: { conversationId: conversation.id },
      });

      const userLabel = user.username || user.firstName || `#${user.id}`;
      await safeRender(ctx, `💬 پیام به ${userLabel}:\n\nمتن پیام خود را ارسال کنید:`, {
        reply_markup: ManagerKeyboards.backToMenu(),
      });
      return;
    }

    // DELETE USER
    if (data.startsWith("mgr:user:delete:")) {
      const userId = safeId(parts[3]);
      const user = await prisma.user.findUnique({ where: { id: userId } });

      if (!user) {
        await answerCallback({ text: "کاربر یافت نشد" });
        return;
      }

      // Soft-delete: deactivate + clear personal data
      await prisma.user.update({
        where: { id: userId },
        data: {
          isActive: false,
          phone: null,
          address: null,
          locationLat: null,
          locationLng: null,
          locationText: null,
        },
      });

      await answerCallback({ text: ManagerTexts.userDeleted(user.username), show_alert: true });

      await safeRender(ctx, ManagerTexts.userDeleted(user.username), {
        reply_markup: ManagerKeyboards.userManagement(),
      });
      return;
    }

    // ===========================================
    // COURIERS
    // ===========================================
    if (data === "mgr:couriers") {
      await safeRender(ctx, ManagerTexts.couriersMenuTitle(), {
        parse_mode: "Markdown",
        reply_markup: ManagerKeyboards.courierManagement(),
      });
      return;
    }

    if (data === "mgr:couriers:list") {
      const couriers = await prisma.courier.findMany({
        orderBy: { id: "desc" },
      });

      if (couriers.length === 0) {
        await safeRender(ctx, ManagerTexts.noCouriers(), {
          reply_markup: ManagerKeyboards.courierManagement(),
        });
        return;
      }

      await safeRender(ctx, ManagerTexts.courierListTitle(), {
        parse_mode: "Markdown",
        reply_markup: ManagerKeyboards.courierList(couriers),
      });
      return;
    }

    if (data === "mgr:couriers:add") {
      managerSessions.set(ctx.from.id, { state: "courier:add" });
      await safeRender(ctx, ManagerTexts.enterCourierTgId(), {
        reply_markup: ManagerKeyboards.backToMenu(),
      });
      return;
    }

    if (data.startsWith("mgr:courier:") && parts[2] !== "toggle" && parts[2] !== "delete") {
      const courierId = safeId(parts[2]);
      const courier = await prisma.courier.findUnique({ where: { id: courierId } });

      if (!courier) {
        await answerCallback({ text: "پیک یافت نشد" });
        return;
      }

      await safeRender(ctx,
        ManagerTexts.courierDetails(courier.id, courier.username, courier.tgUserId, courier.isActive),
        {
          parse_mode: "Markdown",
          reply_markup: ManagerKeyboards.courierActions(courierId, courier.isActive),
        }
      );
      return;
    }

    if (data.startsWith("mgr:courier:toggle:")) {
      const courierId = safeId(parts[3]);
      const courier = await prisma.courier.findUnique({ where: { id: courierId } });

      if (!courier) {
        await answerCallback({ text: "پیک یافت نشد" });
        return;
      }

      const updated = await prisma.courier.update({
        where: { id: courierId },
        data: { isActive: !courier.isActive },
      });

      await answerCallback({
        text: ManagerTexts.courierToggled(updated.username, updated.isActive),
        show_alert: true,
      });

      await safeRender(ctx,
        ManagerTexts.courierDetails(updated.id, updated.username, updated.tgUserId, updated.isActive),
        {
          parse_mode: "Markdown",
          reply_markup: ManagerKeyboards.courierActions(courierId, updated.isActive),
        }
      );
      return;
    }

    if (data.startsWith("mgr:courier:delete:")) {
      const courierId = safeId(parts[3]);
      const courier = await prisma.courier.findUnique({ where: { id: courierId } });

      if (!courier) {
        await answerCallback({ text: "پیک یافت نشد" });
        return;
      }

      await prisma.courier.delete({ where: { id: courierId } });

      await answerCallback({
        text: ManagerTexts.courierDeleted(courier.username),
        show_alert: true,
      });

      // Back to courier list
      const couriers = await prisma.courier.findMany({ orderBy: { id: "desc" } });
      if (couriers.length === 0) {
        await safeRender(ctx, ManagerTexts.noCouriers(), {
          reply_markup: ManagerKeyboards.courierManagement(),
        });
      } else {
        await safeRender(ctx, ManagerTexts.courierListTitle(), {
          parse_mode: "Markdown",
          reply_markup: ManagerKeyboards.courierList(couriers),
        });
      }
      return;
    }

    // ===========================================
    // REFERRALS
    // ===========================================
    if (data === "mgr:referrals") {
      await safeRender(ctx, ManagerTexts.referralsMenuTitle(), {
        parse_mode: "Markdown",
        reply_markup: ManagerKeyboards.referralManagement(),
      });
      return;
    }

    if (data === "mgr:referrals:create") {
      managerSessions.set(ctx.from.id, { state: "referral:create:score" });
      await safeRender(ctx, ManagerTexts.enterReferralScore());
      return;
    }

    if (data === "mgr:referrals:list") {
      const codes = await prisma.referralCode.findMany({
        orderBy: { createdAt: "desc" },
        take: 20,
        include: {
          createdByUser: { select: { username: true } },
          createdByManager: { select: { id: true } },
        },
      });

      if (codes.length === 0) {
        await safeRender(ctx, ManagerTexts.noReferralCodes(), {
          reply_markup: ManagerKeyboards.backToMenu(),
        });
        return;
      }

      let text = ManagerTexts.referralListTitle() + "\n\n";
      codes.forEach((c) => {
        const creator = c.createdByUser?.username || (c.createdByManager ? 'مدیر' : 'نامشخص');
        const status = c.isActive ? "✅" : "❌";
        text += `${status} \`${c.code}\` - توسط ${escapeMarkdown(creator)} - ${c.usedCount}/${c.maxUses || '∞'} استفاده\n`;
      });

      await safeRender(ctx, text, {
        parse_mode: "Markdown",
        reply_markup: ManagerKeyboards.backToMenu(),
      });
      return;
    }

  /**
   * Show product sales analytics page with stock summary + per-product breakdown.
   */
  async function showProductSalesPage(ctx: Context, prisma: PrismaClient, page: number): Promise<void> {
    const pageSize = 5;
    const now = new Date();

    // Stock summary
    const [total, active, outOfStock, lowStock] = await Promise.all([
      prisma.product.count(),
      prisma.product.count({ where: { isActive: true } }),
      prisma.product.count({ where: { isActive: true, stock: 0 } }),
      prisma.product.count({ where: { isActive: true, stock: { gt: 0, lt: 5, not: null } } }),
    ]);
    const inactive = total - active;

    // Sales stats: aggregate OrderItem for PAID/COMPLETED orders by product
    const paidStatuses = [OrderStatus.PAID, OrderStatus.COMPLETED];
    const productStats = await prisma.orderItem.groupBy({
      by: ['productId'],
      where: { order: { status: { in: paidStatuses } } },
      _sum: { qty: true, lineTotal: true },
    });

    // Monthly sales stats
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthProductStats = await prisma.orderItem.groupBy({
      by: ['productId'],
      where: { order: { status: { in: paidStatuses }, createdAt: { gte: monthStart } } },
      _sum: { qty: true, lineTotal: true },
    });
    const monthTotalQty = monthProductStats.reduce((s, p) => s + (p._sum.qty || 0), 0);
    const monthTotalRevenue = monthProductStats.reduce((s, p) => s + (p._sum.lineTotal || 0), 0);

    // Fetch product titles
    const productIds = productStats.map(s => s.productId);
    const products = productIds.length > 0
      ? await prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, title: true } })
      : [];
    const productMap = new Map(products.map(p => [p.id, p.title]));

    // Build sorted list
    const salesList: { title: string; qty: number; revenue: number }[] = productStats
      .map(s => ({
        title: productMap.get(s.productId) || `محصول #${s.productId}`,
        qty: s._sum.qty || 0,
        revenue: s._sum.lineTotal || 0,
      }))
      .sort((a, b) => b.revenue - a.revenue);

    const totalQty = salesList.reduce((sum, p) => sum + p.qty, 0);
    const totalRevenue = salesList.reduce((sum, p) => sum + p.revenue, 0);

    const totalPages = Math.max(1, Math.ceil(salesList.length / pageSize));
    const paged = salesList.slice(page * pageSize, (page + 1) * pageSize);

    // Build text: stock summary + sales breakdown
    let text = `📦 *آمار محصولات*\n\n`;
    text += `📊 *موجودی*\n`;
    text += `   📦 کل: ${total}\n`;
    text += `   ✅ فعال: ${active}\n`;
    text += `   ❌ غیرفعال: ${inactive}\n`;
    text += `   ⛔ ناموجود: ${outOfStock}\n`;
    text += `   ⚠️ کم‌موجودی (<۵): ${lowStock}\n`;
    text += `─────────────────\n\n`;
    text += `📅 *این ماه*\n`;
    text += `   تعداد فروش: ${monthTotalQty}\n`;
    text += `   درآمد: ${formatPrice(monthTotalRevenue)}\n\n`;
    text += `📊 *فروش محصولات (کل)*\n`;
    text += `   مجموع تعداد: ${totalQty}\n`;
    text += `   مجموع درآمد: ${formatPrice(totalRevenue)}\n\n`;

    if (paged.length === 0) {
      text += "هنوز فروشی ثبت نشده.\n";
    } else {
      paged.forEach((p, i) => {
        const rank = page * pageSize + i + 1;
        text += `${rank}. ${escapeMarkdown(p.title)}\n`;
        text += `   ❯ ${p.qty} عدد · ${formatPrice(p.revenue)}\n`;
      });
    }

    // Build keyboard: pagination + back
    const kb = new InlineKeyboard();
    if (page > 0) kb.text("« قبلی", `mgr:analytics:products:page:${page - 1}`);
    kb.text(`${page + 1}/${totalPages}`, "noop");
    if (page < totalPages - 1) kb.text("بعدی »", `mgr:analytics:products:page:${page + 1}`);
    kb.row();
    kb.text("« بازگشت به منو", "mgr:menu");

    await safeRender(ctx, text, {
      parse_mode: "Markdown",
      reply_markup: kb,
    });
  }

    // ===========================================
    // ANALYTICS
    // ===========================================
    if (data === "mgr:analytics") {
      await safeRender(ctx, ManagerTexts.analyticsMenuTitle(), {
        parse_mode: "Markdown",
        reply_markup: ManagerKeyboards.analyticsMenu(),
      });
      return;
    }

    if (data === "mgr:analytics:orders") {
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const weekStart = new Date(todayStart);
      weekStart.setDate(weekStart.getDate() - weekStart.getDay());
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

      const paidStatuses = [OrderStatus.PAID, OrderStatus.COMPLETED];

      const [
        total,
        awaitingManagerApproval,
        approved,
        inviteSent,
        awaitingReceipt,
        paid,
        completed,
        cancelled,
        revenueResult,
        todayOrders,
        todayRevenueResult,
        weekOrders,
        weekRevenueResult,
        monthOrders,
        monthRevenueResult,
      ] = await Promise.all([
        prisma.order.count(),
        prisma.order.count({ where: { status: OrderStatus.AWAITING_MANAGER_APPROVAL } }),
        prisma.order.count({ where: { status: OrderStatus.APPROVED } }),
        prisma.order.count({ where: { status: OrderStatus.INVITE_SENT } }),
        prisma.order.count({ where: { status: OrderStatus.AWAITING_RECEIPT } }),
        prisma.order.count({ where: { status: OrderStatus.PAID } }),
        prisma.order.count({ where: { status: OrderStatus.COMPLETED } }),
        prisma.order.count({ where: { status: OrderStatus.CANCELLED } }),
        prisma.order.aggregate({
          where: { status: { in: paidStatuses } },
          _sum: { grandTotal: true },
        }),
        prisma.order.count({ where: { createdAt: { gte: todayStart } } }),
        prisma.order.aggregate({
          where: { status: { in: paidStatuses }, createdAt: { gte: todayStart } },
          _sum: { grandTotal: true },
        }),
        prisma.order.count({ where: { createdAt: { gte: weekStart } } }),
        prisma.order.aggregate({
          where: { status: { in: paidStatuses }, createdAt: { gte: weekStart } },
          _sum: { grandTotal: true },
        }),
        prisma.order.count({ where: { createdAt: { gte: monthStart } } }),
        prisma.order.aggregate({
          where: { status: { in: paidStatuses }, createdAt: { gte: monthStart } },
          _sum: { grandTotal: true },
        }),
      ]);

      const revenue = revenueResult._sum.grandTotal || 0;
      const todayRev = todayRevenueResult._sum.grandTotal || 0;
      const weekRev = weekRevenueResult._sum.grandTotal || 0;
      const monthRev = monthRevenueResult._sum.grandTotal || 0;

      const breakdown: Record<string, number> = {};
      breakdown[orderStatusLabel(OrderStatus.AWAITING_MANAGER_APPROVAL)] = awaitingManagerApproval;
      breakdown[orderStatusLabel(OrderStatus.APPROVED)] = approved;
      breakdown[orderStatusLabel(OrderStatus.AWAITING_RECEIPT)] = awaitingReceipt + inviteSent;
      breakdown[orderStatusLabel(OrderStatus.PAID)] = paid;
      breakdown[orderStatusLabel(OrderStatus.COMPLETED)] = completed;
      breakdown[orderStatusLabel(OrderStatus.CANCELLED)] = cancelled;

      await safeRender(ctx, 
        ManagerTexts.orderAnalytics(total, breakdown, revenue, todayOrders, todayRev, weekOrders, weekRev, monthOrders, monthRev),
        {
          parse_mode: "Markdown",
          reply_markup: new InlineKeyboard()
            .text("« بازگشت به آمار", "mgr:analytics")
            .text("« منو", "mgr:menu"),
        }
      );
      return;
    }

    if (data === "mgr:analytics:users") {
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const weekStart = new Date(todayStart);
      weekStart.setDate(weekStart.getDate() - weekStart.getDay());
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

      const [total, verified, active, newToday, newThisWeek, newThisMonth] = await Promise.all([
        prisma.user.count(),
        prisma.user.count({ where: { isVerified: true } }),
        prisma.user.count({ where: { isActive: true, isVerified: true } }),
        prisma.user.count({ where: { createdAt: { gte: todayStart } } }),
        prisma.user.count({ where: { createdAt: { gte: weekStart } } }),
        prisma.user.count({ where: { createdAt: { gte: monthStart } } }),
      ]);
      const blocked = total - active;

      await safeRender(ctx, 
        ManagerTexts.userAnalytics(total, verified, active, blocked, newToday, newThisWeek, newThisMonth),
        {
          parse_mode: "Markdown",
          reply_markup: new InlineKeyboard()
            .text("« بازگشت به آمار", "mgr:analytics")
            .text("« منو", "mgr:menu"),
        }
      );
      return;
    }

    if (data === "mgr:analytics:products") {
      const page = 0;
      await showProductSalesPage(ctx, prisma, page);
      return;
    }
    if (data.startsWith("mgr:analytics:products:page:")) {
      const page = safeId(parts[3]);
      await showProductSalesPage(ctx, prisma, page);
      return;
    }

    if (data === "mgr:analytics:referrals" || data === "mgr:referrals:stats") {
      const [totalCodes, activeCodes, totalUsesResult, referredUsers] = await Promise.all([
        prisma.referralCode.count(),
        prisma.referralCode.count({ where: { isActive: true } }),
        prisma.referralCode.aggregate({ _sum: { usedCount: true } }),
        prisma.user.count({ where: { referredById: { not: null } } }),
      ]);
      const totalUses = totalUsesResult._sum.usedCount || 0;
      const avgUses = totalCodes > 0 ? (totalUses / totalCodes).toFixed(1) : "0";

      // Find top referrer
      const topReferrer = await prisma.referralCode.findFirst({
        where: { createdByUserId: { not: null } },
        orderBy: { usedCount: "desc" },
        include: { createdByUser: { select: { username: true } } },
      });

      const refKb = new InlineKeyboard();
      refKb.text("🌳 مشاهده درخت معرفی‌ها", "mgr:analytics:referraltree").row();
      refKb.text("« بازگشت به آمار", "mgr:analytics").text("« منو", "mgr:menu");

      await safeRender(ctx, 
        ManagerTexts.referralAnalytics(
          totalCodes,
          activeCodes,
          totalUses,
          referredUsers,
          avgUses,
          topReferrer?.createdByUser?.username ? escapeMarkdown(topReferrer.createdByUser.username) : null
        ),
        {
          parse_mode: "Markdown",
          reply_markup: refKb,
        }
      );
      return;
    }

    // REFERRAL TREE VIEW
    if (data === "mgr:analytics:referraltree") {
      const analyticsService = new ReferralAnalyticsService(prisma);
      const trees = await analyticsService.getManagerReferralTrees();

      let text = "🌳 *درخت معرفی‌ها*\n\n";
      if (trees.length === 0) {
        text += "هنوز زنجیره معرفی‌ای ایجاد نشده.\n";
      } else {
        trees.forEach((tree) => {
          text += formatReferralTree(tree);
          text += "\n";
        });
      }

      // Truncate if too long for Telegram
      if (text.length > 4000) {
        text = text.substring(0, 3950) + "\n\n... (ادامه دارد)";
      }

      await safeRender(ctx, text, {
        parse_mode: "Markdown",
        reply_markup: ManagerKeyboards.backToMenu(),
      });
      return;
    }

    // ===========================================
    // RECEIPTS MANAGEMENT
    // ===========================================
    if (data === "mgr:receipts" || data.startsWith("mgr:receipts:page:")) {
      const page = safeId(parts[3]);
      const pageSize = 5;

      const [receipts, total] = await Promise.all([
        prisma.receipt.findMany({
          where: { reviewStatus: ReceiptReviewStatus.PENDING },
          include: { 
            order: { select: { grandTotal: true } },
            user: { select: { id: true, username: true, firstName: true, tgUserId: true } },
          },
          orderBy: { submittedAt: "asc" },
          skip: page * pageSize,
          take: pageSize,
        }),
        prisma.receipt.count({ where: { reviewStatus: ReceiptReviewStatus.PENDING } }),
      ]);

      if (receipts.length === 0) {
        await safeRender(ctx, ManagerTexts.noPendingReceipts(), {
          reply_markup: ManagerKeyboards.backToMenu(),
        });
        return;
      }

      const totalPages = Math.ceil(total / pageSize);
      let text = `🧾 *رسیدهای در انتظار بررسی* (${total} عدد)\n\n`;
      receipts.forEach((r) => {
        const name = escapeMarkdown(r.user.firstName || r.user.username) || `کاربر #${r.user.id}`;
        const date = r.submittedAt.toISOString().split("T")[0];
        text += `🆔 سفارش #${r.orderId} · ${name} · ${formatPrice(r.order.grandTotal)} · ${date}\n`;
      });

      await safeRender(ctx, text, {
        parse_mode: "Markdown",
        reply_markup: ManagerKeyboards.receiptList(receipts, page, totalPages),
      });
      return;
    }

    // VIEW RECEIPT
    if (data.startsWith("mgr:receipt:view:")) {
      const receiptId = safeId(parts[3]);
      const receipt = await prisma.receipt.findUnique({
        where: { id: receiptId },
        include: { 
          order: { select: { id: true, grandTotal: true } },
          user: { select: { id: true, username: true, firstName: true, phone: true, address: true, locationLat: true, locationLng: true, locationText: true } },
        },
      });

      if (!receipt) {
        await answerCallback({ text: "رسید یافت نشد" });
        return;
      }

      const esc = escapeMarkdown;
      const name = esc(receipt.user.firstName || receipt.user.username) || `کاربر #${receipt.user.id}`;
      let text = `🧾 *رسید سفارش #${receipt.orderId}*\n`;
      text += `👤 ${name}\n`;
      text += `💳 مبلغ سفارش: ${formatPrice(receipt.order.grandTotal)}\n`;
      text += `📅 ارسال: ${receipt.submittedAt.toISOString().split('T')[0]}\n\n`;
      text += ManagerTexts.userContactInfo(
        receipt.user.phone,
        receipt.user.address,
        receipt.user.locationLat,
        receipt.user.locationLng,
        receipt.user.locationText
      );

      // Send receipt image — file_id belongs to the client bot, so convert
      let receiptSent = false;
      if (clientBot) {
        try {
          const receiptInput = await crossBotFile(clientBot.api, clientBot.token, receipt.fileId);
          await ctx.replyWithPhoto(receiptInput, {
            caption: text,
            parse_mode: "Markdown",
            reply_markup: ManagerKeyboards.receiptActions(receiptId, receipt.order.id),
          });
          receiptSent = true;
        } catch (err) {
          console.error("[RECEIPT VIEW] Failed to get receipt image from client bot:", err);
        }
      }
      if (!receiptSent) {
        await safeRender(ctx, text + "\n\n⚠️ تصویر رسید قابل نمایش نیست.", {
          parse_mode: "Markdown",
          reply_markup: ManagerKeyboards.receiptActions(receiptId, receipt.order.id),
        });
      }
      return;
    }

    // SHOW RECEIPT (from notification)
    if (data.startsWith("mgr:receipt:show:")) {
      const receiptId = safeId(parts[3]);
      const receipt = await prisma.receipt.findUnique({
        where: { id: receiptId },
        include: { order: true },
      });

      if (!receipt) {
        await answerCallback({ text: "رسید یافت نشد" });
        return;
      }

      if (!clientBot) {
        await answerCallback({ text: "ربات فروشنده در دسترس نیست" });
        return;
      }

      try {
        const receiptInput = await crossBotFile(clientBot.api, clientBot.token, receipt.fileId);
        await ctx.replyWithPhoto(receiptInput, {
          caption: `🧾 *رسید سفارش #${receipt.orderId}*`,
          parse_mode: "Markdown",
          reply_markup: new InlineKeyboard()
            .text("✅ تأیید رسید", `mgr:receipt:approve:${receiptId}`)
            .text("❌ رد رسید", `mgr:receipt:reject:${receiptId}`)
            .row()
            .text("« لیست رسیدها", "mgr:receipts"),
        });
        await answerCallback();
      } catch (err) {
        console.error("[RECEIPT SHOW] Failed to show receipt:", err);
        await answerCallback({ text: "خطا در نمایش رسید" });
      }
      return;
    }

    // APPROVE RECEIPT — Ask for ETA text first
    if (data.startsWith("mgr:receipt:approve:")) {
      const receiptId = safeId(parts[3]);
      const receipt = await prisma.receipt.findUnique({
        where: { id: receiptId },
        include: { order: { include: { user: true } } },
      });

      if (!receipt) {
        await answerCallback({ text: "رسید یافت نشد" });
        return;
      }

      managerSessions.set(ctx.from.id, {
        state: "receipt:approve:eta",
        data: { receiptId },
      });

      await answerCallback({ text: "⏳ متن زمان تحویل را وارد کنید." });
      await ctx.reply(ManagerTexts.enterEtaMessage(), {
        reply_markup: ManagerKeyboards.backToMenu(),
      });
      return;
    }

    // REJECT RECEIPT - Ask for reason
    if (data.startsWith("mgr:receipt:reject:")) {
      const receiptId = safeId(parts[3]);
      managerSessions.set(ctx.from.id, { 
        state: "receipt:reject:reason", 
        data: { receiptId } 
      });
      await answerCallback({ text: "⏳ علت رد را وارد کنید." });
      await ctx.reply(ManagerTexts.enterRejectReason(), {
        reply_markup: ManagerKeyboards.backToMenu(),
      });
      return;
    }

    // ===========================================
    // SUPPORT
    // ===========================================
    if (data === "mgr:support" || data.startsWith("mgr:support:page:")) {
      const page = data.startsWith("mgr:support:page:") ? parseInt(data.split(":")[3]) : 0;
      const pageSize = 10;

      const [conversations, total] = await Promise.all([
        prisma.supportConversation.findMany({
          where: { status: SupportConversationStatus.OPEN },
          include: { user: { select: { id: true, username: true, firstName: true } } },
          orderBy: { lastMessageAt: "desc" },
          skip: page * pageSize,
          take: pageSize,
        }),
        prisma.supportConversation.count({
          where: { status: SupportConversationStatus.OPEN },
        }),
      ]);

      if (conversations.length === 0) {
        await safeRender(ctx, ManagerTexts.noSupportConversations(), {
          reply_markup: ManagerKeyboards.backToMenu(),
        });
        return;
      }

      const totalPages = Math.ceil(total / pageSize);
      const items = conversations.map((c) => ({
        id: c.id,
        userLabel: c.user.username || c.user.firstName || `کاربر #${c.user.id}`,
        lastMessageAtLabel: c.lastMessageAt.toISOString().split("T")[0],
      }));

      await safeRender(ctx, ManagerTexts.supportInboxTitle(), {
        parse_mode: "Markdown",
        reply_markup: ManagerKeyboards.supportInbox(items, page, totalPages),
      });
      return;
    }

    // VIEW SUPPORT CONVERSATION
    if (data.startsWith("mgr:support:conv:")) {
      const convId = safeId(parts[3]);
      const conversation = await prisma.supportConversation.findUnique({
        where: { id: convId },
        include: {
          user: { select: { id: true, username: true, firstName: true } },
          messages: {
            orderBy: { createdAt: "desc" },
            take: 15,
          },
        },
      });

      if (!conversation) {
        await answerCallback({ text: "گفتگو یافت نشد" });
        return;
      }

      const userLabel = escapeMarkdown(conversation.user.username || conversation.user.firstName || `کاربر #${conversation.user.id}`);
      let convText = `💬 *گفتگوی پشتیبانی #${convId}*\nکاربر: ${userLabel}\n\n`;

      if (conversation.messages.length > 0) {
        const sorted = [...conversation.messages].reverse();
        sorted.forEach((m) => {
          const sender = m.senderType === SupportSenderType.USER ? "کاربر" : "مدیر";
          convText += `*${sender}:* ${escapeMarkdown(m.text)}\n\n`;
        });
      } else {
        convText += "هنوز پیامی ارسال نشده.\n";
      }

      await safeRender(ctx, convText, {
        parse_mode: "Markdown",
        reply_markup: ManagerKeyboards.supportConversationActions(convId),
      });
      return;
    }

    // SET REPLY SESSION FOR SUPPORT
    if (data.startsWith("mgr:support:reply:")) {
      const convId = safeId(parts[3]);
      managerSessions.set(ctx.from.id, {
        state: "support:reply",
        data: { conversationId: convId },
      });
      await safeRender(ctx, ManagerTexts.supportAskReply(), {
        reply_markup: ManagerKeyboards.backToMenu(),
      });
      return;
    }

    // CLOSE SUPPORT CONVERSATION
    if (data.startsWith("mgr:support:close:")) {
      const convId = safeId(parts[3]);
      const conversation = await prisma.supportConversation.findUnique({
        where: { id: convId },
        include: { user: true },
      });

      await prisma.supportConversation.update({
        where: { id: convId },
        data: { status: SupportConversationStatus.CLOSED },
      });

      // Notify client
      if (conversation?.user) {
        await notificationService.notifyClientSupportClosed(conversation.user.tgUserId);
      }

      await safeRender(ctx, ManagerTexts.supportConversationClosed(), {
        reply_markup: ManagerKeyboards.backToMenu(),
      });
      return;
    }

    // ===========================================
    // SETTINGS
    // ===========================================
    if (data === "mgr:settings") {
      const imageFileId = await settingsService.getCheckoutImageFileId(checkoutImageFileId);
      const imageStatus = imageFileId ? "✅ تنظیم شده" : "❌ تنظیم نشده";
      const cardNumber = await settingsService.getPaymentCardNumber();
      const cardStatus = cardNumber ? `✅ ${cardNumber}` : undefined;
      const deliveryMsg = await settingsService.getOutForDeliveryMessage();
      const deliveryMsgStatus = deliveryMsg ? "✅ تنظیم شده" : undefined;

      await safeRender(ctx, ManagerTexts.settingsMenuTitle(imageStatus, cardStatus, deliveryMsgStatus), {
        parse_mode: "Markdown",
        reply_markup: ManagerKeyboards.settingsMenu(!!imageFileId),
      });
      return;
    }

    if (data === "mgr:settings:image") {
      managerSessions.set(ctx.from.id, { state: "settings:image" });
      await safeRender(ctx, ManagerTexts.settingsImageAsk(), {
        reply_markup: ManagerKeyboards.backToMenu(),
      });
      return;
    }

    if (data === "mgr:settings:image:delete") {
      await settingsService.delete(SettingKeys.CHECKOUT_IMAGE_FILE_ID);
      await answerCallback({ text: ManagerTexts.settingsImageDeleted(), show_alert: true });

      const cardNumber = await settingsService.getPaymentCardNumber();
      const cardStatus = cardNumber ? `✅ ${cardNumber}` : undefined;
      const deliveryMsg = await settingsService.getOutForDeliveryMessage();
      const deliveryMsgStatus = deliveryMsg ? "✅ تنظیم شده" : undefined;
      await safeRender(ctx, ManagerTexts.settingsMenuTitle("❌ تنظیم نشده", cardStatus, deliveryMsgStatus), {
        parse_mode: "Markdown",
        reply_markup: ManagerKeyboards.settingsMenu(false),
      });
      return;
    }

    if (data === "mgr:settings:expiry") {
      managerSessions.set(ctx.from.id, { state: "settings:expiry" });
      await safeRender(ctx, ManagerTexts.settingsExpiryAsk(), {
        reply_markup: ManagerKeyboards.backToMenu(),
      });
      return;
    }

    if (data === "mgr:settings:card") {
      managerSessions.set(ctx.from.id, { state: "settings:card" });
      await safeRender(ctx, ManagerTexts.settingsCardAsk(), {
        reply_markup: ManagerKeyboards.backToMenu(),
      });
      return;
    }

    if (data === "mgr:settings:deliverymsg") {
      managerSessions.set(ctx.from.id, { state: "settings:deliverymsg" });
      await safeRender(ctx, ManagerTexts.settingsDeliveryMsgAsk(), {
        reply_markup: ManagerKeyboards.backToMenu(),
      });
      return;
    }

    // HELP
    if (data === "mgr:help") {
      await safeRender(ctx, ManagerTexts.helpMessage(), {
        parse_mode: "Markdown",
        reply_markup: ManagerKeyboards.backToMenu(),
      });
      return;
    }

    // NO-OP
    if (data === "noop") {
      return;
    }
    } finally {
      await answerCallback();
    }
  });

}
