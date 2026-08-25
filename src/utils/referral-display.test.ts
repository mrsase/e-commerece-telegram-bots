import { describe, expect, it } from "vitest";
import {
  compactReferralUserLabel,
  referralParentLabel,
  referralParentLabelMarkdown,
  referralUserLabel,
} from "./referral-display.js";

describe("referral display helpers", () => {
  it("shows an identifiable parent user", () => {
    expect(referralParentLabel({ id: 12, username: "parent_user", firstName: null })).toBe("parent_user (#12)");
    expect(referralUserLabel({ userId: 12, username: null, firstName: "Ali" })).toBe("Ali (#12)");
  });

  it("distinguishes direct manager invitations from missing legacy data", () => {
    expect(referralParentLabel(null, true)).toBe("دعوت مستقیم مدیر");
    expect(referralParentLabel(null, false)).toBe("— بدون معرف ثبت‌شده");
  });

  it("escapes dynamic Markdown and compacts long button text", () => {
    expect(referralParentLabelMarkdown({ id: 4, username: "a_b", firstName: null })).toBe("a\\_b (#4)");
    expect(compactReferralUserLabel({ id: 1, username: "abcdefghijklmnopqrstuvwxyz", firstName: null }, 10)).toBe("abcdefghi…");
  });
});
