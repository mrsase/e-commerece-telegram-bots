import { CartState } from "@prisma/client";
import type { PrismaClient, User } from "@prisma/client";
import {
  OrderService,
  InsufficientStockError,
} from "../../services/order-service.js";
import { ClientTexts } from "../../i18n/index.js";

export interface ClientContext {
  from?: {
    id: number;
    username?: string;
    first_name?: string;
    last_name?: string;
  };
  message?: {
    text?: string;
  };
  reply(text: string, options?: { parse_mode?: string }): Promise<unknown> | unknown;
}

export interface ClientCommandBot {
  command(
    command: string,
    handler: (ctx: ClientContext) => Promise<void> | void,
  ): void;
}

export interface ClientBotDeps {
  prisma: PrismaClient;
}

function buildReferralCode(tgUserId: number): string {
  return `TSU_${tgUserId.toString()}`;
}

async function ensureUser(
  ctx: ClientContext,
  prisma: PrismaClient,
): Promise<User | undefined> {
  const from = ctx.from;
  if (!from) {
    return undefined;
  }

  const tgUserId = BigInt(from.id);

  return prisma.user.upsert({
    where: { tgUserId },
    update: {
      username: from.username,
      firstName: from.first_name,
      lastName: from.last_name,
    },
    create: {
      tgUserId,
      username: from.username,
      firstName: from.first_name,
      lastName: from.last_name,
      referralCode: buildReferralCode(from.id),
    },
  });
}

export function registerClientBotHandlers(
  bot: ClientCommandBot,
  deps: ClientBotDeps,
): void {
  const { prisma } = deps;

  bot.command("start", async (ctx) => {
    await ensureUser(ctx, prisma);

    await ctx.reply(ClientTexts.welcome());
  });

  bot.command("products", async (ctx) => {
    await ensureUser(ctx, prisma);

    const products = await prisma.product.findMany({
      where: { isActive: true },
      // Show newest products first so the most recently created test product is always included
      orderBy: { id: "desc" },
      take: 10,
    });

    if (products.length === 0) {
      await ctx.reply(ClientTexts.noProductsAvailable());
      return;
    }

    const lines = products.map((p) => ClientTexts.productLine(p.title, p.price, p.currency));

    await ctx.reply([ClientTexts.productsHeader(), ...lines].join("\n"));
  });

  bot.command("add", async (ctx) => {
    const user = await ensureUser(ctx, prisma);
    if (!user) {
      await ctx.reply(ClientTexts.unableToIdentify());
      return;
    }

    const text = ctx.message?.text ?? "";
    const parts = text.trim().split(/\s+/);
    // Expect "/add <productId> <qty>"
    if (parts.length < 3) {
      await ctx.reply(ClientTexts.addUsage());
      return;
    }

    const productId = Number(parts[1]);
    const qty = Number(parts[2]);

    if (!Number.isFinite(productId) || productId <= 0 || !Number.isFinite(qty) || qty <= 0) {
      await ctx.reply(ClientTexts.addUsage());
      return;
    }

    const product = await prisma.product.findFirst({
      where: { id: productId, isActive: true },
    });

    if (!product) {
      await ctx.reply(ClientTexts.productNotFound());
      return;
    }

    let cart = await prisma.cart.findFirst({
      where: { userId: user.id, state: CartState.ACTIVE },
    });

    if (!cart) {
      cart = await prisma.cart.create({
        data: {
          userId: user.id,
        },
      });
    }

    const existingItem = await prisma.cartItem.findFirst({
      where: { cartId: cart.id, productId: product.id },
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
          productId: product.id,
          qty,
          unitPriceSnapshot: product.price,
        },
      });
    }

    await ctx.reply(ClientTexts.addedToCart(product.title, qty));
  });

  bot.command("remove", async (ctx) => {
    const user = await ensureUser(ctx, prisma);
    if (!user) {
      await ctx.reply(ClientTexts.unableToIdentify());
      return;
    }

    const text = ctx.message?.text ?? "";
    const parts = text.trim().split(/\s+/);
    // Expect "/remove <productId>"
    if (parts.length < 2) {
      await ctx.reply(ClientTexts.removeUsage());
      return;
    }

    const productId = Number(parts[1]);
    if (!Number.isFinite(productId) || productId <= 0) {
      await ctx.reply(ClientTexts.removeUsage());
      return;
    }

    const cart = await prisma.cart.findFirst({
      where: { userId: user.id, state: CartState.ACTIVE },
    });

    if (!cart) {
      await ctx.reply(ClientTexts.cartEmpty());
      return;
    }

    const item = await prisma.cartItem.findFirst({
      where: { cartId: cart.id, productId },
    });

    if (!item) {
      await ctx.reply(ClientTexts.productNotInCart());
      return;
    }

    await prisma.cartItem.delete({ where: { id: item.id } });

    const product = await prisma.product.findUnique({ where: { id: productId } });
    const title = product?.title ?? `محصول ${productId}`;

    await ctx.reply(ClientTexts.removedFromCart(title));
  });

  bot.command("cart", async (ctx) => {
    const user = await ensureUser(ctx, prisma);
    if (!user) {
      await ctx.reply(ClientTexts.cartEmpty());
      return;
    }

    const cart = await prisma.cart.findFirst({
      where: { userId: user.id, state: CartState.ACTIVE },
      include: {
        items: {
          include: {
            product: true,
          },
        },
      },
    });

    if (!cart || cart.items.length === 0) {
      await ctx.reply(ClientTexts.cartEmpty());
      return;
    }

    const lines = cart.items.map((item) => {
      const lineTotal = item.qty * item.unitPriceSnapshot;
      const currency = item.product.currency;
      return ClientTexts.cartItemLine(item.product.title, item.qty, lineTotal, currency);
    });

    const subtotal = cart.items.reduce(
      (sum, item) => sum + item.qty * item.unitPriceSnapshot,
      0,
    );

    await ctx.reply([
      ClientTexts.cartHeader(),
      ...lines,
      "",
      ClientTexts.cartSubtotal(subtotal),
    ].join("\n"));
  });

  bot.command("checkout", async (ctx) => {
    const user = await ensureUser(ctx, prisma);
    if (!user) {
      await ctx.reply(ClientTexts.unableToIdentify());
      return;
    }

    const cart = await prisma.cart.findFirst({
      where: { userId: user.id, state: CartState.ACTIVE },
      include: { items: true },
    });

    if (!cart || cart.items.length === 0) {
      await ctx.reply(ClientTexts.cartEmpty());
      return;
    }

    const orderService = new OrderService(prisma);

    try {
      const result = await orderService.createOrderFromCart({
        userId: user.id,
        cartId: cart.id,
        appliedDiscounts: [],
      });

      await ctx.reply(ClientTexts.orderSubmitted(result.orderId, result.grandTotal));
    } catch (error) {
      if (error instanceof InsufficientStockError) {
        await ctx.reply(ClientTexts.outOfStock());
        return;
      }

      await ctx.reply(ClientTexts.checkoutError());
    }
  });

  bot.command("help", async (ctx) => {
    await ensureUser(ctx, prisma);
    await ctx.reply(ClientTexts.helpMessage(), { parse_mode: "Markdown" });
  });
}
