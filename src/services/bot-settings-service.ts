import type { PrismaClient } from "@prisma/client";

/**
 * Well-known setting keys managed via the manager bot.
 * Env vars serve as initial defaults; DB values take priority once set.
 */
export const SettingKeys = {
  CHECKOUT_IMAGE_FILE_ID: "checkout_image_file_id",
  INVITE_EXPIRY_MINUTES: "invite_expiry_minutes",
  PAYMENT_CARD_NUMBER: "payment_card_number",
  PAYMENT_CARD_HOLDER_NAME: "payment_card_holder_name",
  PAYMENT_SHEBA_NUMBER: "payment_sheba_number",
  PAYMENT_SHEBA_HOLDER_NAME: "payment_sheba_holder_name",
  OUT_FOR_DELIVERY_MESSAGE: "out_for_delivery_message",
} as const;

export interface PaymentDetails {
  cardNumber: string | null;
  cardHolderName: string | null;
  shebaNumber: string | null;
  shebaHolderName: string | null;
}

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
   * Get the 16-digit payment card/account number from settings.
   * Returns null if not configured.
   */
  async getPaymentCardNumber(): Promise<string | null> {
    return this.get(SettingKeys.PAYMENT_CARD_NUMBER);
  }

  /** Get every configured checkout destination in one operation. */
  async getPaymentDetails(): Promise<PaymentDetails> {
    const [cardNumber, cardHolderName, shebaNumber, shebaHolderName] = await Promise.all([
      this.get(SettingKeys.PAYMENT_CARD_NUMBER),
      this.get(SettingKeys.PAYMENT_CARD_HOLDER_NAME),
      this.get(SettingKeys.PAYMENT_SHEBA_NUMBER),
      this.get(SettingKeys.PAYMENT_SHEBA_HOLDER_NAME),
    ]);

    return { cardNumber, cardHolderName, shebaNumber, shebaHolderName };
  }

  async setPaymentCardDetails(cardNumber: string, holderName: string): Promise<void> {
    await this.setPaymentPair(
      SettingKeys.PAYMENT_CARD_NUMBER,
      cardNumber,
      SettingKeys.PAYMENT_CARD_HOLDER_NAME,
      holderName,
    );
  }

  async deletePaymentCardDetails(): Promise<void> {
    await this.deletePaymentPair([
      SettingKeys.PAYMENT_CARD_NUMBER,
      SettingKeys.PAYMENT_CARD_HOLDER_NAME,
    ]);
  }

  async setPaymentShebaDetails(shebaNumber: string, holderName: string): Promise<void> {
    await this.setPaymentPair(
      SettingKeys.PAYMENT_SHEBA_NUMBER,
      shebaNumber,
      SettingKeys.PAYMENT_SHEBA_HOLDER_NAME,
      holderName,
    );
  }

  async deletePaymentShebaDetails(): Promise<void> {
    await this.deletePaymentPair([
      SettingKeys.PAYMENT_SHEBA_NUMBER,
      SettingKeys.PAYMENT_SHEBA_HOLDER_NAME,
    ]);
  }

  private async setPaymentPair(
    numberKey: string,
    numberValue: string,
    holderKey: string,
    holderValue: string,
  ): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.botSettings.upsert({
        where: { key: numberKey },
        update: { value: numberValue },
        create: { key: numberKey, value: numberValue },
      }),
      this.prisma.botSettings.upsert({
        where: { key: holderKey },
        update: { value: holderValue },
        create: { key: holderKey, value: holderValue },
      }),
    ]);
  }

  private async deletePaymentPair(keys: string[]): Promise<void> {
    await this.prisma.botSettings.deleteMany({ where: { key: { in: keys } } });
  }

  /**
   * Get the custom message sent to the user when the courier is out for delivery.
   * Returns null if not configured (falls back to default text).
   */
  async getOutForDeliveryMessage(): Promise<string | null> {
    return this.get(SettingKeys.OUT_FOR_DELIVERY_MESSAGE);
  }
}
