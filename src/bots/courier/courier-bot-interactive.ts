import { Bot, Context, InlineKeyboard } from "grammy";
import type { Courier, PrismaClient } from "@prisma/client";
import { DeliveryStatus } from "@prisma/client";
import { CourierTexts } from "../../i18n/index.js";
import { CourierKeyboards } from "../../utils/keyboards.js";

type SessionState = "delivery:fail:reason";

const courierSessions = new Map<
  number,
  {
    state: SessionState;
    deliveryId: number;
  }
>();

interface CourierBotDeps {
  prisma: PrismaClient;
}

async function getCourier(ctx: Context, prisma: PrismaClient): Promise<Courier | null> {
  if (!ctx.from) return null;

  const tgUserId = BigInt(ctx.from.id);
  const courier = await prisma.courier.findUnique({ where: { tgUserId } });
  if (!courier || !courier.isActive) return null;
  return courier;
}

async function answerCallback(ctx: Context, text?: string): Promise<void> {
  if (!ctx.callbackQuery) return;
  try {
    await ctx.answerCallbackQuery(text ? { text } : undefined);
  } catch {
    return;
  }
}

async function render(
  ctx: Context,
  text: string,
  keyboard?: InlineKeyboard
): Promise<void> {
  if (ctx.callbackQuery?.message) {
    try {
      await ctx.editMessageText(text, {
        reply_markup: keyboard,
      });
      return;
    } catch {
      // fall through
    }
  }

  await ctx.reply(text, {
    reply_markup: keyboard,
  });
}

function statusLabel(status: DeliveryStatus): string {
  switch (status) {
    case DeliveryStatus.ASSIGNED:
      return CourierTexts.statusAssigned();
    case DeliveryStatus.PICKED_UP:
      return CourierTexts.statusPickedUp();
    case DeliveryStatus.OUT_FOR_DELIVERY:
      return CourierTexts.statusOutForDelivery();
    case DeliveryStatus.DELIVERED:
      return CourierTexts.statusDelivered();
    case DeliveryStatus.FAILED:
      return CourierTexts.statusFailed();
    default:
      return status;
  }
}

export function registerInteractiveCourierBot(bot: Bot, deps: CourierBotDeps): void {
  const { prisma } = deps;

  bot.command("start", async (ctx) => {
    const courier = await getCourier(ctx, prisma);
    if (!courier) {
      await ctx.reply(CourierTexts.notAuthorized());
      return;
    }

    await ctx.reply(CourierTexts.dashboardTitle(), {
      reply_markup: CourierKeyboards.menu(),
    });
  });

  bot.on("callback_query:data", async (ctx) => {
    const courier = await getCourier(ctx, prisma);
    if (!courier) {
      await answerCallback(ctx);
      await ctx.reply(CourierTexts.notAuthorized());
      return;
    }

    const data = ctx.callbackQuery.data;

    if (data === "courier:menu") {
      await answerCallback(ctx);
      await render(ctx, CourierTexts.dashboardTitle(), CourierKeyboards.menu());
      return;
    }

    if (data === "courier:deliveries") {
      await answerCallback(ctx);

      const deliveries = await prisma.delivery.findMany({
        where: { assignedCourierId: courier.id },
        include: {
          order: {
            include: {
              user: true,
            },
          },
        },
        orderBy: { updatedAt: "desc" },
        take: 20,
      });

      if (deliveries.length === 0) {
        await render(
          ctx,
          CourierTexts.noDeliveries(),
          CourierKeyboards.backToMenu()
        );
        return;
      }

      await render(
        ctx,
        CourierTexts.deliveriesTitle(),
        CourierKeyboards.deliveriesList(
          deliveries.map((d) => ({
            id: d.id,
            orderId: d.orderId,
            statusLabel: statusLabel(d.status),
          }))
        )
      );
      return;
    }

    if (data.startsWith("courier:delivery:")) {
      const parts = data.split(":");
      const deliveryId = Number(parts[2]);
      if (!Number.isFinite(deliveryId)) {
        await answerCallback(ctx, CourierTexts.invalidDelivery());
        return;
      }

      const delivery = await prisma.delivery.findUnique({
        where: { id: deliveryId },
        include: {
          order: {
            include: {
              user: true,
            },
          },
        },
      });

      if (!delivery || delivery.assignedCourierId !== courier.id) {
        await answerCallback(ctx, CourierTexts.notFound());
        return;
      }

      const user = delivery.order.user;
      const details = CourierTexts.deliveryDetails({
        orderId: delivery.orderId,
        status: statusLabel(delivery.status),
        customerName: `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || "-",
        phone: user.phone ?? "-",
        address: user.address ?? "-",
      });

      await answerCallback(ctx);
      await render(ctx, details, CourierKeyboards.deliveryActions(delivery.id));
      return;
    }

    if (data.startsWith("courier:delivery:set:")) {
      const parts = data.split(":");
      const deliveryId = Number(parts[3]);
      const status = parts[4] as DeliveryStatus;

      if (!Number.isFinite(deliveryId)) {
        await answerCallback(ctx, CourierTexts.invalidDelivery());
        return;
      }

      if (!Object.values(DeliveryStatus).includes(status)) {
        await answerCallback(ctx, CourierTexts.invalidDelivery());
        return;
      }

      const delivery = await prisma.delivery.findUnique({
        where: { id: deliveryId },
      });

      if (!delivery || delivery.assignedCourierId !== courier.id) {
        await answerCallback(ctx, CourierTexts.notFound());
        return;
      }

      if (status === DeliveryStatus.FAILED) {
        courierSessions.set(Number(courier.tgUserId), {
          state: "delivery:fail:reason",
          deliveryId,
        });
        await answerCallback(ctx);
        await render(
          ctx,
          CourierTexts.askFailureReason(),
          CourierKeyboards.backToDelivery(deliveryId)
        );
        return;
      }

      const now = new Date();
      const timestampUpdate =
        status === DeliveryStatus.PICKED_UP
          ? { pickedUpAt: now }
          : status === DeliveryStatus.OUT_FOR_DELIVERY
            ? { outForDeliveryAt: now }
            : status === DeliveryStatus.DELIVERED
              ? { deliveredAt: now }
              : {};

      await prisma.delivery.update({
        where: { id: deliveryId },
        data: {
          status,
          ...timestampUpdate,
        },
      });

      await answerCallback(ctx, CourierTexts.updated());
      await render(ctx, CourierTexts.statusUpdated(statusLabel(status)), CourierKeyboards.backToDeliveries());
      return;
    }

    await answerCallback(ctx);
  });

  bot.on("message:text", async (ctx) => {
    const courier = await getCourier(ctx, prisma);
    if (!courier) return;

    const session = courierSessions.get(Number(courier.tgUserId));
    if (!session) return;

    if (session.state === "delivery:fail:reason") {
      const reason = ctx.message.text.trim();
      if (!reason) {
        await ctx.reply(CourierTexts.askFailureReasonEmpty());
        return;
      }

      await prisma.delivery.update({
        where: { id: session.deliveryId },
        data: {
          status: DeliveryStatus.FAILED,
          failedAt: new Date(),
          failureReason: reason,
        },
      });

      courierSessions.delete(Number(courier.tgUserId));
      await ctx.reply(CourierTexts.failureReasonSaved(), {
        reply_markup: CourierKeyboards.menu(),
      });
    }
  });
}
