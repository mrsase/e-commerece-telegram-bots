import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { ReferralAnalyticsService } from "./referral-analytics-service.js";

const users = [
  { id: 1, username: "root", firstName: null, referredById: null, loyaltyScore: 5, loyaltyScoreOverride: null, isActive: true, isVerified: true, usedReferralCode: { createdByManagerId: 10 }, _count: { referrals: 2 } },
  { id: 2, username: "branch", firstName: null, referredById: 1, loyaltyScore: 4, loyaltyScoreOverride: 7, isActive: true, isVerified: true, usedReferralCode: { createdByManagerId: null }, _count: { referrals: 1 } },
  { id: 3, username: "leaf", firstName: null, referredById: 1, loyaltyScore: 3, loyaltyScoreOverride: null, isActive: true, isVerified: true, usedReferralCode: { createdByManagerId: null }, _count: { referrals: 0 } },
  { id: 4, username: "deep", firstName: null, referredById: 2, loyaltyScore: 2, loyaltyScoreOverride: null, isActive: true, isVerified: true, usedReferralCode: { createdByManagerId: null }, _count: { referrals: 0 } },
  { id: 5, username: "second", firstName: null, referredById: null, loyaltyScore: 1, loyaltyScoreOverride: null, isActive: true, isVerified: true, usedReferralCode: { createdByManagerId: 10 }, _count: { referrals: 0 } },
  // A user waiting at the referral gate must not clutter the manager's root list.
  { id: 6, username: "waiting", firstName: null, referredById: null, loyaltyScore: 0, loyaltyScoreOverride: null, isActive: true, isVerified: false, usedReferralCode: null, _count: { referrals: 0 } },
  // Malformed legacy cycle: subtree traversal must terminate and report it.
  { id: 7, username: "cycle-a", firstName: null, referredById: 8, loyaltyScore: 0, loyaltyScoreOverride: null, isActive: true, isVerified: true, usedReferralCode: null, _count: { referrals: 1 } },
  { id: 8, username: "cycle-b", firstName: null, referredById: 7, loyaltyScore: 0, loyaltyScoreOverride: null, isActive: true, isVerified: true, usedReferralCode: null, _count: { referrals: 1 } },
];

const orderAggregates = [
  { userId: 1, _count: { id: 1 }, _sum: { grandTotal: 100 } },
  { userId: 2, _count: { id: 2 }, _sum: { grandTotal: 500 } },
  { userId: 4, _count: { id: 1 }, _sum: { grandTotal: 250 } },
  { userId: 5, _count: { id: 3 }, _sum: { grandTotal: 900 } },
];

function mockPrisma() {
  return {
    user: { findMany: vi.fn().mockResolvedValue(users) },
    order: { groupBy: vi.fn().mockResolvedValue(orderAggregates) },
  } as unknown as PrismaClient;
}

describe("ReferralAnalyticsService", () => {
  let prisma: PrismaClient;
  let service: ReferralAnalyticsService;

  beforeEach(() => {
    prisma = mockPrisma();
    service = new ReferralAnalyticsService(prisma);
  });

  it("paginates the main forest and sorts the largest tree first", async () => {
    const first = await service.getRootPage(0, 1);
    expect(first.totalRoots).toBe(2);
    expect(first.totalNetworkUsers).toBe(5);
    expect(first.totalOrders).toBe(7);
    expect(first.totalRevenue).toBe(1750);
    expect(first.totalPages).toBe(2);
    expect(first.roots[0]).toMatchObject({
      userId: 1,
      totalUsers: 4,
      descendantCount: 3,
      totalOrders: 4,
      totalRevenue: 850,
      maxDepth: 2,
    });

    const second = await service.getRootPage(1, 1);
    expect(second.roots.map((root) => root.userId)).toEqual([5]);
  });

  it("returns one paginated level with complete aggregate subtree stats", async () => {
    const view = await service.getSubtreePage(1, 0, 1);
    expect(view).not.toBeNull();
    expect(view?.root.userId).toBe(1);
    expect(view?.parent).toBeNull();
    expect(view?.totalChildren).toBe(2);
    expect(view?.totalPages).toBe(2);
    expect(view?.stats).toMatchObject({
      totalUsers: 4,
      descendantCount: 3,
      totalOrders: 4,
      totalRevenue: 850,
      maxDepth: 2,
      cycleDetected: false,
    });
    // The larger branch is shown first and remains drillable.
    expect(view?.children[0]).toMatchObject({ userId: 2, totalUsers: 2, totalOrders: 3, totalRevenue: 750 });
  });

  it("returns parent and root lineage for deep subtrees", async () => {
    const view = await service.getSubtreePage(4);
    expect(view?.parent?.userId).toBe(2);
    expect(view?.root.userId).toBe(1);
    expect(view?.lineage.map((node) => node.userId)).toEqual([1, 2, 4]);
    await expect(service.getReferralChainUpward(4)).resolves.toEqual([
      { id: 1, username: "root", firstName: null },
      { id: 2, username: "branch", firstName: null },
      { id: 4, username: "deep", firstName: null },
    ]);
  });

  it("terminates malformed cycles instead of recursing forever", async () => {
    const view = await service.getSubtreePage(7);
    expect(view?.stats.totalUsers).toBe(2);
    expect(view?.stats.cycleDetected).toBe(true);
    expect(view?.lineage.length).toBe(2);
  });

  it("uses a fixed two-query graph load rather than an N+1 query per user", async () => {
    await service.getSubtreePage(1);
    expect(prisma.user.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.order.groupBy).toHaveBeenCalledTimes(1);
  });
});
