import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  type ClientBotDeps,
  type ClientCommandBot,
  type ClientContext,
  registerClientBotHandlers,
} from "./client-bot-handlers.js";

class FakeBot implements ClientCommandBot {
  public handlers = new Map<string, (ctx: ClientContext) => Promise<void> | void>();

  command(
    command: string,
    handler: (ctx: ClientContext) => Promise<void> | void,
  ): void {
    this.handlers.set(command, handler);
  }

  getHandler(command: string): (ctx: ClientContext) => Promise<void> | void {
    const handler = this.handlers.get(command);
    if (!handler) {
      throw new Error(`No handler registered for command ${command}`);
    }
    return handler;
  }
}

let prisma: PrismaClient;
let bot: FakeBot;

const TEST_TG_USER_ID = 7000001;
const TEST_PRODUCT_TITLE = "Client Bot Test Product";

beforeAll(async () => {
  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL = "file:./dev.db";
  }

  prisma = new PrismaClient();
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  const tgUserIdBigInt = BigInt(TEST_TG_USER_ID);

  const existingUser = await prisma.user.findUnique({
    where: { tgUserId: tgUserIdBigInt },
  });

  if (existingUser) {
    await prisma.orderEvent.deleteMany({ where: { order: { userId: existingUser.id } } });
    await prisma.orderItem.deleteMany({ where: { order: { userId: existingUser.id } } });
    await prisma.order.deleteMany({ where: { userId: existingUser.id } });
    await prisma.cartItem.deleteMany({ where: { cart: { userId: existingUser.id } } });
    await prisma.cart.deleteMany({ where: { userId: existingUser.id } });
  }

  await prisma.product.deleteMany({ where: { title: TEST_PRODUCT_TITLE } });

  bot = new FakeBot();
  const deps: ClientBotDeps = { prisma };
  registerClientBotHandlers(bot, deps);
});

describe("client bot basic handlers", () => {
  it("upserts user and replies on /start", async () => {
    const replies: string[] = [];

    const ctx: ClientContext = {
      from: {
        id: TEST_TG_USER_ID,
        username: "client_test",
        first_name: "Client",
        last_name: "User",
      },
      reply: async (text: string) => {
        replies.push(text);
      },
    };

    const handler = bot.getHandler("start");
    await handler(ctx);

    expect(replies.length).toBe(1);
    expect(replies[0]).toContain("به فروشگاه آموز خوش آمدید");

    const user = await prisma.user.findUniqueOrThrow({
      where: { tgUserId: BigInt(TEST_TG_USER_ID) },
    });

    expect(user.username).toBe("client_test");
    expect(user.firstName).toBe("Client");
  });

  it("lists active products on /products", async () => {
    await prisma.product.create({
      data: {
        title: TEST_PRODUCT_TITLE,
        price: 1000,
        currency: "IRR",
        stock: 10,
        isActive: true,
      },
    });

    const replies: string[] = [];

    const ctx: ClientContext = {
      from: {
        id: TEST_TG_USER_ID,
      },
      reply: async (text: string) => {
        replies.push(text);
      },
    };

    const handler = bot.getHandler("products");
    await handler(ctx);

    expect(replies.length).toBe(1);
    const message = replies[0];
    expect(message).toContain("محصولات موجود:");
    expect(message).toContain(TEST_PRODUCT_TITLE);
  });

  it("shows a friendly message when cart is empty on /cart", async () => {
    const replies: string[] = [];

    const ctx: ClientContext = {
      from: {
        id: TEST_TG_USER_ID,
      },
      reply: async (text: string) => {
        replies.push(text);
      },
    };

    const handler = bot.getHandler("cart");
    await handler(ctx);

    expect(replies.length).toBe(1);
    const message = replies[0];
    expect(message).toContain("سبد خرید");
    expect(message).toContain("خالی");
  });

  it("shows cart contents with items on /cart", async () => {
    const tgUserIdBigInt = BigInt(TEST_TG_USER_ID);

    const user = await prisma.user.upsert({
      where: { tgUserId: tgUserIdBigInt },
      update: {},
      create: {
        tgUserId: tgUserIdBigInt,
        referralCode: `TSU_${TEST_TG_USER_ID}`,
      },
    });

    const product = await prisma.product.create({
      data: {
        title: TEST_PRODUCT_TITLE,
        price: 1000,
        currency: "IRR",
        stock: 10,
        isActive: true,
      },
    });

    await prisma.cart.create({
      data: {
        userId: user.id,
        items: {
          create: {
            productId: product.id,
            qty: 2,
            unitPriceSnapshot: 1000,
          },
        },
      },
    });

    const replies: string[] = [];

    const ctx: ClientContext = {
      from: {
        id: TEST_TG_USER_ID,
      },
      reply: async (text: string) => {
        replies.push(text);
      },
    };

    const handler = bot.getHandler("cart");
    await handler(ctx);

    expect(replies.length).toBe(1);
    const message = replies[0];
    expect(message).toContain("سبد خرید شما:");
    expect(message).toContain(TEST_PRODUCT_TITLE);
    expect(message).toContain("2");
    expect(message).toContain("2000");
  });

  it("adds an item to cart on /add", async () => {
    const product = await prisma.product.create({
      data: {
        title: TEST_PRODUCT_TITLE,
        price: 1000,
        currency: "IRR",
        stock: 10,
        isActive: true,
      },
    });

    const replies: string[] = [];

    const ctx: ClientContext = {
      from: {
        id: TEST_TG_USER_ID,
      },
      message: {
        text: `/add ${product.id} 2`,
      },
      reply: async (text: string) => {
        replies.push(text);
      },
    };

    const handler = bot.getHandler("add");
    await handler(ctx);

    expect(replies.length).toBe(1);
    const message = replies[0];
    expect(message).toContain("به سبد خرید اضافه شد");
    expect(message).toContain(TEST_PRODUCT_TITLE);

    const tgUserIdBigInt = BigInt(TEST_TG_USER_ID);
    const user = await prisma.user.findUniqueOrThrow({
      where: { tgUserId: tgUserIdBigInt },
    });

    const carts = await prisma.cart.findMany({
      where: { userId: user.id },
      include: { items: true },
    });

    expect(carts.length).toBe(1);
    const cart = carts[0];
    expect(cart?.items.length).toBe(1);
    expect(cart?.items[0]?.qty).toBe(2);
  });

  it("removes an item from cart on /remove", async () => {
    const tgUserIdBigInt = BigInt(TEST_TG_USER_ID);

    const user = await prisma.user.upsert({
      where: { tgUserId: tgUserIdBigInt },
      update: {},
      create: {
        tgUserId: tgUserIdBigInt,
        referralCode: `TSU_${TEST_TG_USER_ID}`,
      },
    });

    const product = await prisma.product.create({
      data: {
        title: TEST_PRODUCT_TITLE,
        price: 1000,
        currency: "IRR",
        stock: 10,
        isActive: true,
      },
    });

    await prisma.cart.create({
      data: {
        userId: user.id,
        items: {
          create: {
            productId: product.id,
            qty: 1,
            unitPriceSnapshot: 1000,
          },
        },
      },
    });

    const replies: string[] = [];

    const ctx: ClientContext = {
      from: {
        id: TEST_TG_USER_ID,
      },
      message: {
        text: `/remove ${product.id}`,
      },
      reply: async (text: string) => {
        replies.push(text);
      },
    };

    const handler = bot.getHandler("remove");
    await handler(ctx);

    expect(replies.length).toBe(1);
    const message = replies[0];
    expect(message).toContain("از سبد خرید حذف شد");
    expect(message).toContain(TEST_PRODUCT_TITLE);

    const carts = await prisma.cart.findMany({
      where: { userId: user.id },
      include: { items: true },
    });

    expect(carts.length).toBe(1);
    const updatedCart = carts[0];
    expect(updatedCart?.items.length).toBe(0);
  });

  it("does not checkout when cart is empty on /checkout", async () => {
    const replies: string[] = [];

    const ctx: ClientContext = {
      from: {
        id: TEST_TG_USER_ID,
      },
      message: {
        text: "/checkout",
      },
      reply: async (text: string) => {
        replies.push(text);
      },
    };

    const handler = bot.getHandler("checkout");
    await handler(ctx);

    expect(replies.length).toBe(1);
    const message = replies[0];
    expect(message).toContain("سبد خرید");
    expect(message).toContain("خالی");
  });

  it("creates an order and submits cart on /checkout", async () => {
    const tgUserIdBigInt = BigInt(TEST_TG_USER_ID);

    const user = await prisma.user.upsert({
      where: { tgUserId: tgUserIdBigInt },
      update: {},
      create: {
        tgUserId: tgUserIdBigInt,
        referralCode: `TSU_${TEST_TG_USER_ID}`,
      },
    });

    const product = await prisma.product.create({
      data: {
        title: TEST_PRODUCT_TITLE,
        price: 1000,
        currency: "IRR",
        stock: 10,
        isActive: true,
      },
    });

    const cart = await prisma.cart.create({
      data: {
        userId: user.id,
        items: {
          create: {
            productId: product.id,
            qty: 2,
            unitPriceSnapshot: 1000,
          },
        },
      },
    });

    const replies: string[] = [];

    const ctx: ClientContext = {
      from: {
        id: TEST_TG_USER_ID,
      },
      message: {
        text: "/checkout",
      },
      reply: async (text: string) => {
        replies.push(text);
      },
    };

    const handler = bot.getHandler("checkout");
    await handler(ctx);

    expect(replies.length).toBe(1);
    const replyMessage = replies[0];
    expect(replyMessage).toContain("سفارش شما ثبت شد");

    const orders = await prisma.order.findMany({
      where: { userId: user.id, cartId: cart.id },
      include: { items: true },
    });

    expect(orders.length).toBe(1);
    const order = orders[0];
    expect(order?.items.length).toBe(1);
    expect(order?.items[0]?.qty).toBe(2);

    const updatedCart = await prisma.cart.findUniqueOrThrow({ where: { id: cart.id } });
    expect(updatedCart.state).toBe("SUBMITTED");
  });
});
