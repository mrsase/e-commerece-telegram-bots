import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { OrderStatus, PrismaClient } from "@prisma/client";
import { processSendInvitesBatch } from "./send-invites.worker.js";

/**
 * Minimal fake that implements the subset of grammy's Api used by the worker.
 */
function createFakeBotApi() {
  const calls = {
    sendMessage: [] as Array<{ chatId: string | number; text: string }>,
    sendPhoto: [] as Array<{ chatId: string | number; photo: string }>,
    createChatInviteLink: [] as Array<{ chatId: string | number }>,
  };

  const api = {
    sendMessage: async (chatId: string | number, text: string) => {
      calls.sendMessage.push({ chatId, text });
      return { message_id: 100 + calls.sendMessage.length };
    },
    sendPhoto: async (chatId: string | number, photo: string) => {
      calls.sendPhoto.push({ chatId, photo });
      return { message_id: 200 + calls.sendPhoto.length };
    },
    createChatInviteLink: async (chatId: string | number) => {
      calls.createChatInviteLink.push({ chatId });
      return { invite_link: "https://t.me/+jobInvite" };
    },
  };

  return { api: api as never, calls };
}

let prisma: PrismaClient;
let userId: number;

const TEST_USER_TG_ID = 9100001;

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
  const tgUserId = BigInt(TEST_USER_TG_ID);

  const user = await prisma.user.upsert({
    where: { tgUserId },
    update: {
      referralCode: "INVITE_JOB_USER",
    },
    create: {
      tgUserId,
      referralCode: "INVITE_JOB_USER",
    },
  });

  userId = user.id;

  await prisma.orderEvent.deleteMany({ where: { order: { userId } } });
  await prisma.receipt.deleteMany({ where: { userId } });
  await prisma.discountUsage.deleteMany({ where: { userId } });
  await prisma.orderItem.deleteMany({ where: { order: { userId } } });
  await prisma.order.deleteMany({ where: { userId } });
  await prisma.cartItem.deleteMany({ where: { cart: { userId } } });
  await prisma.cart.deleteMany({ where: { userId } });
  await prisma.product.deleteMany({ where: { title: "Send Invites Job Product" } });
});

async function createApprovedOrder(): Promise<{ orderId: number }> {
  const product = await prisma.product.create({
    data: {
      title: "Send Invites Job Product",
      price: 1000,
      currency: "IRR",
      stock: 10,
      isActive: true,
    },
  });

  const cart = await prisma.cart.create({
    data: {
      userId,
      items: {
        create: [
          {
            productId: product.id,
            qty: 1,
            unitPriceSnapshot: 1000,
          },
        ],
      },
    },
  });

  const order = await prisma.order.create({
    data: {
      userId,
      cartId: cart.id,
      subtotal: 1000,
      discountTotal: 0,
      grandTotal: 1000,
      status: OrderStatus.APPROVED,
    },
  });

  return { orderId: order.id };
}

describe("send_invites worker", () => {
  it("processes approved orders without invites and sends notifications", async () => {
    const { orderId } = await createApprovedOrder();
    const { api, calls } = createFakeBotApi();

    const processedCount = await processSendInvitesBatch(
      {
        prisma,
        botApi: api,
        checkoutChannelId: "@checkout_channel_jobs",
        inviteExpiryMinutes: 60,
      },
      { onlyUserIds: [userId] },
    );

    expect(processedCount).toBe(1);

    // Should have posted a text message to channel (no image file id)
    expect(calls.sendMessage.length).toBeGreaterThanOrEqual(1);
    const channelMsg = calls.sendMessage.find((m) => m.chatId === "@checkout_channel_jobs");
    expect(channelMsg).toBeDefined();

    // Should have created an invite link
    expect(calls.createChatInviteLink).toHaveLength(1);
    expect(calls.createChatInviteLink[0]?.chatId).toBe("@checkout_channel_jobs");

    // Should have notified the client
    const clientMsg = calls.sendMessage.find((m) => m.chatId === BigInt(TEST_USER_TG_ID).toString());
    expect(clientMsg).toBeDefined();
    expect(clientMsg!.text).toContain(`#${orderId.toString()}`);

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe(OrderStatus.INVITE_SENT);
    expect(order.inviteLink).toBe("https://t.me/+jobInvite");
    expect(order.channelMessageId).toBeTruthy();
    expect(order.inviteExpiresAt).toBeTruthy();

    const events = await prisma.orderEvent.findMany({ where: { orderId } });
    expect(events.length).toBe(1);
    expect(events[0]?.eventType).toBe("invite_sent");
  });

  it("skips orders that already have invites", async () => {
    const { orderId } = await createApprovedOrder();
    const { api, calls } = createFakeBotApi();

    await prisma.order.update({
      where: { id: orderId },
      data: {
        inviteLink: "https://t.me/+existingJobInvite",
        inviteSentAt: new Date("2024-01-01T00:00:00Z"),
        status: OrderStatus.INVITE_SENT,
      },
    });

    const processedCount = await processSendInvitesBatch(
      {
        prisma,
        botApi: api,
        checkoutChannelId: "@checkout_channel_jobs",
        inviteExpiryMinutes: 60,
      },
      { onlyUserIds: [userId] },
    );

    expect(processedCount).toBe(0);
    expect(calls.createChatInviteLink).toHaveLength(0);
    expect(calls.sendMessage).toHaveLength(0);
  });
});
