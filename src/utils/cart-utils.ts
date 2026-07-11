import type { PrismaClient } from "@prisma/client";
import { CartState } from "@prisma/client";

export class ProductUnavailableForCartError extends Error {
  constructor(message = "Product is unavailable or does not have enough stock") {
    super(message);
    this.name = "ProductUnavailableForCartError";
  }
}

export function safeParseInt(value: string | undefined, fallback = 0): number {
  const n = parseInt(value ?? "", 10);
  return Number.isFinite(n) ? n : fallback;
}

export class PerUserMutex {
  private readonly locks = new Set<number>();

  async lock(key: number): Promise<() => void> {
    while (this.locks.has(key)) {
      await new Promise(r => setImmediate(r));
    }
    this.locks.add(key);
    return () => { this.locks.delete(key); };
  }
}

export async function addItemToCart(
  prisma: PrismaClient,
  userId: number,
  productId: number,
  qty: number,
): Promise<void> {
  if (!Number.isInteger(qty) || qty <= 0) {
    throw new ProductUnavailableForCartError("Quantity must be a positive integer");
  }

  await prisma.$transaction(async (tx) => {
    let cart = await tx.cart.findFirst({
      where: { userId, state: CartState.ACTIVE },
    });
    if (!cart) {
      cart = await tx.cart.create({
        data: { userId, state: CartState.ACTIVE },
      });
    }

    const product = await tx.product.findUnique({ where: { id: productId } });
    if (!product || !product.isActive) {
      throw new ProductUnavailableForCartError(`Product ${productId} is unavailable`);
    }

    const existingItem = await tx.cartItem.findFirst({
      where: { cartId: cart.id, productId },
    });

    const requestedTotal = (existingItem?.qty ?? 0) + qty;
    if (product.stock != null && product.stock < requestedTotal) {
      throw new ProductUnavailableForCartError(`Product ${productId} does not have enough stock`);
    }

    if (existingItem) {
      await tx.cartItem.update({
        where: { id: existingItem.id },
        data: {
          qty: existingItem.qty + qty,
          unitPriceSnapshot: product.price,
        },
      });
    } else {
      await tx.cartItem.create({
        data: {
          cartId: cart.id,
          productId,
          qty,
          unitPriceSnapshot: product.price,
        },
      });
    }
  });
}
