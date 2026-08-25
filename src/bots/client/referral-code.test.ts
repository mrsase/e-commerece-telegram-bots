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
        in: ["REF_USER_1", "REF_USER_2", "REF_SELF_USER", "REF_VERIFIED_USER", "REF_PARENT_USER"],
      },
    },
  });
  await prisma.referralCode.deleteMany({
    where: { code: { in: ["ONE_TIME_CODE", "SELF_REF_CODE", "VERIFIED_REF_CODE"] } },
  });
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

  it("rejects self-referral without consuming the code", async () => {
    const user = await prisma.user.create({
      data: {
        tgUserId: BigInt(900003),
        referralCode: "REF_SELF_USER",
        canCreateReferral: true,
      },
    });
    const code = await prisma.referralCode.create({
      data: {
        code: "SELF_REF_CODE",
        createdByUserId: user.id,
        isActive: true,
      },
    });

    await expect(validateAndUseReferralCode(user.id, code.code, prisma)).resolves.toBe(false);
    const [freshUser, freshCode] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: user.id } }),
      prisma.referralCode.findUniqueOrThrow({ where: { id: code.id } }),
    ]);
    expect(freshUser.referredById).toBeNull();
    expect(freshUser.isVerified).toBe(false);
    expect(freshCode.usedCount).toBe(0);
    expect(freshCode.isActive).toBe(true);
  });

  it("does not re-parent an already verified user", async () => {
    const [verifiedUser, parent] = await Promise.all([
      prisma.user.create({
        data: {
          tgUserId: BigInt(900004),
          referralCode: "REF_VERIFIED_USER",
          isVerified: true,
        },
      }),
      prisma.user.create({
        data: {
          tgUserId: BigInt(900005),
          referralCode: "REF_PARENT_USER",
          isVerified: true,
        },
      }),
    ]);
    const code = await prisma.referralCode.create({
      data: {
        code: "VERIFIED_REF_CODE",
        createdByUserId: parent.id,
        isActive: true,
      },
    });

    await expect(validateAndUseReferralCode(verifiedUser.id, code.code, prisma)).resolves.toBe(false);
    const freshCode = await prisma.referralCode.findUniqueOrThrow({ where: { id: code.id } });
    expect(freshCode.usedCount).toBe(0);
    expect(freshCode.isActive).toBe(true);
  });
});
