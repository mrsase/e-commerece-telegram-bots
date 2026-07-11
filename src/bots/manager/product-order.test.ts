import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { moveProduct } from "./manager-bot-interactive.js";

const prisma = new PrismaClient();

describe("moveProduct", () => {
  beforeEach(async () => {
    await prisma.product.deleteMany({ where: { title: { startsWith: "ORDER_TEST_" } } });
  });

  afterAll(async () => {
    await prisma.product.deleteMany({ where: { title: { startsWith: "ORDER_TEST_" } } });
    await prisma.$disconnect();
  });

  it("swaps a product with the item immediately above it", async () => {
    const first = await prisma.product.create({ data: { title: "ORDER_TEST_FIRST", price: 100, currency: "IRR", sortOrder: 10 } });
    const second = await prisma.product.create({ data: { title: "ORDER_TEST_SECOND", price: 200, currency: "IRR", sortOrder: 20 } });

    expect(await moveProduct(prisma, second.id, "up")).toBe(true);

    const ordered = await prisma.product.findMany({
      where: { id: { in: [first.id, second.id] } },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    });
    expect(ordered.map((product) => product.id)).toEqual([second.id, first.id]);
  });
});
