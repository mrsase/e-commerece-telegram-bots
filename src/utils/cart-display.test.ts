import { describe, expect, it } from "vitest";
import { buildCartDisplay } from "./cart-display.js";

describe("buildCartDisplay", () => {
  it("builds text and items from cart data", () => {
    const result = buildCartDisplay([
      { productId: 1, title: "Item A", qty: 2, unitPrice: 1000, currency: "IRR" },
      { productId: 2, title: "Item B", qty: 1, unitPrice: 500, currency: "IRR" },
    ]);

    expect(result.items).toHaveLength(2);
    expect(result.items[0].productId).toBe(1);
    expect(result.items[0].qty).toBe(2);
    expect(result.subtotal).toBe(2500);
    expect(result.text).toContain("Item A");
    expect(result.text).toContain("Item B");
    expect(result.text).toContain("2,000");
  });

  it("handles empty cart", () => {
    const result = buildCartDisplay([]);
    expect(result.items).toHaveLength(0);
    expect(result.subtotal).toBe(0);
  });

  it("shows the shipping quote and total before checkout", () => {
    const result = buildCartDisplay([
      { productId: 1, title: "Item A", qty: 1, unitPrice: 6_100_000, currency: "IRR" },
    ], 5_900_000);
    expect(result.text).toContain("تخفیف: 200,000 تومان");
    expect(result.text).toContain("هزینه ارسال: 500,000 تومان");
    expect(result.text).toContain("مبلغ قابل پرداخت: 6,400,000 تومان");
  });
});
