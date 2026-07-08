import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { validateAndUseReferralCode } from "./client-bot-interactive.js";

let prisma: PrismaClient;

beforeAll(async () => {
  prisma = new PrismaClient();
  await prisma.$connect();
});

beforeEach(async () => {
  await prisma.user.deleteMany({
    where: {
      referralCode: {
        in: ["REF_USER_1", "REF_USER_2"],
      },
    },
  });
  await prisma.referralCode.deleteMany({ where: { code: "ONE_TIME_CODE" } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("validateAndUseReferralCode", () => {
  it("allows a referral code once and expires it immediately", async () => {
    const firstUser = await prisma.user.create({
      data: {
        tgUserId: BigInt(900001),
        referralCode: "REF_USER_1",
      },
    });
    const secondUser = await prisma.user.create({
      data: {
        tgUserId: BigInt(900002),
        referralCode: "REF_USER_2",
      },
    });
    const code = await prisma.referralCode.create({
      data: {
        code: "ONE_TIME_CODE",
        maxUses: 50,
        isActive: true,
      },
    });

    await expect(validateAndUseReferralCode(firstUser.id, code.code, prisma)).resolves.toBe(true);
    await expect(validateAndUseReferralCode(secondUser.id, code.code, prisma)).resolves.toBe(false);

    const usedCode = await prisma.referralCode.findUniqueOrThrow({
      where: { id: code.id },
    });
    expect(usedCode.usedCount).toBe(1);
    expect(usedCode.isActive).toBe(false);
    expect(usedCode.expiresAt).toBeInstanceOf(Date);

    const verifiedFirstUser = await prisma.user.findUniqueOrThrow({
      where: { id: firstUser.id },
    });
    const rejectedSecondUser = await prisma.user.findUniqueOrThrow({
      where: { id: secondUser.id },
    });
    expect(verifiedFirstUser.isVerified).toBe(true);
    expect(rejectedSecondUser.isVerified).toBe(false);
  });
});
