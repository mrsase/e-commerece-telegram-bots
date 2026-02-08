import {
  beforeAll,
  afterAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { PrismaClient, DiscountType, OrderStatus } from "@prisma/client";
import { DiscountService, type CartContext } from "./discount-service.js";

let prisma: PrismaClient;
let service: DiscountService;
let userId: number;
let productId: number;

beforeAll(async () => {
  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL = "file:./dev.db";
  }

  prisma = new PrismaClient();
  await prisma.$connect();

  const user = await prisma.user.upsert({
    where: { referralCode: "U1" },
    update: {},
    create: {
      tgUserId: BigInt(1),
      referralCode: "U1",
    },
  });

  const product = await prisma.product.create({
    data: {
      title: "Test product",
      price: 1000,
      currency: "IRR",
      isActive: true,
    },
  });

  userId = user.id;
  productId = product.id;

  service = new DiscountService(prisma, () => new Date("2024-01-01T00:00:00Z"));
});

beforeEach(async () => {
  await prisma.discountUsage.deleteMany({ where: { userId } });
  await prisma.discount.deleteMany({
    where: {
      OR: [
        { code: { in: ["MANUAL1000", "LIMITED"] } },
        { autoRule: { in: ["min_amount_example", "auto_10", "first_order"] } },
      ],
    },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

function makeCart(qty: number, unitPrice = 1000): CartContext {
  return {
    userId,
    items: [{ productId, qty, unitPrice }],
  };
}

describe("DiscountService", () => {
  it("returns no discounts when none are active", async () => {
    const cart = makeCart(2);

    const result = await service.calculateDiscounts(cart, null);

    expect(result.subtotal).toBe(2000);
    expect(result.totalDiscount).toBe(0);
    expect(result.appliedDiscounts).toHaveLength(0);
  });

  it("applies an auto percent discount that meets minAmount", async () => {
    await prisma.discount.create({
      data: {
        type: DiscountType.PERCENT,
        value: 10,
        code: null,
        autoRule: "min_amount_example",
        minAmount: 1000,
        isActive: true,
      },
    });

    const cart = makeCart(3); // subtotal = 3000

    const result = await service.calculateDiscounts(cart, null);

    expect(result.subtotal).toBe(3000);
    expect(result.totalDiscount).toBe(300); // 10% of 3000
    expect(result.appliedDiscounts).toHaveLength(1);
  });

  it("applies a manual non-stackable discount and ignores autos", async () => {
    // Auto 10% off
    await prisma.discount.create({
      data: {
        type: DiscountType.PERCENT,
        value: 10,
        code: null,
        autoRule: "auto_10",
        isActive: true,
      },
    });

    // Manual 1000 fixed, non-stackable
    await prisma.discount.create({
      data: {
        type: DiscountType.FIXED,
        value: 1000,
        code: "MANUAL1000",
        stackable: false,
        isActive: true,
      },
    });

    const cart = makeCart(3); // subtotal = 3000

    const result = await service.calculateDiscounts(cart, "MANUAL1000");

    expect(result.subtotal).toBe(3000);
    expect(result.totalDiscount).toBe(1000);
    expect(result.appliedDiscounts).toHaveLength(1);
    expect(result.appliedDiscounts[0]?.code).toBe("MANUAL1000");
  });

  it("enforces perUserLimit and maxUses", async () => {
    const discount = await prisma.discount.create({
      data: {
        type: DiscountType.FIXED,
        value: 500,
        code: "LIMITED",
        perUserLimit: 1,
        maxUses: 1,
        isActive: true,
      },
    });

    // Existing usage for this user and discount
    await prisma.discountUsage.create({
      data: {
        userId,
        discountId: discount.id,
        usedAt: new Date(),
      },
    });

    const cart = makeCart(2); // subtotal = 2000

    const result = await service.calculateDiscounts(cart, "LIMITED");

    expect(result.totalDiscount).toBe(0);
    expect(result.appliedDiscounts).toHaveLength(0);
  });

  it("respects the first_order auto rule", async () => {
    // Ensure user has no orders initially
    await prisma.order.deleteMany({ where: { userId } });

    await prisma.discount.create({
      data: {
        type: DiscountType.PERCENT,
        value: 20,
        code: null,
        autoRule: "first_order",
        isActive: true,
      },
    });

    const firstCart = makeCart(1); // subtotal = 1000

    const firstResult = await service.calculateDiscounts(firstCart, null);
    expect(firstResult.totalDiscount).toBe(200); // 20% of 1000
    expect(firstResult.appliedDiscounts).toHaveLength(1);

    // Simulate an order so the user is no longer a first-time customer
    await prisma.order.create({
      data: {
        userId,
        subtotal: 1000,
        discountTotal: firstResult.totalDiscount,
        grandTotal: firstResult.grandTotal,
        status: OrderStatus.COMPLETED,
      },
    });

    const secondCart = makeCart(1);
    const secondResult = await service.calculateDiscounts(secondCart, null);

    expect(secondResult.totalDiscount).toBe(0);
    expect(secondResult.appliedDiscounts).toHaveLength(0);
  });
});
