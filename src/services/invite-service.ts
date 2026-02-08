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

    if (order.inviteLink) {
      return { inviteLink: order.inviteLink };
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

    await this.prisma.order.update({
      where: { id: order.id },
      data: {
        inviteLink,
        inviteSentAt: now,
        status: OrderStatus.INVITE_SENT,
        events: {
          create: {
            actorType: "system",
            actorId: null,
            eventType: "invite_created",
            payload: JSON.stringify({
              channelId,
              inviteLink,
            }),
          },
        },
      },
    });

    return { inviteLink };
  }
}
