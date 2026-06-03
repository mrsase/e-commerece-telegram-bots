import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
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
    create: { tgUserId: BigInt(1), referralCode: "U1" },
  });
  const product = await prisma.product.create({
    data: { title: "Test product", price: 1000, currency: "IRR", isActive: true },
  });
  userId = user.id;
  productId = product.id;
  service = new DiscountService(prisma);
});

beforeEach(async () => {
  await prisma.user.update({
    where: { id: userId },
    data: { discountPercent: null },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

function makeCart(qty: number, unitPrice = 1000): CartContext {
  return { userId, items: [{ productId, qty, unitPrice }] };
}

describe("DiscountService", () => {
  it("returns no discount when user has no discountPercent", async () => {
    const result = await service.calculateDiscounts(makeCart(2));
    expect(result.subtotal).toBe(2000);
    expect(result.totalDiscount).toBe(0);
    expect(result.grandTotal).toBe(2000);
    expect(result.appliedDiscounts).toHaveLength(0);
  });

  it("applies percent discount based on user's discountPercent", async () => {
    await prisma.user.update({
      where: { id: userId },
      data: { discountPercent: 15 },
    });

    const result = await service.calculateDiscounts(makeCart(3, 2000));
    expect(result.subtotal).toBe(6000);
    expect(result.totalDiscount).toBe(900); // 15% of 6000
    expect(result.grandTotal).toBe(5100);
    expect(result.appliedDiscounts).toHaveLength(1);
    expect(result.appliedDiscounts[0].description).toBe("15% تخفیف");
  });

  it("returns no discount for empty or zero subtotal", async () => {
    await prisma.user.update({
      where: { id: userId },
      data: { discountPercent: 10 },
    });

    const result = await service.calculateDiscounts(makeCart(0, 1000));
    expect(result.subtotal).toBe(0);
    expect(result.totalDiscount).toBe(0);
    expect(result.appliedDiscounts).toHaveLength(0);
  });
});
