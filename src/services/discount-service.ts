import type { PrismaClient, Discount } from "@prisma/client";
import { DiscountType } from "@prisma/client";

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
    private readonly now: () => Date = () => new Date(),
  ) {}

  async calculateDiscounts(
    cart: CartContext,
    manualCode?: string | null,
  ): Promise<DiscountCalculationResult> {
    const subtotal = this.calculateSubtotal(cart.items);
    const totalQty = this.calculateTotalQty(cart.items);

    if (subtotal <= 0 || totalQty <= 0) {
      return {
        subtotal,
        totalDiscount: 0,
        grandTotal: subtotal,
        appliedDiscounts: [],
      };
    }

    const now = this.now();

    const autoDiscounts = await this.prisma.discount.findMany({
      where: {
        isActive: true,
        code: null,
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
        ],
      },
    });

    const applicableAuto: AppliedDiscount[] = [];

    for (const discount of autoDiscounts) {
      if (
        !(await this.isDiscountApplicable({
          discount,
          cart,
          subtotal,
          totalQty,
        }))
      ) {
        continue;
      }

      const amount = this.calculateDiscountAmount(discount, subtotal);
      if (amount <= 0) continue;

      applicableAuto.push({
        discountId: discount.id,
        code: discount.code ?? null,
        amount,
        description: discount.autoRule ?? "auto discount",
      });
    }

    let manualApplied: AppliedDiscount | null = null;

    if (manualCode && manualCode.trim() !== "") {
      const discount = await this.prisma.discount.findFirst({
        where: {
          isActive: true,
          code: manualCode,
          AND: [
            { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
            { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
          ],
        },
      });

      if (
        discount &&
        (await this.isDiscountApplicable({
          discount,
          cart,
          subtotal,
          totalQty,
        }))
      ) {
        const amount = this.calculateDiscountAmount(discount, subtotal);
        if (amount > 0) {
          manualApplied = {
            discountId: discount.id,
            code: discount.code ?? null,
            amount,
            description: discount.code ?? "manual discount",
          };

          // If manual is non-stackable, it replaces autos entirely.
          if (!discount.stackable) {
            const capped = Math.min(amount, subtotal);
            return {
              subtotal,
              totalDiscount: capped,
              grandTotal: subtotal - capped,
              appliedDiscounts: [manualApplied],
            };
          }
        }
      }
    }

    const allApplied: AppliedDiscount[] = [
      ...applicableAuto,
      ...(manualApplied ? [manualApplied] : []),
    ];

    const rawTotal = allApplied.reduce((sum, d) => sum + d.amount, 0);
    const totalDiscount = Math.min(rawTotal, subtotal);
    const grandTotal = subtotal - totalDiscount;

    return {
      subtotal,
      totalDiscount,
      grandTotal,
      appliedDiscounts: allApplied,
    };
  }

  private calculateSubtotal(items: CartItemInput[]): number {
    return items.reduce((sum, item) => sum + item.qty * item.unitPrice, 0);
  }

  private calculateTotalQty(items: CartItemInput[]): number {
    return items.reduce((sum, item) => sum + item.qty, 0);
  }

  private calculateDiscountAmount(discount: Discount, subtotal: number): number {
    if (discount.type === DiscountType.PERCENT) {
      return Math.floor((subtotal * discount.value) / 100);
    }

    if (discount.type === DiscountType.FIXED) {
      return discount.value;
    }

    return 0;
  }

  private async isDiscountApplicable(args: {
    discount: Discount;
    cart: CartContext;
    subtotal: number;
    totalQty: number;
  }): Promise<boolean> {
    const { discount, cart, subtotal, totalQty } = args;

    if (discount.minQty != null && totalQty < discount.minQty) {
      return false;
    }

    if (discount.minAmount != null && subtotal < discount.minAmount) {
      return false;
    }

    // Enforce global and per-user usage limits.
    if (discount.maxUses != null || discount.perUserLimit != null) {
      const totalUsage = await this.prisma.discountUsage.count({
        where: { discountId: discount.id },
      });

      if (discount.maxUses != null && totalUsage >= discount.maxUses) {
        return false;
      }

      const perUserUsage = await this.prisma.discountUsage.count({
        where: { discountId: discount.id, userId: cart.userId },
      });

      if (discount.perUserLimit != null && perUserUsage >= discount.perUserLimit) {
        return false;
      }
    }

    if (!discount.autoRule) {
      return true;
    }

    // Minimal support for the "first_order" auto rule.
    if (discount.autoRule === "first_order") {
      const orderCount = await this.prisma.order.count({
        where: { userId: cart.userId },
      });
      return orderCount === 0;
    }

    // Unknown rules are treated as always applicable for now.
    return true;
  }
}
