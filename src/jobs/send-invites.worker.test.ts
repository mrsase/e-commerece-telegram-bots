import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { OrderStatus, PrismaClient } from "@prisma/client";
import {
  InviteService,
  type TelegramInviteClient,
} from "../services/invite-service.js";
import {
  processSendInvitesBatch,
  type TelegramNotificationClient,
} from "./send-invites.worker.js";

class FakeTelegramInviteClient implements TelegramInviteClient {
  public calls: { chatId: string }[] = [];

  constructor(private readonly link: string = "https://t.me/+jobInvite") {}

  async createInviteLink(args: { chatId: string }): Promise<{ inviteLink: string }> {
    this.calls.push({ chatId: args.chatId });
    return { inviteLink: this.link };
  }
}

class FakeNotificationClient implements TelegramNotificationClient {
  public messages: { chatId: string | number; text: string }[] = [];

  async sendMessage(chatId: string | number, text: string): Promise<void> {
    this.messages.push({ chatId, text });
  }
}

let prisma: PrismaClient;
let inviteService: InviteService;
let telegramInviteClient: FakeTelegramInviteClient;
let notifier: FakeNotificationClient;
let userId: number;

const TEST_USER_TG_ID = 9100001;

beforeAll(async () => {
  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL = "file:./dev.db";
  }

  prisma = new PrismaClient();
  await prisma.$connect();

  telegramInviteClient = new FakeTelegramInviteClient();
  inviteService = new InviteService(
    prisma,
    telegramInviteClient,
    () => new Date("2024-01-01T00:00:00Z"),
  );
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

  notifier = new FakeNotificationClient();
  telegramInviteClient.calls = [];
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

    const processedCount = await processSendInvitesBatch({
      prisma,
      inviteService,
      notifier,
      checkoutChannelId: "@checkout_channel_jobs",
    },
    { onlyUserIds: [userId] });

    expect(processedCount).toBe(1);
    expect(telegramInviteClient.calls).toHaveLength(1);
    expect(telegramInviteClient.calls[0]?.chatId).toBe("@checkout_channel_jobs");

    expect(notifier.messages).toHaveLength(1);
    const message = notifier.messages[0];
    expect(message.chatId).toBe(BigInt(TEST_USER_TG_ID).toString());
    expect(message.text).toContain(`#${orderId.toString()}`);

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe(OrderStatus.INVITE_SENT);
    expect(order.inviteLink).toBe("https://t.me/+jobInvite");

    const events = await prisma.orderEvent.findMany({ where: { orderId } });
    expect(events.length).toBe(1);
    expect(events[0]?.eventType).toBe("invite_created");
  });

  it("skips orders that already have invites", async () => {
    const { orderId } = await createApprovedOrder();

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
        inviteService,
        notifier,
        checkoutChannelId: "@checkout_channel_jobs",
      },
      { onlyUserIds: [userId] },
    );

    expect(processedCount).toBe(0);
    expect(telegramInviteClient.calls).toHaveLength(0);
    expect(notifier.messages).toHaveLength(0);
  });
});
