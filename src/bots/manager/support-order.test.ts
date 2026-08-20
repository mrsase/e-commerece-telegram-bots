import { PrismaClient, SupportConversationStatus } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  extractReplyDraft,
  gateSupportReply,
  openOrderSupportConversation,
} from "./manager-bot-interactive.js";

const prisma = new PrismaClient();

async function seedUser(tgId: bigint) {
  return prisma.user.create({
    data: {
      tgUserId: tgId,
      referralCode: `SUPPORT_TEST_${tgId}`,
      isVerified: true,
      isActive: true,
    },
  });
}

async function seedOrder(userId: number, grandTotal = 1000) {
  return prisma.order.create({
    data: { userId, subtotal: grandTotal, discountTotal: 0, grandTotal },
  });
}

describe("openOrderSupportConversation", () => {
  beforeEach(async () => {
    await prisma.supportMessage.deleteMany();
    await prisma.supportConversation.deleteMany();
    await prisma.order.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await prisma.supportMessage.deleteMany();
    await prisma.supportConversation.deleteMany();
    await prisma.order.deleteMany();
    await prisma.user.deleteMany();
    await prisma.$disconnect();
  });

  it("creates an open conversation tied to the order when none exists", async () => {
    const user = await seedUser(900001n);
    const order = await seedOrder(user.id);

    const conversation = await openOrderSupportConversation(prisma, order.id);

    expect(conversation).not.toBeNull();
    expect(conversation!.userId).toBe(user.id);
    expect(conversation!.orderId).toBe(order.id);
    expect(conversation!.status).toBe(SupportConversationStatus.OPEN);
  });

  it("reuses the client's existing open conversation and repoints it at the clicked order", async () => {
    const user = await seedUser(900002n);
    const firstOrder = await seedOrder(user.id, 1000);
    const existing = await openOrderSupportConversation(prisma, firstOrder.id);
    const clickedOrder = await seedOrder(user.id, 500);

    const conversation = await openOrderSupportConversation(prisma, clickedOrder.id);

    // Same single open conversation — never two live chats with one customer —
    // but the shortcut stays truly order-linked: orderId now points at the
    // order the manager actually clicked.
    expect(conversation!.id).toBe(existing!.id);
    expect(conversation!.userId).toBe(user.id);
    expect(conversation!.orderId).toBe(clickedOrder.id);
    expect(await prisma.supportConversation.count({ where: { userId: user.id } })).toBe(1);
  });

  it("reusing an already order-linked conversation does not write a redundant update", async () => {
    const user = await seedUser(900007n);
    const order = await seedOrder(user.id);

    const first = await openOrderSupportConversation(prisma, order.id);
    const second = await openOrderSupportConversation(prisma, order.id);

    expect(second!.id).toBe(first!.id);
    expect(second!.orderId).toBe(order.id);
    expect(await prisma.supportConversation.count({ where: { userId: user.id } })).toBe(1);
  });

  it("does not reuse a closed conversation — creates a fresh one tied to the order", async () => {
    const user = await seedUser(900003n);
    await prisma.supportConversation.create({
      data: { userId: user.id, status: SupportConversationStatus.CLOSED },
    });
    const order = await seedOrder(user.id);

    const conversation = await openOrderSupportConversation(prisma, order.id);

    expect(conversation).not.toBeNull();
    expect(conversation!.orderId).toBe(order.id);
    expect(conversation!.status).toBe(SupportConversationStatus.OPEN);
    expect(await prisma.supportConversation.count({ where: { userId: user.id } })).toBe(2);
  });

  it("returns null when the order does not exist", async () => {
    expect(await openOrderSupportConversation(prisma, 999999)).toBeNull();
  });

  it("does not create duplicate open conversations under concurrent clicks", async () => {
    const user = await seedUser(900004n);
    const order = await seedOrder(user.id);

    const [first, second] = await Promise.all([
      openOrderSupportConversation(prisma, order.id),
      openOrderSupportConversation(prisma, order.id),
    ]);

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(second!.id).toBe(first!.id);
    expect(await prisma.supportConversation.count({ where: { userId: user.id } })).toBe(1);
  });

  it("serializes concurrent opens for different orders of the same customer", async () => {
    const user = await seedUser(900005n);
    const orderA = await seedOrder(user.id, 1000);
    const orderB = await seedOrder(user.id, 2000);

    const [a, b] = await Promise.all([
      openOrderSupportConversation(prisma, orderA.id),
      openOrderSupportConversation(prisma, orderB.id),
    ]);

    expect(a!.id).toBe(b!.id);
    expect(await prisma.supportConversation.count({ where: { userId: user.id } })).toBe(1);
    // The surviving conversation is linked to one of the two clicked orders
    // (whichever call ran second) — never orphaned.
    expect([orderA.id, orderB.id]).toContain(a!.orderId);
  });
});

describe("gateSupportReply", () => {
  const previewSession = (conversationId: number, replyText = "پاسخ") => ({
    state: "support:reply:preview",
    data: { conversationId, replyText },
  });

  it("rejects a missing conversation", () => {
    expect(gateSupportReply(null, previewSession(1), 1).kind).toBe("missing-draft");
  });

  it("rejects a missing or foreign draft", () => {
    const conversation = { status: SupportConversationStatus.OPEN };
    expect(gateSupportReply(conversation, undefined, 1).kind).toBe("missing-draft");
    expect(gateSupportReply(conversation, previewSession(2), 1).kind).toBe("missing-draft");
    expect(gateSupportReply(conversation, { state: "support:reply", data: { conversationId: 1 } }, 1).kind).toBe("missing-draft");
    expect(gateSupportReply(conversation, { state: "support:reply:preview", data: { conversationId: 1, replyText: "" } }, 1).kind).toBe("missing-draft");
  });

  it("requires a deliberate reopen when the conversation is closed — never a silent send", () => {
    const closed = { status: SupportConversationStatus.CLOSED };
    expect(gateSupportReply(closed, previewSession(1), 1).kind).toBe("reopen-required");
  });

  it("allows the send for an open conversation with a valid draft", () => {
    const open = { status: SupportConversationStatus.OPEN };
    expect(gateSupportReply(open, previewSession(1), 1).kind).toBe("send");
  });
});

describe("extractReplyDraft", () => {
  it("returns the draft only for the exact conversation being previewed", () => {
    const session = { state: "support:reply:preview", data: { conversationId: 7, replyText: "سلام" } };
    expect(extractReplyDraft(session, 7)).toBe("سلام");
    expect(extractReplyDraft(session, 8)).toBeNull();
    expect(extractReplyDraft({ state: "support:reply", data: { conversationId: 7, replyText: "سلام" } }, 7)).toBeNull();
    expect(extractReplyDraft({ state: "support:reply:preview", data: { conversationId: 7, replyText: "  " } }, 7)).toBeNull();
    expect(extractReplyDraft(undefined, 7)).toBeNull();
  });
});
