import { Bot, Context } from "grammy";
import type { PrismaClient, Manager } from "@prisma/client";
import { OrderStatus, ReceiptReviewStatus, SupportConversationStatus, SupportSenderType } from "@prisma/client";
import { ManagerTexts, ClientTexts, ChannelTexts } from "../../i18n/index.js";
import { ManagerKeyboards } from "../../utils/keyboards.js";

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
  | "referral:create:maxuses"
  | "receipt:reject:reason"
  | "support:reply"
  | "settings:image"
  | "settings:expiry"
  | "courier:add"
  | "user:setscore";

interface ManagerSession {
  state: SessionState;
  data?: Record<string, unknown>;
}

const managerSessions = new SessionStore<ManagerSession>();

interface ManagerBotDeps {
  prisma: PrismaClient;
  clientBot?: Bot;
  courierBot?: Bot;
  checkoutChannelId?: string;
  checkoutImageFileId?: string;
  inviteExpiryMinutes?: number;
}

import { createReferralCodeWithRetry } from "../../utils/referral-utils.js";
import { NotificationService } from "../../services/notification-service.js";
import { orderStatusLabel } from "../../utils/order-status.js";
import { ReferralAnalyticsService, formatReferralTree } from "../../services/referral-analytics-service.js";
import { safeRender as safeRenderOriginal } from "../../utils/safe-reply.js";
import { escapeMarkdown } from "../../utils/escape-markdown.js";
import { cleanupChannelForOrder } from "../../services/channel-cleanup-service.js";
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
 * Register all interactive handlers for manager bot
 */
export function registerInteractiveManagerBot(bot: Bot, deps: ManagerBotDeps): void {
  const { prisma, clientBot, courierBot, checkoutChannelId, checkoutImageFileId, inviteExpiryMinutes = 60 } = deps;
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

    const pendingCount = await prisma.order.count({
      where: { status: OrderStatus.AWAITING_MANAGER_APPROVAL },
    });

    await ctx.reply(
      `${ManagerTexts.mainMenuTitle()}\n\n📋 سفارش‌های در انتظار: ${pendingCount}`,
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

    // CANCEL HANDLER
    if (text === "/cancel") {
      managerSessions.delete(ctx.from.id);
      await ctx.reply(ManagerTexts.actionCancelled(), {
        reply_markup: ManagerKeyboards.mainMenu(),
      });
      return;
    }

    // PRODUCT CREATION FLOW
    if (session.state === "product:add:title") {
      session.data = { ...session.data, title: text };
      session.state = "product:add:description";
      managerSessions.set(ctx.from.id, session);
      await ctx.reply(ManagerTexts.enterProductDescription() + "\n(برای انصراف /cancel را ارسال کنید)");
      return;
    }

    if (session.state === "product:add:description") {
      session.data = { ...session.data, description: text === "/skip" ? null : text };
      session.state = "product:add:price";
      managerSessions.set(ctx.from.id, session);
      await ctx.reply(ManagerTexts.enterProductPrice() + "\n(برای انصراف /cancel را ارسال کنید)");
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
      await ctx.reply(ManagerTexts.enterProductStock() + "\n(برای انصراف /cancel را ارسال کنید)");
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
      await ctx.reply(ManagerTexts.sendProductImage() + "\n(برای انصراف /cancel را ارسال کنید)");
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

    // REFERRAL CODE CREATION
    if (session.state === "referral:create:maxuses") {
      const maxUses = text === "/skip" ? null : parseInt(text);
      if (text !== "/skip" && (isNaN(maxUses!) || maxUses! < 1)) {
        await ctx.reply(ManagerTexts.invalidNumber());
        return;
      }

      const code = await createReferralCodeWithRetry(prisma, {
        createdByManagerId: manager.id,
        maxUses,
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
      const reason = ctx.message.text === "/skip" ? null : ctx.message.text.trim();

      const receipt = await prisma.receipt.findUnique({
        where: { id: receiptId },
        include: { order: { include: { user: true } } },
      });

      if (!receipt) {
        managerSessions.delete(ctx.from.id);
        await ctx.reply("رسید یافت نشد.", { reply_markup: ManagerKeyboards.backToMenu() });
        return;
      }

      await prisma.$transaction([
        prisma.receipt.update({
          where: { id: receiptId },
          data: { 
            reviewStatus: ReceiptReviewStatus.REJECTED,
            reviewedById: manager.id,
            reviewNotes: reason,
          },
        }),
        prisma.order.update({
          where: { id: receipt.orderId },
          data: { 
            status: OrderStatus.INVITE_SENT,
            events: {
              create: {
                actorType: "manager",
                actorId: manager.id,
                eventType: "receipt_rejected",
                payload: reason ? JSON.stringify({ reason }) : null,
              },
            },
          },
        }),
      ]);

      if (clientBot && receipt.order.user) {
        try {
          await clientBot.api.sendMessage(
            receipt.order.user.tgUserId.toString(),
            ClientTexts.receiptRejected(receipt.orderId, reason || undefined)
          );
        } catch (error) {
          console.error("Failed to notify client of receipt rejection:", error);
        }
      }

      managerSessions.delete(ctx.from.id);
      await ctx.reply(ManagerTexts.receiptRejected(receipt.orderId), {
        reply_markup: ManagerKeyboards.backToMenu(),
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

    // COURIER ADD BY TG ID
    if (session.state === "courier:add") {
      const input = ctx.message.text.trim();
      const tgUserId = BigInt(input || "0");

      if (!input || tgUserId <= 0n) {
        await ctx.reply(ManagerTexts.invalidTgId());
        return;
      }

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

      await notificationService.notifyClientSupportReply(conversation.user.tgUserId, replyText);

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
      if (session.state === "product:add:image" || session.state === "product:edit:image") {
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

    // Helper to answer callback and render
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const render = async (text: string, options?: any) => {
      await answerCallback();
      return safeRenderOriginal(ctx, text, options);
    };

    const data = ctx.callbackQuery.data;
    const parts = data.split(":");

    // MAIN MENU
    if (data === "mgr:menu") {
      const pendingCount = await prisma.order.count({
        where: { status: OrderStatus.AWAITING_MANAGER_APPROVAL },
      });

      await render(
        `${ManagerTexts.mainMenuTitle()}\n\n📋 سفارش‌های در انتظار: ${pendingCount}`,
        {
          parse_mode: "Markdown",
          reply_markup: ManagerKeyboards.mainMenu(),
        }
      );
      return;
    }

    // ===========================================
    // ORDERS
    // ===========================================
    if (data === "mgr:orders" || data.startsWith("mgr:orders:")) {
      const page = parts[2] ? parseInt(parts[2]) : 0;
      const pageSize = 5;

      const [orders, total] = await Promise.all([
        prisma.order.findMany({
          where: { status: OrderStatus.AWAITING_MANAGER_APPROVAL },
          orderBy: { id: "asc" },
          skip: page * pageSize,
          take: pageSize,
        }),
        prisma.order.count({
          where: { status: OrderStatus.AWAITING_MANAGER_APPROVAL },
        }),
      ]);

      if (orders.length === 0) {
        await render( ManagerTexts.noPendingOrders(), {
          reply_markup: ManagerKeyboards.backToMenu(),
        });
        return;
      }

      const totalPages = Math.ceil(total / pageSize);
      await render( ManagerTexts.pendingOrdersHeader(), {
        reply_markup: ManagerKeyboards.orderList(orders, page, totalPages),
      });
      return;
    }

    // APPROVE ORDER - Supports two methods: "channel" and "direct"
    if (data.startsWith("mgr:approve:")) {
      const orderId = parseInt(parts[2]);

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
        const payMethod = await settingsService.getPaymentMethod();
        const effectiveImageFileId = await settingsService.getCheckoutImageFileId(checkoutImageFileId);
        const effectiveExpiryMin = await settingsService.getInviteExpiryMinutes(inviteExpiryMinutes);

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
          order.items[0]?.product?.currency ?? "IRR",
        );

        // 1) Update order status to APPROVED
        await prisma.order.update({
          where: { id: orderId },
          data: {
            status: OrderStatus.APPROVED,
            events: {
              create: { actorType: "manager", actorId: manager.id, eventType: "order_approved" },
            },
          },
        });

        if (payMethod === "channel") {
          // ── CHANNEL METHOD ──
          if (!checkoutChannelId) {
            // Fallback: no channel configured → approve but warn
            await prisma.order.update({
              where: { id: orderId },
              data: { status: OrderStatus.AWAITING_RECEIPT },
            });
            await answerCallback({
              text: "⚠️ تأیید شد اما CHECKOUT_CHANNEL_ID تنظیم نشده. روش را به «مستقیم» تغییر دهید یا کانال تنظیم کنید.",
              show_alert: true,
            });
          } else {
            // Post payment message to checkout channel
            let channelMessageId: number | null = null;
            try {
              if (checkoutImageInput) {
                const msg = await clientBot.api.sendPhoto(checkoutChannelId, checkoutImageInput, {
                  caption: paymentCaption, parse_mode: "Markdown",
                });
                channelMessageId = msg.message_id;
              } else {
                const msg = await clientBot.api.sendMessage(checkoutChannelId, paymentCaption, {
                  parse_mode: "Markdown",
                });
                channelMessageId = msg.message_id;
              }
            } catch (err) {
              console.error("[APPROVE channel] Failed to post payment message:", err);
            }

            // Create time-limited invite link
            const now = new Date();
            const expiresAt = new Date(now.getTime() + effectiveExpiryMin * 60 * 1000);
            const expireUnix = Math.floor(expiresAt.getTime() / 1000);
            let inviteLink: string | null = null;
            try {
              const result = await clientBot.api.createChatInviteLink(checkoutChannelId, {
                member_limit: 1, name: `Order #${orderId}`, expire_date: expireUnix,
              });
              inviteLink = result.invite_link;
            } catch (err) {
              console.error("[APPROVE channel] Failed to create invite link:", err);
            }

            // Persist invite details
            await prisma.order.update({
              where: { id: orderId },
              data: {
                status: OrderStatus.INVITE_SENT,
                inviteLink, inviteSentAt: now, inviteExpiresAt: expiresAt, channelMessageId,
                events: {
                  create: {
                    actorType: "manager", actorId: manager.id, eventType: "invite_sent",
                    payload: JSON.stringify({ inviteLink, channelMessageId, expiresAt: expiresAt.toISOString() }),
                  },
                },
              },
            });

            // Send invite to client
            if (order.user && inviteLink) {
              try {
                await clientBot.api.sendMessage(
                  order.user.tgUserId.toString(),
                  ClientTexts.orderApprovedWithInvite(orderId, inviteLink),
                );
              } catch (err) {
                console.error("[APPROVE channel] Failed to send invite to client:", err);
              }
              await answerCallback({ text: `✅ سفارش #${orderId} تأیید شد و لینک کانال ارسال شد.`, show_alert: true });
            } else {
              await answerCallback({
                text: `⚠️ سفارش #${orderId} تأیید شد ولی لینک دعوت ایجاد نشد.`,
                show_alert: true,
              });
            }
          }

        } else {
          // ── DIRECT METHOD ──
          // Send payment details directly to client via DM
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
            console.error("[APPROVE direct] Failed to send payment details to client:", err);
            // Retry without Markdown and without image
            try {
              const msg = await clientBot.api.sendMessage(userTgId, paymentCaption.replace(/[*_`\[]/g, ""));
              directMessageId = msg.message_id;
            } catch (err2) {
              console.error("[APPROVE direct] Retry also failed:", err2);
            }
          }

          // Also send instruction to upload receipt
          try {
            await clientBot.api.sendMessage(
              userTgId,
              `✅ سفارش #${orderId} تأیید شد.\n\nپس از پرداخت، عکس رسید را همینجا ارسال کنید.`,
            );
          } catch (err) {
            console.error("[APPROVE direct] Failed to send receipt instruction:", err);
          }

          // Update order to AWAITING_RECEIPT (skip INVITE_SENT since no channel)
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
            text: `✅ سفارش #${orderId} تأیید شد و اطلاعات پرداخت مستقیماً ارسال شد.`,
            show_alert: true,
          });
        }

        // Refresh order list (both methods)
        const orders = await prisma.order.findMany({
          where: { status: OrderStatus.AWAITING_MANAGER_APPROVAL },
          orderBy: { id: "asc" },
          take: 5,
        });

        if (orders.length === 0) {
          await render( ManagerTexts.noPendingOrders(), {
            reply_markup: ManagerKeyboards.backToMenu(),
          });
        } else {
          await render( ManagerTexts.pendingOrdersHeader(), {
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
      const orderId = parseInt(parts[2]);

      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: { user: true },
      });
      if (!order || order.status !== OrderStatus.AWAITING_MANAGER_APPROVAL) {
        await answerCallback({ text: ManagerTexts.orderNotFound() });
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
              eventType: "order_rejected",
            },
          },
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
        await render( ManagerTexts.noPendingOrders(), {
          reply_markup: ManagerKeyboards.backToMenu(),
        });
      } else {
        await render( ManagerTexts.pendingOrdersHeader(), {
          reply_markup: ManagerKeyboards.orderList(orders, 0, 1),
        });
      }
      return;
    }

    // ===========================================
    // ORDER DETAIL
    // ===========================================
    if (data.startsWith("mgr:order:") && !data.startsWith("mgr:orders")) {
      const orderId = parseInt(parts[2]);
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: {
          items: { include: { product: true } },
          user: { select: { id: true, username: true, firstName: true, phone: true, address: true, locationLat: true, locationLng: true } },
          events: { orderBy: { createdAt: "asc" }, take: 10 },
          receipts: { orderBy: { submittedAt: "desc" }, take: 3 },
          delivery: { include: { assignedCourier: true } },
        },
      });

      if (!order) {
        await answerCallback({ text: ManagerTexts.orderNotFound() });
        return;
      }

      const esc = escapeMarkdown;
      let detailText = `📦 *سفارش #${order.id}*\n`;
      detailText += `وضعیت: ${esc(orderStatusLabel(order.status))}\n`;
      detailText += `تاریخ: ${order.createdAt.toISOString().split("T")[0]}\n\n`;

      // User info
      const u = order.user;
      detailText += `*مشتری:* ${esc(u.firstName)} (@${esc(u.username)})\n`;
      detailText += `تلفن: ${esc(u.phone) || "-"}\n`;
      detailText += `آدرس: ${esc(u.address) || "-"}\n`;
      if (u.locationLat != null) detailText += `📍 موقعیت ثبت شده\n`;
      detailText += "\n";

      // Items
      detailText += `*اقلام:*\n`;
      order.items.forEach((item) => {
        detailText += `  ${esc(item.product.title)} x${item.qty} = ${item.lineTotal}\n`;
      });
      detailText += `\nجمع: ${order.subtotal}\n`;
      if (order.discountTotal > 0) detailText += `تخفیف: ${order.discountTotal}\n`;
      detailText += `*نهایی: ${order.grandTotal}*\n`;

      // Receipts
      if (order.receipts.length > 0) {
        detailText += `\n🧾 رسیدها: ${order.receipts.length} عدد (آخرین: ${esc(order.receipts[0].reviewStatus)})\n`;
      }

      // Delivery
      if (order.delivery) {
        const d = order.delivery;
        detailText += `\n🚚 ارسال: ${esc(d.status)}`;
        if (d.assignedCourier) detailText += ` (پیک: @${esc(d.assignedCourier.username) || d.assignedCourier.id})`;
        detailText += "\n";
      }

      // Events
      if (order.events.length > 0) {
        detailText += `\n📋 *تاریخچه:*\n`;
        order.events.forEach((e) => {
          detailText += `  ${e.createdAt.toISOString().split("T")[0]} · ${esc(e.eventType)}\n`;
        });
      }

      const { InlineKeyboard: DK } = await import("grammy");
      const detailKb = new DK();
      if (order.status === OrderStatus.AWAITING_MANAGER_APPROVAL) {
        detailKb.text("✅ تأیید", `mgr:approve:${orderId}`).text("❌ رد", `mgr:reject:${orderId}`).row();
      }
      detailKb.text("« سفارش‌ها", "mgr:orders").text("« منو", "mgr:menu");

      await render( detailText, {
        parse_mode: "Markdown",
        reply_markup: detailKb,
      });
      return;
    }

    // ALL ORDERS WITH STATUS FILTER
    if (data === "mgr:allorders" || data.startsWith("mgr:allorders:")) {
      const statusFilter = parts[1] === "allorders" && parts[2] ? parts[2] : null;
      const page = parts[3] ? parseInt(parts[3]) : 0;
      const pageSize = 5;

      const where = statusFilter ? { status: statusFilter as OrderStatus } : {};

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

      const totalPages = Math.ceil(total / pageSize);

      let text = `📊 *همه سفارش‌ها* (${total} سفارش)\n`;
      if (statusFilter) text += `فیلتر: ${orderStatusLabel(statusFilter as OrderStatus)}\n`;
      text += "\n";

      if (orders.length === 0) {
        text += "سفارشی یافت نشد.\n";
      } else {
        orders.forEach((o) => {
          const label = escapeMarkdown(o.user.username || o.user.firstName) || `#${o.userId}`;
          text += `#${o.id} · ${label} · ${escapeMarkdown(orderStatusLabel(o.status))} · ${o.grandTotal}\n`;
        });
      }

      const { InlineKeyboard: AK } = await import("grammy");
      const allKb = new AK();
      // Status filter buttons
      allKb
        .text("⏳ در انتظار", "mgr:allorders:AWAITING_MANAGER_APPROVAL:0")
        .text("✅ تأیید", "mgr:allorders:APPROVED:0")
        .row()
        .text("💰 پرداخت", "mgr:allorders:PAID:0")
        .text("✅ تکمیل", "mgr:allorders:COMPLETED:0")
        .row()
        .text("❌ لغو", "mgr:allorders:CANCELLED:0")
        .text("📋 همه", "mgr:allorders")
        .row();

      // Pagination
      if (totalPages > 1) {
        const filterPart = statusFilter ? `:${statusFilter}` : "";
        if (page > 0) allKb.text("« قبلی", `mgr:allorders${filterPart}:${page - 1}`);
        allKb.text(`${page + 1}/${totalPages}`, "noop");
        if (page < totalPages - 1) allKb.text("بعدی »", `mgr:allorders${filterPart}:${page + 1}`);
        allKb.row();
      }

      // Per-order detail buttons
      orders.forEach((o) => {
        allKb.text(`📋 #${o.id}`, `mgr:order:${o.id}`).row();
      });

      allKb.text("« منو", "mgr:menu");

      await render( text, {
        parse_mode: "Markdown",
        reply_markup: allKb,
      });
      return;
    }

    // USER'S ORDERS
    if (data.startsWith("mgr:user:orders:")) {
      const userId = parseInt(parts[3]);
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

      let text = `📦 *سفارش‌های ${label}*\n\n`;
      if (userOrders.length === 0) {
        text += "سفارشی یافت نشد.\n";
      } else {
        userOrders.forEach((o) => {
          text += `#${o.id} · ${orderStatusLabel(o.status)} · ${o.grandTotal}\n`;
        });
      }

      const { InlineKeyboard: UK } = await import("grammy");
      const userKb = new UK();
      userOrders.forEach((o) => {
        userKb.text(`📋 #${o.id}`, `mgr:order:${o.id}`).row();
      });
      userKb.text("« کاربران", "mgr:users").text("« منو", "mgr:menu");

      await render( text, {
        parse_mode: "Markdown",
        reply_markup: userKb,
      });
      return;
    }

    // USER'S REFERRALS
    if (data.startsWith("mgr:user:referrals:")) {
      const userId = parseInt(parts[3]);

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

      let text = `🔗 *معرفی‌های ${label}*\n\n`;

      if (referralCodes.length > 0) {
        text += "*کدهای معرفی:*\n";
        referralCodes.forEach((c) => {
          text += `\`${c.code}\` · ${c.usedCount} استفاده\n`;
        });
      }

      text += `\n*کاربران معرفی شده:* ${referredUsers.length}\n`;
      referredUsers.forEach((u) => {
        text += `  ${u.username || u.firstName || `#${u.id}`}\n`;
      });

      await render( text, {
        parse_mode: "Markdown",
        reply_markup: ManagerKeyboards.backToMenu(),
      });
      return;
    }

    // ===========================================
    // PRODUCTS
    // ===========================================
    if (data === "mgr:products") {
      await render( ManagerTexts.productsMenuTitle(), {
        parse_mode: "Markdown",
        reply_markup: ManagerKeyboards.productManagement(),
      });
      return;
    }

    if (data === "mgr:products:list" || data.startsWith("mgr:products:list:")) {
      const page = parts[3] ? parseInt(parts[3]) : 0;
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
        await render( ManagerTexts.noProducts(), {
          reply_markup: ManagerKeyboards.backToMenu(),
        });
        return;
      }

      const totalPages = Math.ceil(total / pageSize);
      await render( ManagerTexts.productListTitle(), {
        parse_mode: "Markdown",
        reply_markup: ManagerKeyboards.productList(products, page, totalPages),
      });
      return;
    }

    if (data === "mgr:products:add") {
      managerSessions.set(ctx.from.id, { state: "product:add:title", data: {} });
      await render( ManagerTexts.enterProductTitle() + "\n(برای انصراف /cancel را ارسال کنید)");
      return;
    }

    if (data.startsWith("mgr:product:edit:") && parts.length === 4) {
      const productId = parseInt(parts[3]);
      const product = await prisma.product.findUnique({ where: { id: productId } });

      if (!product) {
        await answerCallback({ text: "محصول یافت نشد" });
        return;
      }

      const text = `*ویرایش محصول: ${escapeMarkdown(product.title)}*\n\n` +
        `📝 عنوان: ${escapeMarkdown(product.title)}\n` +
        `📄 توضیحات: ${escapeMarkdown(product.description) || '—'}\n` +
        `💰 قیمت: ${product.price} ${product.currency}\n` +
        `📦 موجودی: ${product.stock ?? 'نامحدود'}\n` +
        `🖼️ تصویر: ${product.photoFileId ? 'دارد' : 'ندارد'}\n` +
        `وضعیت: ${product.isActive ? '✅ فعال' : '❌ غیرفعال'}`;

      await render( text, {
        parse_mode: "Markdown",
        reply_markup: ManagerKeyboards.productEdit(productId, !!product.photoFileId),
      });
      return;
    }

    if (data.startsWith("mgr:product:edit:") && parts.length === 5) {
      const productId = parseInt(parts[3]);
      const field = parts[4];

      // Handle remove image immediately (no user input needed)
      if (field === "removeimage") {
        await prisma.product.update({
          where: { id: productId },
          data: { photoFileId: null },
        });
        
        const product = await prisma.product.findUnique({ where: { id: productId } });
        const text = `*ویرایش محصول: ${escapeMarkdown(product!.title)}*\n\n` +
          `📝 عنوان: ${escapeMarkdown(product!.title)}\n` +
          `📄 توضیحات: ${escapeMarkdown(product!.description) || '—'}\n` +
          `💰 قیمت: ${product!.price} ${product!.currency}\n` +
          `📦 موجودی: ${product!.stock ?? 'نامحدود'}\n` +
          `🖼️ تصویر: ندارد\n` +
          `وضعیت: ${product!.isActive ? '✅ فعال' : '❌ غیرفعال'}`;

        await render( text, {
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

      if (field === "title") await render( ManagerTexts.enterProductTitle() + "\n(برای انصراف /cancel را ارسال کنید)");
      else if (field === "desc") await render( ManagerTexts.enterProductDescription() + "\n(برای انصراف /cancel را ارسال کنید)");
      else if (field === "price") await render( ManagerTexts.enterProductPrice() + "\n(برای انصراف /cancel را ارسال کنید)");
      else if (field === "stock") await render( ManagerTexts.enterProductStock() + "\n(برای انصراف /cancel را ارسال کنید)");
      else if (field === "image") await render( ManagerTexts.sendProductImage() + "\n(برای انصراف /cancel را ارسال کنید)");
      return;
    }

    if (data.startsWith("mgr:product:toggle:")) {
      const productId = parseInt(parts[3]);
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
      const text = `*ویرایش محصول: ${escapeMarkdown(updated!.title)}*\n\n` +
        `📝 عنوان: ${escapeMarkdown(updated!.title)}\n` +
        `📄 توضیحات: ${escapeMarkdown(updated!.description) || '—'}\n` +
        `💰 قیمت: ${updated!.price} ${updated!.currency}\n` +
        `📦 موجودی: ${updated!.stock ?? 'نامحدود'}\n` +
        `🖼️ تصویر: ${updated!.photoFileId ? 'دارد' : 'ندارد'}\n` +
        `وضعیت: ${updated!.isActive ? '✅ فعال' : '❌ غیرفعال'}`;

      await render( text, {
        parse_mode: "Markdown",
        reply_markup: ManagerKeyboards.productEdit(productId, !!updated!.photoFileId),
      });
      return;
    }

    // ===========================================
    // USERS
    // ===========================================
    if (data === "mgr:users") {
      await render( ManagerTexts.usersMenuTitle(), {
        parse_mode: "Markdown",
        reply_markup: ManagerKeyboards.userManagement(),
      });
      return;
    }

    if (data === "mgr:users:list" || data.startsWith("mgr:users:list:")) {
      const page = parts[3] ? parseInt(parts[3]) : 0;
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
        await render( ManagerTexts.noUsers(), {
          reply_markup: ManagerKeyboards.backToMenu(),
        });
        return;
      }

      const totalPages = Math.ceil(total / pageSize);
      await render( ManagerTexts.userListTitle(), {
        parse_mode: "Markdown",
        reply_markup: ManagerKeyboards.userList(users, page, totalPages),
      });
      return;
    }

    if (data === "mgr:users:search") {
      managerSessions.set(ctx.from.id, { state: "user:search" });
      await render( ManagerTexts.enterSearchQuery() + "\n(برای انصراف /cancel را ارسال کنید)");
      return;
    }

    if (data.startsWith("mgr:user:") && !["toggle", "toggleref", "orders", "referrals", "contact", "delete", "setscore", "message"].includes(parts[2])) {
      const userId = parseInt(parts[2]);
      const user = await prisma.user.findUnique({ where: { id: userId } });

      if (!user) {
        await answerCallback({ text: "کاربر یافت نشد" });
        return;
      }

      const orderCount = await prisma.order.count({ where: { userId } });
      const effectiveScore = user.loyaltyScoreOverride ?? user.loyaltyScore;
      const hasOverride = user.loyaltyScoreOverride != null;

      await render(
        ManagerTexts.userDetails(user.id, user.username, user.isActive, orderCount, user.canCreateReferral, effectiveScore, hasOverride),
        {
          parse_mode: "Markdown",
          reply_markup: ManagerKeyboards.userActions(userId, user.isActive, user.canCreateReferral),
        }
      );
      return;
    }

    if (data.startsWith("mgr:user:toggle:")) {
      const userId = parseInt(parts[3]);
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
      const orderCount = await prisma.order.count({ where: { userId } });
      const eScore = updated!.loyaltyScoreOverride ?? updated!.loyaltyScore;
      const hasOvr = updated!.loyaltyScoreOverride != null;

      await render(
        ManagerTexts.userDetails(updated!.id, updated!.username, updated!.isActive, orderCount, updated!.canCreateReferral, eScore, hasOvr),
        {
          parse_mode: "Markdown",
          reply_markup: ManagerKeyboards.userActions(userId, updated!.isActive, updated!.canCreateReferral),
        }
      );
      return;
    }

    // TOGGLE USER REFERRAL PERMISSION
    if (data.startsWith("mgr:user:toggleref:")) {
      const userId = parseInt(parts[3]);
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
      const orderCount = await prisma.order.count({ where: { userId } });
      const eScore2 = updated!.loyaltyScoreOverride ?? updated!.loyaltyScore;
      const hasOvr2 = updated!.loyaltyScoreOverride != null;

      await render(
        ManagerTexts.userDetails(updated!.id, updated!.username, updated!.isActive, orderCount, updated!.canCreateReferral, eScore2, hasOvr2),
        {
          parse_mode: "Markdown",
          reply_markup: ManagerKeyboards.userActions(userId, updated!.isActive, updated!.canCreateReferral),
        }
      );
      return;
    }

    // USER CONTACT INFO
    if (data.startsWith("mgr:user:contact:")) {
      const userId = parseInt(parts[3]);
      const user = await prisma.user.findUnique({ where: { id: userId } });

      if (!user) {
        await answerCallback({ text: "کاربر یافت نشد" });
        return;
      }

      await render(
        ManagerTexts.userContactInfo(user.phone, user.address, user.locationLat, user.locationLng),
        {
          parse_mode: "Markdown",
          reply_markup: ManagerKeyboards.userActions(userId, user.isActive, user.canCreateReferral),
        }
      );
      return;
    }

    // SET USER LOYALTY SCORE (override)
    if (data.startsWith("mgr:user:setscore:")) {
      const userId = parseInt(parts[3]);
      managerSessions.set(ctx.from.id, { state: "user:setscore", data: { userId } });
      await render( ManagerTexts.enterUserScore() + "\n(برای انصراف /cancel را ارسال کنید)", {
        reply_markup: ManagerKeyboards.backToMenu(),
      });
      return;
    }

    // INITIATE SUPPORT CONVERSATION WITH USER
    if (data.startsWith("mgr:user:message:")) {
      const userId = parseInt(parts[3]);
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
      await render( `💬 پیام به ${userLabel}:\n\nمتن پیام خود را ارسال کنید:`, {
        reply_markup: ManagerKeyboards.backToMenu(),
      });
      return;
    }

    // DELETE USER
    if (data.startsWith("mgr:user:delete:")) {
      const userId = parseInt(parts[3]);
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
        },
      });

      await answerCallback({ text: ManagerTexts.userDeleted(user.username), show_alert: true });

      await render( ManagerTexts.userDeleted(user.username), {
        reply_markup: ManagerKeyboards.userManagement(),
      });
      return;
    }

    // ===========================================
    // COURIERS
    // ===========================================
    if (data === "mgr:couriers") {
      await render( ManagerTexts.couriersMenuTitle(), {
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
        await render( ManagerTexts.noCouriers(), {
          reply_markup: ManagerKeyboards.courierManagement(),
        });
        return;
      }

      await render( ManagerTexts.courierListTitle(), {
        parse_mode: "Markdown",
        reply_markup: ManagerKeyboards.courierList(couriers),
      });
      return;
    }

    if (data === "mgr:couriers:add") {
      managerSessions.set(ctx.from.id, { state: "courier:add" });
      await render( ManagerTexts.enterCourierTgId() + "\n(برای انصراف /cancel را ارسال کنید)", {
        reply_markup: ManagerKeyboards.backToMenu(),
      });
      return;
    }

    if (data.startsWith("mgr:courier:") && parts[2] !== "toggle" && parts[2] !== "delete") {
      const courierId = parseInt(parts[2]);
      const courier = await prisma.courier.findUnique({ where: { id: courierId } });

      if (!courier) {
        await answerCallback({ text: "پیک یافت نشد" });
        return;
      }

      await render(
        ManagerTexts.courierDetails(courier.id, courier.username, courier.tgUserId, courier.isActive),
        {
          parse_mode: "Markdown",
          reply_markup: ManagerKeyboards.courierActions(courierId, courier.isActive),
        }
      );
      return;
    }

    if (data.startsWith("mgr:courier:toggle:")) {
      const courierId = parseInt(parts[3]);
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

      await render(
        ManagerTexts.courierDetails(updated.id, updated.username, updated.tgUserId, updated.isActive),
        {
          parse_mode: "Markdown",
          reply_markup: ManagerKeyboards.courierActions(courierId, updated.isActive),
        }
      );
      return;
    }

    if (data.startsWith("mgr:courier:delete:")) {
      const courierId = parseInt(parts[3]);
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
        await render( ManagerTexts.noCouriers(), {
          reply_markup: ManagerKeyboards.courierManagement(),
        });
      } else {
        await render( ManagerTexts.courierListTitle(), {
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
      await render( ManagerTexts.referralsMenuTitle(), {
        parse_mode: "Markdown",
        reply_markup: ManagerKeyboards.referralManagement(),
      });
      return;
    }

    if (data === "mgr:referrals:create") {
      managerSessions.set(ctx.from.id, { state: "referral:create:maxuses" });
      await render( ManagerTexts.enterReferralMaxUses() + "\n(برای انصراف /cancel را ارسال کنید)");
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
        await render( ManagerTexts.noReferralCodes(), {
          reply_markup: ManagerKeyboards.backToMenu(),
        });
        return;
      }

      let text = ManagerTexts.referralListTitle() + "\n\n";
      codes.forEach((c) => {
        const creator = c.createdByUser?.username || (c.createdByManager ? 'مدیر' : 'نامشخص');
        const status = c.isActive ? "✅" : "❌";
        text += `${status} \`${c.code}\` - توسط ${creator} - ${c.usedCount}/${c.maxUses || '∞'} استفاده\n`;
      });

      await render( text, {
        parse_mode: "Markdown",
        reply_markup: ManagerKeyboards.backToMenu(),
      });
      return;
    }

    // ===========================================
    // ANALYTICS
    // ===========================================
    if (data === "mgr:analytics") {
      await render( ManagerTexts.analyticsMenuTitle(), {
        parse_mode: "Markdown",
        reply_markup: ManagerKeyboards.analyticsMenu(),
      });
      return;
    }

    if (data === "mgr:analytics:orders") {
      const [total, pending, completed] = await Promise.all([
        prisma.order.count(),
        prisma.order.count({ where: { status: OrderStatus.AWAITING_MANAGER_APPROVAL } }),
        prisma.order.count({ where: { status: OrderStatus.COMPLETED } }),
      ]);

      const revenueResult = await prisma.order.aggregate({
        where: { status: { in: [OrderStatus.APPROVED, OrderStatus.INVITE_SENT, OrderStatus.COMPLETED] } },
        _sum: { grandTotal: true },
      });
      const revenue = revenueResult._sum.grandTotal || 0;

      await render(
        ManagerTexts.orderAnalytics(total, pending, completed, revenue),
        {
          parse_mode: "Markdown",
          reply_markup: ManagerKeyboards.backToMenu(),
        }
      );
      return;
    }

    if (data === "mgr:analytics:users") {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const [total, active, newToday] = await Promise.all([
        prisma.user.count(),
        prisma.user.count({ where: { isActive: true, isVerified: true } }),
        prisma.user.count({ where: { createdAt: { gte: today } } }),
      ]);

      await render(
        ManagerTexts.userAnalytics(total, active, newToday),
        {
          parse_mode: "Markdown",
          reply_markup: ManagerKeyboards.backToMenu(),
        }
      );
      return;
    }

    if (data === "mgr:analytics:products") {
      const [total, active] = await Promise.all([
        prisma.product.count(),
        prisma.product.count({ where: { isActive: true } }),
      ]);

      const lowStock = await prisma.product.count({
        where: { isActive: true, stock: { lt: 10, not: null } },
      });

      await render(
        ManagerTexts.productAnalytics(total, active, lowStock),
        {
          parse_mode: "Markdown",
          reply_markup: ManagerKeyboards.backToMenu(),
        }
      );
      return;
    }

    if (data === "mgr:analytics:referrals") {
      const [totalCodes, totalUsesResult] = await Promise.all([
        prisma.referralCode.count(),
        prisma.referralCode.aggregate({ _sum: { usedCount: true } }),
      ]);
      const totalUses = totalUsesResult._sum.usedCount || 0;

      // Find top referrer
      const topReferrer = await prisma.referralCode.findFirst({
        where: { createdByUserId: { not: null } },
        orderBy: { usedCount: "desc" },
        include: { createdByUser: { select: { username: true } } },
      });

      const { InlineKeyboard: RK } = await import("grammy");
      const refKb = new RK();
      refKb.text("🌳 مشاهده درخت معرفی‌ها", "mgr:analytics:referraltree").row();
      refKb.text("« بازگشت به منو", "mgr:menu");

      await render(
        ManagerTexts.referralAnalytics(
          totalCodes,
          totalUses,
          topReferrer?.createdByUser?.username || null
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

      await render( text, {
        parse_mode: "Markdown",
        reply_markup: ManagerKeyboards.backToMenu(),
      });
      return;
    }

    // ===========================================
    // RECEIPTS MANAGEMENT
    // ===========================================
    if (data === "mgr:receipts" || data.startsWith("mgr:receipts:page:")) {
      const page = parts[3] ? parseInt(parts[3]) : 0;
      const pageSize = 5;

      const [receipts, total] = await Promise.all([
        prisma.receipt.findMany({
          where: { reviewStatus: ReceiptReviewStatus.PENDING },
          include: { 
            order: true, 
            user: { select: { id: true, username: true, tgUserId: true } } 
          },
          orderBy: { submittedAt: "asc" },
          skip: page * pageSize,
          take: pageSize,
        }),
        prisma.receipt.count({ where: { reviewStatus: ReceiptReviewStatus.PENDING } }),
      ]);

      if (receipts.length === 0) {
        await render( ManagerTexts.noPendingReceipts(), {
          reply_markup: ManagerKeyboards.backToMenu(),
        });
        return;
      }

      const totalPages = Math.ceil(total / pageSize);
      await render( ManagerTexts.pendingReceiptsTitle(), {
        parse_mode: "Markdown",
        reply_markup: ManagerKeyboards.receiptList(receipts, page, totalPages),
      });
      return;
    }

    // VIEW RECEIPT
    if (data.startsWith("mgr:receipt:view:")) {
      const receiptId = parseInt(parts[3]);
      const receipt = await prisma.receipt.findUnique({
        where: { id: receiptId },
        include: { 
          order: true, 
          user: { select: { id: true, username: true, phone: true, address: true, locationLat: true, locationLng: true } } 
        },
      });

      if (!receipt) {
        await answerCallback({ text: "رسید یافت نشد" });
        return;
      }

      const text = ManagerTexts.receiptDetails(
        receipt.orderId,
        receipt.user.id,
        receipt.user.username,
        receipt.submittedAt.toISOString().split('T')[0]
      ) + "\n\n" + ManagerTexts.userContactInfo(
        receipt.user.phone,
        receipt.user.address,
        receipt.user.locationLat,
        receipt.user.locationLng
      );

      // Send receipt image — file_id belongs to the client bot, so convert to URL
      try { await ctx.deleteMessage(); } catch { /* ignore */ }
      let receiptSent = false;
      if (clientBot) {
        try {
          const receiptInput = await crossBotFile(clientBot.api, clientBot.token, receipt.fileId);
          await ctx.replyWithPhoto(receiptInput, {
            caption: text,
            parse_mode: "Markdown",
            reply_markup: ManagerKeyboards.receiptActions(receiptId),
          });
          receiptSent = true;
        } catch (err) {
          console.error("[RECEIPT VIEW] Failed to get receipt image URL from client bot:", err);
        }
      }
      if (!receiptSent) {
        // Fallback: show text only
        await render( text + "\n\n⚠️ تصویر رسید قابل نمایش نیست.", {
          parse_mode: "Markdown",
          reply_markup: ManagerKeyboards.receiptActions(receiptId),
        });
      }
      return;
    }

    // APPROVE RECEIPT
    if (data.startsWith("mgr:receipt:approve:")) {
      const receiptId = parseInt(parts[3]);
      const receipt = await prisma.receipt.findUnique({
        where: { id: receiptId },
        include: { order: { include: { user: true } } },
      });

      if (!receipt || receipt.reviewStatus !== ReceiptReviewStatus.PENDING) {
        await answerCallback({ text: "رسید یافت نشد یا قبلاً بررسی شده است" });
        return;
      }

      // Update receipt and order status to PAID
      await prisma.$transaction([
        prisma.receipt.update({
          where: { id: receiptId },
          data: { 
            reviewStatus: ReceiptReviewStatus.ACCEPTED,
            reviewedById: manager.id,
          },
        }),
        prisma.order.update({
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
        }),
      ]);

      // Cleanup channel: delete payment message, revoke invite, kick user
      if (clientBot && checkoutChannelId) {
        await cleanupChannelForOrder(
          { prisma, botApi: clientBot.api, checkoutChannelId },
          {
            orderId: receipt.orderId,
            channelMessageId: receipt.order.channelMessageId,
            inviteLink: receipt.order.inviteLink,
            userTgId: receipt.order.user.tgUserId,
          },
        );
      }

      // Notify client
      await notificationService.notifyClientReceiptApproved(
        receipt.order.user.tgUserId,
        receipt.orderId,
      );

      // Auto-assign delivery to first active courier
      const activeCourier = await prisma.courier.findFirst({
        where: { isActive: true },
      });

      if (activeCourier) {
        await prisma.delivery.create({
          data: {
            orderId: receipt.orderId,
            assignedCourierId: activeCourier.id,
          },
        });

        // Notify courier
        const orderUser = receipt.order.user;
        await notificationService.notifyCourierNewDelivery(
          activeCourier.tgUserId,
          receipt.orderId,
          `${orderUser.firstName ?? ""} ${orderUser.lastName ?? ""}`.trim() || "-",
          orderUser.phone ?? "-",
          orderUser.address ?? "-",
        );
      }

      await answerCallback({ 
        text: ManagerTexts.receiptApproved(receipt.orderId),
        show_alert: true,
      });

      // Go back to receipt list
      await ctx.deleteMessage();
      await ctx.reply(ManagerTexts.receiptApproved(receipt.orderId), {
        reply_markup: ManagerKeyboards.backToMenu(),
      });
      return;
    }

    // REJECT RECEIPT - Ask for reason
    if (data.startsWith("mgr:receipt:reject:")) {
      const receiptId = parseInt(parts[3]);
      managerSessions.set(ctx.from.id, { 
        state: "receipt:reject:reason", 
        data: { receiptId } 
      });
      await ctx.deleteMessage();
      await ctx.reply(ManagerTexts.enterRejectReason() + "\n(برای انصراف /cancel را ارسال کنید)");
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
        await render( ManagerTexts.noSupportConversations(), {
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

      await render( ManagerTexts.supportInboxTitle(), {
        parse_mode: "Markdown",
        reply_markup: ManagerKeyboards.supportInbox(items, page, totalPages),
      });
      return;
    }

    // VIEW SUPPORT CONVERSATION
    if (data.startsWith("mgr:support:conv:")) {
      const convId = parseInt(parts[3]);
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

      const userLabel = conversation.user.username || conversation.user.firstName || `کاربر #${conversation.user.id}`;
      let convText = `💬 *گفتگوی پشتیبانی #${convId}*\nکاربر: ${userLabel}\n\n`;

      if (conversation.messages.length > 0) {
        const sorted = [...conversation.messages].reverse();
        sorted.forEach((m) => {
          const sender = m.senderType === SupportSenderType.USER ? "کاربر" : "مدیر";
          convText += `*${sender}:* ${m.text}\n\n`;
        });
      } else {
        convText += "هنوز پیامی ارسال نشده.\n";
      }

      await render( convText, {
        parse_mode: "Markdown",
        reply_markup: ManagerKeyboards.supportConversationActions(convId),
      });
      return;
    }

    // SET REPLY SESSION FOR SUPPORT
    if (data.startsWith("mgr:support:reply:")) {
      const convId = parseInt(parts[3]);
      managerSessions.set(ctx.from.id, {
        state: "support:reply",
        data: { conversationId: convId },
      });
      await render( ManagerTexts.supportAskReply() + "\n(برای انصراف /cancel را ارسال کنید)", {
        reply_markup: ManagerKeyboards.backToMenu(),
      });
      return;
    }

    // CLOSE SUPPORT CONVERSATION
    if (data.startsWith("mgr:support:close:")) {
      const convId = parseInt(parts[3]);
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

      await render( ManagerTexts.supportConversationClosed(), {
        reply_markup: ManagerKeyboards.backToMenu(),
      });
      return;
    }

    // ===========================================
    // SETTINGS
    // ===========================================
    if (data === "mgr:settings") {
      const imageFileId = await settingsService.getCheckoutImageFileId(checkoutImageFileId);
      const expiryMin = await settingsService.getInviteExpiryMinutes(inviteExpiryMinutes);
      const payMethod = await settingsService.getPaymentMethod();
      const imageStatus = imageFileId ? "✅ تنظیم شده" : "❌ تنظیم نشده";

      await render( ManagerTexts.settingsMenuTitle(imageStatus, expiryMin, payMethod), {
        parse_mode: "Markdown",
        reply_markup: ManagerKeyboards.settingsMenu(!!imageFileId, payMethod),
      });
      return;
    }

    if (data === "mgr:settings:image") {
      managerSessions.set(ctx.from.id, { state: "settings:image" });
      await render( ManagerTexts.settingsImageAsk() + "\n(برای انصراف /cancel را ارسال کنید)", {
        reply_markup: ManagerKeyboards.backToMenu(),
      });
      return;
    }

    if (data === "mgr:settings:image:delete") {
      await settingsService.delete(SettingKeys.CHECKOUT_IMAGE_FILE_ID);
      await answerCallback({ text: ManagerTexts.settingsImageDeleted(), show_alert: true });

      const expiryMin = await settingsService.getInviteExpiryMinutes(inviteExpiryMinutes);
      const payMethod = await settingsService.getPaymentMethod();
      await render( ManagerTexts.settingsMenuTitle("❌ تنظیم نشده", expiryMin, payMethod), {
        parse_mode: "Markdown",
        reply_markup: ManagerKeyboards.settingsMenu(false, payMethod),
      });
      return;
    }

    if (data === "mgr:settings:paymethod") {
      const current = await settingsService.getPaymentMethod();
      const newMethod = current === "channel" ? "direct" : "channel";
      try {
        await settingsService.set(SettingKeys.PAYMENT_METHOD, newMethod);
      } catch {
        await answerCallback({ text: "❌ خطا در ذخیره تنظیمات", show_alert: true });
        return;
      }
      await answerCallback({ text: ManagerTexts.settingsPayMethodToggled(newMethod), show_alert: true });

      const imageFileId = await settingsService.getCheckoutImageFileId(checkoutImageFileId);
      const expiryMin = await settingsService.getInviteExpiryMinutes(inviteExpiryMinutes);
      const imageStatus = imageFileId ? "✅ تنظیم شده" : "❌ تنظیم نشده";
      await render( ManagerTexts.settingsMenuTitle(imageStatus, expiryMin, newMethod), {
        parse_mode: "Markdown",
        reply_markup: ManagerKeyboards.settingsMenu(!!imageFileId, newMethod),
      });
      return;
    }

    if (data === "mgr:settings:expiry") {
      managerSessions.set(ctx.from.id, { state: "settings:expiry" });
      await render( ManagerTexts.settingsExpiryAsk() + "\n(برای انصراف /cancel را ارسال کنید)", {
        reply_markup: ManagerKeyboards.backToMenu(),
      });
      return;
    }

    // HELP
    if (data === "mgr:help") {
      await render( ManagerTexts.helpMessage(), {
        parse_mode: "Markdown",
        reply_markup: ManagerKeyboards.backToMenu(),
      });
      return;
    }

    // NO-OP
    if (data === "noop") {
      return;
    }
  });

}
