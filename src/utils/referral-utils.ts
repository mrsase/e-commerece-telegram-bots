import crypto from "crypto";
import type { PrismaClient } from "@prisma/client";

/**
 * Generate a random referral code.
 * @param prefix Optional prefix (e.g. "MGR_" for manager codes)
 * @param length Number of random characters (default 8)
 */
export function generateReferralCode(prefix = "", length = 8): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const randomBytes = crypto.randomBytes(length);
  let code = prefix;
  for (let i = 0; i < length; i++) {
    code += chars.charAt(randomBytes[i] % chars.length);
  }
  return code;
}

/**
 * Create a referral code with retry on unique constraint violation (P2002).
 */
export async function createReferralCodeWithRetry(
  prisma: PrismaClient,
  opts: {
    createdByUserId?: number;
    createdByManagerId?: number;
    maxUses?: number | null;
    prefix?: string;
    length?: number;
  },
  maxRetries = 3,
): Promise<string> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const code = generateReferralCode(opts.prefix ?? "", opts.length ?? 8);
    try {
      await prisma.referralCode.create({
        data: {
          code,
          createdByUserId: opts.createdByUserId ?? null,
          createdByManagerId: opts.createdByManagerId ?? null,
          maxUses: opts.maxUses ?? null,
        },
      });
      return code;
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        "code" in error &&
        (error as { code: string }).code === "P2002"
      ) {
        if (attempt === maxRetries - 1) {
          throw new Error(
            "Failed to generate unique referral code after multiple attempts",
          );
        }
        continue;
      }
      throw error;
    }
  }
  throw new Error("Failed to generate referral code");
}
