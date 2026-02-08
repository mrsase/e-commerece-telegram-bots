import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { CartState, PrismaClient } from "@prisma/client";
import { expireIdleCarts } from "./cleanup-carts.worker.js";

let prisma: PrismaClient;
let userId: number;

const TEST_USER_TG_ID = 9200001;

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
      referralCode: "CLEANUP_CARTS_USER",
    },
    create: {
      tgUserId,
      referralCode: "CLEANUP_CARTS_USER",
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
});

describe("cleanup_carts worker", () => {
  it("expires carts that have been idle longer than the threshold", async () => {
    const oldCart = await prisma.cart.create({
      data: {
        userId,
        state: CartState.ACTIVE,
      },
    });

    const recentCart = await prisma.cart.create({
      data: {
        userId,
        state: CartState.ACTIVE,
      },
    });

    const submittedCart = await prisma.cart.create({
      data: {
        userId,
        state: CartState.SUBMITTED,
      },
    });

    await prisma.cart.update({
      where: { id: oldCart.id },
      data: { updatedAt: new Date("2024-01-01T00:00:00Z") },
    });

    await prisma.cart.update({
      where: { id: recentCart.id },
      data: { updatedAt: new Date("2024-01-02T00:30:00Z") },
    });

    await prisma.cart.update({
      where: { id: submittedCart.id },
      data: { updatedAt: new Date("2024-01-01T00:00:00Z") },
    });

    const now = new Date("2024-01-02T01:00:00Z");
    const idleThresholdMs = 60 * 60 * 1000; // 1 hour

    const expiredCount = await expireIdleCarts(
      { prisma, now: () => now },
      { idleThresholdMs },
    );

    expect(expiredCount).toBe(1);

    const reloadedOldCart = await prisma.cart.findUniqueOrThrow({ where: { id: oldCart.id } });
    const reloadedRecentCart = await prisma.cart.findUniqueOrThrow({ where: { id: recentCart.id } });
    const reloadedSubmittedCart = await prisma.cart.findUniqueOrThrow({ where: { id: submittedCart.id } });

    expect(reloadedOldCart.state).toBe(CartState.EXPIRED);
    expect(reloadedRecentCart.state).toBe(CartState.ACTIVE);
    expect(reloadedSubmittedCart.state).toBe(CartState.SUBMITTED);
  });

  it("does nothing when there are no idle carts", async () => {
    const recentCart = await prisma.cart.create({
      data: {
        userId,
        state: CartState.ACTIVE,
      },
    });

    await prisma.cart.update({
      where: { id: recentCart.id },
      data: { updatedAt: new Date("2024-01-02T00:30:00Z") },
    });

    const now = new Date("2024-01-02T00:45:00Z");
    const idleThresholdMs = 60 * 60 * 1000; // 1 hour

    const expiredCount = await expireIdleCarts(
      { prisma, now: () => now },
      { idleThresholdMs },
    );

    expect(expiredCount).toBe(0);

    const reloadedRecentCart = await prisma.cart.findUniqueOrThrow({ where: { id: recentCart.id } });
    expect(reloadedRecentCart.state).toBe(CartState.ACTIVE);
  });
});
