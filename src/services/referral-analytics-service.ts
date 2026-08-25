import type { PrismaClient } from "@prisma/client";
import { formatPrice } from "../utils/format-price.js";
import { escapeMarkdown } from "../utils/escape-markdown.js";

export interface ReferralChainNode {
  userId: number;
  username: string | null;
  firstName: string | null;
  depth: number;
  orderCount: number;
  orderTotal: number;
  loyaltyScore: number;
  children: ReferralChainNode[];
}

export interface ChainStats {
  totalUsers: number;
  totalOrders: number;
  totalRevenue: number;
  maxDepth: number;
}

export interface ReferralGraphNode {
  userId: number;
  username: string | null;
  firstName: string | null;
  referredById: number | null;
  loyaltyScore: number;
  isActive: boolean;
  isVerified: boolean;
  invitedByManager: boolean;
  directChildren: number;
  orderCount: number;
  orderTotal: number;
}

export interface ReferralNodeSummary extends ReferralGraphNode, ChainStats {
  descendantCount: number;
  cycleDetected: boolean;
}

export interface ReferralRootPage {
  roots: ReferralNodeSummary[];
  page: number;
  totalPages: number;
  totalRoots: number;
  totalNetworkUsers: number;
  totalOrders: number;
  totalRevenue: number;
}

export interface ReferralSubtreePage {
  node: ReferralGraphNode;
  parent: ReferralGraphNode | null;
  root: ReferralGraphNode;
  lineage: ReferralGraphNode[];
  stats: ChainStats & { descendantCount: number; cycleDetected: boolean };
  children: ReferralNodeSummary[];
  page: number;
  totalPages: number;
  totalChildren: number;
}

interface ReferralGraphSnapshot {
  nodes: Map<number, ReferralGraphNode>;
  childrenByParent: Map<number, number[]>;
}

interface AggregateResult extends ChainStats {
  cycleDetected: boolean;
}

const normalizePage = (page: number): number => Math.max(0, Math.trunc(Number.isFinite(page) ? page : 0));

export class ReferralAnalyticsService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Return a paginated overview of every verified top-level invitation tree.
   *
   * Unlike the old renderer, this performs two fixed queries and builds the
   * graph in memory. It never issues one query per user and never attempts to
   * put the full forest into one Telegram message.
   */
  async getRootPage(page = 0, pageSize = 6): Promise<ReferralRootPage> {
    const graph = await this.loadGraph();
    const roots = [...graph.nodes.values()].filter(
      (node) => node.referredById === null && (node.isVerified || node.directChildren > 0),
    );

    const summaries = roots
      .map((root) => this.toSummary(root, this.aggregateSubtree(graph, root.userId)))
      .sort((a, b) => b.totalUsers - a.totalUsers || b.totalRevenue - a.totalRevenue || a.userId - b.userId);

    const safePageSize = Math.max(1, Math.trunc(pageSize));
    const totalPages = Math.max(1, Math.ceil(summaries.length / safePageSize));
    const safePage = Math.min(normalizePage(page), totalPages - 1);
    const start = safePage * safePageSize;

    return {
      roots: summaries.slice(start, start + safePageSize),
      page: safePage,
      totalPages,
      totalRoots: summaries.length,
      totalNetworkUsers: summaries.reduce((sum, root) => sum + root.totalUsers, 0),
      totalOrders: summaries.reduce((sum, root) => sum + root.totalOrders, 0),
      totalRevenue: summaries.reduce((sum, root) => sum + root.totalRevenue, 0),
    };
  }

  /**
   * Return one node and a page of its direct children. Each child includes
   * aggregate statistics for its complete subtree, enabling drill-down without
   * rendering or querying every descendant separately.
   */
  async getSubtreePage(userId: number, page = 0, pageSize = 6): Promise<ReferralSubtreePage | null> {
    const graph = await this.loadGraph();
    const node = graph.nodes.get(userId);
    if (!node) return null;

    const lineage = this.buildLineage(graph, userId);
    const root = lineage[0] ?? node;
    const childIds = graph.childrenByParent.get(userId) ?? [];
    const childSummaries = childIds
      .map((childId) => graph.nodes.get(childId))
      .filter((child): child is ReferralGraphNode => child !== undefined)
      .map((child) => this.toSummary(child, this.aggregateSubtree(graph, child.userId)))
      .sort((a, b) => b.totalUsers - a.totalUsers || b.totalRevenue - a.totalRevenue || a.userId - b.userId);

    const safePageSize = Math.max(1, Math.trunc(pageSize));
    const totalPages = Math.max(1, Math.ceil(childSummaries.length / safePageSize));
    const safePage = Math.min(normalizePage(page), totalPages - 1);
    const start = safePage * safePageSize;
    const aggregate = this.aggregateSubtree(graph, userId);

    return {
      node,
      parent: node.referredById === null ? null : graph.nodes.get(node.referredById) ?? null,
      root,
      lineage,
      stats: {
        ...aggregate,
        descendantCount: Math.max(0, aggregate.totalUsers - 1),
      },
      children: childSummaries.slice(start, start + safePageSize),
      page: safePage,
      totalPages,
      totalChildren: childSummaries.length,
    };
  }

  /** Walk referredById upward and return root → … → user in two DB queries total. */
  async getReferralChainUpward(
    userId: number,
  ): Promise<{ id: number; username: string | null; firstName: string | null }[]> {
    const graph = await this.loadGraph();
    return this.buildLineage(graph, userId).map((node) => ({
      id: node.userId,
      username: node.username,
      firstName: node.firstName,
    }));
  }

  /** Backward-compatible full-tree API. Prefer getSubtreePage for bot UI. */
  async getReferralTree(rootUserId: number, maxDepth = 10): Promise<ReferralChainNode | null> {
    const graph = await this.loadGraph();
    return this.buildLegacyTree(graph, rootUserId, 0, Math.max(0, maxDepth), new Set<number>());
  }

  /** Aggregate stats for an entire referral subtree. */
  async getChainStats(rootUserId: number): Promise<ChainStats> {
    const graph = await this.loadGraph();
    if (!graph.nodes.has(rootUserId)) return { totalUsers: 0, totalOrders: 0, totalRevenue: 0, maxDepth: 0 };
    const stats = this.aggregateSubtree(graph, rootUserId);
    return {
      totalUsers: stats.totalUsers,
      totalOrders: stats.totalOrders,
      totalRevenue: stats.totalRevenue,
      maxDepth: stats.maxDepth,
    };
  }

  /** Backward-compatible manager-root API. Prefer getRootPage for bot UI. */
  async getManagerReferralTrees(): Promise<ReferralChainNode[]> {
    const graph = await this.loadGraph();
    const roots = [...graph.nodes.values()].filter(
      (node) => node.referredById === null && node.invitedByManager,
    );
    return roots
      .map((root) => this.buildLegacyTree(graph, root.userId, 0, 5, new Set<number>()))
      .filter((tree): tree is ReferralChainNode => tree !== null);
  }

  private async loadGraph(): Promise<ReferralGraphSnapshot> {
    const [users, orderAggregates] = await Promise.all([
      this.prisma.user.findMany({
        select: {
          id: true,
          username: true,
          firstName: true,
          referredById: true,
          loyaltyScore: true,
          loyaltyScoreOverride: true,
          isActive: true,
          isVerified: true,
          usedReferralCode: { select: { createdByManagerId: true } },
          _count: { select: { referrals: true } },
        },
        orderBy: { id: "asc" },
      }),
      this.prisma.order.groupBy({
        by: ["userId"],
        _count: { id: true },
        _sum: { grandTotal: true },
      }),
    ]);

    const ordersByUser = new Map(
      orderAggregates.map((aggregate) => [
        aggregate.userId,
        { count: aggregate._count.id, total: aggregate._sum.grandTotal ?? 0 },
      ]),
    );
    const nodes = new Map<number, ReferralGraphNode>();
    const childrenByParent = new Map<number, number[]>();

    for (const user of users) {
      const orders = ordersByUser.get(user.id) ?? { count: 0, total: 0 };
      nodes.set(user.id, {
        userId: user.id,
        username: user.username,
        firstName: user.firstName,
        referredById: user.referredById,
        loyaltyScore: user.loyaltyScoreOverride ?? user.loyaltyScore,
        isActive: user.isActive,
        isVerified: user.isVerified,
        invitedByManager: user.usedReferralCode?.createdByManagerId != null,
        directChildren: user._count.referrals,
        orderCount: orders.count,
        orderTotal: orders.total,
      });
      if (user.referredById !== null) {
        const children = childrenByParent.get(user.referredById) ?? [];
        children.push(user.id);
        childrenByParent.set(user.referredById, children);
      }
    }

    return { nodes, childrenByParent };
  }

  private aggregateSubtree(graph: ReferralGraphSnapshot, rootUserId: number): AggregateResult {
    const stats: AggregateResult = {
      totalUsers: 0,
      totalOrders: 0,
      totalRevenue: 0,
      maxDepth: 0,
      cycleDetected: false,
    };
    const stack: { userId: number; depth: number }[] = [{ userId: rootUserId, depth: 0 }];
    const visited = new Set<number>();

    while (stack.length > 0) {
      const current = stack.pop()!;
      if (visited.has(current.userId)) {
        stats.cycleDetected = true;
        continue;
      }
      visited.add(current.userId);
      const node = graph.nodes.get(current.userId);
      if (!node) continue;

      stats.totalUsers += 1;
      stats.totalOrders += node.orderCount;
      stats.totalRevenue += node.orderTotal;
      stats.maxDepth = Math.max(stats.maxDepth, current.depth);

      for (const childId of graph.childrenByParent.get(current.userId) ?? []) {
        stack.push({ userId: childId, depth: current.depth + 1 });
      }
    }

    return stats;
  }

  private buildLineage(graph: ReferralGraphSnapshot, userId: number): ReferralGraphNode[] {
    const lineage: ReferralGraphNode[] = [];
    const visited = new Set<number>();
    let currentId: number | null = userId;

    while (currentId !== null && !visited.has(currentId)) {
      visited.add(currentId);
      const node = graph.nodes.get(currentId);
      if (!node) break;
      lineage.unshift(node);
      currentId = node.referredById;
    }

    return lineage;
  }

  private toSummary(node: ReferralGraphNode, stats: AggregateResult): ReferralNodeSummary {
    return {
      ...node,
      ...stats,
      descendantCount: Math.max(0, stats.totalUsers - 1),
    };
  }

  private buildLegacyTree(
    graph: ReferralGraphSnapshot,
    userId: number,
    depth: number,
    maxDepth: number,
    visited: Set<number>,
  ): ReferralChainNode | null {
    if (depth > maxDepth || visited.has(userId)) return null;
    const node = graph.nodes.get(userId);
    if (!node) return null;

    visited.add(userId);
    const children = (graph.childrenByParent.get(userId) ?? [])
      .map((childId) => this.buildLegacyTree(graph, childId, depth + 1, maxDepth, visited))
      .filter((child): child is ReferralChainNode => child !== null);

    return {
      userId: node.userId,
      username: node.username,
      firstName: node.firstName,
      depth,
      orderCount: node.orderCount,
      orderTotal: node.orderTotal,
      loyaltyScore: node.loyaltyScore,
      children,
    };
  }
}

/** Format the legacy bounded tree API as indented text. */
export function formatReferralTree(node: ReferralChainNode, indent = ""): string {
  const label = escapeMarkdown(node.username || node.firstName || `#${node.userId}`);
  let text = `${indent}${indent ? "└ " : ""}${label} ⭐${node.loyaltyScore} (${node.orderCount} سفارش · ${formatPrice(node.orderTotal)})\n`;
  node.children.forEach((child, i) => {
    const isLast = i === node.children.length - 1;
    text += formatReferralTree(child, indent + (isLast ? "  " : "│ "));
  });
  return text;
}
