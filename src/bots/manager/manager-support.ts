import { SupportConversationStatus, type PrismaClient } from "@prisma/client";

/**
 * Serialize conversation creation per customer. This prevents duplicate open
 * conversations inside the single-process polling runtime.
 */
const conversationLocks = new Map<number, Promise<unknown>>();

function withConversationLock<T>(
  userId: number,
  fn: () => Promise<T>,
): Promise<T> {
  const previous = conversationLocks.get(userId) ?? Promise.resolve();
  const next = previous.then(fn, fn);
  const tracked = next.then(
    (value) => {
      conversationLocks.delete(userId);
      return value;
    },
    (error) => {
      conversationLocks.delete(userId);
      throw error;
    },
  );
  conversationLocks.set(userId, tracked);
  return tracked;
}

export type SupportReplyGate =
  | { kind: "send" }
  | { kind: "reopen-required" }
  | { kind: "missing-draft" };

export function extractReplyDraft(
  session: { state?: string; data?: Record<string, unknown> } | undefined,
  conversationId: number,
): string | null {
  if (session?.state !== "support:reply:preview") return null;
  if (session.data?.conversationId !== conversationId) return null;
  const replyText = session.data.replyText;
  if (typeof replyText !== "string" || !replyText.trim()) return null;
  return replyText;
}

export function gateSupportReply(
  conversation: { status: SupportConversationStatus } | null,
  session: { state?: string; data?: Record<string, unknown> } | undefined,
  conversationId: number,
): SupportReplyGate {
  if (!conversation) return { kind: "missing-draft" };
  if (extractReplyDraft(session, conversationId) === null)
    return { kind: "missing-draft" };
  if (conversation.status === SupportConversationStatus.CLOSED)
    return { kind: "reopen-required" };
  return { kind: "send" };
}

export async function resolveOrCreateOpenConversation(
  prisma: PrismaClient,
  userId: number,
) {
  return withConversationLock(userId, async () => {
    const existing = await prisma.supportConversation.findFirst({
      where: { userId, status: SupportConversationStatus.OPEN },
      orderBy: { createdAt: "desc" },
    });
    if (existing) return existing;

    return prisma.supportConversation.create({ data: { userId } });
  });
}

/** Resolve the customer's single open conversation and link it to an order. */
export async function openOrderSupportConversation(
  prisma: PrismaClient,
  orderId: number,
) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { userId: true },
  });
  if (!order) return null;

  const conversation = await resolveOrCreateOpenConversation(
    prisma,
    order.userId,
  );
  if (conversation.orderId === orderId) return conversation;

  return prisma.supportConversation.update({
    where: { id: conversation.id },
    data: { orderId },
  });
}
