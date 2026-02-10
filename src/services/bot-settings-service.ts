import type { PrismaClient } from "@prisma/client";

/**
 * Well-known setting keys managed via the manager bot.
 * Env vars serve as initial defaults; DB values take priority once set.
 */
export const SettingKeys = {
  CHECKOUT_IMAGE_FILE_ID: "checkout_image_file_id",
  INVITE_EXPIRY_MINUTES: "invite_expiry_minutes",
} as const;

export class BotSettingsService {
  constructor(private readonly prisma: PrismaClient) {}

  async get(key: string): Promise<string | null> {
    try {
      const row = await this.prisma.botSettings.findUnique({ where: { key } });
      return row?.value ?? null;
    } catch {
      // Table may not exist yet (prisma db push not run)
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
    } catch {
      // Key didn't exist — that's fine
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
}
