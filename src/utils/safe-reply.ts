import type { Context } from "grammy";
import type { InlineKeyboard } from "grammy";

/**
 * Telegram API error-resilient message helpers.
 *
 * Wraps common reply methods so that "message is not modified",
 * "message to edit not found", "bot was blocked by the user", etc.
 * are caught gracefully instead of crashing the handler.
 */

function isIgnorableError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message?.toLowerCase() ?? "";
  return (
    msg.includes("message is not modified") ||
    msg.includes("message to edit not found") ||
    msg.includes("message can't be edited") ||
    msg.includes("query is too old") ||
    msg.includes("bot was blocked by the user") ||
    msg.includes("user is deactivated") ||
    msg.includes("chat not found") ||
    msg.includes("have no rights to send a message")
  );
}

export async function safeEditMessageText(
  ctx: Context,
  text: string,
  options?: {
    parse_mode?: "Markdown" | "MarkdownV2" | "HTML";
    reply_markup?: InlineKeyboard;
  },
): Promise<boolean> {
  try {
    await ctx.editMessageText(text, options);
    return true;
  } catch (err) {
    if (isIgnorableError(err)) {
      return false;
    }
    throw err;
  }
}

export async function safeEditMessageReplyMarkup(
  ctx: Context,
  replyMarkup: InlineKeyboard,
): Promise<boolean> {
  try {
    await ctx.editMessageReplyMarkup({ reply_markup: replyMarkup });
    return true;
  } catch (err) {
    if (isIgnorableError(err)) {
      return false;
    }
    throw err;
  }
}

export async function safeDeleteMessage(ctx: Context): Promise<boolean> {
  try {
    await ctx.deleteMessage();
    return true;
  } catch (err) {
    if (isIgnorableError(err)) {
      return false;
    }
    throw err;
  }
}

export async function safeAnswerCallbackQuery(
  ctx: Context,
  options?: { text?: string; show_alert?: boolean },
): Promise<boolean> {
  try {
    await ctx.answerCallbackQuery(options);
    return true;
  } catch (err) {
    if (isIgnorableError(err)) {
      return false;
    }
    throw err;
  }
}

/**
 * Smart render: tries editMessageText first; if it fails (e.g. current message is
 * a photo, or message was already deleted), falls back to deleteMessage + reply.
 * This prevents message stacking in callback_query handlers.
 */
export async function safeRender(
  ctx: Context,
  text: string,
  options?: {
    parse_mode?: "Markdown" | "MarkdownV2" | "HTML";
    reply_markup?: InlineKeyboard;
  },
): Promise<void> {
  // First try to edit the existing message in place
  try {
    await ctx.editMessageText(text, options);
    return;
  } catch {
    // editMessageText failed — fall through to delete+reply
  }

  // Delete the old message (photo or stale), then send a new one
  try {
    await ctx.deleteMessage();
  } catch {
    // Ignore delete failures (message may already be gone)
  }

  try {
    await ctx.reply(text, options);
  } catch {
    // If Markdown fails, retry without parse_mode as a last resort
    const { parse_mode, ...rest } = options ?? {};
    if (parse_mode) {
      await ctx.reply(text, rest);
    }
  }
}

/**
 * Send a message to a chat via a bot API, ignoring "blocked" / "not found" errors.
 * Returns true if sent successfully.
 */
export async function safeSendMessage(
  botApi: { sendMessage: (chatId: string | number, text: string, options?: Record<string, unknown>) => Promise<unknown> },
  chatId: string | number,
  text: string,
  options?: Record<string, unknown>,
): Promise<boolean> {
  try {
    await botApi.sendMessage(chatId, text, options);
    return true;
  } catch (err) {
    if (isIgnorableError(err)) {
      console.warn(`safeSendMessage failed (ignorable) for chat ${chatId}:`, (err as Error).message);
      return false;
    }
    throw err;
  }
}
