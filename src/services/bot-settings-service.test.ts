import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { BotSettingsService } from "./bot-settings-service.js";

describe("BotSettingsService payment details", () => {
  let prisma: PrismaClient;
  let service: BotSettingsService;

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();
    service = new BotSettingsService(prisma);
    await service.deletePaymentCardDetails();
    await service.deletePaymentShebaDetails();
  });

  afterAll(async () => {
    await service.deletePaymentCardDetails();
    await service.deletePaymentShebaDetails();
    await prisma.$disconnect();
  });

  it("stores and reads card and Sheba details as complete pairs", async () => {
    await service.setPaymentCardDetails("6219861928504819", "علی رضایی");
    await service.setPaymentShebaDetails("IR123456789012345678901234", "شرکت نمونه");

    await expect(service.getPaymentDetails()).resolves.toEqual({
      cardNumber: "6219861928504819",
      cardHolderName: "علی رضایی",
      shebaNumber: "IR123456789012345678901234",
      shebaHolderName: "شرکت نمونه",
    });
  });

  it("deletes each payment method together without affecting the other", async () => {
    await service.deletePaymentCardDetails();

    await expect(service.getPaymentDetails()).resolves.toEqual({
      cardNumber: null,
      cardHolderName: null,
      shebaNumber: "IR123456789012345678901234",
      shebaHolderName: "شرکت نمونه",
    });
  });
});
