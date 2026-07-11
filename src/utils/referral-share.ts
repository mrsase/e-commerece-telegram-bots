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
  const linkLabel = link?.replace(/_/g, "\\_");

  return [
    "لینک اختصاصی دعوت به فروشگاه ایرانی :",
    "",
    link && linkLabel ? `[${linkLabel}](${link})` : "لینک ربات هنوز تنظیم نشده است.",
    "",
    `کد معرفی شما در صورت نیاز و وارد نشدن از طریق لینک بالا : \`${code}\``,
    "",
    "این لینک قابل استفاده‌ برای یک نفر می‌باشد.",
  ].join("\n");
}
