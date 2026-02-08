import type { PrismaClient, Manager } from "@prisma/client";
import { OrderStatus } from "@prisma/client";
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

  const manager = await prisma.manager.findUnique({
    where: { tgUserId },
  });

  if (!manager || !manager.isActive) {
    return null;
  }

  return manager;
}

export function registerManagerBotHandlers(
  bot: ManagerCommandBot,
  deps: ManagerBotDeps,
): void {
  const { prisma } = deps;

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

    const order = await prisma.order.findUnique({ where: { id: orderId } });

    if (!order || order.status !== OrderStatus.AWAITING_MANAGER_APPROVAL) {
      await ctx.reply(ManagerTexts.orderNotFound());
      return;
    }

    await prisma.order.update({
      where: { id: orderId },
      data: {
        status: OrderStatus.APPROVED,
        events: {
          create: {
            actorType: "manager",
            actorId: manager.id,
            eventType: "order_approved",
          },
        },
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

    const order = await prisma.order.findUnique({ where: { id: orderId } });

    if (!order || order.status !== OrderStatus.AWAITING_MANAGER_APPROVAL) {
      await ctx.reply(ManagerTexts.orderNotFound());
      return;
    }

    await prisma.order.update({
      where: { id: orderId },
      data: {
        status: OrderStatus.CANCELLED,
        events: {
          create: {
            actorType: "manager",
            actorId: manager.id,
            eventType: "order_rejected",
          },
        },
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
