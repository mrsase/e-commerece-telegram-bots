import type { PrismaClient } from "@prisma/client";

/**
 * Well-known setting keys managed via the manager bot.
 * Env vars serve as initial defaults; DB values take priority once set.
 */
export const SettingKeys = {
  CHECKOUT_IMAGE_FILE_ID: "checkout_image_file_id",
  INVITE_EXPIRY_MINUTES: "invite_expiry_minutes",
  PAYMENT_METHOD: "payment_method",
} as const;

export type PaymentMethod = "channel" | "direct";

export class BotSettingsService {
  constructor(private readonly prisma: PrismaClient) {}

  async get(key: string): Promise<string | null> {
    try {
      const row = await this.prisma.botSettings.findUnique({ where: { key } });
      return row?.value ?? null;
    } catch (err) {
      // Table may not exist yet (prisma db push not run)
      console.warn("[BotSettings] Failed to read setting, table may not exist:", err instanceof Error ? err.message : err);
      return null;
    }
  }

  async set(key: string, value: string): Promise<void> {
    await this.prisma.botSettings.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });
  }

  async delete(key: string): Promise<void> {
    try {
      await this.prisma.botSettings.delete({ where: { key } });
    } catch (err) {
      // Key didn't exist — that's fine
      console.warn("[BotSettings] Failed to delete setting:", err instanceof Error ? err.message : err);
    }
  }

  /**
   * Get checkout image file_id.
   * Priority: DB → env fallback → null
   */
  async getCheckoutImageFileId(envFallback?: string): Promise<string | null> {
    const dbVal = await this.get(SettingKeys.CHECKOUT_IMAGE_FILE_ID);
    return dbVal ?? envFallback ?? null;
  }

  /**
   * Get invite expiry in minutes.
   * Priority: DB → env fallback → 60
   */
  async getInviteExpiryMinutes(envFallback?: number): Promise<number> {
    const dbVal = await this.get(SettingKeys.INVITE_EXPIRY_MINUTES);
    if (dbVal) {
      const parsed = parseInt(dbVal, 10);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
    return envFallback ?? 60;
  }

  /**
   * Get payment method: "channel" (post to checkout channel + invite) or "direct" (DM to client).
   * Default: "direct" (works without channel setup).
   */
  async getPaymentMethod(): Promise<PaymentMethod> {
    const val = await this.get(SettingKeys.PAYMENT_METHOD);
    return val === "channel" ? "channel" : "direct";
  }
}
