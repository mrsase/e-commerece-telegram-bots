import { describe, expect, it, vi } from "vitest";
import type { Bot } from "grammy";
import type { PrismaClient } from "@prisma/client";
import { NotificationService } from "./notification-service.js";

function depsWithReferral(referredBy: { id: number; username: string | null; firstName: string | null } | null, createdByManagerId: number | null) {
  const sendMessage = vi.fn().mockResolvedValue({});
  const prisma = {
    manager: { findMany: vi.fn().mockResolvedValue([{ tgUserId: BigInt(1000), isActive: true }]) },
    order: {
      findUnique: vi.fn().mockResolvedValue({
        user: { referredBy, usedReferralCode: { createdByManagerId } },
      }),
    },
  } as unknown as PrismaClient;
  const managerBot = { api: { sendMessage } } as unknown as Bot;
  return { prisma, managerBot, sendMessage };
}

describe("NotificationService manager order referral context", () => {
  it("includes the parent user in every new-order manager notification", async () => {
    const { prisma, managerBot, sendMessage } = depsWithReferral(
      { id: 9, username: "parent_user", firstName: null },
      null,
    );
    const service = new NotificationService({ prisma, managerBot });

    await service.notifyManagersNewOrder(42, "Customer", "+989121234567", "Address", 1000, 0, 1000, [
      { title: "Product", qty: 1, lineTotal: 1000 },
    ]);

    expect(sendMessage).toHaveBeenCalledTimes(1);
    const [, text, options] = sendMessage.mock.calls[0];
    expect(text).toContain("👤 معرف: parent\\_user (#9)");
    expect(JSON.stringify(options)).toContain("mgr:user:9");
    expect(JSON.stringify(options)).toContain("mgr:ref:node:9:0");
  });

  it("labels manager-created root invitations without inventing a parent user", async () => {
    const { prisma, managerBot, sendMessage } = depsWithReferral(null, 5);
    const service = new NotificationService({ prisma, managerBot });

    await service.notifyManagersNewOrder(43, "Customer", null, null, 0, 0, 0, []);

    const [, text] = sendMessage.mock.calls[0];
    expect(text).toContain("👤 معرف: دعوت مستقیم مدیر");
  });
});
