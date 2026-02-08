import { Bot, Context } from "grammy";
import type { PrismaClient, Manager } from "@prisma/client";
import { OrderStatus, ReceiptReviewStatus } from "@prisma/client";
import { ManagerTexts, ClientTexts } from "../../i18n/index.js";
import { ManagerKeyboards } from "../../utils/keyboards.js";

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
  | "receipt:reject:reason";

const managerSessions = new Map<number, {
  state: SessionState;
  data?: Record<string, unknown>;
}>();

interface ManagerBotDeps {
  prisma: PrismaClient;
  clientBot?: Bot;
  checkoutChannelId?: string;
}

import crypto from "crypto";

/**
 * P1-4 Fix: Generate a random referral code using crypto for better randomness
 */
function generateReferralCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const randomBytes = crypto.randomBytes(6);
  let code = 'MGR_';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(randomBytes[i] % chars.length);
  }
  return code;
}

/**
 * P1-4 Fix: Create referral code with retry on unique constraint violation
 */
async function createManagerReferralCodeWithRetry(
  prisma: PrismaClient,
  managerId: number,
  maxUses: number | null,
  maxRetries = 3
): Promise<string> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const code = generateReferralCode();
    try {
      await prisma.referralCode.create({
        data: {
          code,
          createdByManagerId: managerId,
          maxUses,
        },
      });
      return code;
    } catch (error: unknown) {
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
  const { prisma, clientBot, checkoutChannelId } = deps;

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

    // REFERRAL CODE CREATION
    if (session.state === "referral:create:maxuses") {
      const maxUses = text === "/skip" ? null : parseInt(text);
      if (text !== "/skip" && (isNaN(maxUses!) || maxUses! < 1)) {
        await ctx.reply(ManagerTexts.invalidNumber());
        return;
      }

      // P1-4 Fix: Use retry mechanism for referral code creation
      const code = await createManagerReferralCodeWithRetry(prisma, manager.id, maxUses);

      managerSessions.delete(ctx.from.id);
      await ctx.reply(ManagerTexts.referralCodeCreated(code), {
        parse_mode: "Markdown",
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
        await ctx.answerCallbackQuery(options);
      }
    };
    
    if (!manager) {
      await answerCallback({ text: ManagerTexts.notAuthorized() });
      return;
    }

    await answerCallback();

    const data = ctx.callbackQuery.data;
    const parts = data.split(":");

    // MAIN MENU
    if (data === "mgr:menu") {
      const pendingCount = await prisma.order.count({
        where: { status: OrderStatus.AWAITING_MANAGER_APPROVAL },
      });

      await ctx.editMessageText(
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
        await ctx.editMessageText(ManagerTexts.noPendingOrders(), {
          reply_markup: ManagerKeyboards.backToMenu(),
        });
        return;
      }

      const totalPages = Math.ceil(total / pageSize);
      await ctx.editMessageText(ManagerTexts.pendingOrdersHeader(), {
        reply_markup: ManagerKeyboards.orderList(orders, page, totalPages),
      });
      return;
    }

    // APPROVE ORDER - Send invite to client
    if (data.startsWith("mgr:approve:")) {
      const orderId = parseInt(parts[2]);

      const order = await prisma.order.findUnique({ 
        where: { id: orderId },
        include: { user: true },
      });
      if (!order || order.status !== OrderStatus.AWAITING_MANAGER_APPROVAL) {
        await answerCallback({ text: ManagerTexts.orderNotFound(), show_alert: true });
        return;
      }

      // P0-2 Fix: Require checkoutChannelId to be configured before approval
      if (!checkoutChannelId) {
        await answerCallback({ 
          text: "امکان تأیید نیست: CHECKOUT_CHANNEL_ID تنظیم نشده است.", 
          show_alert: true 
        });
        return;
      }

      // Update order status to APPROVED first (worker will create invite)
      // If no worker is running, we create the invite inline
      await prisma.order.update({
        where: { id: orderId },
        data: {
          status: OrderStatus.APPROVED,
          events: {
            create: {
              actorType: "manager",
              actorId: manager.id,
              eventType: "order_approved",
            },
          },
        },
      });

      // Try to create invite link directly using the bot API
      let inviteLink: string | null = null;
      try {
        if (clientBot) {
          const result = await clientBot.api.createChatInviteLink(checkoutChannelId, {
            member_limit: 1,
            name: `Order #${orderId}`,
          });
          inviteLink = result.invite_link;
        }
      } catch (error) {
        console.error("Failed to create invite link:", error);
        // Fallback: use channel ID as link if we can't create one
        inviteLink = `https://t.me/${checkoutChannelId.replace('@', '')}`;
      }

      // Update order with invite link and status
      await prisma.order.update({
        where: { id: orderId },
        data: {
          status: OrderStatus.INVITE_SENT,
          inviteLink,
          inviteSentAt: new Date(),
          events: {
            create: {
              actorType: "manager",
              actorId: manager.id,
              eventType: "invite_sent",
            },
          },
        },
      });

      // Send message to client via client bot
      if (clientBot && order.user && inviteLink) {
        try {
          await clientBot.api.sendMessage(
            order.user.tgUserId.toString(),
            ClientTexts.orderApprovedWithInvite(orderId, inviteLink),
            { parse_mode: "Markdown" }
          );
          await answerCallback({ 
            text: ManagerTexts.orderApprovedInviteSent(orderId, order.user.tgUserId),
            show_alert: true,
          });
        } catch (error) {
          console.error("Failed to send invite to client:", error);
          await answerCallback({ 
            text: ManagerTexts.inviteSendFailed(orderId),
            show_alert: true,
          });
        }
      } else {
        await answerCallback({ 
          text: ManagerTexts.orderApproved(orderId),
          show_alert: true,
        });
      }

      // Refresh order list
      const orders = await prisma.order.findMany({
        where: { status: OrderStatus.AWAITING_MANAGER_APPROVAL },
        orderBy: { id: "asc" },
        take: 5,
      });

      if (orders.length === 0) {
        await ctx.editMessageText(ManagerTexts.noPendingOrders(), {
          reply_markup: ManagerKeyboards.backToMenu(),
        });
      } else {
        await ctx.editMessageText(ManagerTexts.pendingOrdersHeader(), {
          reply_markup: ManagerKeyboards.orderList(orders, 0, 1),
        });
      }
      return;
    }

    // REJECT ORDER
    if (data.startsWith("mgr:reject:")) {
      const orderId = parseInt(parts[2]);

      const order = await prisma.order.findUnique({ where: { id: orderId } });
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
        await ctx.editMessageText(ManagerTexts.noPendingOrders(), {
          reply_markup: ManagerKeyboards.backToMenu(),
        });
      } else {
        await ctx.editMessageText(ManagerTexts.pendingOrdersHeader(), {
          reply_markup: ManagerKeyboards.orderList(orders, 0, 1),
        });
      }
      return;
    }

    // ===========================================
    // PRODUCTS
    // ===========================================
    if (data === "mgr:products") {
      await ctx.editMessageText(ManagerTexts.productsMenuTitle(), {
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
        await ctx.editMessageText(ManagerTexts.noProducts(), {
          reply_markup: ManagerKeyboards.backToMenu(),
        });
        return;
      }

      const totalPages = Math.ceil(total / pageSize);
      await ctx.editMessageText(ManagerTexts.productListTitle(), {
        parse_mode: "Markdown",
        reply_markup: ManagerKeyboards.productList(products, page, totalPages),
      });
      return;
    }

    if (data === "mgr:products:add") {
      managerSessions.set(ctx.from.id, { state: "product:add:title", data: {} });
      await ctx.editMessageText(ManagerTexts.enterProductTitle());
      return;
    }

    if (data.startsWith("mgr:product:edit:") && parts.length === 4) {
      const productId = parseInt(parts[3]);
      const product = await prisma.product.findUnique({ where: { id: productId } });

      if (!product) {
        await ctx.answerCallbackQuery({ text: "محصول یافت نشد" });
        return;
      }

      const text = `*ویرایش محصول: ${product.title}*\n\n` +
        `📝 عنوان: ${product.title}\n` +
        `📄 توضیحات: ${product.description || '—'}\n` +
        `💰 قیمت: ${product.price} ${product.currency}\n` +
        `📦 موجودی: ${product.stock ?? 'نامحدود'}\n` +
        `🖼️ تصویر: ${product.photoFileId ? 'دارد' : 'ندارد'}\n` +
        `وضعیت: ${product.isActive ? '✅ فعال' : '❌ غیرفعال'}`;

      await ctx.editMessageText(text, {
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
        const text = `*ویرایش محصول: ${product!.title}*\n\n` +
          `📝 عنوان: ${product!.title}\n` +
          `📄 توضیحات: ${product!.description || '—'}\n` +
          `💰 قیمت: ${product!.price} ${product!.currency}\n` +
          `📦 موجودی: ${product!.stock ?? 'نامحدود'}\n` +
          `🖼️ تصویر: ندارد\n` +
          `وضعیت: ${product!.isActive ? '✅ فعال' : '❌ غیرفعال'}`;

        await ctx.editMessageText(text, {
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

      if (field === "title") await ctx.editMessageText(ManagerTexts.enterProductTitle());
      else if (field === "desc") await ctx.editMessageText(ManagerTexts.enterProductDescription());
      else if (field === "price") await ctx.editMessageText(ManagerTexts.enterProductPrice());
      else if (field === "stock") await ctx.editMessageText(ManagerTexts.enterProductStock());
      else if (field === "image") await ctx.editMessageText(ManagerTexts.sendProductImage());
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
      const text = `*ویرایش محصول: ${updated!.title}*\n\n` +
        `📝 عنوان: ${updated!.title}\n` +
        `📄 توضیحات: ${updated!.description || '—'}\n` +
        `💰 قیمت: ${updated!.price} ${updated!.currency}\n` +
        `📦 موجودی: ${updated!.stock ?? 'نامحدود'}\n` +
        `🖼️ تصویر: ${updated!.photoFileId ? 'دارد' : 'ندارد'}\n` +
        `وضعیت: ${updated!.isActive ? '✅ فعال' : '❌ غیرفعال'}`;

      await ctx.editMessageText(text, {
        parse_mode: "Markdown",
        reply_markup: ManagerKeyboards.productEdit(productId, !!updated!.photoFileId),
      });
      return;
    }

    // ===========================================
    // USERS
    // ===========================================
    if (data === "mgr:users") {
      await ctx.editMessageText(ManagerTexts.usersMenuTitle(), {
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
        await ctx.editMessageText(ManagerTexts.noUsers(), {
          reply_markup: ManagerKeyboards.backToMenu(),
        });
        return;
      }

      const totalPages = Math.ceil(total / pageSize);
      await ctx.editMessageText(ManagerTexts.userListTitle(), {
        parse_mode: "Markdown",
        reply_markup: ManagerKeyboards.userList(users, page, totalPages),
      });
      return;
    }

    if (data === "mgr:users:search") {
      managerSessions.set(ctx.from.id, { state: "user:search" });
      await ctx.editMessageText(ManagerTexts.enterSearchQuery());
      return;
    }

    if (data.startsWith("mgr:user:") && parts[2] !== "toggle" && parts[2] !== "orders" && parts[2] !== "referrals") {
      const userId = parseInt(parts[2]);
      const user = await prisma.user.findUnique({ where: { id: userId } });

      if (!user) {
        await answerCallback({ text: "کاربر یافت نشد" });
        return;
      }

      const orderCount = await prisma.order.count({ where: { userId } });

      await ctx.editMessageText(
        ManagerTexts.userDetails(user.id, user.username, user.isActive, orderCount),
        {
          parse_mode: "Markdown",
          reply_markup: ManagerKeyboards.userActions(userId, user.isActive),
        }
      );
      return;
    }

    if (data.startsWith("mgr:user:toggle:")) {
      const userId = parseInt(parts[3]);
      const user = await prisma.user.findUnique({ where: { id: userId } });

      if (!user) {
        await ctx.answerCallbackQuery({ text: "کاربر یافت نشد" });
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

      await ctx.editMessageText(
        ManagerTexts.userDetails(updated!.id, updated!.username, updated!.isActive, orderCount),
        {
          parse_mode: "Markdown",
          reply_markup: ManagerKeyboards.userActions(userId, updated!.isActive),
        }
      );
      return;
    }

    // ===========================================
    // REFERRALS
    // ===========================================
    if (data === "mgr:referrals") {
      await ctx.editMessageText(ManagerTexts.referralsMenuTitle(), {
        parse_mode: "Markdown",
        reply_markup: ManagerKeyboards.referralManagement(),
      });
      return;
    }

    if (data === "mgr:referrals:create") {
      managerSessions.set(ctx.from.id, { state: "referral:create:maxuses" });
      await ctx.editMessageText(ManagerTexts.enterReferralMaxUses());
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
        await ctx.editMessageText(ManagerTexts.noReferralCodes(), {
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

      await ctx.editMessageText(text, {
        parse_mode: "Markdown",
        reply_markup: ManagerKeyboards.backToMenu(),
      });
      return;
    }

    // ===========================================
    // ANALYTICS
    // ===========================================
    if (data === "mgr:analytics") {
      await ctx.editMessageText(ManagerTexts.analyticsMenuTitle(), {
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

      await ctx.editMessageText(
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

      await ctx.editMessageText(
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

      await ctx.editMessageText(
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

      await ctx.editMessageText(
        ManagerTexts.referralAnalytics(
          totalCodes,
          totalUses,
          topReferrer?.createdByUser?.username || null
        ),
        {
          parse_mode: "Markdown",
          reply_markup: ManagerKeyboards.backToMenu(),
        }
      );
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
        await ctx.editMessageText(ManagerTexts.noPendingReceipts(), {
          reply_markup: ManagerKeyboards.backToMenu(),
        });
        return;
      }

      const totalPages = Math.ceil(total / pageSize);
      await ctx.editMessageText(ManagerTexts.pendingReceiptsTitle(), {
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

      // Send receipt image
      await ctx.deleteMessage();
      await ctx.replyWithPhoto(receipt.fileId, {
        caption: text,
        parse_mode: "Markdown",
        reply_markup: ManagerKeyboards.receiptActions(receiptId),
      });
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

      // Update receipt and order status
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
            status: OrderStatus.COMPLETED,
            events: {
              create: {
                actorType: "manager",
                actorId: manager.id,
                eventType: "receipt_approved_order_completed",
              },
            },
          },
        }),
      ]);

      // Notify client
      if (clientBot && receipt.order.user) {
        try {
          await clientBot.api.sendMessage(
            receipt.order.user.tgUserId.toString(),
            ClientTexts.receiptApproved(receipt.orderId)
          );
        } catch (error) {
          console.error("Failed to notify client of receipt approval:", error);
        }
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
      await ctx.reply(ManagerTexts.enterRejectReason());
      return;
    }

    // HELP
    if (data === "mgr:help") {
      await ctx.editMessageText(ManagerTexts.helpMessage(), {
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

  // Handle receipt rejection reason text
  bot.on("message:text", async (ctx) => {
    const manager = await getManager(ctx, prisma);
    if (!manager) return;

    const session = managerSessions.get(ctx.from.id);
    if (session?.state === "receipt:reject:reason") {
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

      // Update receipt status but keep order in INVITE_SENT so user can send new receipt
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
            status: OrderStatus.INVITE_SENT, // Back to invite_sent so user can try again
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

      // Notify client
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
    }
  });
}
