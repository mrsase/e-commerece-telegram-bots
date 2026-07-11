import { AnnouncementAudience, AnnouncementType, DiscountType, type PrismaClient } from "@prisma/client";

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

    const now = new Date();
    const user = await this.prisma.user.findUnique({
      where: { id: cart.userId },
      select: { discountPercent: true, discountType: true, discountValue: true, isTestUser: true },
    });
    const campaign = await this.prisma.announcement.findFirst({
        where: {
          type: AnnouncementType.GENERAL,
          isActive: true,
          startsAt: { lte: now },
          AND: [
            { OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
            { OR: [
              { audience: AnnouncementAudience.ALL },
              ...(user?.isTestUser ? [{ audience: AnnouncementAudience.TEST }] : []),
            ] },
          ],
          discountType: { not: null },
          discountValue: { gt: 0 },
        },
        orderBy: { createdAt: "desc" },
        select: { id: true, title: true, discountType: true, discountValue: true },
    });

    const discountType = user?.discountType ?? (user?.discountPercent != null ? DiscountType.PERCENT : null);
    const discountValue = user?.discountValue ?? user?.discountPercent ?? 0;

    const appliedDiscounts: AppliedDiscount[] = [];
    const addDiscount = (type: DiscountType, value: number, description: string, code: string | null): void => {
      const remaining = subtotal - appliedDiscounts.reduce((sum, item) => sum + item.amount, 0);
      const rawAmount = type === DiscountType.PERCENT ? Math.floor((subtotal * value) / 100) : value;
      const amount = Math.min(Math.max(rawAmount, 0), remaining);
      if (amount > 0) appliedDiscounts.push({ discountId: 0, code, amount, description });
    };

    if (campaign?.discountType && campaign.discountValue) {
      addDiscount(
        campaign.discountType,
        campaign.discountValue,
        `تخفیف عمومی «${campaign.title}»`,
        `ANNOUNCEMENT_${campaign.id}`,
      );
    }
    if (discountType && discountValue > 0) {
      addDiscount(
        discountType,
        discountValue,
        discountType === DiscountType.PERCENT
          ? `${discountValue}% تخفیف`
          : `${discountValue.toLocaleString("en-US")} تومان تخفیف`,
        null,
      );
    }

    const totalDiscount = appliedDiscounts.reduce((sum, item) => sum + item.amount, 0);

    return {
      subtotal,
      totalDiscount,
      grandTotal: subtotal - totalDiscount,
      appliedDiscounts,
    };
  }
}
