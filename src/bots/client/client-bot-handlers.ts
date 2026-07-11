import { CartState } from "@prisma/client";
import type { PrismaClient, User } from "@prisma/client";
import {
  OrderService,
  InsufficientStockError,
} from "../../services/order-service.js";
import { ClientTexts } from "../../i18n/index.js";
import { addItemToCart, PerUserMutex, ProductUnavailableForCartError } from "../../utils/cart-utils.js";
import { formatPrice } from "../../utils/format-price.js";

const cartMutex = new PerUserMutex();

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
  catch?(handler: (err: unknown) => void): void;
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

  bot.catch?.((err) => {
    console.error("Client bot handler error:", err instanceof Error ? err.message : err);
  });

  bot.command("start", async (ctx) => {
    await ensureUser(ctx, prisma);

    await ctx.reply(ClientTexts.welcome());
  });

  bot.command("products", async (ctx) => {
    await ensureUser(ctx, prisma);

    const products = await prisma.product.findMany({
      where: { isActive: true, OR: [{ stock: null }, { stock: { gt: 0 } }] },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
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

    const unlock = await cartMutex.lock(user.id);
    try {
      const text = ctx.message?.text;
      if (!text) return;

      const parts = text.trim().split(/\s+/);
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
        where: { id: productId, isActive: true, OR: [{ stock: null }, { stock: { gt: 0 } }] },
      });

      if (!product) {
        await ctx.reply(ClientTexts.productNotFound());
        return;
      }

      try {
        await addItemToCart(prisma, user.id, product.id, qty);
      } catch (error) {
        if (error instanceof ProductUnavailableForCartError) {
          await ctx.reply(ClientTexts.productUnavailable());
          return;
        }
        throw error;
      }

      await ctx.reply(ClientTexts.addedToCart(product.title, qty));
    } finally {
      unlock();
    }
  });

  bot.command("remove", async (ctx) => {
    const user = await ensureUser(ctx, prisma);
    if (!user) {
      await ctx.reply(ClientTexts.unableToIdentify());
      return;
    }

    const unlock = await cartMutex.lock(user.id);
    try {
      const text = ctx.message?.text;
      if (!text) return;

      const parts = text.trim().split(/\s+/);
      if (parts.length < 2) {
        await ctx.reply(ClientTexts.removeUsage());
        return;
      }

      const productId = Number(parts[1]);
      if (!Number.isFinite(productId)) {
        await ctx.reply(ClientTexts.removeUsage());
        return;
      }

      const cart = await prisma.cart.findFirst({
        where: { userId: user.id, state: CartState.ACTIVE },
        include: { items: { include: { product: true } } },
      });

      if (!cart) {
        await ctx.reply(ClientTexts.cartEmpty());
        return;
      }

      const item = cart.items.find((i) => i.productId === productId);
      if (!item) {
        await ctx.reply(ClientTexts.productNotInCart());
        return;
      }

      if (item.qty > 1) {
        await prisma.cartItem.update({
          where: { id: item.id },
          data: { qty: item.qty - 1 },
        });
      } else {
        await prisma.cartItem.delete({
          where: { id: item.id },
        });
      }

      await ctx.reply(ClientTexts.removedFromCart(item.product.title));
    } finally {
      unlock();
    }
  });

  bot.command("cart", async (ctx) => {
    const user = await ensureUser(ctx, prisma);
    if (!user) {
      await ctx.reply(ClientTexts.unableToIdentify());
      return;
    }

    const cart = await prisma.cart.findFirst({
      where: { userId: user.id, state: CartState.ACTIVE },
      include: {
        items: { include: { product: true } },
      },
    });

    if (!cart || cart.items.length === 0) {
      await ctx.reply(ClientTexts.cartEmpty());
      return;
    }

    const lines = cart.items.map(
      (item) => `• ${item.product.title} — ${item.qty} × ${item.unitPriceSnapshot} = ${formatPrice(item.qty * item.unitPriceSnapshot)}`,
    );

    await ctx.reply([ClientTexts.cartHeader(), ...lines].join("\n"));
  });

  bot.command("checkout", async (ctx) => {
    const user = await ensureUser(ctx, prisma);
    if (!user) {
      await ctx.reply(ClientTexts.unableToIdentify());
      return;
    }

    try {
      const cart = await prisma.cart.findFirst({
        where: { userId: user.id, state: CartState.ACTIVE },
        include: { items: { include: { product: true } } },
      });

      if (!cart || cart.items.length === 0) {
        await ctx.reply(ClientTexts.cartEmpty());
        return;
      }

      const orderService = new OrderService(prisma);

      const result = await orderService.createOrderFromCart({
        userId: user.id,
        cartId: cart.id,
        appliedDiscounts: [],
      });

      await ctx.reply(
        ClientTexts.orderSubmitted(result.orderId, result.grandTotal),
      );
    } catch (error) {
      if (error instanceof InsufficientStockError) {
        await ctx.reply(ClientTexts.outOfStock());
        return;
      }
      await ctx.reply(ClientTexts.checkoutError());
    }
  });

  bot.command("help", async (ctx) => {
    await ctx.reply(ClientTexts.helpMessage());
  });
}
