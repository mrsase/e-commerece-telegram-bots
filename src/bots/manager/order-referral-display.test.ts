import { describe, expect, it } from "vitest";
import { OrderStatus } from "@prisma/client";
import { ManagerTexts } from "../../i18n/index.js";
import { buildOrderDetailText } from "./manager-bot-interactive.js";

describe("manager referral parent display", () => {
  it("shows the parent in a user's details", () => {
    const text = ManagerTexts.userDetails(2, "child", true, 3, true, 5, false, "ندارد", 3, false, "parent (#1)");
    expect(text).toContain("👤 معرف: parent (#1)");
  });

  it("shows the parent in order details", () => {
    const text = buildOrderDetailText({
      id: 88,
      status: OrderStatus.AWAITING_RECEIPT,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      subtotal: 1000,
      discountTotal: 0,
      grandTotal: 1000,
      user: {
        firstName: "Child",
        username: "child",
        phone: "+989121234567",
        address: "Address",
        locationLat: null,
        locationLng: null,
        locationText: null,
        referredBy: { id: 1, username: "parent_user", firstName: null },
        usedReferralCode: { createdByManagerId: null },
      },
      items: [{ product: { title: "Product" }, qty: 1, lineTotal: 1000 }],
      receipts: [],
      delivery: null,
      events: [],
    });

    expect(text).toContain("👤 معرف: parent\\_user (#1)");
  });
});
