import { Bot, Context, Keyboard } from "grammy";
import type { PrismaClient, User } from "@prisma/client";
import { CartState, OrderStatus, ReceiptReviewStatus, SupportConversationStatus, SupportSenderType } from "@prisma/client";
import { ClientTexts, ChannelTexts } from "../../i18n/index.js";
import { ClientKeyboards } from "../../utils/keyboards.js";
import { formatPrice } from "../../utils/format-price.js";
import { OrderService, InsufficientStockError } from "../../services/order-service.js";

import { SessionStore } from "../../utils/session-store.js";

// Session state for tracking user interactions
type SessionState = 
  | "awaiting_referral"
  | "viewing_product"
  | "checkout_phone"
  | "checkout_location"
  | "checkout_address"
  | "awaiting_receipt"
  | "referral_score"
  | "support_message";

interface ClientSession {
  state: SessionState;
  data?: Record<string, unknown>;
  selectedQty?: number;
  orderId?: number;
  supportConversationId?: number;
  fromProfile?: boolean;
}

const userSessions = new SessionStore<ClientSession>();

interface ClientBotDeps {
  prisma: PrismaClient;
  managerBot?: Bot;
  checkoutImageFileId?: string;
}

import { createReferralCodeWithRetry } from "../../utils/referral-utils.js";
import { buildCartDisplay } from "../../utils/cart-display.js";
import { NotificationService } from "../../services/notification-service.js";
import { orderStatusLabel } from "../../utils/order-status.js";
import { safeRender } from "../../utils/safe-reply.js";
import { crossBotFile } from "../../utils/cross-bot-file.js";
import { BotSettingsService } from "../../services/bot-settings-service.js";

/**
 * Get or create user, checking referral status
 */
async function getOrCreateUser(
  ctx: Context,
  prisma: PrismaClient
): Promise<{ user: User | null; needsReferral: boolean }> {
  if (!ctx.from) return { user: null, needsReferral: false };

  const tgUserId = BigInt(ctx.from.id);
  
  let user = await prisma.user.findUnique({
    where: { tgUserId },
  });

  if (user) {
    // Check if user is blocked
    if (!user.isActive) {
      return { user: null, needsReferral: false };
    }
    // Check if user is verified (has entered a referral code)
    if (!user.isVerified) {
      return { user, needsReferral: true };
    }
    // Update last seen
    await prisma.user.update({
      where: { id: user.id },
      data: { lastSeenAt: new Date() },
    });
    return { user, needsReferral: false };
  }

  // Build username: prefer Telegram handle, fall back to profile name
  const displayName = ctx.from.username
    || ctx.from.first_name
    || ctx.from.last_name
    || `${ctx.from.id}`;

  // Create new user (unverified)
  user = await prisma.user.create({
    data: {
      tgUserId,
      username: displayName,
      firstName: ctx.from.first_name,
      lastName: ctx.from.last_name,
      referralCode: `USR_${ctx.from.id}`,
      isVerified: false,
    },
  });

  return { user, needsReferral: true };
}

/**
 * Validate and use a referral code atomically.
 * Uses interactive transaction + conditional updateMany to prevent race conditions
 * where two concurrent requests use the same code.
 */
export async function validateAndUseReferralCode(
  userId: number,
  code: string,
  prisma: PrismaClient
): Promise<boolean> {
  try {
    return await prisma.$transaction(async (tx) => {
      const referralCode = await tx.referralCode.findUnique({
        where: { code: code.toUpperCase() },
      });

      if (!referralCode) return false;
      if (!referralCode.isActive) return false;
      if (referralCode.expiresAt && referralCode.expiresAt < new Date()) return false;
      if (referralCode.usedCount > 0) return false;

      // Referral access codes are one-time tokens. Claim and expire immediately.
      const claimResult = await tx.referralCode.updateMany({
        where: {
          id: referralCode.id,
          isActive: true,
          usedCount: 0,
        },
        data: {
          usedCount: { increment: 1 },
          isActive: false,
          expiresAt: new Date(),
        },
      });

      if (claimResult.count === 0) return false; // Someone else claimed it first

      await tx.user.update({
        where: { id: userId },
        data: {
          isVerified: true,
          usedReferralCodeId: referralCode.id,
          referredById: referralCode.createdByUserId,
          loyaltyScore: referralCode.loyaltyScore,
        },
      });

      return true;
    });
  } catch (error) {
    console.error("[validateAndUseReferralCode] Transaction failed:", error);
    return false;
  }
}

/**
 * Send payment details to user immediately after order creation (bypasses manager approval)
 */
async function sendPaymentDetailsForOrder(
  orderId: number,
  prisma: PrismaClient,
  clientBot: Bot,
  managerBot: Bot | undefined,
  checkoutImageFileId: string | undefined,
): Promise<void> {
  const settingsService = new BotSettingsService(prisma);

  const effectiveImageFileId = await settingsService.getCheckoutImageFileId(checkoutImageFileId);
  const effectiveExpiryMin = await settingsService.getInviteExpiryMinutes(60);
  const cardNumber = await settingsService.getPaymentCardNumber();

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { user: true, items: { include: { product: true } } },
  });

  if (!order || !order.user) {
    console.error(`[sendPaymentDetails] Order #${orderId} not found or has no user`);
    return;
  }

  let checkoutImageInput: import("grammy").InputFile | null = null;
  if (effectiveImageFileId && managerBot) {
    try {
      checkoutImageInput = await crossBotFile(managerBot.api, managerBot.token, effectiveImageFileId);
    } catch (err) {
      console.error("[sendPaymentDetails] Failed to download checkout image:", err);
    }
  }

  const paymentCaption = ChannelTexts.paymentMessage(
    orderId,
    order.grandTotal,
    cardNumber ?? undefined,
    order.items[0]?.product?.currency ?? "IRR",
  );

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
    console.error("[sendPaymentDetails] Failed to send direct payment details:", err);
    try {
      const msg = await clientBot.api.sendMessage(userTgId, paymentCaption.replace(/[*_`\[]/g, ""));
      directMessageId = msg.message_id;
    } catch (err2) {
      console.error("[sendPaymentDetails] Retry also failed:", err2);
    }
  }

  await prisma.order.update({
    where: { id: orderId },
    data: {
      status: OrderStatus.AWAITING_RECEIPT,
      channelMessageId: directMessageId,
      inviteSentAt: new Date(),
    },
  });

  if (directMessageId) {
    const deleteDelayMs = effectiveExpiryMin * 60 * 1000;
    setTimeout(async () => {
      try {
        await clientBot.api.deleteMessage(userTgId, directMessageId);
      } catch (err) {
        console.error(`[AUTO-DELETE] Failed to delete message ${directMessageId}:`, err);
      }
    }, deleteDelayMs);
  }
}

/**
 * Process checkout after info is collected
 */
async function processCheckout(
  ctx: Context,
  user: User,
  cartId: number,
  prisma: PrismaClient,
  notificationService?: NotificationService,
  clientBot?: Bot,
  managerBot?: Bot,
  checkoutImageFileId?: string,
): Promise<void> {
  const orderService = new OrderService(prisma);
  const discountService = new (await import("../../services/discount-service.js")).DiscountService(prisma);

  try {
    const cart = await prisma.cart.findUnique({
      where: { id: cartId },
      include: { items: { include: { product: true } } },
    });

    if (!cart) {
      await safeRender(ctx, ClientTexts.checkoutError(), {
        reply_markup: ClientKeyboards.mainMenu(),
      });
      return;
    }

    const discountResult = await discountService.calculateDiscounts({
      userId: user.id,
      items: cart.items.map(item => ({
        productId: item.productId,
        qty: item.qty,
        unitPrice: item.unitPriceSnapshot,
      })),
    });

    const result = await orderService.createOrderFromCart({
      userId: user.id,
      cartId,
      appliedDiscounts: discountResult.appliedDiscounts,
    });

    const orderMsg = discountResult.totalDiscount > 0
      ? ClientTexts.orderSubmittedWithDiscount(result.orderId, result.grandTotal, result.subtotal, discountResult.totalDiscount)
      : ClientTexts.orderSubmitted(result.orderId, result.grandTotal);

    await safeRender(
      ctx,
      orderMsg,
      { reply_markup: ClientKeyboards.mainMenu() }
    );

    // Send payment details immediately (bypass manager approval)
    if (clientBot) {
      await sendPaymentDetailsForOrder(
        result.orderId,
        prisma,
        clientBot,
        managerBot,
        checkoutImageFileId,
      );
    }

    // Notify managers about the new order
    if (notificationService) {
      const userLabel = user.firstName || user.username || `#${user.id}`;
      await notificationService.notifyManagersNewOrder(
        result.orderId,
        userLabel,
        user.phone,
        user.address,
        result.subtotal,
        result.discountTotal,
        result.grandTotal,
        cart.items.map(item => ({
          title: item.product.title,
          qty: item.qty,
          lineTotal: item.qty * item.unitPriceSnapshot,
        })),
      );
    }

    // Set session to await receipt directly so user can upload photo right away
    userSessions.set(ctx.from!.id, { state: "awaiting_receipt", orderId: result.orderId });
  } catch (error) {
    if (error instanceof InsufficientStockError) {
      await safeRender(ctx, ClientTexts.outOfStock(), {
        reply_markup: ClientKeyboards.mainMenu(),
      });
      return;
    }
    await safeRender(ctx, ClientTexts.checkoutError(), {
      reply_markup: ClientKeyboards.mainMenu(),
    });
  }
}

/**
 * Continue checkout flow after info gathering step
 */
async function continueCheckoutFlow(
  ctx: Context,
  user: User,
  prisma: PrismaClient,
  notificationService?: NotificationService,
  clientBot?: Bot,
  managerBot?: Bot,
  checkoutImageFileId?: string,
): Promise<void> {
  // Refresh user data
  const updatedUser = await prisma.user.findUnique({ where: { id: user.id } });
  if (!updatedUser) return;

  const needsAddress = !updatedUser.address;

  if (needsAddress) {
    userSessions.set(ctx.from!.id, { state: "checkout_address" });
    await ctx.reply(ClientTexts.askAddress());
    return;
  }

  // All info collected — proceed directly to checkout or return to menu
  const activeCart = await prisma.cart.findFirst({
    where: { userId: updatedUser.id, state: CartState.ACTIVE },
  });

  if (activeCart) {
    userSessions.delete(ctx.from!.id);
    await processCheckout(ctx, updatedUser, activeCart.id, prisma, notificationService, clientBot, managerBot, checkoutImageFileId);
  } else {
    userSessions.delete(ctx.from!.id);
    await ctx.reply(ClientTexts.infoComplete(), {
      reply_markup: ClientKeyboards.mainMenu(),
    });
  }
}

/**
 * Show the user profile with edit options
 */
async function showProfile(
  ctx: Context,
  user: User,
): Promise<void> {
  let profileText = "👤 *پروفایل من*\n\n";
  profileText += `نام: ${user.firstName ?? "-"} ${user.lastName ?? ""}\n`;
  profileText += `نام کاربری: ${user.username ? "@" + user.username : "-"}\n`;
  profileText += `تلفن: ${user.phone ?? "ثبت نشده"}\n`;
  profileText += `آدرس: ${user.address ?? "ثبت نشده"}\n`;
  profileText += `موقعیت: ${user.locationLat != null ? "✅ ثبت شده" : "ثبت نشده"}\n`;
  const effectiveScore = user.loyaltyScoreOverride ?? user.loyaltyScore;
  profileText += `⭐ امتیاز وفاداری: ${effectiveScore}/10\n`;

  const { InlineKeyboard: PK } = await import("grammy");
  const profileKb = new PK();
  profileKb.text("📱 ویرایش تلفن", "client:profile:edit:phone").row();
  profileKb.text("📍 ویرایش آدرس", "client:profile:edit:address").row();
  profileKb.text("🗺️ ویرایش موقعیت", "client:profile:edit:location").row();
  profileKb.text("« بازگشت به منو", "client:menu");

  await safeRender(ctx, profileText, {
    parse_mode: "Markdown",
    reply_markup: profileKb,
  });
}

/**
 * Register all interactive handlers for client bot
 */
export function registerInteractiveClientBot(bot: Bot, deps: ClientBotDeps): void {
  const { prisma, managerBot, checkoutImageFileId } = deps;
  const notificationService = new NotificationService({ prisma, managerBot });

  // Global error handler to prevent crashes
  bot.catch((err) => {
    console.error("Client bot error:", err.message || err);
  });

  // ===========================================
  // START COMMAND - Referral Gate
  // ===========================================
  bot.command("start", async (ctx) => {
    const { user, needsReferral } = await getOrCreateUser(ctx, prisma);

    if (!user) {
      await ctx.reply(ClientTexts.userBlocked());
      return;
    }

    if (needsReferral) {
      userSessions.set(ctx.from!.id, { state: "awaiting_referral" });
      await ctx.reply(ClientTexts.welcomeNewUser());
      return;
    }

    const displayName = user.firstName || user.username || "دوست عزیز";
    await ctx.reply(`${ClientTexts.welcomeBack(displayName)}\n\n${ClientTexts.welcome()}`, {
      reply_markup: ClientKeyboards.mainMenu(),
      parse_mode: "Markdown",
    });
  });

  // ===========================================
  // TEXT MESSAGE HANDLER - For referral codes, address, etc.
  // ===========================================
  bot.on("message:text", async (ctx) => {
    const session = userSessions.get(ctx.from.id);
    const incomingText = ctx.message.text.trim();

    if (session && session.state !== "awaiting_referral" && (incomingText === "/cancel" || incomingText === "انصراف")) {
      userSessions.delete(ctx.from.id);
      await ctx.reply(ClientTexts.actionCancelled(), {
        reply_markup: { remove_keyboard: true },
      });
      await ctx.reply(ClientTexts.welcome(), {
        reply_markup: ClientKeyboards.mainMenu(),
      });
      return;
    }
    
    if (session?.state === "awaiting_referral") {
      const code = incomingText;
      
      const user = await prisma.user.findUnique({
        where: { tgUserId: BigInt(ctx.from.id) },
      });

      if (!user) {
        await ctx.reply(ClientTexts.unableToIdentify());
        return;
      }

      const valid = await validateAndUseReferralCode(user.id, code, prisma);

      if (!valid) {
        await ctx.reply(ClientTexts.invalidReferralCode());
        return;
      }

      userSessions.delete(ctx.from.id);
      await ctx.reply(ClientTexts.referralCodeAccepted(), {
        reply_markup: ClientKeyboards.mainMenu(),
      });
      return;
    }

    // Handle manual phone number input during checkout
    if (session?.state === "checkout_phone") {
      const text = incomingText;

      // User clicked the "typing" button text — guide them
      if (text === ClientTexts.askPhoneManualButton()) {
        await ctx.reply(ClientTexts.askPhoneManualPrompt(), { reply_markup: { remove_keyboard: true } });
        return;
      }

      // Validate as phone number (Iranian format: 09xxxxxxxxx or +989xxxxxxxxx)
      const digitsOnly = text.replace(/\D/g, "");
      const isValid = /^(\+98|0)?9\d{9}$/.test(text) || digitsOnly.length >= 10;

      if (!isValid) {
        await ctx.reply(ClientTexts.invalidPhone());
        return;
      }

      // Normalize the phone number
      let phone = text;
      if (phone.startsWith("0") && !phone.startsWith("+98")) {
        phone = "+98" + phone.slice(1);
      } else if (!phone.startsWith("+98") && !phone.startsWith("0")) {
        phone = "0" + phone;
      }

      const user = await prisma.user.findUnique({
        where: { tgUserId: BigInt(ctx.from.id) },
      });

      if (!user) {
        await ctx.reply(ClientTexts.unableToIdentify());
        return;
      }

      await prisma.user.update({
        where: { id: user.id },
        data: { phone },
      });

      await ctx.reply(ClientTexts.phoneReceived(), { reply_markup: { remove_keyboard: true } });

      if (session.fromProfile) {
        const updated = await prisma.user.findUnique({ where: { id: user.id } });
        if (updated) await showProfile(ctx, updated);
      } else {
        await continueCheckoutFlow(ctx, user, prisma, notificationService, bot, managerBot, checkoutImageFileId);
      }
      return;
    }

    // Reject text input when waiting for location — only Telegram location format is accepted
    if (session?.state === "checkout_location") {
      await ctx.reply(ClientTexts.invalidLocation());
      return;
    }

    // Handle address input during checkout
    if (session?.state === "checkout_address") {
      const address = incomingText;
      
      const user = await prisma.user.findUnique({
        where: { tgUserId: BigInt(ctx.from.id) },
      });

      if (!user) {
        await ctx.reply(ClientTexts.unableToIdentify());
        return;
      }

      await prisma.user.update({
        where: { id: user.id },
        data: { address },
      });

      userSessions.delete(ctx.from.id);
      await ctx.reply(ClientTexts.addressReceived(), { reply_markup: { remove_keyboard: true } });

      if (session.fromProfile) {
        const updated = await prisma.user.findUnique({ where: { id: user.id } });
        if (updated) await showProfile(ctx, updated);
      } else {
        await continueCheckoutFlow(ctx, user, prisma, notificationService, bot, managerBot, checkoutImageFileId);
      }
      return;
    }

    // Handle referral score input — step 2 of client referral code creation
    if (session?.state === "referral_score") {
      const text = incomingText;
      const score = text === "/skip" ? 0 : parseInt(text);
      if (text !== "/skip" && (!Number.isFinite(score) || score < 0 || score > 10)) {
        await ctx.reply(ClientTexts.invalidReferralScore());
        return;
      }

      const user = await prisma.user.findUnique({
        where: { tgUserId: BigInt(ctx.from.id) },
      });
      if (!user) return;

      const code = await createReferralCodeWithRetry(prisma, {
        createdByUserId: user.id,
        maxUses: 1,
        loyaltyScore: score,
      });

      userSessions.delete(ctx.from.id);
      await ctx.reply(ClientTexts.referralCodeGenerated(code), {
        parse_mode: "Markdown",
        reply_markup: ClientKeyboards.backToMenu(),
      });
      return;
    }

    // Handle support message
    if (session?.state === "support_message" && session.supportConversationId) {
      const messageText = incomingText;
      if (!messageText) return;

      const user = await prisma.user.findUnique({
        where: { tgUserId: BigInt(ctx.from.id) },
      });
      if (!user) {
        await ctx.reply(ClientTexts.unableToIdentify());
        return;
      }

      await prisma.$transaction([
        prisma.supportMessage.create({
          data: {
            conversationId: session.supportConversationId,
            senderType: SupportSenderType.USER,
            text: messageText,
          },
        }),
        prisma.supportConversation.update({
          where: { id: session.supportConversationId },
          data: { lastMessageAt: new Date() },
        }),
      ]);

      await ctx.reply(ClientTexts.supportMessageSent(), {
        reply_markup: ClientKeyboards.supportActions(session.supportConversationId),
      });

      // Notify managers
      const userLabel = user.username || user.firstName || `#${user.id}`;
      await notificationService.notifyManagersNewSupportMessage(session.supportConversationId, userLabel, messageText);
      return;
    }

    // Not in a special state - ignore
  });

  // ===========================================
  // CONTACT MESSAGE HANDLER - For phone number
  // ===========================================
  bot.on("message:contact", async (ctx) => {
    const session = userSessions.get(ctx.from.id);
    
    if (session?.state === "checkout_phone") {
      const contact = ctx.message.contact;
      
      const user = await prisma.user.findUnique({
        where: { tgUserId: BigInt(ctx.from.id) },
      });

      if (!user) {
        await ctx.reply(ClientTexts.unableToIdentify());
        return;
      }

      await prisma.user.update({
        where: { id: user.id },
        data: { phone: contact.phone_number },
      });

      userSessions.delete(ctx.from.id);
      await ctx.reply(ClientTexts.phoneReceived(), { reply_markup: { remove_keyboard: true } });

      if (session.fromProfile) {
        const updated = await prisma.user.findUnique({ where: { id: user.id } });
        if (updated) await showProfile(ctx, updated);
      } else {
        await continueCheckoutFlow(ctx, user, prisma, notificationService, bot, managerBot, checkoutImageFileId);
      }
    }
  });

  // ===========================================
  // LOCATION MESSAGE HANDLER - For GPS location
  // ===========================================
  bot.on("message:location", async (ctx) => {
    const session = userSessions.get(ctx.from.id);
    
    if (session?.state === "checkout_location") {
      const location = ctx.message.location;
      
      const user = await prisma.user.findUnique({
        where: { tgUserId: BigInt(ctx.from.id) },
      });

      if (!user) {
        await ctx.reply(ClientTexts.unableToIdentify());
        return;
      }

      await prisma.user.update({
        where: { id: user.id },
        data: { 
          locationLat: location.latitude,
          locationLng: location.longitude,
          locationText: null,
        },
      });

      userSessions.delete(ctx.from.id);
      await ctx.reply(ClientTexts.locationReceived(), { reply_markup: { remove_keyboard: true } });

      if (session.fromProfile) {
        const updated = await prisma.user.findUnique({ where: { id: user.id } });
        if (updated) await showProfile(ctx, updated);
      } else {
        await continueCheckoutFlow(ctx, user, prisma, notificationService, bot, managerBot, checkoutImageFileId);
      }
    }
  });

  // ===========================================
  // PHOTO MESSAGE HANDLER - For receipt images
  // ===========================================
  bot.on("message:photo", async (ctx) => {
    try {
      const session = userSessions.get(ctx.from.id);

      // Only accept receipt photos when user has explicitly selected an order
      if (session?.state !== "awaiting_receipt" || !session.orderId) {
        await ctx.reply("برای ارسال رسید، ابتدا از منوی «سفارش‌های من» سفارش مورد نظر را باز کنید و دکمه «📸 ارسال رسید پرداخت» را بزنید.");
        return;
      }

      const orderId = session.orderId;

      const user = await prisma.user.findUnique({
        where: { tgUserId: BigInt(ctx.from.id) },
      });

      if (!user) {
        await ctx.reply(ClientTexts.unableToIdentify());
        return;
      }

      const order = await prisma.order.findUnique({
        where: { id: orderId },
      });

      if (!order || order.userId !== user.id) {
        userSessions.delete(ctx.from.id);
        await ctx.reply("سفارش یافت نشد. لطفاً دوباره از منوی سفارش‌ها اقدام کنید.");
        return;
      }

      if (order.status !== OrderStatus.APPROVED && order.status !== OrderStatus.INVITE_SENT && order.status !== OrderStatus.AWAITING_RECEIPT) {
        userSessions.delete(ctx.from.id);
        await ctx.reply("برای این سفارش امکان ارسال رسید وجود ندارد.");
        return;
      }

      const photo = ctx.message.photo[ctx.message.photo.length - 1];

      const [, receipt] = await prisma.$transaction([
        // Mark existing pending receipts as superseded
        prisma.receipt.updateMany({
          where: {
            orderId: order.id,
            reviewStatus: ReceiptReviewStatus.PENDING,
          },
          data: {
            reviewStatus: ReceiptReviewStatus.REJECTED,
            reviewNotes: "با ارسال رسید جدید جایگزین شد",
          },
        }),
        // Create new receipt
        prisma.receipt.create({
          data: {
            orderId: order.id,
            userId: user.id,
            fileId: photo.file_id,
            caption: ctx.message.caption,
          },
        }),
        // Ensure order is in AWAITING_RECEIPT status
        prisma.order.update({
          where: { id: order.id },
          data: { status: OrderStatus.AWAITING_RECEIPT },
        }),
      ]);

      // Clear session
      userSessions.delete(ctx.from.id);

      await ctx.reply(ClientTexts.receiptReceived());
      const userLabel = user.username || user.firstName || `#${user.id}`;
      await notificationService.notifyManagersNewReceipt(order.id, userLabel, receipt.id);
    } catch (error) {
      console.error("[CLIENT PHOTO HANDLER] Error processing receipt:", error);
      userSessions.delete(ctx.from.id);
      try {
        await ctx.reply("❌ خطا در ثبت رسید. لطفاً دوباره تلاش کنید.");
      } catch {
        // Ignore reply errors
      }
    }
  });

  // ===========================================
  // CALLBACK QUERY HANDLERS
  // ===========================================
  bot.on("callback_query:data", async (ctx) => {
    const data = ctx.callbackQuery.data;
    
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
    
    // Answer immediately for responsive UX (will be skipped if answered later with specific text)
    await answerCallback();

    // Get user
    const { user, needsReferral } = await getOrCreateUser(ctx, prisma);
    
    if (!user || !user.isActive) {
      await safeRender(ctx, ClientTexts.userBlocked());
      return;
    }

    if (needsReferral && !data.startsWith("noop")) {
      userSessions.set(ctx.from.id, { state: "awaiting_referral" });
      await safeRender(ctx, ClientTexts.welcomeNewUser());
      return;
    }

    // Parse callback data
    const parts = data.split(":");

    // MAIN MENU
    if (data === "client:menu") {
      await safeRender(ctx, ClientTexts.welcome(), {
        reply_markup: ClientKeyboards.mainMenu(),
      });
      return;
    }

    // PRODUCTS LIST
    if (data === "client:products" || data.startsWith("client:products:")) {
      const page = parts[2] ? parseInt(parts[2]) : 0;
      const pageSize = 5;

      const [products, total] = await Promise.all([
        prisma.product.findMany({
          where: { isActive: true },
          orderBy: { id: "desc" },
          skip: page * pageSize,
          take: pageSize,
        }),
        prisma.product.count({ where: { isActive: true } }),
      ]);

      if (products.length === 0) {
        await safeRender(ctx, ClientTexts.noProductsAvailable(), {
          reply_markup: ClientKeyboards.backToMenu(),
        });
        return;
      }

      const totalPages = Math.ceil(total / pageSize);
      await safeRender(ctx, ClientTexts.productsHeader(), {
        reply_markup: ClientKeyboards.productList(products, page, totalPages),
      });
      return;
    }

    // VIEW SINGLE PRODUCT
    if (data.startsWith("client:product:") && !data.includes("qty")) {
      const productId = parseInt(parts[2]);
      const product = await prisma.product.findUnique({ where: { id: productId } });

      if (!product) {
        await safeRender(ctx, ClientTexts.productNotFound(), {
          reply_markup: ClientKeyboards.backToMenu(),
        });
        return;
      }

      // Initialize quantity to 1
      userSessions.set(ctx.from.id, { state: "viewing_product", selectedQty: 1 });

      const text = ClientTexts.productDetails(
        product.title,
        product.description,
        product.price,
        product.currency,
        product.stock
      );

      // If product has image, convert from manager bot and send photo
      if (product.photoFileId && managerBot) {
        try {
          await ctx.deleteMessage();
        } catch { /* ignore */ }
        try {
          const imageInput = await crossBotFile(managerBot.api, managerBot.token, product.photoFileId);
          await ctx.replyWithPhoto(imageInput, {
            caption: text,
            parse_mode: "Markdown",
            reply_markup: ClientKeyboards.productView(productId, 1),
          });
        } catch (err) {
          console.error(`[CLIENT] Failed to convert product image for product #${productId}:`, err);
          // Fallback: text only
          await ctx.reply(text, {
            parse_mode: "Markdown",
            reply_markup: ClientKeyboards.productView(productId, 1),
          });
        }
      } else {
        await safeRender(ctx, text, {
          parse_mode: "Markdown",
          reply_markup: ClientKeyboards.productView(productId, 1),
        });
      }
      return;
    }

    // QUANTITY CONTROLS
    if (data.startsWith("client:qty:")) {
      const action = parts[2]; // inc or dec
      const productId = parseInt(parts[3]);
      const session = userSessions.get(ctx.from.id) || { state: "viewing_product", selectedQty: 1 };
      let qty = session.selectedQty || 1;

      if (action === "inc") qty = Math.min(qty + 1, 99);
      if (action === "dec") qty = Math.max(qty - 1, 1);

      userSessions.set(ctx.from.id, { ...session, selectedQty: qty });

      // Update keyboard
      try {
        await ctx.editMessageReplyMarkup({
          reply_markup: ClientKeyboards.productView(productId, qty),
        });
      } catch {
        // Message might be a photo, try different approach
      }
      return;
    }

    // ADD TO CART (continue shopping → back to products)
    if (data.startsWith("client:addtocart:")) {
      const productId = parseInt(parts[2]);
      const qty = parseInt(parts[3]);

      const product = await prisma.product.findUnique({ where: { id: productId } });
      if (!product) {
        await answerCallback({ text: ClientTexts.productNotFound() });
        return;
      }

      // Get or create cart
      let cart = await prisma.cart.findFirst({
        where: { userId: user.id, state: CartState.ACTIVE },
      });

      if (!cart) {
        cart = await prisma.cart.create({
          data: { userId: user.id, state: CartState.ACTIVE },
        });
      }

      // Check if item exists in cart
      const existingItem = await prisma.cartItem.findFirst({
        where: { cartId: cart.id, productId },
      });

      if (existingItem) {
        await prisma.cartItem.update({
          where: { id: existingItem.id },
          data: { 
            qty: existingItem.qty + qty,
            unitPriceSnapshot: product.price,
          },
        });
      } else {
        await prisma.cartItem.create({
          data: {
            cartId: cart.id,
            productId,
            qty,
            unitPriceSnapshot: product.price,
          },
        });
      }

      await answerCallback({ 
        text: ClientTexts.addedToCartSuccess(product.title, qty),
        show_alert: true,
      });

      // Navigate back to products list
      const products = await prisma.product.findMany({
        where: { isActive: true },
        orderBy: { id: "desc" },
        take: 5,
      });
      const total = await prisma.product.count({ where: { isActive: true } });
      const totalPages = Math.ceil(total / 5);

      await safeRender(ctx, ClientTexts.productsHeader(), {
        reply_markup: ClientKeyboards.productList(products, 0, totalPages),
      });
      return;
    }

    // ADD TO CART & GO TO CHECKOUT
    if (data.startsWith("client:addandcheckout:")) {
      const productId = parseInt(parts[2]);
      const qty = parseInt(parts[3]);

      const product = await prisma.product.findUnique({ where: { id: productId } });
      if (!product) {
        await answerCallback({ text: ClientTexts.productNotFound() });
        return;
      }

      // Get or create cart
      let cart = await prisma.cart.findFirst({
        where: { userId: user.id, state: CartState.ACTIVE },
      });

      if (!cart) {
        cart = await prisma.cart.create({
          data: { userId: user.id, state: CartState.ACTIVE },
        });
      }

      // Check if item exists in cart
      const existingItem = await prisma.cartItem.findFirst({
        where: { cartId: cart.id, productId },
      });

      if (existingItem) {
        await prisma.cartItem.update({
          where: { id: existingItem.id },
          data: { 
            qty: existingItem.qty + qty,
            unitPriceSnapshot: product.price,
          },
        });
      } else {
        await prisma.cartItem.create({
          data: {
            cartId: cart.id,
            productId,
            qty,
            unitPriceSnapshot: product.price,
          },
        });
      }

      await answerCallback({ 
        text: ClientTexts.addedToCartSuccess(product.title, qty),
        show_alert: true,
      });

      // Navigate to cart view
      const updatedCart = await prisma.cart.findFirst({
        where: { userId: user.id, state: CartState.ACTIVE },
        include: { items: { include: { product: true } } },
      });

      if (!updatedCart || updatedCart.items.length === 0) {
        await safeRender(ctx, ClientTexts.cartEmpty(), {
          reply_markup: ClientKeyboards.backToMenu(),
        });
        return;
      }

      const display = buildCartDisplay(updatedCart.items.map((item) => ({
        productId: item.productId,
        title: item.product.title,
        qty: item.qty,
        unitPrice: item.unitPriceSnapshot,
        currency: item.product.currency,
      })));

      await safeRender(ctx, display.text, {
        reply_markup: ClientKeyboards.cartView(display.items),
      });
      return;
    }

    // VIEW CART
    if (data === "client:cart") {
      const cart = await prisma.cart.findFirst({
        where: { userId: user.id, state: CartState.ACTIVE },
        include: {
          items: {
            include: { product: true },
          },
        },
      });

      if (!cart || cart.items.length === 0) {
        await safeRender(ctx, ClientTexts.cartEmpty(), {
          reply_markup: ClientKeyboards.backToMenu(),
        });
        return;
      }

      const display = buildCartDisplay(cart.items.map((item) => ({
        productId: item.productId,
        title: item.product.title,
        qty: item.qty,
        unitPrice: item.unitPriceSnapshot,
        currency: item.product.currency,
      })));

      await safeRender(ctx, display.text, {
        reply_markup: ClientKeyboards.cartView(display.items),
      });
      return;
    }

    // REMOVE FROM CART
    if (data.startsWith("client:removefromcart:")) {
      const productId = parseInt(parts[2]);

      const cart = await prisma.cart.findFirst({
        where: { userId: user.id, state: CartState.ACTIVE },
      });

      if (cart) {
        await prisma.cartItem.deleteMany({
          where: { cartId: cart.id, productId },
        });
      }

      // Refresh cart view
      await answerCallback({ text: "از سبد حذف شد" });
      
      // Refresh cart display
      const updatedCart = await prisma.cart.findFirst({
        where: { userId: user.id, state: CartState.ACTIVE },
        include: { items: { include: { product: true } } },
      });

      if (!updatedCart || updatedCart.items.length === 0) {
        await safeRender(ctx, ClientTexts.cartEmpty(), {
          reply_markup: ClientKeyboards.backToMenu(),
        });
        return;
      }

      const display = buildCartDisplay(updatedCart.items.map((item) => ({
        productId: item.productId,
        title: item.product.title,
        qty: item.qty,
        unitPrice: item.unitPriceSnapshot,
        currency: item.product.currency,
      })));

      await safeRender(ctx, display.text, {
        reply_markup: ClientKeyboards.cartView(display.items),
      });
      return;
    }

    // CLEAR CART
    if (data === "client:clearcart") {
      const cart = await prisma.cart.findFirst({
        where: { userId: user.id, state: CartState.ACTIVE },
      });

      if (cart) {
        await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
      }

      await safeRender(ctx, ClientTexts.cartCleared(), {
        reply_markup: ClientKeyboards.backToMenu(),
      });
      return;
    }

    // CHECKOUT - Start info gathering flow
    if (data === "client:checkout") {
      const cart = await prisma.cart.findFirst({
        where: { userId: user.id, state: CartState.ACTIVE },
        include: { items: true },
      });

      if (!cart || cart.items.length === 0) {
        await safeRender(ctx, ClientTexts.cartEmpty(), {
          reply_markup: ClientKeyboards.backToMenu(),
        });
        return;
      }

      // Check if we need to gather info
      const needsPhone = !user.phone;
      const needsAddress = !user.address;

      if (needsPhone || needsAddress) {
        // Delete the inline message to avoid stacking
        try { await ctx.deleteMessage(); } catch { /* ignore */ }
        
        if (needsPhone) {
          userSessions.set(ctx.from.id, { state: "checkout_phone" });
          const keyboard = new Keyboard()
            .requestContact(ClientTexts.askPhoneButton())
            .text(ClientTexts.askPhoneManualButton())
            .resized()
            .oneTime();
          await ctx.reply(ClientTexts.askPhone(), { reply_markup: keyboard });
          return;
        }
        
        if (needsAddress) {
          userSessions.set(ctx.from.id, { state: "checkout_address" });
          await ctx.reply(ClientTexts.askAddress());
          return;
        }
      }

      // All info available — proceed directly to checkout
      await processCheckout(ctx, user, cart.id, prisma, notificationService, bot, managerBot, checkoutImageFileId);
      return;
    }

    // CANCEL CHECKOUT
    if (data === "client:checkout:cancel") {
      userSessions.delete(ctx.from.id);
      await safeRender(ctx, ClientTexts.cancelCheckout(), {
        reply_markup: ClientKeyboards.backToMenu(),
      });
      return;
    }

    // MY ORDERS
    if (data === "client:orders") {
      const orders = await prisma.order.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        take: 10,
      });

      if (orders.length === 0) {
        await safeRender(ctx, ClientTexts.noOrders(), {
          reply_markup: ClientKeyboards.backToMenu(),
        });
        return;
      }

      let text = ClientTexts.myOrdersHeader() + "\n\n";
      orders.forEach((o) => {
        text += `سفارش #${o.id} · ${orderStatusLabel(o.status)} · ${formatPrice(o.grandTotal)}\n`;
      });
      text += "\nبرای هر سفارش، دکمه مهم‌ترین اقدام همان سفارش نمایش داده شده است.";

      const { InlineKeyboard } = await import("grammy");
      const kb = new InlineKeyboard();
      orders.forEach((o) => {
        if (o.status === OrderStatus.APPROVED || o.status === OrderStatus.INVITE_SENT || o.status === OrderStatus.AWAITING_RECEIPT) {
          kb.text(`📸 ارسال رسید #${o.id}`, `client:receipt:${o.id}`).text("جزئیات", `client:order:${o.id}`).row();
          return;
        }
        if (o.status === OrderStatus.AWAITING_MANAGER_APPROVAL) {
          kb.text(`📋 سفارش #${o.id}`, `client:order:${o.id}`).text("❌ لغو", `client:cancel:${o.id}`).row();
          return;
        }
        kb.text(`📋 سفارش #${o.id}`, `client:order:${o.id}`).row();
      });
      kb.text("« بازگشت به منو", "client:menu");

      await safeRender(ctx, text, {
        reply_markup: kb,
      });
      return;
    }

    // ORDER DETAIL
    if (data.startsWith("client:order:") && !data.startsWith("client:orders")) {
      const orderId = parseInt(parts[2]);
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: {
          items: { include: { product: true } },
          delivery: true,
        },
      });

      if (!order || order.userId !== user.id) {
        await safeRender(ctx, "سفارش یافت نشد.", {
          reply_markup: ClientKeyboards.backToMenu(),
        });
        return;
      }

      let detailText = `📦 *سفارش #${order.id}*\n`;
      detailText += `وضعیت: ${orderStatusLabel(order.status)}\n`;
      detailText += `تاریخ: ${order.createdAt.toISOString().split("T")[0]}\n\n`;
      detailText += `*اقلام:*\n`;
      order.items.forEach((item) => {
        detailText += `  ${item.product.title} x${item.qty} = ${formatPrice(item.lineTotal)}\n`;
      });
      detailText += `\nجمع: ${formatPrice(order.subtotal)}\n`;
      if (order.discountTotal > 0) {
        detailText += `تخفیف: ${formatPrice(order.discountTotal)}\n`;
      }
      detailText += `*مبلغ نهایی: ${formatPrice(order.grandTotal)}*\n`;

      if (order.delivery) {
        const dlabel = order.delivery.status === "DELIVERED" ? "تحویل داده شده ✅"
          : order.delivery.status === "OUT_FOR_DELIVERY" ? "در حال ارسال 🚚"
          : order.delivery.status === "PICKED_UP" ? "بسته تحویل پیک شده 📦"
          : order.delivery.status === "FAILED" ? "تحویل ناموفق ❌"
          : "اختصاص داده‌شده به پیک 📋";
        detailText += `\nوضعیت ارسال: ${dlabel}\n`;
      }

      const { InlineKeyboard: IK } = await import("grammy");
      const detailKb = new IK();

      // Show send receipt button for orders awaiting payment
      if (order.status === OrderStatus.APPROVED || order.status === OrderStatus.INVITE_SENT || order.status === OrderStatus.AWAITING_RECEIPT) {
        detailKb.text("📸 ارسال رسید پرداخت", `client:receipt:${order.id}`).row();
      }

      // Show cancel button only for pending orders
      if (order.status === OrderStatus.AWAITING_MANAGER_APPROVAL) {
        detailKb.text("❌ لغو سفارش", `client:cancel:${order.id}`).row();
      }
      detailKb.text("« بازگشت به سفارش‌ها", "client:orders").row();
      detailKb.text("« بازگشت به منو", "client:menu");

      await safeRender(ctx, detailText, {
        parse_mode: "Markdown",
        reply_markup: detailKb,
      });
      return;
    }

    // CANCEL RECEIPT UPLOAD — must be checked BEFORE client:receipt: startsWith
    if (data === "client:receipt:cancel") {
      userSessions.delete(ctx.from.id);
      try { await ctx.deleteMessage(); } catch { /* ignore */ }
      await ctx.reply("ارسال رسید لغو شد.", {
        reply_markup: ClientKeyboards.mainMenu(),
      });
      return;
    }

    // SEND RECEIPT - Set session to awaiting_receipt with orderId
    if (data.startsWith("client:receipt:")) {
      const orderId = parseInt(parts[2]);
      const order = await prisma.order.findUnique({ where: { id: orderId } });

      if (!order || order.userId !== user.id) {
        await answerCallback({ text: "سفارش یافت نشد.", show_alert: true });
        return;
      }

      if (order.status !== OrderStatus.APPROVED && order.status !== OrderStatus.INVITE_SENT && order.status !== OrderStatus.AWAITING_RECEIPT) {
        await answerCallback({ text: "برای این سفارش امکان ارسال رسید وجود ندارد.", show_alert: true });
        return;
      }

      userSessions.set(ctx.from.id, { state: "awaiting_receipt", orderId });

      try { await ctx.deleteMessage(); } catch { /* ignore */ }
      const { InlineKeyboard: CancelKb } = await import("grammy");
      await ctx.reply(
        `📸 *سفارش #${orderId}*\n\nلطفاً عکس رسید پرداخت را ارسال کنید.`,
        {
          parse_mode: "Markdown",
          reply_markup: new CancelKb().text("❌ انصراف", `client:receipt:cancel`),
        },
      );
      return;
    }

    // CANCEL ORDER
    if (data.startsWith("client:cancel:")) {
      const orderId = parseInt(parts[2]);
      const order = await prisma.order.findUnique({ where: { id: orderId } });

      if (!order || order.userId !== user.id || order.status !== OrderStatus.AWAITING_MANAGER_APPROVAL) {
        await answerCallback({ text: "این سفارش قابل لغو نیست.", show_alert: true });
        return;
      }

      await prisma.order.update({
        where: { id: orderId },
        data: {
          status: OrderStatus.CANCELLED,
          events: {
            create: {
              actorType: "user",
              actorId: user.id,
              eventType: "order_cancelled_by_user",
            },
          },
        },
      });

      await safeRender(ctx, `✅ سفارش #${orderId} لغو شد.`, {
        reply_markup: ClientKeyboards.backToMenu(),
      });
      return;
    }

    // USER PROFILE
    if (data === "client:profile") {
      await showProfile(ctx, user);
      return;
    }

    // EDIT PHONE
    if (data === "client:profile:edit:phone") {
      userSessions.set(ctx.from.id, { state: "checkout_phone", fromProfile: true });
      try { await ctx.deleteMessage(); } catch { /* ignore */ }
      const keyboard = new Keyboard()
        .requestContact(ClientTexts.askPhoneButton())
        .text(ClientTexts.askPhoneManualButton())
        .resized()
        .oneTime();
      await ctx.reply(ClientTexts.askPhone(), { reply_markup: keyboard });
      return;
    }

    // EDIT ADDRESS
    if (data === "client:profile:edit:address") {
      userSessions.set(ctx.from.id, { state: "checkout_address", fromProfile: true });
      await safeRender(ctx, "🏠 آدرس کامل تحویل را ارسال کنید:");
      return;
    }

    // EDIT LOCATION
    if (data === "client:profile:edit:location") {
      userSessions.set(ctx.from.id, { state: "checkout_location", fromProfile: true });
      try { await ctx.deleteMessage(); } catch { /* ignore */ }
      const keyboard = new Keyboard()
        .requestLocation(ClientTexts.askLocationButton())
        .resized()
        .oneTime();
      await ctx.reply(ClientTexts.askLocation(), { reply_markup: keyboard });
      return;
    }

    // MY REFERRALS
    if (data === "client:referrals") {
      const referralCodes = await prisma.referralCode.findMany({
        where: { createdByUserId: user.id },
      });

      const totalReferred = referralCodes.reduce((sum, c) => sum + c.usedCount, 0);

      // Re-fetch user to get canCreateReferral and maxReferralCodes
      const freshUser = await prisma.user.findUnique({ where: { id: user.id } });
      const canCreate = freshUser?.canCreateReferral ?? false;
      const maxCodes = freshUser?.maxReferralCodes ?? 3;

      let text = "🔗 *کدهای معرفی یک‌بارمصرف من*\n\n";
      
      if (referralCodes.length > 0) {
        text += "کدهای شما:\n";
        referralCodes.forEach((c) => {
          text += `\`${c.code}\` - ${c.usedCount > 0 ? "استفاده‌شده" : "قابل استفاده"}\n`;
        });
      } else {
        text += "هنوز هیچ کد معرفی یک‌بارمصرفی نساخته‌اید.\n";
      }

      text += `\n${ClientTexts.referralStats(totalReferred)}`;

      await safeRender(ctx, text, {
        parse_mode: "Markdown",
        reply_markup: ClientKeyboards.referralMenu(referralCodes.length, canCreate, maxCodes),
      });
      return;
    }

    // REFERRAL STATS
    if (data === "client:referral:stats") {
      const referralCodes = await prisma.referralCode.findMany({
        where: { createdByUserId: user.id },
      });

      const totalReferred = referralCodes.reduce((sum, c) => sum + c.usedCount, 0);

      // Find users referred by this user
      const referredUsers = await prisma.user.findMany({
        where: { referredById: user.id },
        select: { username: true, firstName: true, createdAt: true },
      });

      let text = "📊 *آمار کدهای معرفی من*\n\n";
      text += `کل کدها: ${referralCodes.length}\n`;
      text += `کدهای مصرف‌شده: ${totalReferred}\n`;
      text += `کاربران معرفی‌شده: ${referredUsers.length}\n`;

      if (referredUsers.length > 0) {
        text += "\nکاربرانی که با کد یک‌بارمصرف شما وارد شده‌اند:\n";
        referredUsers.forEach((u) => {
          const name = u.username || u.firstName || "ناشناس";
          const date = u.createdAt.toISOString().split("T")[0];
          text += `  • ${name} — ${date}\n`;
        });
      }

      await safeRender(ctx, text, {
        parse_mode: "Markdown",
        reply_markup: ClientKeyboards.backToMenu(),
      });
      return;
    }

    // GENERATE REFERRAL CODE — step 1: ask for score
    if (data === "client:referral:generate") {
      // Check permission
      const freshUser = await prisma.user.findUnique({ where: { id: user.id } });
      if (!freshUser?.canCreateReferral) {
        await answerCallback({
          text: ClientTexts.referralNoPermission(),
          show_alert: true,
        });
        return;
      }

      const maxCodes = freshUser.maxReferralCodes ?? 3;

      // Check if user already reached their max
      const existingCodes = await prisma.referralCode.count({
        where: { createdByUserId: user.id },
      });

      if (existingCodes >= maxCodes) {
        await answerCallback({
          text: ClientTexts.referralMaxCodesReached(maxCodes),
          show_alert: true,
        });
        return;
      }

      userSessions.set(ctx.from.id, { state: "referral_score" });
      await safeRender(ctx, ClientTexts.enterReferralScore(), {
        parse_mode: "Markdown",
      });
      return;
    }

    // HELP
    if (data === "client:help") {
      await safeRender(ctx, ClientTexts.helpMessage(), {
        parse_mode: "Markdown",
        reply_markup: ClientKeyboards.backToMenu(),
      });
      return;
    }

    // ===========================================
    // SUPPORT
    // ===========================================
    if (data === "client:support") {
      // Find or create open conversation
      let conversation = await prisma.supportConversation.findFirst({
        where: { userId: user.id, status: SupportConversationStatus.OPEN },
        orderBy: { createdAt: "desc" },
      });

      if (!conversation) {
        conversation = await prisma.supportConversation.create({
          data: { userId: user.id },
        });
      }

      // Show last messages
      const messages = await prisma.supportMessage.findMany({
        where: { conversationId: conversation.id },
        orderBy: { createdAt: "desc" },
        take: 10,
      });

      let supportText = ClientTexts.supportIntro() + "\n\n";
      if (messages.length > 0) {
        const sorted = messages.reverse();
        sorted.forEach((m) => {
          const sender = m.senderType === SupportSenderType.USER ? "شما" : "پشتیبانی";
          supportText += `*${sender}:* ${m.text}\n\n`;
        });
      }
      supportText += ClientTexts.supportAskMessage();

      userSessions.set(ctx.from.id, {
        state: "support_message",
        supportConversationId: conversation.id,
      });

      await safeRender(ctx, supportText, {
        parse_mode: "Markdown",
        reply_markup: ClientKeyboards.supportActions(conversation.id),
      });
      return;
    }

    // CLOSE SUPPORT CONVERSATION
    if (data.startsWith("client:support:close:")) {
      const convId = parseInt(parts[3]);
      await prisma.supportConversation.update({
        where: { id: convId },
        data: { status: SupportConversationStatus.CLOSED },
      });

      userSessions.delete(ctx.from.id);
      await safeRender(ctx, ClientTexts.supportClosed(), {
        reply_markup: ClientKeyboards.backToMenu(),
      });
      return;
    }

    // REPLY TO SUPPORT FROM NOTIFICATION
    if (data.startsWith("client:support:reply:")) {
      const convId = parseInt(parts[3]);
      const conversation = await prisma.supportConversation.findUnique({
        where: { id: convId },
      });

      if (!conversation || conversation.status === SupportConversationStatus.CLOSED) {
        await ctx.answerCallbackQuery({ text: "این گفتگو بسته شده است.", show_alert: true });
        return;
      }

      userSessions.set(ctx.from.id, {
        state: "support_message",
        supportConversationId: conversation.id,
      });

      await answerCallback();
      await safeRender(ctx, ClientTexts.supportAskMessage(), {
        reply_markup: ClientKeyboards.supportActions(conversation.id),
      });
      return;
    }

    // NO-OP (for display-only buttons)
    if (data === "noop") {
      return;
    }
  });
}
