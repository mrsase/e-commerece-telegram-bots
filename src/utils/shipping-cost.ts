/** Shipping tiers are based on the discounted basket total, before shipping. */
export function shippingCostForBasket(discountedBasketTotal: number): number {
  if (discountedBasketTotal > 10_000_000) return 0;
  if (discountedBasketTotal >= 6_000_000) return 350_000;
  return 500_000;
}
