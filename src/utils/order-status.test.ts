import { describe, expect, it } from "vitest";
import { OrderStatus } from "@prisma/client";
import { orderStatusLabel } from "./order-status.js";

describe("orderStatusLabel", () => {
  it("returns Persian label for each status", () => {
    expect(orderStatusLabel(OrderStatus.AWAITING_MANAGER_APPROVAL)).toContain("انتظار");
    expect(orderStatusLabel(OrderStatus.APPROVED)).toContain("تأیید");
    expect(orderStatusLabel(OrderStatus.INVITE_SENT)).toContain("ارسال");
    expect(orderStatusLabel(OrderStatus.AWAITING_RECEIPT)).toContain("رسید");
    expect(orderStatusLabel(OrderStatus.PAID)).toContain("پرداخت");
    expect(orderStatusLabel(OrderStatus.COMPLETED)).toContain("تکمیل");
    expect(orderStatusLabel(OrderStatus.CANCELLED)).toContain("لغو");
  });

  it("does not return raw enum value", () => {
    for (const status of Object.values(OrderStatus)) {
      const label = orderStatusLabel(status);
      expect(label).not.toBe(status);
    }
  });
});
