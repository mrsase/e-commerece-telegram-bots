import { Bot, Context, Keyboard } from "grammy";
import type { PrismaClient, User } from "@prisma/client";
import { CartState, OrderStatus, ReceiptReviewStatus, SupportConversationStatus, SupportSenderType } from "@prisma/client";
import { ClientTexts } from "../../i18n/index.js";
import { ClientKeyboards } from "../../utils/keyboards.js";
import { OrderService, InsufficientStockError } from "../../services/order-service.js";
import { DiscountService } from "../../services/discount-service.js";

import { SessionStore } from "../../utils/session-store.js";

// Session state for tracking user interactions
type SessionState = 
  | "awaiting_referral"
  | "viewing_product"
  | "checkout_phone"
  | "checkout_location"
  | "checkout_address"
  | "checkout_discount"
  | "awaiting_receipt"
  | "support_message";

interface ClientSession {
  state: SessionState;
  data?: Record<string, unknown>;
  selectedQty?: number;
  orderId?: number;
  supportConversationId?: number;
}

const userSessions = new SessionStore<ClientSession>();

interface ClientBotDeps {
  prisma: PrismaClient;
  managerBot?: Bot;
}

import { createReferralCodeWithRetry } from "../../utils/referral-utils.js";
import { buildCartDisplay } from "../../utils/cart-display.js";
import { NotificationService } from "../../services/notification-service.js";
import { orderStatusLabel } from "../../utils/order-status.js";
import { safeRender as safeRenderOriginal } from "../../utils/safe-reply.js";

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

  // Create new user (unverified)
  user = await prisma.user.create({
    data: {
      tgUserId,
      username: ctx.from.username,
      firstName: ctx.from.first_name,
      lastName: ctx.from.last_name,
      referralCode: `USR_${ctx.from.id}`,
      isVerified: false,
    },
  });

  return { user, needsReferral: true };
}

/**
 * Validate and use a referral code
 */
async function validateAndUseReferralCode(
  userId: number,
  code: string,
  prisma: PrismaClient
): Promise<boolean> {
  // Find the referral code
  const referralCode = await prisma.referralCode.findUnique({
    where: { code: code.toUpperCase() },
  });

  if (!referralCode) return false;
  if (!referralCode.isActive) return false;
  if (referralCode.expiresAt && referralCode.expiresAt < new Date()) return false;
  if (referralCode.maxUses && referralCode.usedCount >= referralCode.maxUses) return false;

  // P1-3 Fix: Set referredById from the referral code creator
  // Update user and referral code
  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: {
        isVerified: true,
        usedReferralCodeId: referralCode.id,
        referredById: referralCode.createdByUserId, // Link to who referred them
      },
    }),
    prisma.referralCode.update({
      where: { id: referralCode.id },
      data: { usedCount: { increment: 1 } },
    }),
  ]);

  return true;
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
  discountCode?: string | null,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  render: (text: string, options?: any) => Promise<any> = (t, o) => safeRenderOriginal(ctx, t, o)
): Promise<void> {
  const orderService = new OrderService(prisma);
  const discountService = new DiscountService(prisma);

  try {
    const cart = await prisma.cart.findUnique({
      where: { id: cartId },
      include: { items: { include: { product: true } } },
    });

    if (!cart) {
      await render( ClientTexts.checkoutError(), {
        reply_markup: ClientKeyboards.mainMenu(),
      });
      return;
    }

    const discountResult = await discountService.calculateDiscounts(
      {
        userId: user.id,
        items: cart.items.map(item => ({
          productId: item.productId,
          qty: item.qty,
          unitPrice: item.unitPriceSnapshot,
        })),
      },
      discountCode,
    );

    const result = await orderService.createOrderFromCart({
      userId: user.id,
      cartId,
      appliedDiscounts: discountResult.appliedDiscounts,
    });

    await render(
      ClientTexts.orderSubmitted(result.orderId, result.grandTotal) + "\n\n" + ClientTexts.orderPendingApproval(),
      { reply_markup: ClientKeyboards.mainMenu() }
    );

    // Notify managers about the new order
    const userLabel = user.username || user.firstName || `#${user.id}`;
    await notificationService?.notifyManagersNewOrder(result.orderId, userLabel, result.grandTotal);
  } catch (error) {
    if (error instanceof InsufficientStockError) {
      await render( ClientTexts.outOfStock(), {
        reply_markup: ClientKeyboards.mainMenu(),
      });
      return;
    }
    await render( ClientTexts.checkoutError(), {
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
): Promise<void> {
  // Refresh user data
  const updatedUser = await prisma.user.findUnique({ where: { id: user.id } });
  if (!updatedUser) return;

  // P2-1 Fix: Use nullish check instead of truthiness (0 is a valid coordinate)
  const needsLocation = updatedUser.locationLat == null || updatedUser.locationLng == null;
  const needsAddress = !updatedUser.address;

  if (needsLocation) {
    userSessions.set(ctx.from!.id, { state: "checkout_location" });
    const keyboard = new Keyboard()
      .requestLocation(ClientTexts.askLocationButton())
      .resized()
      .oneTime();
    await ctx.reply(ClientTexts.askLocation(), { reply_markup: keyboard });
    return;
  }

  if (needsAddress) {
    userSessions.set(ctx.from!.id, { state: "checkout_address" });
    await ctx.reply(ClientTexts.askAddress());
    return;
  }

  // All info collected - proceed to checkout
  await ctx.reply(ClientTexts.infoComplete());
  userSessions.delete(ctx.from!.id);

  const cart = await prisma.cart.findFirst({
    where: { userId: updatedUser.id, state: CartState.ACTIVE },
  });

  if (cart) {
    await processCheckout(ctx, updatedUser, cart.id, prisma, notificationService);
  }
}

/**
 * Register all interactive handlers for client bot
 */
export function registerInteractiveClientBot(bot: Bot, deps: ClientBotDeps): void {
  const { prisma, managerBot } = deps;
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

    // Show main menu
    const name = user.firstName || user.username || "دوست عزیز";
    await ctx.reply(ClientTexts.welcomeBack(name), {
      reply_markup: ClientKeyboards.mainMenu(),
      parse_mode: "Markdown",
    });
  });

  // ===========================================
  // TEXT MESSAGE HANDLER - For referral codes, address, etc.
  // ===========================================
  bot.on("message:text", async (ctx) => {
    const session = userSessions.get(ctx.from.id);
    
    if (session?.state === "awaiting_referral") {
      const code = ctx.message.text.trim();
      
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

    // Handle address input during checkout
    if (session?.state === "checkout_address") {
      const address = ctx.message.text.trim();
      
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

      await ctx.reply(ClientTexts.addressReceived(), { reply_markup: { remove_keyboard: true } });
      await continueCheckoutFlow(ctx, user, prisma, notificationService);
      return;
    }

    // Handle discount code entry during checkout
    if (session?.state === "checkout_discount") {
      const code = ctx.message.text.trim();
      
      const user = await prisma.user.findUnique({
        where: { tgUserId: BigInt(ctx.from.id) },
      });
      if (!user) {
        await ctx.reply(ClientTexts.unableToIdentify());
        return;
      }

      userSessions.delete(ctx.from.id);

      if (code === "/skip") {
        // Continue without discount code
        const cart = await prisma.cart.findFirst({
          where: { userId: user.id, state: CartState.ACTIVE },
        });
        if (cart) {
          // Called from message:text, so use default render (no callback answer)
          await processCheckout(ctx, user, cart.id, prisma, notificationService);
        }
        return;
      }

      // Validate the discount code exists and is active
      const discount = await prisma.discount.findUnique({
        where: { code },
      });

      if (!discount || !discount.isActive) {
        await ctx.reply("❌ کد تخفیف نامعتبر است. سفارش بدون تخفیف ثبت می‌شود.");
        const cart = await prisma.cart.findFirst({
          where: { userId: user.id, state: CartState.ACTIVE },
        });
        if (cart) {
          await processCheckout(ctx, user, cart.id, prisma, notificationService);
        }
        return;
      }

      // Process checkout with discount code
      const cart = await prisma.cart.findFirst({
        where: { userId: user.id, state: CartState.ACTIVE },
      });
      if (cart) {
        await ctx.reply(`✅ کد تخفیف "${code}" اعمال شد.`);
        await processCheckout(ctx, user, cart.id, prisma, notificationService, code);
      }
      return;
    }

    // Handle support message
    if (session?.state === "support_message" && session.supportConversationId) {
      const messageText = ctx.message.text.trim();
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

      await ctx.reply(ClientTexts.supportMessageSent());

      // Notify managers
      const userLabel = user.username || user.firstName || `#${user.id}`;
      await notificationService.notifyManagersNewSupportMessage(session.supportConversationId, userLabel);
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

      await ctx.reply(ClientTexts.phoneReceived(), { reply_markup: { remove_keyboard: true } });
      await continueCheckoutFlow(ctx, user, prisma, notificationService);
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
        },
      });

      await ctx.reply(ClientTexts.locationReceived(), { reply_markup: { remove_keyboard: true } });
      await continueCheckoutFlow(ctx, user, prisma, notificationService);
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
        await ctx.reply("برای ارسال رسید، ابتدا از منوی «سفارش‌های من» سفارش مورد نظر را انتخاب کرده و دکمه «📸 ارسال رسید پرداخت» را بزنید.");
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
        await ctx.reply("این سفارش دیگر در وضعیت ارسال رسید نیست.");
        return;
      }

      const photo = ctx.message.photo[ctx.message.photo.length - 1];

      await prisma.$transaction([
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
      await notificationService.notifyManagersNewReceipt(order.id, userLabel);
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
    
    // Helper to answer callback and render
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const render = async (text: string, options?: any) => {
      await answerCallback();
      return safeRenderOriginal(ctx, text, options);
    };

    // Get user
    const { user, needsReferral } = await getOrCreateUser(ctx, prisma);
    
    if (!user || !user.isActive) {
      await render(ClientTexts.userBlocked());
      return;
    }

    if (needsReferral && !data.startsWith("noop")) {
      userSessions.set(ctx.from.id, { state: "awaiting_referral" });
      await render(ClientTexts.welcomeNewUser());
      return;
    }

    // Parse callback data
    const parts = data.split(":");

    // MAIN MENU
    if (data === "client:menu") {
      await render(ClientTexts.welcome(), {
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
        await render( ClientTexts.noProductsAvailable(), {
          reply_markup: ClientKeyboards.backToMenu(),
        });
        return;
      }

      const totalPages = Math.ceil(total / pageSize);
      await render( ClientTexts.productsHeader(), {
        reply_markup: ClientKeyboards.productList(products, page, totalPages),
      });
      return;
    }

    // VIEW SINGLE PRODUCT
    if (data.startsWith("client:product:") && !data.includes("qty")) {
      const productId = parseInt(parts[2]);
      const page = parts[3] ? parseInt(parts[3]) : 0;
      const product = await prisma.product.findUnique({ where: { id: productId } });

      if (!product) {
        await render( ClientTexts.productNotFound(), {
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

      // If product has image, send photo
      if (product.photoFileId) {
        await ctx.deleteMessage();
        await ctx.replyWithPhoto(product.photoFileId, {
          caption: text,
          parse_mode: "Markdown",
          reply_markup: ClientKeyboards.productView(productId, 1, page),
        });
      } else {
        await render( text, {
          parse_mode: "Markdown",
          reply_markup: ClientKeyboards.productView(productId, 1, page),
        });
      }
      return;
    }

    // QUANTITY CONTROLS
    if (data.startsWith("client:qty:")) {
      const action = parts[2]; // inc or dec
      const productId = parseInt(parts[3]);
      const page = parts[4] ? parseInt(parts[4]) : 0;
      const session = userSessions.get(ctx.from.id) || { state: "viewing_product", selectedQty: 1 };
      let qty = session.selectedQty || 1;

      if (action === "inc") qty = Math.min(qty + 1, 99);
      if (action === "dec") qty = Math.max(qty - 1, 1);

      userSessions.set(ctx.from.id, { ...session, selectedQty: qty });

      // Update keyboard
      try {
        await ctx.editMessageReplyMarkup({
          reply_markup: ClientKeyboards.productView(productId, qty, page),
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
      const page = parts[4] ? parseInt(parts[4]) : 0;

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

      // Navigate back to products list (with preserved page)
      const pageSize = 5;
      const products = await prisma.product.findMany({
        where: { isActive: true },
        orderBy: { id: "desc" },
        skip: page * pageSize,
        take: pageSize,
      });
      const total = await prisma.product.count({ where: { isActive: true } });
      const totalPages = Math.ceil(total / pageSize);

      await render( ClientTexts.productsHeader(), {
        reply_markup: ClientKeyboards.productList(products, page, totalPages),
      });
      return;
    }

    // ADD TO CART & GO TO CHECKOUT
    if (data.startsWith("client:addandcheckout:")) {
      const productId = parseInt(parts[2]);
      const qty = parseInt(parts[3]);
      // page is parts[4], but not used here since we go to cart/checkout

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
        await render( ClientTexts.cartEmpty(), {
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

      await render( display.text, {
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
        await render( ClientTexts.cartEmpty(), {
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

      await render( display.text, {
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
        await render( ClientTexts.cartEmpty(), {
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

      await render( display.text, {
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

      await render( ClientTexts.cartCleared(), {
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
        await render( ClientTexts.cartEmpty(), {
          reply_markup: ClientKeyboards.backToMenu(),
        });
        return;
      }

      // Check if we need to gather info
      const needsPhone = !user.phone;
      // P2-1 Fix: Use nullish check instead of truthiness (0 is a valid coordinate)
      const needsLocation = user.locationLat == null || user.locationLng == null;
      const needsAddress = !user.address;

      if (needsPhone || needsLocation || needsAddress) {
        // Delete the inline message to avoid stacking
        try { await ctx.deleteMessage(); } catch { /* ignore */ }
        
        if (needsPhone) {
          userSessions.set(ctx.from.id, { state: "checkout_phone" });
          const keyboard = new Keyboard()
            .requestContact(ClientTexts.askPhoneButton())
            .resized()
            .oneTime();
          await ctx.reply(ClientTexts.askPhone(), { reply_markup: keyboard });
          return;
        }
        
        if (needsLocation) {
          userSessions.set(ctx.from.id, { state: "checkout_location" });
          const keyboard = new Keyboard()
            .requestLocation(ClientTexts.askLocationButton())
            .resized()
            .oneTime();
          await ctx.reply(ClientTexts.askLocation(), { reply_markup: keyboard });
          return;
        }
        
        if (needsAddress) {
          userSessions.set(ctx.from.id, { state: "checkout_address" });
          await ctx.reply(ClientTexts.askAddress());
          return;
        }
      }

      // All info available - ask for discount code
      const { InlineKeyboard: CK } = await import("grammy");
      const discountKb = new CK();
      discountKb.text("🎟️ وارد کردن کد تخفیف", "client:checkout:discount").row();
      discountKb.text("⏭️ ادامه بدون کد تخفیف", `client:checkout:finalize:${cart.id}`).row();
      discountKb.text("❌ انصراف", "client:checkout:cancel");

      await render( "آیا کد تخفیف دارید؟", {
        reply_markup: discountKb,
      });
      return;
    }

    // DISCOUNT CODE PROMPT
    if (data === "client:checkout:discount") {
      userSessions.set(ctx.from.id, { state: "checkout_discount" });
      await render( "🎟️ لطفاً کد تخفیف خود را وارد کنید:\n\nبرای انصراف /skip را ارسال کنید.");
      return;
    }

    // FINALIZE CHECKOUT (with or without discount code)
    if (data.startsWith("client:checkout:finalize:")) {
      const cartId = parseInt(parts[3]);
      const discountCode = parts[4] || null; // optional discount code passed via callback
      await processCheckout(ctx, user, cartId, prisma, notificationService, discountCode, render);
      return;
    }

    // CANCEL CHECKOUT
    if (data === "client:checkout:cancel") {
      userSessions.delete(ctx.from.id);
      await render( ClientTexts.cancelCheckout(), {
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
        await render( ClientTexts.noOrders(), {
          reply_markup: ClientKeyboards.backToMenu(),
        });
        return;
      }

      let text = ClientTexts.myOrdersHeader() + "\n\n";
      orders.forEach((o) => {
        text += `سفارش #${o.id} · ${orderStatusLabel(o.status)} · ${o.grandTotal} تومان\n`;
      });

      const { InlineKeyboard } = await import("grammy");
      const kb = new InlineKeyboard();
      orders.forEach((o) => {
        kb.text(`📋 جزئیات سفارش #${o.id}`, `client:order:${o.id}`).row();
      });
      kb.text("« بازگشت به منو", "client:menu");

      await render( text, {
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
        await render( "سفارش یافت نشد.", {
          reply_markup: ClientKeyboards.backToMenu(),
        });
        return;
      }

      let detailText = `📦 *سفارش #${order.id}*\n`;
      detailText += `وضعیت: ${orderStatusLabel(order.status)}\n`;
      detailText += `تاریخ: ${order.createdAt.toISOString().split("T")[0]}\n\n`;
      detailText += `*اقلام:*\n`;
      order.items.forEach((item) => {
        detailText += `  ${item.product.title} x${item.qty} = ${item.lineTotal} تومان\n`;
      });
      detailText += `\nجمع: ${order.subtotal} تومان\n`;
      if (order.discountTotal > 0) {
        detailText += `تخفیف: ${order.discountTotal} تومان\n`;
      }
      detailText += `*مبلغ نهایی: ${order.grandTotal} تومان*\n`;

      if (order.delivery) {
        const dlabel = order.delivery.status === "DELIVERED" ? "تحویل داده شده ✅"
          : order.delivery.status === "OUT_FOR_DELIVERY" ? "در حال ارسال 🚚"
          : order.delivery.status === "PICKED_UP" ? "برداشته شده 📦"
          : order.delivery.status === "FAILED" ? "ناموفق ❌"
          : "تخصیص داده شده 📋";
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

      await render( detailText, {
        parse_mode: "Markdown",
        reply_markup: detailKb,
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
        await answerCallback({ text: "این سفارش در وضعیت ارسال رسید نیست.", show_alert: true });
        return;
      }

      userSessions.set(ctx.from.id, { state: "awaiting_receipt", orderId });

      try { await ctx.deleteMessage(); } catch { /* ignore */ }
      await ctx.reply(
        `📸 *سفارش #${orderId}*\n\nلطفاً عکس رسید پرداخت را ارسال کنید.`,
        { parse_mode: "Markdown" },
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

      await render( `✅ سفارش #${orderId} لغو شد.`, {
        reply_markup: ClientKeyboards.backToMenu(),
      });
      return;
    }

    // USER PROFILE
    if (data === "client:profile") {
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

      await render( profileText, {
        parse_mode: "Markdown",
        reply_markup: profileKb,
      });
      return;
    }

    // EDIT PHONE
    if (data === "client:profile:edit:phone") {
      userSessions.set(ctx.from.id, { state: "checkout_phone" });
      try { await ctx.deleteMessage(); } catch { /* ignore */ }
      const keyboard = new Keyboard()
        .requestContact(ClientTexts.askPhoneButton())
        .resized()
        .oneTime();
      await ctx.reply(ClientTexts.askPhone(), { reply_markup: keyboard });
      return;
    }

    // EDIT ADDRESS
    if (data === "client:profile:edit:address") {
      userSessions.set(ctx.from.id, { state: "checkout_address" });
      await render( "📍 آدرس جدید خود را ارسال کنید:");
      return;
    }

    // EDIT LOCATION
    if (data === "client:profile:edit:location") {
      userSessions.set(ctx.from.id, { state: "checkout_location" });
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

      let text = "🔗 *معرفی‌های من*\n\n";
      
      if (referralCodes.length > 0) {
        text += "کدهای معرفی شما:\n";
        referralCodes.forEach((c) => {
          text += `\`${c.code}\` - ${c.usedCount} بار استفاده\n`;
        });
      } else {
        text += "هنوز هیچ کد معرفی‌ای نساخته‌اید.\n";
      }

      text += `\n${ClientTexts.referralStats(totalReferred)}`;

      // Re-fetch user to get canCreateReferral
      const freshUser = await prisma.user.findUnique({ where: { id: user.id } });
      const canCreate = freshUser?.canCreateReferral ?? false;

      await render( text, {
        parse_mode: "Markdown",
        reply_markup: ClientKeyboards.referralMenu(referralCodes.length > 0, canCreate),
      });
      return;
    }

    // GENERATE REFERRAL CODE — step 1: ask for score
    if (data === "client:referral:generate") {
      // Check permission
      const freshUser = await prisma.user.findUnique({ where: { id: user.id } });
      if (!freshUser?.canCreateReferral) {
        await answerCallback({
          text: "شما مجوز ساخت کد معرفی ندارید. با مدیریت تماس بگیرید.",
          show_alert: true,
        });
        return;
      }

      // Check if user already has a code (limit to 3 per user)
      const existingCodes = await prisma.referralCode.count({
        where: { createdByUserId: user.id },
      });

      if (existingCodes >= 3) {
        await answerCallback({
          text: "حداکثر می‌توانید ۳ کد معرفی بسازید.",
          show_alert: true,
        });
        return;
      }

      const code = await createReferralCodeWithRetry(prisma, {
        createdByUserId: user.id,
        maxUses: 5,
      });

      await render( ClientTexts.referralCodeGenerated(code), {
        parse_mode: "Markdown",
        reply_markup: ClientKeyboards.backToMenu(),
      });
      return;
    }

    // HELP
    if (data === "client:help") {
      await render( ClientTexts.helpMessage(), {
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

      await render( supportText, {
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
      await render( ClientTexts.supportClosed(), {
        reply_markup: ClientKeyboards.backToMenu(),
      });
      return;
    }

    // NO-OP (for display-only buttons)
    if (data === "noop") {
      return;
    }
  });
}
