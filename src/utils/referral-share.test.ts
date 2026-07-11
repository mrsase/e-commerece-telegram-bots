import { describe, expect, it } from "vitest";
import { referralShareMessage } from "./referral-share.js";

describe("referralShareMessage", () => {
  it("includes the code and a deep link when the bot username is available", () => {
    const message = referralShareMessage("MGR_ABC123", "@IranianShopBot");

    expect(message).toContain("لینک اختصاصی دعوت به فروشگاه ایرانی :");
    expect(message).toContain("[https://t.me/IranianShopBot?start=MGR\\_ABC123](https://t.me/IranianShopBot?start=MGR_ABC123)");
    expect(message).toContain("کد معرفی شما در صورت نیاز و وارد نشدن از طریق لینک بالا : `MGR_ABC123`");
    expect(message).toContain("این لینک قابل استفاده‌ برای یک نفر می‌باشد.");
    expect(message).not.toContain("ساخته شد");
    expect(message).not.toContain("اعتبارش را از دست");
  });

  it("keeps the code visible when the bot username is unavailable", () => {
    const message = referralShareMessage("MGR_ABC123");

    expect(message).toContain("MGR_ABC123");
    expect(message).toContain("لینک ربات هنوز تنظیم نشده است.");
  });
});
