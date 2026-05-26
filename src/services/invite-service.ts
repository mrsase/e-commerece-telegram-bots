import type { PrismaClient } from "@prisma/client";
import { OrderStatus } from "@prisma/client";

export interface TelegramInviteClient {
  createInviteLink(args: { chatId: string }): Promise<{ inviteLink: string }>;
}

export class OrderNotFoundError extends Error {
  constructor(message = "Order not found") {
    super(message);
    this.name = "OrderNotFoundError";
  }
}

export class OrderNotApprovedError extends Error {
  constructor(message = "Order is not approved") {
    super(message);
    this.name = "OrderNotApprovedError";
  }
}

export interface CreateInviteForOrderArgs {
  orderId: number;
  channelId: string;
}

export interface CreateInviteForOrderResult {
  inviteLink: string;
}

export class InviteService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly telegram: TelegramInviteClient,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async createInviteForApprovedOrder(
    args: CreateInviteForOrderArgs,
  ): Promise<CreateInviteForOrderResult> {
    const { orderId, channelId } = args;

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { user: true },
    });

    if (!order) {
      throw new OrderNotFoundError();
    }

    // If invite already exists, verify it came from a valid approval
    if (order.inviteLink) {
      if (order.status === OrderStatus.APPROVED || order.status === OrderStatus.INVITE_SENT) {
        return { inviteLink: order.inviteLink };
      }
      // Stale invite on a non-viable order — treat as missing and re-validate
    }

    if (order.status !== OrderStatus.APPROVED) {
      throw new OrderNotApprovedError(
        `Order ${order.id} status is ${order.status}, expected APPROVED`,
      );
    }

    const { inviteLink } = await this.telegram.createInviteLink({
      chatId: channelId,
    });

    const now = this.now();

    const updated = await this.prisma.order.updateMany({
      where: { id: order.id, status: OrderStatus.APPROVED },
      data: {
        inviteLink,
        inviteSentAt: now,
        status: OrderStatus.INVITE_SENT,
      },
    });

    if (updated.count === 0) {
      throw new OrderNotApprovedError(
        `Order ${order.id} was already claimed by another process (status changed)`,
      );
    }

    await this.prisma.orderEvent.create({
      data: {
        orderId: order.id,
        actorType: "system",
        actorId: null,
        eventType: "invite_created",
        payload: JSON.stringify({ channelId, inviteLink }),
      },
    });

    return { inviteLink };
  }
}
