import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { addItemToCart, ProductUnavailableForCartError } from "./cart-utils.js";

const prisma = new PrismaClient();
let userId: number;
let productId: number;

describe("addItemToCart stock validation", () => {
  beforeEach(async () => {
    const user = await prisma.user.upsert({
      where: { referralCode: "CART_STOCK_USER" },
      update: {},
      create: { tgUserId: BigInt(880001), referralCode: "CART_STOCK_USER" },
    });
    userId = user.id;

    await prisma.cartItem.deleteMany({ where: { cart: { userId } } });
    await prisma.cart.deleteMany({ where: { userId } });
    await prisma.product.deleteMany({ where: { title: "CART_STOCK_PRODUCT" } });

    const product = await prisma.product.create({
      data: { title: "CART_STOCK_PRODUCT", price: 1000, currency: "IRR", stock: 2, isActive: true },
    });
    productId = product.id;
  });

  afterAll(async () => {
    await prisma.cartItem.deleteMany({ where: { cart: { userId } } });
    await prisma.cart.deleteMany({ where: { userId } });
    await prisma.product.deleteMany({ where: { title: "CART_STOCK_PRODUCT" } });
    await prisma.$disconnect();
  });

  it("rejects a zero-stock product", async () => {
    await prisma.product.update({ where: { id: productId }, data: { stock: 0 } });

    await expect(addItemToCart(prisma, userId, productId, 1)).rejects.toBeInstanceOf(ProductUnavailableForCartError);
    expect(await prisma.cartItem.count({ where: { productId } })).toBe(0);
  });

  it("rejects additions that make the cart quantity exceed stock", async () => {
    await addItemToCart(prisma, userId, productId, 2);

    await expect(addItemToCart(prisma, userId, productId, 1)).rejects.toBeInstanceOf(ProductUnavailableForCartError);
    expect((await prisma.cartItem.findFirstOrThrow({ where: { productId } })).qty).toBe(2);
  });
});
