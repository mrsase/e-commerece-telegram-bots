import type { Context } from "grammy";
import type { InlineKeyboard } from "grammy";

/**
 * Telegram API error-resilient message helpers.
 *
 * Wraps common reply methods so that "message is not modified",
 * "message to edit not found", "bot was blocked by the user", etc.
 * are caught gracefully instead of crashing the handler.
 */

function errorMessage(err: unknown): string {
  return err instanceof Error ? (err.message?.toLowerCase() ?? "") : String(err).toLowerCase();
}

function isIgnorableError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = errorMessage(err);
  return (
    msg.includes("message is not modified") ||
    msg.includes("message to edit not found") ||
    msg.includes("message can't be edited") ||
    msg.includes("message to delete not found") ||
    msg.includes("query is too old") ||
    msg.includes("bot was blocked by the user") ||
    msg.includes("user is deactivated") ||
    msg.includes("chat not found") ||
    msg.includes("have no rights to send a message")
  );
}

function isMessageNotModified(err: unknown): boolean {
  return errorMessage(err).includes("message is not modified");
}

function isExpectedEditFallback(err: unknown): boolean {
  const msg = errorMessage(err);
  return msg.includes("there is no text in the message to edit") ||
    msg.includes("message to edit not found") ||
    msg.includes("message can't be edited");
}

function isEntityParseError(err: unknown): boolean {
  const msg = errorMessage(err);
  return msg.includes("can't parse entities") || msg.includes("can't find end of the entity");
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

export async function safeDeleteChatMessage(
  api: { deleteMessage: (chatId: string | number, messageId: number) => Promise<unknown> },
  chatId: string | number,
  messageId: number,
): Promise<boolean> {
  try {
    await api.deleteMessage(chatId, messageId);
    return true;
  } catch (err) {
    if (isIgnorableError(err)) return false;
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
  let editError: unknown;
  let replyOptions = options;
  try {
    await ctx.editMessageText(text, options);
    return;
  } catch (err) {
    if (isMessageNotModified(err)) return;
    editError = err;
  }

  // User-provided text can contain incomplete Markdown. Preserve the message and
  // retry as plain text before considering delete + reply.
  if (options?.parse_mode && isEntityParseError(editError)) {
    const plainOptions = options.reply_markup ? { reply_markup: options.reply_markup } : {};
    replyOptions = plainOptions;
    try {
      await ctx.editMessageText(text, plainOptions);
      return;
    } catch (plainEditError) {
      if (isMessageNotModified(plainEditError)) return;
      editError = plainEditError;
    }
  }

  if (!isExpectedEditFallback(editError) && !isIgnorableError(editError)) {
    console.warn("safeRender: editMessageText failed, falling back to delete+reply:", errorMessage(editError));
  }

  try {
    await ctx.deleteMessage();
  } catch (deleteErr) {
    if (!isIgnorableError(deleteErr)) {
      console.warn("safeRender: deleteMessage failed:", errorMessage(deleteErr));
    }
  }

  try {
    await ctx.reply(text, replyOptions);
  } catch (firstErr) {
    const { parse_mode, ...rest } = replyOptions ?? {};
    if (parse_mode) {
      try {
        await ctx.reply(text, rest);
        return;
      } catch (secondErr) {
        console.warn("safeRender: reply failed:", errorMessage(secondErr));
      }
    } else {
      console.warn("safeRender: reply failed:", errorMessage(firstErr));
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
      console.warn(`safeSendMessage failed (ignorable) for chat ${chatId}:`, err instanceof Error ? err.message : err);
      return false;
    }
    throw err;
  }
}
