import { ClientTexts } from "../i18n/index.js";

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
export function buildCartDisplay(cartItems: CartDisplayItem[]): CartDisplayResult {
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
    text += `${item.title} x${item.qty} = ${lineTotal} ${item.currency}\n`;
  });
  text += `\n${ClientTexts.cartSubtotal(subtotal)}`;

  return { text, items, subtotal };
}
