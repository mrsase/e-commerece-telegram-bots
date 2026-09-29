import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { PrismaClient, OrderStatus } from "@prisma/client";
import { OrderService, InsufficientStockError, archiveOrderAndRestoreStock, cancelOrderAndRestoreStock } from "./order-service.js";
import { shippingCostForBasket } from "../utils/shipping-cost.js";
import type { AppliedDiscount } from "./discount-service.js";

let prisma: PrismaClient;
let service: OrderService;
let userId: number;
let productId: number;

beforeAll(async () => {
  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL = "file:./dev.db";
  }

  prisma = new PrismaClient();
  await prisma.$connect();

  service = new OrderService(prisma, () => new Date("2024-01-01T00:00:00Z"));
});

beforeEach(async () => {
  const user = await prisma.user.upsert({
    where: { referralCode: "ORDER_U1" },
    update: {},
    create: {
      tgUserId: BigInt(100),
      referralCode: "ORDER_U1",
    },
  });

  userId = user.id;

  await prisma.orderEvent.deleteMany({ where: { order: { userId } } });
  await prisma.receipt.deleteMany({ where: { order: { userId } } });
  await prisma.discountUsage.deleteMany({ where: { userId } });
  await prisma.orderItem.deleteMany({ where: { order: { userId } } });
  await prisma.order.deleteMany({ where: { userId } });
  await prisma.cartItem.deleteMany({ where: { cart: { userId } } });
  await prisma.cart.deleteMany({ where: { userId } });
  await prisma.discount.deleteMany({ where: { code: "ORDER_DISC" } });

  const product = await prisma.product.create({
    data: {
      title: "Order Test Product",
      price: 1000,
      currency: "IRR",
      stock: 10,
      isActive: true,
    },
  });

  productId = product.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function createCartWithQty(qty: number) {
  const cart = await prisma.cart.create({
    data: {
      userId,
      items: {
        create: [
          {
            productId,
            qty,
            unitPriceSnapshot: 1000,
          },
        ],
      },
    },
    include: { items: true },
  });

  return cart;
}

describe("OrderService", () => {
  it("creates an order and decrements stock once", async () => {
    const cart = await createCartWithQty(2); // subtotal = 2000

    const appliedDiscounts: AppliedDiscount[] = [];

    const result = await service.createOrderFromCart({
      userId,
      cartId: cart.id,
      appliedDiscounts,
    });

    expect(result.subtotal).toBe(2000);
    expect(result.discountTotal).toBe(0);
    expect(result.shippingCost).toBe(500_000);
    expect(result.grandTotal).toBe(502_000);

    const product = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
    expect(product.stock).toBe(8);

    const order = await prisma.order.findUniqueOrThrow({
      where: { id: result.orderId },
      include: { items: true },
    });

    expect(order.status).toBe(OrderStatus.APPROVED);
    expect(order.shippingCost).toBe(500_000);
    expect(order.items).toHaveLength(1);
    expect(order.items[0]?.qty).toBe(2);

    const cartAfter = await prisma.cart.findUniqueOrThrow({ where: { id: cart.id } });
    expect(cartAfter.state).not.toBeNull();
  });

  it("throws InsufficientStockError and does not decrement stock when stock is low", async () => {
    await prisma.product.update({
      where: { id: productId },
      data: { stock: 1 },
    });

    const cart = await createCartWithQty(2);

    const appliedDiscounts: AppliedDiscount[] = [];

    await expect(
      service.createOrderFromCart({
        userId,
        cartId: cart.id,
        appliedDiscounts,
      }),
    ).rejects.toBeInstanceOf(InsufficientStockError);

    const product = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
    expect(product.stock).toBe(1);

    const orderCount = await prisma.order.count({ where: { userId } });
    expect(orderCount).toBe(0);
  });

  it("never creates an order for a product with zero stock", async () => {
    await prisma.product.update({
      where: { id: productId },
      data: { stock: 0 },
    });
    const cart = await createCartWithQty(1);

    await expect(
      service.createOrderFromCart({ userId, cartId: cart.id, appliedDiscounts: [] }),
    ).rejects.toBeInstanceOf(InsufficientStockError);

    expect(await prisma.order.count({ where: { userId } })).toBe(0);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: productId } })).stock).toBe(0);
  });

  it("creates discount usages and stores discount totals", async () => {
    const discount = await prisma.discount.create({
      data: {
        type: "FIXED",
        value: 500,
        code: "ORDER_DISC",
        isActive: true,
      },
    });

    const cart = await createCartWithQty(3); // subtotal = 3000

    const appliedDiscounts: AppliedDiscount[] = [
      {
        discountId: discount.id,
        code: discount.code,
        amount: 500,
        description: "order test discount",
      },
    ];

    const result = await service.createOrderFromCart({
      userId,
      cartId: cart.id,
      appliedDiscounts,
    });

    expect(result.subtotal).toBe(3000);
    expect(result.discountTotal).toBe(500);
    expect(result.shippingCost).toBe(500_000);
    expect(result.grandTotal).toBe(502_500);

    const usageCount = await prisma.discountUsage.count({
      where: { userId, discountId: discount.id },
    });
    expect(usageCount).toBe(1);
  });

  it("restores finite stock exactly once when an unfulfilled order is cancelled", async () => {
    const cart = await createCartWithQty(2);
    const created = await service.createOrderFromCart({ userId, cartId: cart.id, appliedDiscounts: [] });
    expect((await prisma.product.findUniqueOrThrow({ where: { id: productId } })).stock).toBe(8);

    const cancelled = await cancelOrderAndRestoreStock(prisma, {
      orderId: created.orderId,
      actorType: "manager",
      actorId: null,
      eventType: "order_cancelled",
    });
    expect(cancelled.kind).toBe("cancelled");
    expect((await prisma.product.findUniqueOrThrow({ where: { id: productId } })).stock).toBe(10);

    const duplicate = await cancelOrderAndRestoreStock(prisma, {
      orderId: created.orderId,
      actorType: "manager",
      actorId: null,
      eventType: "order_cancelled",
    });
    expect(duplicate.kind).toBe("already-cancelled");
    expect((await prisma.product.findUniqueOrThrow({ where: { id: productId } })).stock).toBe(10);
  });

  it("applies exact shipping thresholds to the discounted basket", () => {
    expect(shippingCostForBasket(5_999_999)).toBe(500_000);
    expect(shippingCostForBasket(6_000_000)).toBe(350_000);
    expect(shippingCostForBasket(10_000_000)).toBe(350_000);
    expect(shippingCostForBasket(10_000_001)).toBe(0);
  });

  it("uses the discounted amount for the stored shipping tier", async () => {
    await prisma.product.update({ where: { id: productId }, data: { price: 6_000_000 } });
    const cart = await prisma.cart.create({
      data: {
        userId,
        items: { create: { productId, qty: 1, unitPriceSnapshot: 6_000_000 } },
      },
    });
    const result = await service.createOrderFromCart({
      userId,
      cartId: cart.id,
      appliedDiscounts: [{ discountId: 0, code: null, amount: 1, description: "test" }],
    });
    expect(result.shippingCost).toBe(500_000);
    expect(result.grandTotal).toBe(6_499_999);
    const saved = await prisma.order.findUniqueOrThrow({ where: { id: result.orderId } });
    expect(saved.shippingCost).toBe(500_000);
  });

  it("archives directly and restores stock only once", async () => {
    const cart = await createCartWithQty(2);
    const created = await service.createOrderFromCart({ userId, cartId: cart.id, appliedDiscounts: [] });
    const manager = await prisma.manager.create({ data: { tgUserId: BigInt(99001), role: "ADMIN" } });
    try {
      const archived = await archiveOrderAndRestoreStock(prisma, { orderId: created.orderId, managerId: manager.id });
      expect(archived.kind).toBe("archived");
      expect((await prisma.order.findUniqueOrThrow({ where: { id: created.orderId } })).status).toBe(OrderStatus.CANCELLED);
      expect((await prisma.product.findUniqueOrThrow({ where: { id: productId } })).stock).toBe(10);
      expect(await prisma.orderEvent.count({ where: { orderId: created.orderId, eventType: "order_deleted" } })).toBe(1);

      const again = await archiveOrderAndRestoreStock(prisma, { orderId: created.orderId, managerId: manager.id });
      expect(again.kind).toBe("already-archived");
      expect((await prisma.product.findUniqueOrThrow({ where: { id: productId } })).stock).toBe(10);
    } finally {
      await prisma.manager.delete({ where: { id: manager.id } });
    }
  });

  it("submits one cart at most once under concurrent checkout attempts", async () => {
    const cart = await createCartWithQty(2);

    const attempts = await Promise.allSettled([
      service.createOrderFromCart({ userId, cartId: cart.id, appliedDiscounts: [] }),
      service.createOrderFromCart({ userId, cartId: cart.id, appliedDiscounts: [] }),
    ]);

    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter((attempt) => attempt.status === "rejected")).toHaveLength(1);
    expect(await prisma.order.count({ where: { cartId: cart.id } })).toBe(1);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: productId } })).stock).toBe(8);
  });
});
