import type { Bot } from "grammy";

function normalizeBotUsername(username: string | undefined): string | undefined {
  const normalized = username?.trim().replace(/^@/, "");
  return normalized || undefined;
}

export async function resolveClientBotUsername(bot: Bot | undefined, configuredUsername?: string): Promise<string | undefined> {
  const configured = normalizeBotUsername(configuredUsername);
  if (configured) return configured;

  try {
    const me = await bot?.api.getMe();
    return normalizeBotUsername(me?.username);
  } catch {
    return undefined;
  }
}

export function referralShareMessage(code: string, botUsername?: string): string {
  const username = normalizeBotUsername(botUsername);
  const link = username ? `https://t.me/${username}?start=${encodeURIComponent(code)}` : undefined;

  return [
    "✅ کد معرفی ساخته شد",
    `کد: ${code}`,
    "",
    "متن آماده برای ارسال به کاربر جدید:",
    "سلام! برای ورود به فروشگاه ایرانی از این لینک استفاده کن:",
    link ?? "لینک ربات هنوز تنظیم نشده است.",
    "",
    `اگر لینک باز نشد، در ربات کد ${code} را وارد کن.`,
    "این کد پس از اولین ورود اعتبارش را از دست می‌دهد.",
  ].join("\n");
}
