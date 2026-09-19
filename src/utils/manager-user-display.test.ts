import { describe, expect, it } from "vitest";
import { ManagerTexts } from "../i18n/texts.js";
import { ManagerKeyboards } from "./keyboards.js";

describe("manager user referral display", () => {
  it("labels manager-invited users and distinguishes pending access attempts", () => {
    const keyboard = ManagerKeyboards.userList([
      {
        id: 1,
        username: "manager_guest",
        isActive: true,
        isVerified: true,
        usedReferralCode: { createdByManagerId: 7 },
      },
      {
        id: 2,
        username: "pending_guest",
        isActive: true,
        isVerified: false,
        usedReferralCode: null,
      },
    ]);

    const labels = keyboard.inline_keyboard.flat().map((button) => button.text);
    expect(labels).toContain("✅ manager_guest · دعوت مدیر");
    expect(labels).toContain("⏳ pending_guest");
  });

  it("reports manager invitations separately in referral analytics", () => {
    const text = ManagerTexts.referralAnalytics(20, 4, 16, 16, 5, "0.8", "top_user");
    expect(text).toContain("کاربران معرفی‌شده: 16");
    expect(text).toContain("دعوت‌شده توسط مدیر: 5");
  });
});
