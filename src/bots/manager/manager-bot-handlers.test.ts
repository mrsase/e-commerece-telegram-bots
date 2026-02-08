import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient, OrderStatus } from "@prisma/client";
import {
  type ManagerBotDeps,
  type ManagerCommandBot,
  type ManagerContext,
  registerManagerBotHandlers,
} from "./manager-bot-handlers.js";

class FakeManagerBot implements ManagerCommandBot {
  public handlers = new Map<string, (ctx: ManagerContext) => Promise<void> | void>();

  command(
    command: string,
    handler: (ctx: ManagerContext) => Promise<void> | void,
  ): void {
    this.handlers.set(command, handler);
  }

  getHandler(command: string): (ctx: ManagerContext) => Promise<void> | void {
    const handler = this.handlers.get(command);
    if (!handler) {
      throw new Error(`No handler registered for command ${command}`);
    }
    return handler;
  }
}

let prisma: PrismaClient;
let bot: FakeManagerBot;

const TEST_MANAGER_TG_ID = 8000001;
const TEST_USER_TG_ID = 8100001;

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
  const managerTg = BigInt(TEST_MANAGER_TG_ID);
  const userTg = BigInt(TEST_USER_TG_ID);

  const user = await prisma.user.findUnique({ where: { tgUserId: userTg } });

  if (user) {
    await prisma.orderEvent.deleteMany({ where: { order: { userId: user.id } } });
    await prisma.receipt.deleteMany({ where: { userId: user.id } });
    await prisma.discountUsage.deleteMany({ where: { userId: user.id } });
    await prisma.orderItem.deleteMany({ where: { order: { userId: user.id } } });
    await prisma.order.deleteMany({ where: { userId: user.id } });
    await prisma.cartItem.deleteMany({ where: { cart: { userId: user.id } } });
    await prisma.cart.deleteMany({ where: { userId: user.id } });
    await prisma.user.deleteMany({ where: { id: user.id } });
  }

  await prisma.manager.deleteMany({ where: { tgUserId: managerTg } });

  bot = new FakeManagerBot();
  const deps: ManagerBotDeps = { prisma };
  registerManagerBotHandlers(bot, deps);
});

describe("manager bot basic handlers", () => {
  it("denies access to non-manager on /start", async () => {
    const replies: string[] = [];

    const ctx: ManagerContext = {
      from: {
        id: TEST_MANAGER_TG_ID,
      },
      reply: async (text: string) => {
        replies.push(text);
      },
    };

    const handler = bot.getHandler("start");
    await handler(ctx);

    expect(replies.length).toBe(1);
    const message = replies[0];
    expect(message).toContain("اجازه");
  });

  it("greets active manager on /start with pending count", async () => {
    const managerTg = BigInt(TEST_MANAGER_TG_ID);

    await prisma.manager.create({
      data: {
        tgUserId: managerTg,
        role: "ADMIN",
        isActive: true,
      },
    });

    const replies: string[] = [];

    const ctx: ManagerContext = {
      from: {
        id: TEST_MANAGER_TG_ID,
      },
      reply: async (text: string) => {
        replies.push(text);
      },
    };

    const handler = bot.getHandler("start");
    await handler(ctx);

    expect(replies.length).toBe(1);
    const message = replies[0];
    expect(message).toContain("سلام مدیر محترم");
    expect(message).toContain("سفارش‌های در انتظار بررسی");
  });

  it.skip("shows 'No pending orders' when none exist on /pending_orders", async () => {
    const managerTg = BigInt(TEST_MANAGER_TG_ID);

    // Ensure there are no globally pending orders from other test suites
    await prisma.orderEvent.deleteMany({
      where: { order: { status: OrderStatus.AWAITING_MANAGER_APPROVAL } },
    });
    await prisma.receipt.deleteMany({
      where: { order: { status: OrderStatus.AWAITING_MANAGER_APPROVAL } },
    });
    await prisma.discountUsage.deleteMany({
      where: { order: { status: OrderStatus.AWAITING_MANAGER_APPROVAL } },
    });
    await prisma.orderItem.deleteMany({
      where: { order: { status: OrderStatus.AWAITING_MANAGER_APPROVAL } },
    });
    await prisma.order.deleteMany({
      where: { status: OrderStatus.AWAITING_MANAGER_APPROVAL },
    });

    await prisma.manager.create({
      data: {
        tgUserId: managerTg,
        role: "ADMIN",
        isActive: true,
      },
    });

    const replies: string[] = [];

    const ctx: ManagerContext = {
      from: {
        id: TEST_MANAGER_TG_ID,
      },
      reply: async (text: string) => {
        replies.push(text);
      },
    };

    const handler = bot.getHandler("pending_orders");
    await handler(ctx);

    expect(replies.length).toBe(1);
    const message = replies[0];
    expect(message).toContain("هیچ سفارشی برای بررسی وجود ندارد");
  });

  it("lists pending orders on /pending_orders", async () => {
    const managerTg = BigInt(TEST_MANAGER_TG_ID);
    const userTg = BigInt(TEST_USER_TG_ID);

    await prisma.manager.create({
      data: {
        tgUserId: managerTg,
        role: "ADMIN",
        isActive: true,
      },
    });

    const user = await prisma.user.create({
      data: {
        tgUserId: userTg,
        referralCode: `MGR_U_${TEST_USER_TG_ID}`,
      },
    });

    const product = await prisma.product.create({
      data: {
        title: "Manager Test Product",
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

    const order = await prisma.order.create({
      data: {
        userId: user.id,
        cartId: cart.id,
        subtotal: 2000,
        discountTotal: 0,
        grandTotal: 2000,
        status: OrderStatus.AWAITING_MANAGER_APPROVAL,
      },
    });

    const replies: string[] = [];

    const ctx: ManagerContext = {
      from: {
        id: TEST_MANAGER_TG_ID,
      },
      reply: async (text: string) => {
        replies.push(text);
      },
    };

    const handler = bot.getHandler("pending_orders");
    await handler(ctx);

    expect(replies.length).toBe(1);
    const message = replies[0];
    expect(message).toContain("سفارش‌های در انتظار بررسی");
    expect(message).toContain(`#${order.id}`);
    expect(message).toContain("2000");
  });

  it("approves a pending order on /approve_order", async () => {
    const managerTg = BigInt(TEST_MANAGER_TG_ID);
    const userTg = BigInt(TEST_USER_TG_ID);

    const manager = await prisma.manager.create({
      data: {
        tgUserId: managerTg,
        role: "ADMIN",
        isActive: true,
      },
    });

    const user = await prisma.user.create({
      data: {
        tgUserId: userTg,
        referralCode: `MGR_U_${TEST_USER_TG_ID}`,
      },
    });

    const product = await prisma.product.create({
      data: {
        title: "Manager Approve Product",
        price: 1500,
        currency: "IRR",
        stock: 5,
        isActive: true,
      },
    });

    const cart = await prisma.cart.create({
      data: {
        userId: user.id,
        items: {
          create: {
            productId: product.id,
            qty: 1,
            unitPriceSnapshot: 1500,
          },
        },
      },
    });

    const order = await prisma.order.create({
      data: {
        userId: user.id,
        cartId: cart.id,
        subtotal: 1500,
        discountTotal: 0,
        grandTotal: 1500,
        status: OrderStatus.AWAITING_MANAGER_APPROVAL,
      },
    });

    const replies: string[] = [];

    const ctx: ManagerContext = {
      from: {
        id: TEST_MANAGER_TG_ID,
      },
      message: {
        text: `/approve_order ${order.id}`,
      },
      reply: async (text: string) => {
        replies.push(text);
      },
    };

    const handler = bot.getHandler("approve_order");
    await handler(ctx);

    expect(replies.length).toBe(1);
    const replyMessage = replies[0];
    expect(replyMessage).toContain(`#${order.id}`);
    expect(replyMessage).toContain("تأیید");

    const updatedOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(updatedOrder.status).toBe(OrderStatus.APPROVED);

    const events = await prisma.orderEvent.findMany({ where: { orderId: order.id } });
    expect(events.length).toBe(1);
    const event = events[0];
    expect(event.eventType).toBe("order_approved");
    expect(event.actorType).toBe("manager");
    expect(event.actorId).toBe(manager.id);
  });

  it("shows an error when order does not exist on /approve_order", async () => {
    const managerTg = BigInt(TEST_MANAGER_TG_ID);

    await prisma.manager.create({
      data: {
        tgUserId: managerTg,
        role: "ADMIN",
        isActive: true,
      },
    });

    const replies: string[] = [];

    const ctx: ManagerContext = {
      from: {
        id: TEST_MANAGER_TG_ID,
      },
      message: {
        text: "/approve_order 999999",
      },
      reply: async (text: string) => {
        replies.push(text);
      },
    };

    const handler = bot.getHandler("approve_order");
    await handler(ctx);

    expect(replies.length).toBe(1);
    const message = replies[0];
    expect(message).toContain("پیدا");
  });

  it("rejects a pending order on /reject_order", async () => {
    const managerTg = BigInt(TEST_MANAGER_TG_ID);
    const userTg = BigInt(TEST_USER_TG_ID);

    const manager = await prisma.manager.create({
      data: {
        tgUserId: managerTg,
        role: "ADMIN",
        isActive: true,
      },
    });

    const user = await prisma.user.create({
      data: {
        tgUserId: userTg,
        referralCode: `MGR_U_${TEST_USER_TG_ID}`,
      },
    });

    const product = await prisma.product.create({
      data: {
        title: "Manager Reject Product",
        price: 1500,
        currency: "IRR",
        stock: 5,
        isActive: true,
      },
    });

    const cart = await prisma.cart.create({
      data: {
        userId: user.id,
        items: {
          create: {
            productId: product.id,
            qty: 1,
            unitPriceSnapshot: 1500,
          },
        },
      },
    });

    const order = await prisma.order.create({
      data: {
        userId: user.id,
        cartId: cart.id,
        subtotal: 1500,
        discountTotal: 0,
        grandTotal: 1500,
        status: OrderStatus.AWAITING_MANAGER_APPROVAL,
      },
    });

    const replies: string[] = [];

    const ctx: ManagerContext = {
      from: {
        id: TEST_MANAGER_TG_ID,
      },
      message: {
        text: `/reject_order ${order.id}`,
      },
      reply: async (text: string) => {
        replies.push(text);
      },
    };

    const handler = bot.getHandler("reject_order");
    await handler(ctx);

    expect(replies.length).toBe(1);
    const replyMessage = replies[0];
    expect(replyMessage).toContain(`#${order.id}`);
    expect(replyMessage).toContain("رد");

    const updatedOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(updatedOrder.status).toBe(OrderStatus.CANCELLED);

    const events = await prisma.orderEvent.findMany({ where: { orderId: order.id } });
    expect(events.length).toBe(1);
    const event = events[0];
    expect(event.eventType).toBe("order_rejected");
    expect(event.actorType).toBe("manager");
    expect(event.actorId).toBe(manager.id);
  });

  it("shows an error when order does not exist on /reject_order", async () => {
    const managerTg = BigInt(TEST_MANAGER_TG_ID);

    await prisma.manager.create({
      data: {
        tgUserId: managerTg,
        role: "ADMIN",
        isActive: true,
      },
    });

    const replies: string[] = [];

    const ctx: ManagerContext = {
      from: {
        id: TEST_MANAGER_TG_ID,
      },
      message: {
        text: "/reject_order 999999",
      },
      reply: async (text: string) => {
        replies.push(text);
      },
    };

    const handler = bot.getHandler("reject_order");
    await handler(ctx);

    expect(replies.length).toBe(1);
    const message = replies[0];
    expect(message).toContain("پیدا");
  });
});
