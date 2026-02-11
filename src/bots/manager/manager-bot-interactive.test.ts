
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { PrismaClient, ManagerRole } from "@prisma/client";
import { registerInteractiveManagerBot } from "./manager-bot-interactive.js";
import { Bot, Context } from "grammy";
import { ManagerTexts } from "../../i18n/index.js";

// Mock Bot
const mockBot = {
  command: vi.fn(),
  on: vi.fn(),
  catch: vi.fn(),
  api: {
    sendMessage: vi.fn(),
    editMessageReplyMarkup: vi.fn(),
    deleteMessage: vi.fn(),
    answerCallbackQuery: vi.fn(),
  },
} as unknown as Bot;

let prisma: PrismaClient;

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

describe("Manager Bot Interactive", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await prisma.supportMessage.deleteMany();
    await prisma.supportConversation.deleteMany();
    await prisma.receipt.deleteMany();
    await prisma.delivery.deleteMany();
    await prisma.discountUsage.deleteMany();
    await prisma.cartItem.deleteMany();
    await prisma.cart.deleteMany();
    await prisma.orderEvent.deleteMany();
    await prisma.orderItem.deleteMany();
    await prisma.order.deleteMany();

    // Break circular dependency
    await prisma.user.updateMany({ data: { usedReferralCodeId: null } });
    await prisma.referralCode.deleteMany();

    await prisma.user.deleteMany();
    await prisma.product.deleteMany();
    await prisma.manager.deleteMany();
  });

  const registerHandlers = () => {
    registerInteractiveManagerBot(mockBot, { prisma });

    // Extract handlers
    // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
    const commandHandlers: Record<string, Function> = {};
    // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
    const eventHandlers: Record<string, Function> = {};

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockBot.command as any).mock.calls.forEach(([cmd, handler]: any) => {
      commandHandlers[cmd] = handler;
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockBot.on as any).mock.calls.forEach(([event, handler]: any) => {
      eventHandlers[event] = handler;
    });

    return { commandHandlers, eventHandlers };
  };

  it("checks authorization on /start", async () => {
    const { commandHandlers } = registerHandlers();

    // Unauthorized user
    const ctxUnauthorized = {
      from: { id: 999 },
      reply: vi.fn(),
    } as unknown as Context;

    await commandHandlers["start"](ctxUnauthorized);
    expect(ctxUnauthorized.reply).toHaveBeenCalledWith(ManagerTexts.notAuthorized());

    // Authorized manager
    await prisma.manager.create({
      data: {
        tgUserId: BigInt(123),
        role: ManagerRole.ADMIN,
        isActive: true,
      },
    });

    const ctxAuthorized = {
      from: { id: 123 },
      reply: vi.fn(),
    } as unknown as Context;

    await commandHandlers["start"](ctxAuthorized);
    // Should show main menu
    expect(ctxAuthorized.reply).toHaveBeenCalledWith(
      expect.stringContaining("داشبورد مدیریت"),
      expect.any(Object)
    );
  });

  it("handles product creation wizard", async () => {
    const { eventHandlers } = registerHandlers();

    await prisma.manager.create({
      data: { tgUserId: BigInt(123), role: ManagerRole.ADMIN, isActive: true },
    });

    // 1. Start wizard
    const ctxStart = {
      from: { id: 123 },
      callbackQuery: { data: "mgr:products:add" },
      answerCallbackQuery: vi.fn(),
      reply: vi.fn(),
      // safeRender mock
      api: { sendMessage: vi.fn() },
    } as unknown as Context;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (ctxStart as any).editMessageText = vi.fn();

    await eventHandlers["callback_query:data"](ctxStart);
    // Expect prompt for title

    // 2. Enter title
    const ctxTitle = {
      from: { id: 123 },
      message: { text: "New Product" },
      reply: vi.fn(),
    } as unknown as Context;

    await eventHandlers["message:text"](ctxTitle);
    // Expect prompt for description
    expect(ctxTitle.reply).toHaveBeenCalledWith(expect.stringContaining("توضیحات"));

    // 3. Enter description
    const ctxDesc = {
      from: { id: 123 },
      message: { text: "Desc" },
      reply: vi.fn(),
    } as unknown as Context;

    await eventHandlers["message:text"](ctxDesc);
    // Expect prompt for price

    // 4. Enter price
    const ctxPrice = {
      from: { id: 123 },
      message: { text: "1000" },
      reply: vi.fn(),
    } as unknown as Context;

    await eventHandlers["message:text"](ctxPrice);
    // Expect prompt for stock

    // 5. Enter stock
    const ctxStock = {
      from: { id: 123 },
      message: { text: "10" },
      reply: vi.fn(),
    } as unknown as Context;

    await eventHandlers["message:text"](ctxStock);
    // Expect prompt for image

    // 6. Send image (or skip)
    // Actually, let's simulate /skip for image since sending photo is complex to mock (needs message:photo handler)
    // Wait, the wizard says "send /skip" for image?
    // In code:
    // if (session.state === "product:add:image" && text === "/skip") { ... }

    const ctxImage = {
      from: { id: 123 },
      message: { text: "/skip" },
      reply: vi.fn(),
    } as unknown as Context;

    await eventHandlers["message:text"](ctxImage);

    // Verify product created
    const product = await prisma.product.findFirst({ where: { title: "New Product" } });
    expect(product).toBeDefined();
    expect(product?.price).toBe(1000);
    expect(product?.stock).toBe(10);
  });

  it("handles cancel in wizard", async () => {
    const { eventHandlers } = registerHandlers();

    await prisma.manager.create({
      data: { tgUserId: BigInt(123), role: ManagerRole.ADMIN, isActive: true },
    });

    // Start wizard
    const ctxStart = {
      from: { id: 123 },
      callbackQuery: { data: "mgr:products:add" },
      answerCallbackQuery: vi.fn(),
      reply: vi.fn(),
      api: { sendMessage: vi.fn() },
    } as unknown as Context;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (ctxStart as any).editMessageText = vi.fn();
    await eventHandlers["callback_query:data"](ctxStart);

    // Send /cancel
    const ctxCancel = {
      from: { id: 123 },
      message: { text: "/cancel" },
      reply: vi.fn(),
    } as unknown as Context;

    await eventHandlers["message:text"](ctxCancel);

    // Expect cancellation message
    expect(ctxCancel.reply).toHaveBeenCalledWith(ManagerTexts.actionCancelled(), expect.any(Object));

    // Verify NO product created (except unrelated ones)
    const count = await prisma.product.count();
    expect(count).toBe(0);
  });
});
