import { AnnouncementType, ManagerRole, PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { AnnouncementService, formatAnnouncement } from "./announcement-service.js";

const prisma = new PrismaClient();
let managerId: number;
let now = new Date("2026-07-11T08:00:00.000Z");

describe("AnnouncementService", () => {
  beforeEach(async () => {
    const manager = await prisma.manager.upsert({
      where: { tgUserId: BigInt(990011) },
      update: { isActive: true },
      create: { tgUserId: BigInt(990011), role: ManagerRole.ADMIN, isActive: true },
    });
    managerId = manager.id;
    await prisma.announcement.deleteMany({ where: { createdByManagerId: managerId } });
    now = new Date("2026-07-11T08:00:00.000Z");
  });

  afterAll(async () => {
    await prisma.announcement.deleteMany({ where: { createdByManagerId: managerId } });
    await prisma.$disconnect();
  });

  it("blocks checkout only while a closure announcement is active", async () => {
    const service = new AnnouncementService(prisma, () => now);
    const announcement = await service.create({
      type: AnnouncementType.CLOSURE,
      message: "فروشگاه به مناسبت تعطیلات بسته است.",
      managerId,
      durationDays: 2,
    });

    expect((await service.getActiveClosure())?.id).toBe(announcement.id);

    now = new Date("2026-07-14T08:00:00.000Z");
    expect(await service.getActiveClosure()).toBeNull();
  });

  it("does not treat a promotion as a closure", async () => {
    const service = new AnnouncementService(prisma, () => now);
    const announcement = await service.create({
      type: AnnouncementType.PROMOTION,
      message: "پیشنهاد ویژه امروز",
      managerId,
      durationDays: 1,
    });

    expect(await service.getActiveClosure()).toBeNull();
    expect(formatAnnouncement(announcement)).toContain("🎁 پیشنهاد ویژه");
  });
});
