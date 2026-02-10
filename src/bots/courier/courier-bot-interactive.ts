import { Bot, Context, InlineKeyboard } from "grammy";
import type { Courier, PrismaClient } from "@prisma/client";
import { DeliveryStatus, OrderStatus } from "@prisma/client";
import { CourierTexts } from "../../i18n/index.js";
import { CourierKeyboards } from "../../utils/keyboards.js";

import { SessionStore } from "../../utils/session-store.js";
import { NotificationService } from "../../services/notification-service.js";

type SessionState = "delivery:fail:reason";

interface CourierSession {
  state: SessionState;
  deliveryId: number;
}

const courierSessions = new SessionStore<CourierSession>();

interface CourierBotDeps {
  prisma: PrismaClient;
  clientBot?: Bot;
  managerBot?: Bot;
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
  const { prisma, clientBot, managerBot } = deps;
  const notificationService = new NotificationService({ prisma, clientBot, managerBot });

  // Global error handler to prevent crashes
  bot.catch((err) => {
    console.error("Courier bot error:", err.message || err);
  });

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
        where: {
          assignedCourierId: courier.id,
          status: { not: DeliveryStatus.DELIVERED },
        },
        include: { order: { include: { user: true } } },
        orderBy: { updatedAt: "desc" },
        take: 20,
      });

      if (deliveries.length === 0) {
        await render(ctx, CourierTexts.noDeliveries(), CourierKeyboards.backToMenu());
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

    if (data === "courier:history") {
      await answerCallback(ctx);

      const deliveries = await prisma.delivery.findMany({
        where: {
          assignedCourierId: courier.id,
          status: DeliveryStatus.DELIVERED,
        },
        include: { order: true },
        orderBy: { deliveredAt: "desc" },
        take: 10,
      });

      if (deliveries.length === 0) {
        await render(ctx, "هیچ ارسال تکمیل‌شده‌ای ندارید.", CourierKeyboards.backToMenu());
        return;
      }

      let text = "📋 تاریخچه ارسال‌ها:\n\n";
      deliveries.forEach((d) => {
        const date = d.deliveredAt?.toISOString().split("T")[0] ?? "—";
        text += `✅ سفارش #${d.orderId} — ${date}\n`;
      });

      await render(ctx, text, CourierKeyboards.backToMenu());
      return;
    }

    // ── STATUS CHANGE — must be checked BEFORE courier:delivery: ──
    if (data.startsWith("courier:status:")) {
      const parts = data.split(":");
      const deliveryId = Number(parts[2]);
      const status = parts[3] as DeliveryStatus;

      if (!Number.isFinite(deliveryId) || !Object.values(DeliveryStatus).includes(status)) {
        await answerCallback(ctx, CourierTexts.invalidDelivery());
        return;
      }

      const delivery = await prisma.delivery.findUnique({
        where: { id: deliveryId },
        include: { order: { include: { user: true } } },
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
        await render(ctx, CourierTexts.askFailureReason(), CourierKeyboards.backToDelivery(deliveryId));
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

      const updatedDelivery = await prisma.delivery.update({
        where: { id: deliveryId },
        data: { status, ...timestampUpdate },
        include: { order: { include: { user: true } } },
      });

      // If delivered, mark order as COMPLETED
      if (status === DeliveryStatus.DELIVERED) {
        await prisma.order.update({
          where: { id: updatedDelivery.orderId },
          data: {
            status: OrderStatus.COMPLETED,
            events: {
              create: {
                actorType: "courier",
                actorId: courier.id,
                eventType: "delivery_completed",
              },
            },
          },
        });
      }

      const courierLabel = courier.username || `پیک #${courier.id}`;

      // Notify client about delivery status change
      if (updatedDelivery.order.user) {
        try {
          await notificationService.notifyClientDeliveryUpdate(
            updatedDelivery.order.user.tgUserId,
            updatedDelivery.orderId,
            statusLabel(status),
          );
        } catch (err) {
          console.error("[COURIER] Failed to notify client:", err);
        }
      }

      // Notify managers about delivery status change
      try {
        await notificationService.notifyManagersDeliveryStatusChange(
          updatedDelivery.orderId,
          statusLabel(status),
          courierLabel,
        );
      } catch (err) {
        console.error("[COURIER] Failed to notify managers:", err);
      }

      await answerCallback(ctx, CourierTexts.updated());

      // Go back to the delivery detail so courier sees the updated status
      const user = updatedDelivery.order.user;
      const details = CourierTexts.deliveryDetails({
        orderId: updatedDelivery.orderId,
        status: statusLabel(status),
        customerName: `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || "-",
        phone: user.phone ?? "-",
        address: user.address ?? "-",
        locationLat: user.locationLat,
        locationLng: user.locationLng,
      });
      await render(ctx, details, CourierKeyboards.deliveryActions(deliveryId, status));
      return;
    }

    // ── SEND LOCATION — sends location pin to courier ──
    if (data.startsWith("courier:location:")) {
      const deliveryId = Number(data.split(":")[2]);
      const delivery = await prisma.delivery.findUnique({
        where: { id: deliveryId },
        include: { order: { include: { user: true } } },
      });

      if (!delivery || delivery.assignedCourierId !== courier.id) {
        await answerCallback(ctx, CourierTexts.notFound());
        return;
      }

      const user = delivery.order.user;
      if (user.locationLat != null && user.locationLng != null) {
        await answerCallback(ctx);
        await ctx.replyWithLocation(user.locationLat, user.locationLng);
      } else {
        await answerCallback(ctx, "موقعیت مشتری ثبت نشده است.");
      }
      return;
    }

    // ── DELIVERY DETAIL ──
    if (data.startsWith("courier:delivery:")) {
      const deliveryId = Number(data.split(":")[2]);
      if (!Number.isFinite(deliveryId)) {
        await answerCallback(ctx, CourierTexts.invalidDelivery());
        return;
      }

      const delivery = await prisma.delivery.findUnique({
        where: { id: deliveryId },
        include: { order: { include: { user: true } } },
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
        locationLat: user.locationLat,
        locationLng: user.locationLng,
      });

      await answerCallback(ctx);
      await render(ctx, details, CourierKeyboards.deliveryActions(delivery.id, delivery.status));
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

      const failedDelivery = await prisma.delivery.update({
        where: { id: session.deliveryId },
        data: {
          status: DeliveryStatus.FAILED,
          failedAt: new Date(),
          failureReason: reason,
        },
        include: { order: { include: { user: true } } },
      });

      // Notify client and managers about delivery failure
      if (failedDelivery.order.user) {
        await notificationService.notifyClientDeliveryUpdate(
          failedDelivery.order.user.tgUserId,
          failedDelivery.orderId,
          statusLabel(DeliveryStatus.FAILED),
        );
      }
      await notificationService.notifyManagersDeliveryFailed(failedDelivery.orderId, reason);

      courierSessions.delete(Number(courier.tgUserId));
      await ctx.reply(CourierTexts.failureReasonSaved(), {
        reply_markup: CourierKeyboards.menu(),
      });
    }
  });
}
