import type { PrismaClient } from "@prisma/client";
import { CartState } from "@prisma/client";

export interface CleanupCartsJobDeps {
  prisma: PrismaClient;
  now?: () => Date;
}

export interface CleanupCartsJobOptions {
  idleThresholdMs: number;
}

export async function expireIdleCarts(
  deps: CleanupCartsJobDeps,
  options: CleanupCartsJobOptions,
): Promise<number> {
  const now = deps.now?.() ?? new Date();
  const cutoff = new Date(now.getTime() - options.idleThresholdMs);

  const result = await deps.prisma.cart.updateMany({
    where: {
      state: CartState.ACTIVE,
      updatedAt: {
        lt: cutoff,
      },
    },
    data: {
      state: CartState.EXPIRED,
    },
  });

  return result.count;
}
