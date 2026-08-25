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

export type CancelOrderResult =
  | { kind: "cancelled"; previousStatus: OrderStatus; userTgUserId: bigint }
  | { kind: "missing" }
  | { kind: "already-cancelled" }
  | { kind: "not-allowed"; status: OrderStatus }
  | { kind: "conflict" };

/**
 * Cancel an order atomically and return finite-stock inventory exactly once.
 * Completed orders represent fulfilled sales, so archiving/cancelling them does
 * not put sold units back into inventory.
 */
export async function cancelOrderAndRestoreStock(
  prisma: PrismaClient,
  args: {
    orderId: number;
    actorType: string;
    actorId: number | null;
    eventType: string;
    completedEventType?: string;
    allowedStatuses?: OrderStatus[];
  },
): Promise<CancelOrderResult> {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: args.orderId },
      select: {
        status: true,
        user: { select: { tgUserId: true } },
        items: { select: { productId: true, qty: true } },
      },
    });
    if (!order) return { kind: "missing" as const };
    if (order.status === OrderStatus.CANCELLED) return { kind: "already-cancelled" as const };
    if (args.allowedStatuses && !args.allowedStatuses.includes(order.status)) {
      return { kind: "not-allowed" as const, status: order.status };
    }

    const claimed = await tx.order.updateMany({
      where: { id: args.orderId, status: order.status },
      data: { status: OrderStatus.CANCELLED },
    });
    if (claimed.count === 0) return { kind: "conflict" as const };

    if (order.status !== OrderStatus.COMPLETED) {
      for (const item of order.items) {
        await tx.product.updateMany({
          where: { id: item.productId, stock: { not: null } },
          data: { stock: { increment: item.qty } },
        });
      }
    }

    await tx.orderEvent.create({
      data: {
        orderId: args.orderId,
        actorType: args.actorType,
        actorId: args.actorId,
        eventType: order.status === OrderStatus.COMPLETED && args.completedEventType
          ? args.completedEventType
          : args.eventType,
      },
    });

    return {
      kind: "cancelled" as const,
      previousStatus: order.status,
      userTgUserId: order.user.tgUserId,
    };
  });
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

      // Atomically claim the cart before changing stock or creating the order.
      // A second concurrent checkout can have read the same ACTIVE snapshot,
      // but only one transaction may transition it to SUBMITTED.
      const claimed = await tx.cart.updateMany({
        where: { id: cart.id, userId, state: CartState.ACTIVE },
        data: { state: CartState.SUBMITTED },
      });
      if (claimed.count === 0) {
        throw new CartNotActiveError("Cart was already submitted");
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
          status: OrderStatus.APPROVED,
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

      const usageDiscounts = appliedDiscounts.filter((d) => d.discountId > 0);
      if (usageDiscounts.length > 0) {
        await tx.discountUsage.createMany({
          data: usageDiscounts.map((d) => ({
            userId,
            discountId: d.discountId,
            orderId: order.id,
            usedAt: this.now(),
          })),
        });
      }

      return {
        orderId: order.id,
        subtotal,
        discountTotal,
        grandTotal,
      };
    });
  }
}
