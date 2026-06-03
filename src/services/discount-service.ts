import type { PrismaClient } from "@prisma/client";

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

    // Look up the user's manager-assigned discount percentage
    const user = await this.prisma.user.findUnique({
      where: { id: cart.userId },
      select: { discountPercent: true },
    });

    const percent = user?.discountPercent ?? 0;
    if (percent <= 0) {
      return { subtotal, totalDiscount: 0, grandTotal: subtotal, appliedDiscounts: [] };
    }

    const amount = Math.floor((subtotal * percent) / 100);
    return {
      subtotal,
      totalDiscount: amount,
      grandTotal: subtotal - amount,
      appliedDiscounts: [{
        discountId: 0,
        code: null,
        amount,
        description: `${percent}% تخفیف`,
      }],
    };
  }
}
