import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { PrismaClient, OrderStatus } from "@prisma/client";

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

describe("Prisma SQLite schema", () => {
  it("creates User, Product, Cart, and Order with relations", async () => {
    const existingUser = await prisma.user.findUnique({
      where: { tgUserId: BigInt(123456789) },
      include: { carts: { include: { items: true } }, orders: true },
    });

    if (existingUser) {
      await prisma.orderEvent.deleteMany({ where: { order: { userId: existingUser.id } } });
      await prisma.orderItem.deleteMany({ where: { order: { userId: existingUser.id } } });
      await prisma.order.deleteMany({ where: { userId: existingUser.id } });
      await prisma.cartItem.deleteMany({ where: { cart: { userId: existingUser.id } } });
      await prisma.cart.deleteMany({ where: { userId: existingUser.id } });
    }

    const user = await prisma.user.upsert({
      where: { tgUserId: BigInt(123456789) },
      update: {
        username: "testuser",
        referralCode: "PRISMA_SCHEMA_USER",
      },
      create: {
        tgUserId: BigInt(123456789),
        username: "testuser",
        referralCode: "PRISMA_SCHEMA_USER",
      },
    });

    const product = await prisma.product.create({
      data: {
        title: "Test product",
        description: "Example description",
        price: 1000,
        currency: "IRR",
        isActive: true,
      },
    });

    const cart = await prisma.cart.create({
      data: {
        userId: user.id,
        items: {
          create: [
            {
              productId: product.id,
              qty: 2,
              unitPriceSnapshot: product.price,
            },
          ],
        },
      },
      include: { items: true },
    });

    const item = cart.items[0];
    const subtotal = item.unitPriceSnapshot * item.qty;

    const order = await prisma.order.create({
      data: {
        userId: user.id,
        cartId: cart.id,
        subtotal,
        discountTotal: 0,
        grandTotal: subtotal,
        status: OrderStatus.AWAITING_MANAGER_APPROVAL,
        items: {
          create: [
            {
              productId: item.productId,
              qty: item.qty,
              unitPriceSnapshot: item.unitPriceSnapshot,
              lineTotal: subtotal,
            },
          ],
        },
      },
      include: { user: true, items: true },
    });

    expect(order.user.id).toBe(user.id);
    expect(order.items.length).toBe(1);
    expect(order.subtotal).toBe(subtotal);
    expect(order.grandTotal).toBe(subtotal);
  });
});
