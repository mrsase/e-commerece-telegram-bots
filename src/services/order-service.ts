import { PrismaClient, CartState, OrderStatus } from "@prisma/client";
import type { AppliedDiscount } from "./discount-service.js";

export class CartNotFoundError extends Error {
  constructor(message = "Cart not found") {
    super(message);
    this.name = "CartNotFoundError";
  }
}

export class CartNotActiveError extends Error {
  constructor(message = "Cart is not active") {
    super(message);
    this.name = "CartNotActiveError";
  }
}

export class InsufficientStockError extends Error {
  constructor(message = "Insufficient stock for one or more products") {
    super(message);
    this.name = "InsufficientStockError";
  }
}

export class ProductNotAvailableError extends Error {
  constructor(message = "Product is not available") {
    super(message);
    this.name = "ProductNotAvailableError";
  }
}

export class CartEmptyError extends Error {
  constructor(message = "Cart is empty") {
    super(message);
    this.name = "CartEmptyError";
  }
}

export interface CreateOrderFromCartArgs {
  userId: number;
  cartId: number;
  appliedDiscounts: AppliedDiscount[];
}

export interface CreateOrderResult {
  orderId: number;
  subtotal: number;
  discountTotal: number;
  grandTotal: number;
}

export class OrderService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async createOrderFromCart(args: CreateOrderFromCartArgs): Promise<CreateOrderResult> {
    const { userId, cartId, appliedDiscounts } = args;

    return this.prisma.$transaction(async (tx) => {
      const cart = await tx.cart.findUnique({
        where: { id: cartId },
        include: { items: true },
      });

      if (!cart) {
        throw new CartNotFoundError();
      }

      if (cart.userId !== userId) {
        throw new CartNotFoundError("Cart does not belong to this user");
      }

      if (cart.state !== CartState.ACTIVE) {
        throw new CartNotActiveError();
      }

      if (cart.items.length === 0) {
        throw new CartEmptyError();
      }

      const productIds = cart.items.map((item) => item.productId);
      const products = await tx.product.findMany({
        where: { id: { in: productIds } },
      });
      const productById = new Map(products.map((p) => [p.id, p]));

      for (const item of cart.items) {
        const product = productById.get(item.productId);
        if (!product || !product.isActive) {
          throw new ProductNotAvailableError(
            `Product ${item.productId} is not available`,
          );
        }

        if (product.stock != null && product.stock < item.qty) {
          throw new InsufficientStockError(
            `Insufficient stock for product ${product.id}`,
          );
        }
      }

      for (const item of cart.items) {
        const product = productById.get(item.productId)!;
        if (product.stock != null) {
          const result = await tx.product.updateMany({
            where: { id: product.id, stock: { gte: item.qty } },
            data: { stock: { decrement: item.qty } },
          });
          if (result.count === 0) {
            throw new InsufficientStockError(
              `Insufficient stock for product ${product.id} (concurrent update)`,
            );
          }
        }
      }

      const subtotal = cart.items.reduce(
        (sum, item) => sum + item.qty * item.unitPriceSnapshot,
        0,
      );

      const rawDiscountTotal = appliedDiscounts.reduce(
        (sum, d) => sum + d.amount,
        0,
      );
      const discountTotal = Math.min(rawDiscountTotal, subtotal);
      const grandTotal = subtotal - discountTotal;

      const order = await tx.order.create({
        data: {
          userId,
          cartId: cart.id,
          subtotal,
          discountTotal,
          grandTotal,
          status: OrderStatus.AWAITING_MANAGER_APPROVAL,
          items: {
            create: cart.items.map((item) => ({
              productId: item.productId,
              qty: item.qty,
              unitPriceSnapshot: item.unitPriceSnapshot,
              lineTotal: item.qty * item.unitPriceSnapshot,
            })),
          },
          events: {
            create: {
              actorType: "system",
              actorId: null,
              eventType: "order_created",
              payload: JSON.stringify({
                cartId: cart.id,
                subtotal,
                discountTotal,
                grandTotal,
                appliedDiscounts,
              }),
            },
          },
        },
      });

      if (appliedDiscounts.length > 0) {
        // Re-validate discount limits inside the transaction to prevent races
        for (const ad of appliedDiscounts) {
          const discount = await tx.discount.findUnique({
            where: { id: ad.discountId },
          });
          if (!discount || !discount.isActive) {
            throw new Error(`Discount ${ad.discountId} is no longer active`);
          }
          if (discount.maxUses != null) {
            const usageCount = await tx.discountUsage.count({
              where: { discountId: discount.id },
            });
            if (usageCount >= discount.maxUses) {
              throw new Error(`Discount ${ad.discountId} has reached max uses`);
            }
          }
          if (discount.perUserLimit != null) {
            const perUserCount = await tx.discountUsage.count({
              where: { discountId: discount.id, userId },
            });
            if (perUserCount >= discount.perUserLimit) {
              throw new Error(`Discount ${ad.discountId} per-user limit reached`);
            }
          }
        }

        await tx.discountUsage.createMany({
          data: appliedDiscounts.map((d) => ({
            userId,
            discountId: d.discountId,
            orderId: order.id,
            usedAt: this.now(),
          })),
        });
      }

      await tx.cart.update({
        where: { id: cart.id },
        data: { state: CartState.SUBMITTED },
      });

      return {
        orderId: order.id,
        subtotal,
        discountTotal,
        grandTotal,
      };
    });
  }
}
