import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { PrismaClient, OrderStatus } from "@prisma/client";
import {
  InviteService,
  OrderNotApprovedError,
  type TelegramInviteClient,
} from "./invite-service.js";

class FakeTelegramInviteClient implements TelegramInviteClient {
  public calls: { chatId: string }[] = [];
  constructor(private readonly link: string = "https://t.me/+fakeInvite") {}

  async createInviteLink(args: { chatId: string }): Promise<{ inviteLink: string }> {
    this.calls.push({ chatId: args.chatId });
    return { inviteLink: this.link };
  }
}

let prisma: PrismaClient;
let service: InviteService;
let telegramClient: FakeTelegramInviteClient;
let userId: number;
let productId: number;

beforeAll(async () => {
  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL = "file:./dev.db";
  }

  prisma = new PrismaClient();
  await prisma.$connect();

  telegramClient = new FakeTelegramInviteClient();
  service = new InviteService(
    prisma,
    telegramClient,
    () => new Date("2024-01-01T00:00:00Z"),
  );
});

beforeEach(async () => {
  const user = await prisma.user.upsert({
    where: { tgUserId: BigInt(9000001) },
    update: {
      referralCode: "INVITE_U1",
    },
    create: {
      tgUserId: BigInt(9000001),
      referralCode: "INVITE_U1",
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
  await prisma.product.deleteMany({ where: { title: "Invite Test Product" } });

  const product = await prisma.product.create({
    data: {
      title: "Invite Test Product",
      price: 1000,
      currency: "IRR",
      stock: 10,
      isActive: true,
    },
  });

  productId = product.id;

  telegramClient.calls = [];
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function createApprovedOrder(): Promise<{ orderId: number }> {
  const cart = await prisma.cart.create({
    data: {
      userId,
      items: {
        create: [
          {
            productId,
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

describe("InviteService", () => {
  it("creates an invite for an approved order and updates state", async () => {
    const { orderId } = await createApprovedOrder();

    const result = await service.createInviteForApprovedOrder({
      orderId,
      channelId: "@checkout_channel",
    });

    expect(result.inviteLink).toBe("https://t.me/+fakeInvite");
    expect(telegramClient.calls).toHaveLength(1);
    expect(telegramClient.calls[0]?.chatId).toBe("@checkout_channel");

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.inviteLink).toBe("https://t.me/+fakeInvite");
    expect(order.status).toBe(OrderStatus.INVITE_SENT);
    expect(order.inviteSentAt).not.toBeNull();

    const eventsCount = await prisma.orderEvent.count({ where: { orderId } });
    expect(eventsCount).toBe(1);
  });

  it("throws when order is not approved", async () => {
    const cart = await prisma.cart.create({
      data: {
        userId,
        items: {
          create: [
            {
              productId,
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
        status: OrderStatus.AWAITING_MANAGER_APPROVAL,
      },
    });

    await expect(
      service.createInviteForApprovedOrder({
        orderId: order.id,
        channelId: "@checkout_channel",
      }),
    ).rejects.toBeInstanceOf(OrderNotApprovedError);

    expect(telegramClient.calls).toHaveLength(0);
  });

  it("is idempotent when invite already exists", async () => {
    const { orderId } = await createApprovedOrder();

    await prisma.order.update({
      where: { id: orderId },
      data: {
        inviteLink: "https://t.me/+existing",
        inviteSentAt: new Date("2024-01-01T00:00:00Z"),
        status: OrderStatus.INVITE_SENT,
      },
    });

    const result = await service.createInviteForApprovedOrder({
      orderId,
      channelId: "@checkout_channel",
    });

    expect(result.inviteLink).toBe("https://t.me/+existing");
    expect(telegramClient.calls).toHaveLength(0);
  });
});
