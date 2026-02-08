import type { PrismaClient } from "@prisma/client";

export interface ReferralChainNode {
  userId: number;
  username: string | null;
  firstName: string | null;
  depth: number;
  orderCount: number;
  orderTotal: number;
  children: ReferralChainNode[];
}

export interface ChainStats {
  totalUsers: number;
  totalOrders: number;
  totalRevenue: number;
  maxDepth: number;
}

export class ReferralAnalyticsService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Walk referredById upward to find the full invite path from a user to root.
   * Returns array from root → … → user.
   */
  async getReferralChainUpward(userId: number): Promise<{ id: number; username: string | null; firstName: string | null }[]> {
    const chain: { id: number; username: string | null; firstName: string | null }[] = [];
    let currentId: number | null = userId;
    const visited = new Set<number>();

    while (currentId != null) {
      if (visited.has(currentId)) break; // prevent cycles
      visited.add(currentId);

      const found: { id: number; username: string | null; firstName: string | null; referredById: number | null } | null =
        await this.prisma.user.findUnique({
          where: { id: currentId },
          select: { id: true, username: true, firstName: true, referredById: true },
        });

      if (!found) break;
      chain.unshift({ id: found.id, username: found.username, firstName: found.firstName });
      currentId = found.referredById;
    }

    return chain;
  }

  /**
   * Build a full referral tree downward from a root user.
   * Includes order count and revenue per node.
   */
  async getReferralTree(rootUserId: number, maxDepth = 10): Promise<ReferralChainNode | null> {
    return this.buildNode(rootUserId, 0, maxDepth);
  }

  /**
   * Aggregate stats for an entire referral subtree.
   */
  async getChainStats(rootUserId: number): Promise<ChainStats> {
    const tree = await this.getReferralTree(rootUserId);
    if (!tree) return { totalUsers: 0, totalOrders: 0, totalRevenue: 0, maxDepth: 0 };

    const stats: ChainStats = { totalUsers: 0, totalOrders: 0, totalRevenue: 0, maxDepth: 0 };
    this.aggregateNode(tree, stats);
    return stats;
  }

  /**
   * Get all referral trees rooted at users who were invited by managers
   * (i.e., users whose referral code was created by a manager).
   */
  async getManagerReferralTrees(): Promise<ReferralChainNode[]> {
    // Find users who used a manager-created referral code (top-level invitees)
    const topUsers = await this.prisma.user.findMany({
      where: {
        referredById: null,
        usedReferralCode: { createdByManagerId: { not: null } },
      },
      select: { id: true },
    });

    const trees: ReferralChainNode[] = [];
    for (const u of topUsers) {
      const tree = await this.getReferralTree(u.id, 5);
      if (tree) trees.push(tree);
    }
    return trees;
  }

  private async buildNode(userId: number, depth: number, maxDepth: number): Promise<ReferralChainNode | null> {
    if (depth > maxDepth) return null;

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true, firstName: true },
    });
    if (!user) return null;

    const [orderAgg, children] = await Promise.all([
      this.prisma.order.aggregate({
        where: { userId },
        _count: { id: true },
        _sum: { grandTotal: true },
      }),
      this.prisma.user.findMany({
        where: { referredById: userId },
        select: { id: true },
      }),
    ]);

    const childNodes: ReferralChainNode[] = [];
    for (const child of children) {
      const node = await this.buildNode(child.id, depth + 1, maxDepth);
      if (node) childNodes.push(node);
    }

    return {
      userId: user.id,
      username: user.username,
      firstName: user.firstName,
      depth,
      orderCount: orderAgg._count.id,
      orderTotal: orderAgg._sum.grandTotal ?? 0,
      children: childNodes,
    };
  }

  private aggregateNode(node: ReferralChainNode, stats: ChainStats): void {
    stats.totalUsers += 1;
    stats.totalOrders += node.orderCount;
    stats.totalRevenue += node.orderTotal;
    stats.maxDepth = Math.max(stats.maxDepth, node.depth);

    for (const child of node.children) {
      this.aggregateNode(child, stats);
    }
  }
}

/**
 * Format a referral tree as indented text for display.
 */
export function formatReferralTree(node: ReferralChainNode, indent = ""): string {
  const label = node.username || node.firstName || `#${node.userId}`;
  let text = `${indent}${indent ? "└ " : ""}${label} (${node.orderCount} سفارش · ${node.orderTotal} تومان)\n`;
  node.children.forEach((child, i) => {
    const isLast = i === node.children.length - 1;
    text += formatReferralTree(child, indent + (isLast ? "  " : "│ "));
  });
  return text;
}
