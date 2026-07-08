import { DiscountType, type PrismaClient } from "@prisma/client";

export interface CartItemInput {
  productId: number;
  qty: number;
  unitPrice: number;
}

export interface CartContext {
  userId: number;
  items: CartItemInput[];
}

export interface AppliedDiscount {
  discountId: number;
  code: string | null;
  amount: number;
  description: string;
}

export interface DiscountCalculationResult {
  subtotal: number;
  totalDiscount: number;
  grandTotal: number;
  appliedDiscounts: AppliedDiscount[];
}

export class DiscountService {
  constructor(
    private readonly prisma: PrismaClient,
  ) {}

  async calculateDiscounts(
    cart: CartContext,
  ): Promise<DiscountCalculationResult> {
    const subtotal = cart.items.reduce((sum, item) => sum + item.qty * item.unitPrice, 0);

    if (subtotal <= 0) {
      return { subtotal, totalDiscount: 0, grandTotal: subtotal, appliedDiscounts: [] };
    }

    const user = await this.prisma.user.findUnique({
      where: { id: cart.userId },
      select: {
        discountPercent: true,
        discountType: true,
        discountValue: true,
      },
    });

    const discountType = user?.discountType ?? (user?.discountPercent != null ? DiscountType.PERCENT : null);
    const discountValue = user?.discountValue ?? user?.discountPercent ?? 0;

    if (!discountType || discountValue <= 0) {
      return { subtotal, totalDiscount: 0, grandTotal: subtotal, appliedDiscounts: [] };
    }

    const rawAmount = discountType === DiscountType.PERCENT
      ? Math.floor((subtotal * discountValue) / 100)
      : discountValue;
    const amount = Math.min(Math.max(rawAmount, 0), subtotal);
    if (amount <= 0) {
      return { subtotal, totalDiscount: 0, grandTotal: subtotal, appliedDiscounts: [] };
    }

    return {
      subtotal,
      totalDiscount: amount,
      grandTotal: subtotal - amount,
      appliedDiscounts: [{
        discountId: 0,
        code: null,
        amount,
        description: discountType === DiscountType.PERCENT
          ? `${discountValue}% تخفیف`
          : `${discountValue.toLocaleString("en-US")} تومان تخفیف`,
      }],
    };
  }
}
