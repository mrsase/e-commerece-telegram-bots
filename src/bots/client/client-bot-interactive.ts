import { Bot, Context, Keyboard } from "grammy";
import type { PrismaClient, User } from "@prisma/client";
import { CartState, OrderStatus, ReceiptReviewStatus } from "@prisma/client";
import { ClientTexts } from "../../i18n/index.js";
import { ClientKeyboards } from "../../utils/keyboards.js";
import { OrderService, InsufficientStockError } from "../../services/order-service.js";
import { DiscountService } from "../../services/discount-service.js";

// Session state for tracking user interactions
type SessionState = 
  | "awaiting_referral"
  | "viewing_product"
  | "checkout_phone"
  | "checkout_location"
  | "checkout_address"
  | "awaiting_receipt";

const userSessions = new Map<number, { 
  state: SessionState;
  data?: Record<string, unknown>;
  selectedQty?: number;
  orderId?: number;
}>();

interface ClientBotDeps {
  prisma: PrismaClient;
}

/**
 * P1-4 Fix: Generate a random referral code using crypto for better randomness
 */
import crypto from "crypto";

function generateReferralCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const randomBytes = crypto.randomBytes(8);
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(randomBytes[i] % chars.length);
  }
  return code;
}

/**
 * P1-4 Fix: Create referral code with retry on unique constraint violation
 */
async function createReferralCodeWithRetry(
  prisma: PrismaClient,
  userId: number,
  maxRetries = 3
): Promise<string> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const code = generateReferralCode();
    try {
      await prisma.referralCode.create({
        data: {
          code,
          createdByUserId: userId,
          maxUses: 5,
        },
      });
      return code;
    } catch (error: unknown) {
      // Check for unique constraint violation (Prisma error code P2002)
      if (
        error instanceof Error &&
        'code' in error &&
        (error as { code: string }).code === 'P2002'
      ) {
        if (attempt === maxRetries - 1) {
          throw new Error('Failed to generate unique referral code after multiple attempts');
        }
        continue;
      }
      throw error;
    }
  }
  throw new Error('Failed to generate referral code');
}

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
  prisma: PrismaClient
): Promise<void> {
  const orderService = new OrderService(prisma);
  const discountService = new DiscountService(prisma);

  try {
    // P2-4 Fix: Integrate DiscountService into checkout
    // Get cart items to calculate discounts
    const cart = await prisma.cart.findUnique({
      where: { id: cartId },
      include: { items: { include: { product: true } } },
    });

    if (!cart) {
      await ctx.reply(ClientTexts.checkoutError(), {
        reply_markup: ClientKeyboards.mainMenu(),
      });
      return;
    }

    // Calculate applicable discounts
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

    await ctx.reply(
      ClientTexts.orderSubmitted(result.orderId, result.grandTotal) + "\n\n" + ClientTexts.orderPendingApproval(),
      { reply_markup: ClientKeyboards.mainMenu() }
    );
  } catch (error) {
    if (error instanceof InsufficientStockError) {
      await ctx.reply(ClientTexts.outOfStock(), {
        reply_markup: ClientKeyboards.mainMenu(),
      });
      return;
    }
    await ctx.reply(ClientTexts.checkoutError(), {
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
  prisma: PrismaClient
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
    await processCheckout(ctx, updatedUser, cart.id, prisma);
  }
}

/**
 * Register all interactive handlers for client bot
 */
export function registerInteractiveClientBot(bot: Bot, deps: ClientBotDeps): void {
  const { prisma } = deps;

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
      await continueCheckoutFlow(ctx, user, prisma);
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
      await continueCheckoutFlow(ctx, user, prisma);
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
      await continueCheckoutFlow(ctx, user, prisma);
    }
  });

  // ===========================================
  // PHOTO MESSAGE HANDLER - For receipt images
  // ===========================================
  bot.on("message:photo", async (ctx) => {
    // Check if user has an order awaiting receipt
    const user = await prisma.user.findUnique({
      where: { tgUserId: BigInt(ctx.from.id) },
    });

    if (!user) {
      await ctx.reply(ClientTexts.unableToIdentify());
      return;
    }

    // Find order awaiting receipt
    const order = await prisma.order.findFirst({
      where: {
        userId: user.id,
        status: OrderStatus.AWAITING_RECEIPT,
      },
      orderBy: { createdAt: "desc" },
    });

    if (!order) {
      // Check if they have an approved order that needs receipt
      const approvedOrder = await prisma.order.findFirst({
        where: {
          userId: user.id,
          status: OrderStatus.INVITE_SENT,
        },
        orderBy: { createdAt: "desc" },
      });

      if (approvedOrder) {
        // P1-1 Fix: Mark any existing pending receipts as superseded before creating new one
        const photo = ctx.message.photo[ctx.message.photo.length - 1];
        
        await prisma.$transaction([
          // Mark existing pending receipts as rejected (superseded)
          prisma.receipt.updateMany({
            where: {
              orderId: approvedOrder.id,
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
              orderId: approvedOrder.id,
              userId: user.id,
              fileId: photo.file_id,
              caption: ctx.message.caption,
            },
          }),
          prisma.order.update({
            where: { id: approvedOrder.id },
            data: { status: OrderStatus.AWAITING_RECEIPT },
          }),
        ]);

        await ctx.reply(ClientTexts.receiptReceived());
        return;
      }

      await ctx.reply(ClientTexts.noActiveOrderForReceipt());
      return;
    }

    // P1-1 Fix: Mark any existing pending receipts as superseded before creating new one
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    
    await prisma.$transaction([
      // Mark existing pending receipts as rejected (superseded)
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
    ]);

    await ctx.reply(ClientTexts.receiptReceived());
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
        await ctx.answerCallbackQuery(options);
      }
    };
    
    // Answer immediately for responsive UX (will be skipped if answered later with specific text)
    await answerCallback();

    // Get user
    const { user, needsReferral } = await getOrCreateUser(ctx, prisma);
    
    if (!user || !user.isActive) {
      await ctx.editMessageText(ClientTexts.userBlocked());
      return;
    }

    if (needsReferral && !data.startsWith("noop")) {
      userSessions.set(ctx.from.id, { state: "awaiting_referral" });
      await ctx.editMessageText(ClientTexts.welcomeNewUser());
      return;
    }

    // Parse callback data
    const parts = data.split(":");

    // MAIN MENU
    if (data === "client:menu") {
      await ctx.editMessageText(ClientTexts.welcome(), {
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
        await ctx.editMessageText(ClientTexts.noProductsAvailable(), {
          reply_markup: ClientKeyboards.backToMenu(),
        });
        return;
      }

      const totalPages = Math.ceil(total / pageSize);
      await ctx.editMessageText(ClientTexts.productsHeader(), {
        reply_markup: ClientKeyboards.productList(products, page, totalPages),
      });
      return;
    }

    // VIEW SINGLE PRODUCT
    if (data.startsWith("client:product:") && !data.includes("qty")) {
      const productId = parseInt(parts[2]);
      const product = await prisma.product.findUnique({ where: { id: productId } });

      if (!product) {
        await ctx.editMessageText(ClientTexts.productNotFound(), {
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
          reply_markup: ClientKeyboards.productView(productId, 1),
        });
      } else {
        await ctx.editMessageText(text, {
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

    // ADD TO CART
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
        // P2-3 Fix: Always update price snapshot to latest price when adding to cart
        // This ensures consistent behavior with legacy flow
        await prisma.cartItem.update({
          where: { id: existingItem.id },
          data: { 
            qty: existingItem.qty + qty,
            unitPriceSnapshot: product.price, // Update to current price
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
        await ctx.editMessageText(ClientTexts.cartEmpty(), {
          reply_markup: ClientKeyboards.backToMenu(),
        });
        return;
      }

      const items = cart.items.map((item) => ({
        productId: item.productId,
        title: item.product.title,
        qty: item.qty,
      }));

      const subtotal = cart.items.reduce(
        (sum, item) => sum + item.qty * item.unitPriceSnapshot,
        0
      );

      let text = ClientTexts.cartHeader() + "\n\n";
      cart.items.forEach((item) => {
        const lineTotal = item.qty * item.unitPriceSnapshot;
        text += `${item.product.title} x${item.qty} = ${lineTotal} ${item.product.currency}\n`;
      });
      text += `\n${ClientTexts.cartSubtotal(subtotal)}`;

      await ctx.editMessageText(text, {
        reply_markup: ClientKeyboards.cartView(items),
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
        await ctx.editMessageText(ClientTexts.cartEmpty(), {
          reply_markup: ClientKeyboards.backToMenu(),
        });
        return;
      }

      const items = updatedCart.items.map((item) => ({
        productId: item.productId,
        title: item.product.title,
        qty: item.qty,
      }));

      const subtotal = updatedCart.items.reduce(
        (sum, item) => sum + item.qty * item.unitPriceSnapshot,
        0
      );

      let text = ClientTexts.cartHeader() + "\n\n";
      updatedCart.items.forEach((item) => {
        const lineTotal = item.qty * item.unitPriceSnapshot;
        text += `${item.product.title} x${item.qty} = ${lineTotal} ${item.product.currency}\n`;
      });
      text += `\n${ClientTexts.cartSubtotal(subtotal)}`;

      await ctx.editMessageText(text, {
        reply_markup: ClientKeyboards.cartView(items),
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

      await ctx.editMessageText(ClientTexts.cartCleared(), {
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
        await ctx.editMessageText(ClientTexts.cartEmpty(), {
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
        await ctx.editMessageText(ClientTexts.checkoutInfoRequired());
        
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

      // All info available - proceed with checkout
      await processCheckout(ctx, user, cart.id, prisma);
      return;
    }

    // CANCEL CHECKOUT
    if (data === "client:checkout:cancel") {
      userSessions.delete(ctx.from.id);
      await ctx.editMessageText(ClientTexts.cancelCheckout(), {
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
        await ctx.editMessageText(ClientTexts.noOrders(), {
          reply_markup: ClientKeyboards.backToMenu(),
        });
        return;
      }

      let text = ClientTexts.myOrdersHeader() + "\n\n";
      orders.forEach((o) => {
        text += `#${o.id} - ${o.status} - ${o.grandTotal}\n`;
      });

      await ctx.editMessageText(text, {
        reply_markup: ClientKeyboards.backToMenu(),
      });
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

      await ctx.editMessageText(text, {
        parse_mode: "Markdown",
        reply_markup: ClientKeyboards.referralMenu(referralCodes.length > 0),
      });
      return;
    }

    // GENERATE REFERRAL CODE
    if (data === "client:referral:generate") {
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

      // P1-4 Fix: Use retry mechanism for referral code creation
      const code = await createReferralCodeWithRetry(prisma, user.id);

      await ctx.editMessageText(ClientTexts.referralCodeGenerated(code), {
        parse_mode: "Markdown",
        reply_markup: ClientKeyboards.backToMenu(),
      });
      return;
    }

    // HELP
    if (data === "client:help") {
      await ctx.editMessageText(ClientTexts.helpMessage(), {
        parse_mode: "Markdown",
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
