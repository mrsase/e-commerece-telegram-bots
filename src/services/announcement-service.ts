import { AnnouncementType, DiscountType, type Announcement, type PrismaClient } from "@prisma/client";
import type { Bot } from "grammy";
import { formatPrice } from "../utils/format-price.js";

export function announcementTypeLabel(type: AnnouncementType): string {
  if (type === AnnouncementType.CLOSURE) return "اطلاعیه تعطیلی";
  return "اطلاعیه فروشگاه ایرانی";
}

export function formatAnnouncement(
  announcement: Pick<Announcement, "type" | "title" | "message" | "discountType" | "discountValue">,
): string {
  const icon = announcement.type === AnnouncementType.CLOSURE ? "⛔" : "📣";
  const lines = [`${icon} ${announcement.title}`];
  if (announcement.message.trim()) lines.push(announcement.message.trim());
  if (announcement.discountType && announcement.discountValue) {
    const discount = announcement.discountType === DiscountType.PERCENT
      ? `${announcement.discountValue}٪`
      : formatPrice(announcement.discountValue);
    lines.push(`🎁 تخفیف عمومی: ${discount}`);
  }
  return lines.join("\n\n");
}

export class AnnouncementService {
  constructor(private readonly prisma: PrismaClient, private readonly now: () => Date = () => new Date()) {}

  async getActive(): Promise<Announcement[]> {
    const now = this.now();
    return this.prisma.announcement.findMany({
      where: {
        isActive: true,
        startsAt: { lte: now },
        OR: [{ endsAt: null }, { endsAt: { gt: now } }],
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async getActiveClosure(): Promise<Announcement | null> {
    const now = this.now();
    return this.prisma.announcement.findFirst({
      where: {
        type: AnnouncementType.CLOSURE,
        isActive: true,
        startsAt: { lte: now },
        OR: [{ endsAt: null }, { endsAt: { gt: now } }],
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async create(args: {
    type: AnnouncementType;
    title: string;
    message?: string;
    discountType?: DiscountType | null;
    discountValue?: number | null;
    managerId: number;
    durationDays: number | null;
  }): Promise<Announcement> {
    const startsAt = this.now();
    const endsAt = args.durationDays == null
      ? null
      : new Date(startsAt.getTime() + args.durationDays * 24 * 60 * 60 * 1000);

    return this.prisma.announcement.create({
      data: {
        type: args.type,
        title: args.title,
        message: args.message ?? "",
        discountType: args.type === AnnouncementType.GENERAL ? args.discountType : null,
        discountValue: args.type === AnnouncementType.GENERAL ? args.discountValue : null,
        startsAt,
        endsAt,
        createdByManagerId: args.managerId,
      },
    });
  }

  async broadcast(announcement: Announcement, clientBot: Bot | undefined): Promise<{ targeted: number; sent: number; failed: number }> {
    const users = await this.prisma.user.findMany({
      where: { isActive: true, isVerified: true },
      select: { tgUserId: true },
    });

    if (!clientBot) return { targeted: users.length, sent: 0, failed: users.length };

    let sent = 0;
    let failed = 0;
    for (const user of users) {
      try {
        await clientBot.api.sendMessage(user.tgUserId.toString(), formatAnnouncement(announcement));
        sent += 1;
      } catch (error) {
        failed += 1;
        console.error("Failed to broadcast announcement:", error);
      }
      await new Promise((resolve) => setTimeout(resolve, 45));
    }

    await this.prisma.announcement.update({
      where: { id: announcement.id },
      data: { broadcastAt: this.now() },
    });
    return { targeted: users.length, sent, failed };
  }
}
