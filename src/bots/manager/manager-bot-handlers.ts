import type { PrismaClient, Manager } from "@prisma/client";
import { OrderStatus, ManagerRole } from "@prisma/client";
import { ManagerTexts } from "../../i18n/index.js";

export interface ManagerContext {
  from?: {
    id: number;
  };
  message?: {
    text?: string;
  };
  reply(text: string, options?: { parse_mode?: string }): Promise<unknown> | unknown;
}

export interface ManagerCommandBot {
  command(
    command: string,
    handler: (ctx: ManagerContext) => Promise<void> | void,
  ): void;
  catch?(handler: (err: unknown) => void): void;
}

export interface ManagerBotDeps {
  prisma: PrismaClient;
}

async function getManager(
  ctx: ManagerContext,
  prisma: PrismaClient,
): Promise<Manager | null> {
  const from = ctx.from;
  if (!from) {
    return null;
  }

  const tgUserId = BigInt(from.id);

  let manager = await prisma.manager.findUnique({
    where: { tgUserId },
  });

  if (manager) {
    return manager.isActive ? manager : null;
  }

  // Auto-register admin from env var if not in DB yet
  const adminTgUserId = process.env.ADMIN_TG_USER_ID;
  if (adminTgUserId && String(from.id) === adminTgUserId) {
    manager = await prisma.manager.create({
      data: {
        tgUserId,
        role: ManagerRole.ADMIN,
        isActive: true,
      },
    });
    console.log(`✓ Auto-registered admin manager (tgUserId: ${tgUserId})`);
    return manager;
  }

  return null;
}

export function registerManagerBotHandlers(
  bot: ManagerCommandBot,
  deps: ManagerBotDeps,
): void {
  const { prisma } = deps;

  if (bot.catch) {
    bot.catch((err) => {
      console.error("Manager bot handler error:", err instanceof Error ? err.message : err);
    });
  }

  bot.command("start", async (ctx) => {
    const manager = await getManager(ctx, prisma);
    if (!manager) {
      await ctx.reply(ManagerTexts.notAuthorized());
      return;
    }

    const pendingCount = await prisma.order.count({
      where: { status: OrderStatus.AWAITING_MANAGER_APPROVAL },
    });

    await ctx.reply(ManagerTexts.welcome(pendingCount));
  });

  bot.command("pending_orders", async (ctx) => {
    const manager = await getManager(ctx, prisma);
    if (!manager) {
      await ctx.reply(ManagerTexts.notAuthorized());
      return;
    }

    const orders = await prisma.order.findMany({
      where: { status: OrderStatus.AWAITING_MANAGER_APPROVAL },
      orderBy: { id: "asc" },
      take: 10,
      include: {
        user: true,
      },
    });

    if (orders.length === 0) {
      await ctx.reply(ManagerTexts.noPendingOrders());
      return;
    }

    const lines = orders.map(
      (o) => ManagerTexts.pendingOrderLine(o.id, o.userId, o.grandTotal),
    );

    await ctx.reply([ManagerTexts.pendingOrdersHeader(), ...lines].join("\n"));
  });

  bot.command("approve_order", async (ctx) => {
    const manager = await getManager(ctx, prisma);
    if (!manager) {
      await ctx.reply(ManagerTexts.notAuthorized());
      return;
    }

    const text = ctx.message?.text ?? "";
    const parts = text.trim().split(/\s+/);
    // Expect "/approve_order <orderId>"
    if (parts.length < 2) {
      await ctx.reply(ManagerTexts.approveUsage());
      return;
    }

    const orderId = Number(parts[1]);
    if (!Number.isFinite(orderId) || orderId <= 0) {
      await ctx.reply(ManagerTexts.approveUsage());
      return;
    }

    const claimed = await prisma.order.updateMany({
      where: { id: orderId, status: OrderStatus.AWAITING_MANAGER_APPROVAL },
      data: { status: OrderStatus.APPROVED },
    });

    if (claimed.count === 0) {
      await ctx.reply(ManagerTexts.orderNotFound());
      return;
    }

    await prisma.orderEvent.create({
      data: {
        orderId,
        actorType: "manager",
        actorId: manager.id,
        eventType: "order_approved",
      },
    });

    await ctx.reply(ManagerTexts.orderApproved(orderId));
  });

  bot.command("reject_order", async (ctx) => {
    const manager = await getManager(ctx, prisma);
    if (!manager) {
      await ctx.reply(ManagerTexts.notAuthorized());
      return;
    }

    const text = ctx.message?.text ?? "";
    const parts = text.trim().split(/\s+/);
    // Expect "/reject_order <orderId>"
    if (parts.length < 2) {
      await ctx.reply(ManagerTexts.rejectUsage());
      return;
    }

    const orderId = Number(parts[1]);
    if (!Number.isFinite(orderId) || orderId <= 0) {
      await ctx.reply(ManagerTexts.rejectUsage());
      return;
    }

    const claimed = await prisma.order.updateMany({
      where: { id: orderId, status: OrderStatus.AWAITING_MANAGER_APPROVAL },
      data: { status: OrderStatus.CANCELLED },
    });

    if (claimed.count === 0) {
      await ctx.reply(ManagerTexts.orderNotFound());
      return;
    }

    await prisma.orderEvent.create({
      data: {
        orderId,
        actorType: "manager",
        actorId: manager.id,
        eventType: "order_rejected",
      },
    });

    await ctx.reply(ManagerTexts.orderRejected(orderId));
  });

  bot.command("help", async (ctx) => {
    const manager = await getManager(ctx, prisma);
    if (!manager) {
      await ctx.reply(ManagerTexts.notAuthorized());
      return;
    }

    await ctx.reply(ManagerTexts.helpMessage(), { parse_mode: "Markdown" });
  });
}
