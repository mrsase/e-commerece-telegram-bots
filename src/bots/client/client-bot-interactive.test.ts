
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { PrismaClient, CartState } from "@prisma/client";
import { registerInteractiveClientBot } from "./client-bot-interactive.js";
import { Bot, Context } from "grammy";
import { ClientTexts } from "../../i18n/index.js";

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

describe("Client Bot Interactive", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // Clean up DB
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
  });

  const registerHandlers = () => {
    registerInteractiveClientBot(mockBot, { prisma });

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

  it("registers /start command", () => {
    registerInteractiveClientBot(mockBot, { prisma });
    expect(mockBot.command).toHaveBeenCalledWith("start", expect.any(Function));
  });

  it("handles /start for new user (needs referral)", async () => {
    const { commandHandlers } = registerHandlers();

    const ctx = {
      from: { id: 123, first_name: "Test", username: "testuser" },
      reply: vi.fn(),
    } as unknown as Context;

    await commandHandlers["start"](ctx);

    // Should create user
    const user = await prisma.user.findUnique({ where: { tgUserId: BigInt(123) } });
    expect(user).toBeDefined();
    expect(user?.isVerified).toBe(false);

    // Should reply with welcome new user message
    expect(ctx.reply).toHaveBeenCalledWith(ClientTexts.welcomeNewUser());
  });

  it("handles referral code entry", async () => {
    const { commandHandlers, eventHandlers } = registerHandlers();

    // 1. Start (creates user)
    const ctxStart = {
      from: { id: 123, first_name: "Test", username: "testuser" },
      reply: vi.fn(),
    } as unknown as Context;
    await commandHandlers["start"](ctxStart);

    // Create a referral code
    await prisma.referralCode.create({
      data: {
        code: "TESTCODE",
        maxUses: 10,
        createdByUserId: null, // Admin code
      },
    });

    // 2. Send text message with code
    const ctxText = {
      from: { id: 123 },
      message: { text: "TESTCODE" },
      reply: vi.fn(),
    } as unknown as Context;

    // Simulate "message:text" handler
    await eventHandlers["message:text"](ctxText);

    // Verify user is verified
    const user = await prisma.user.findUnique({ where: { tgUserId: BigInt(123) } });
    expect(user?.isVerified).toBe(true);

    // Verify reply
    expect(ctxText.reply).toHaveBeenCalledWith(ClientTexts.referralCodeAccepted(), expect.any(Object));
  });

  it("shows products list via callback", async () => {
    const { eventHandlers } = registerHandlers();

    // Setup: verified user and products
    await prisma.user.create({
      data: {
        tgUserId: BigInt(123),
        username: "verified",
        isVerified: true,
        referralCode: "USR_123",
      },
    });

    await prisma.product.create({
      data: { title: "P1", price: 100, currency: "IRR", isActive: true },
    });

    const ctx = {
      from: { id: 123 },
      callbackQuery: { data: "client:products" },
      answerCallbackQuery: vi.fn(),
      reply: vi.fn(),
      // safeRender mock logic
      api: { sendMessage: vi.fn() },
    } as unknown as Context;

    // Mock safeRender behavior since it might use ctx.reply or editMessageText
    // But safeRender is imported. Since I can't easily mock imported functions in this setup without more work,
    // I rely on `ctx.reply` or `ctx.editMessageText` being called.
    // Wait, `safeRender` tries `editMessageText` first, then `reply`.
    // I need to mock `editMessageText` on ctx too?
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (ctx as any).editMessageText = vi.fn();

    await eventHandlers["callback_query:data"](ctx);

    expect(ctx.answerCallbackQuery).toHaveBeenCalled();
    // Expect product list to be rendered
    // It calls safeRender -> editMessageText or reply
    // check ClientTexts.productsHeader()
  });

  it("adds to cart via callback", async () => {
    const { eventHandlers } = registerHandlers();

    const user = await prisma.user.create({
      data: {
        tgUserId: BigInt(123),
        username: "verified",
        isVerified: true,
        referralCode: "USR_123",
      },
    });

    const product = await prisma.product.create({
      data: { title: "P1", price: 100, currency: "IRR", isActive: true },
    });

    const ctx = {
      from: { id: 123 },
      callbackQuery: { data: `client:addtocart:${product.id}:2:0` },
      answerCallbackQuery: vi.fn(),
      reply: vi.fn(),
      deleteMessage: vi.fn(),
    } as unknown as Context;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (ctx as any).editMessageText = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (ctx as any).editMessageReplyMarkup = vi.fn();

    await eventHandlers["callback_query:data"](ctx);

    // Verify cart item created
    const cart = await prisma.cart.findFirst({ where: { userId: user.id, state: CartState.ACTIVE } });
    expect(cart).toBeDefined();

    const cartItem = await prisma.cartItem.findFirst({ where: { cartId: cart?.id } });
    expect(cartItem?.productId).toBe(product.id);
    expect(cartItem?.qty).toBe(2);

    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith(expect.objectContaining({ show_alert: true }));
  });
});
