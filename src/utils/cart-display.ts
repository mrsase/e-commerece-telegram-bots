import { ClientTexts } from "../i18n/index.js";
import { formatPrice } from "./format-price.js";
import { shippingCostForBasket } from "./shipping-cost.js";

interface CartDisplayItem {
  productId: number;
  title: string;
  qty: number;
  unitPrice: number;
  currency: string;
}

export interface CartDisplayResult {
  text: string;
  items: { productId: number; title: string; qty: number }[];
  subtotal: number;
}

/**
 * Build cart display text and extract items for keyboard rendering.
 */
export function buildCartDisplay(cartItems: CartDisplayItem[], discountedBasketTotal?: number): CartDisplayResult {
  const items = cartItems.map((item) => ({
    productId: item.productId,
    title: item.title,
    qty: item.qty,
  }));

  const subtotal = cartItems.reduce(
    (sum, item) => sum + item.qty * item.unitPrice,
    0,
  );

  let text = ClientTexts.cartHeader() + "\n\n";
  cartItems.forEach((item) => {
    const lineTotal = item.qty * item.unitPrice;
    text += `${item.title} x${item.qty} = ${formatPrice(lineTotal)}\n`;
  });
  text += `\n${ClientTexts.cartSubtotal(subtotal)}`;
  if (discountedBasketTotal !== undefined) {
    const discount = Math.max(0, subtotal - discountedBasketTotal);
    if (discount > 0) text += `\nتخفیف: ${formatPrice(discount)}`;
    const shippingCost = shippingCostForBasket(discountedBasketTotal);
    text += `\n🚚 هزینه ارسال: ${shippingCost ? formatPrice(shippingCost) : 'رایگان'}`;
    text += `\n💳 مبلغ قابل پرداخت: ${formatPrice(discountedBasketTotal + shippingCost)}`;
  }

  return { text, items, subtotal };
}
