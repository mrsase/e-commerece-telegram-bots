import { describe, expect, it } from "vitest";
import { referralShareMessage } from "./referral-share.js";

describe("referralShareMessage", () => {
  it("includes the code and a deep link when the bot username is available", () => {
    const message = referralShareMessage("MGR_ABC123", "@IranianShopBot");

    expect(message).toContain("MGR_ABC123");
    expect(message).toContain("https://t.me/IranianShopBot?start=MGR_ABC123");
  });

  it("keeps the code visible when the bot username is unavailable", () => {
    const message = referralShareMessage("MGR_ABC123");

    expect(message).toContain("MGR_ABC123");
    expect(message).toContain("لینک ربات هنوز تنظیم نشده است.");
  });
});
