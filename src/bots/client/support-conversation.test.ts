import { PrismaClient, SupportConversationStatus } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  isAllowedDuringOnboarding,
  isInMandatoryOnboarding,
  resolveSupportConversationForUser,
  type ClientSession,
} from "./client-bot-interactive.js";

describe("isAllowedDuringOnboarding", () => {
  it("allows inert noop and support/help actions", () => {
    expect(isAllowedDuringOnboarding("noop")).toBe(true);
    expect(isAllowedDuringOnboarding("client:support")).toBe(true);
    expect(isAllowedDuringOnboarding("client:help")).toBe(true);
    expect(isAllowedDuringOnboarding("client:support:close:5")).toBe(true);
    expect(isAllowedDuringOnboarding("client:support:reply:5")).toBe(true);
  });

  it("blocks every store action during onboarding", () => {
    expect(isAllowedDuringOnboarding("client:menu")).toBe(false);
    expect(isAllowedDuringOnboarding("client:products")).toBe(false);
    expect(isAllowedDuringOnboarding("client:cart")).toBe(false);
    expect(isAllowedDuringOnboarding("client:checkout")).toBe(false);
    expect(isAllowedDuringOnboarding("client:checkout:cancel")).toBe(false);
    expect(isAllowedDuringOnboarding("client:receipt:cancel")).toBe(false);
    expect(isAllowedDuringOnboarding("client:profile")).toBe(false);
    expect(isAllowedDuringOnboarding("client:qty:inc:3")).toBe(false);
    expect(isAllowedDuringOnboarding("client:referral:generate")).toBe(false);
    expect(isAllowedDuringOnboarding("client:orders")).toBe(false);
  });
});

describe("isInMandatoryOnboarding", () => {
  it("is false when there is no session or no onboarding marker", () => {
    expect(isInMandatoryOnboarding(undefined)).toBe(false);
    expect(isInMandatoryOnboarding({} as ClientSession)).toBe(false);
    expect(isInMandatoryOnboarding({ state: "checkout_location" })).toBe(false);
    expect(isInMandatoryOnboarding({ state: "checkout_phone" })).toBe(false);
  });

  it("is true only while the session carries the onboarding marker", () => {
    expect(isInMandatoryOnboarding({ state: "checkout_location", afterLocation: "onboarding" })).toBe(true);
    // Even after moving into support, the marker still marks the user as mid-onboarding.
    expect(isInMandatoryOnboarding({ state: "support_message", afterLocation: "onboarding", supportConversationId: 3 })).toBe(true);
  });
});

const prisma = new PrismaClient();

async function seedUser(tgId: bigint) {
  return prisma.user.create({
    data: {
      tgUserId: tgId,
      referralCode: `SUP_CONV_${tgId}`,
      isVerified: true,
      isActive: true,
    },
  });
}

describe("resolveSupportConversationForUser", () => {
  beforeEach(async () => {
    await prisma.supportMessage.deleteMany();
    await prisma.supportConversation.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await prisma.supportMessage.deleteMany();
    await prisma.supportConversation.deleteMany();
    await prisma.user.deleteMany();
    await prisma.$disconnect();
  });

  it("returns the user's own open conversation when the id matches", async () => {
    const user = await seedUser(910001n);
    const conversation = await prisma.supportConversation.create({
      data: { userId: user.id },
    });

    const resolved = await resolveSupportConversationForUser(prisma, user.id, conversation.id);

    expect(resolved?.id).toBe(conversation.id);
    expect(resolved?.userId).toBe(user.id);
    expect(resolved?.status).toBe(SupportConversationStatus.OPEN);
  });

  it("never resolves to another user's conversation — falls back to the owner's own", async () => {
    const owner = await seedUser(910002n);
    const attacker = await seedUser(910003n);
    const victimsConversation = await prisma.supportConversation.create({
      data: { userId: attacker.id },
    });
    const ownersConversation = await prisma.supportConversation.create({
      data: { userId: owner.id },
    });

    // Attempting to write into the victim's conversation id must resolve to the owner's own chat.
    const resolved = await resolveSupportConversationForUser(prisma, owner.id, victimsConversation.id);

    expect(resolved?.id).toBe(ownersConversation.id);
    expect(resolved?.userId).toBe(owner.id);
    const untouched = await prisma.supportConversation.findUnique({ where: { id: victimsConversation.id } });
    expect(untouched?.userId).toBe(attacker.id);
    expect(untouched?.status).toBe(SupportConversationStatus.OPEN);
  });

  it("creates a fresh conversation when a foreign id is given and the user has none", async () => {
    const owner = await seedUser(910004n);
    const other = await seedUser(910005n);
    const otherConversation = await prisma.supportConversation.create({
      data: { userId: other.id },
    });

    const resolved = await resolveSupportConversationForUser(prisma, owner.id, otherConversation.id);

    expect(resolved).not.toBeNull();
    expect(resolved!.userId).toBe(owner.id);
    expect(resolved!.id).not.toBe(otherConversation.id);
    expect(await prisma.supportConversation.count({ where: { userId: owner.id } })).toBe(1);
  });

  it("reopens the user's own closed conversation instead of orphaning the message", async () => {
    const user = await seedUser(910006n);
    const conversation = await prisma.supportConversation.create({
      data: { userId: user.id, status: SupportConversationStatus.CLOSED },
    });

    const resolved = await resolveSupportConversationForUser(prisma, user.id, conversation.id);

    expect(resolved?.id).toBe(conversation.id);
    expect(resolved?.status).toBe(SupportConversationStatus.OPEN);
  });

  it("falls back to the existing open conversation when the stored id is stale", async () => {
    const user = await seedUser(910007n);
    const staleId = 999999;
    const open = await prisma.supportConversation.create({
      data: { userId: user.id },
    });

    const resolved = await resolveSupportConversationForUser(prisma, user.id, staleId);

    expect(resolved?.id).toBe(open.id);
  });

  it("creates an open conversation when the user has none at all", async () => {
    const user = await seedUser(910008n);

    const resolved = await resolveSupportConversationForUser(prisma, user.id);

    expect(resolved).not.toBeNull();
    expect(resolved!.userId).toBe(user.id);
    expect(resolved!.status).toBe(SupportConversationStatus.OPEN);
  });
});