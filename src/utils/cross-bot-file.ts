import type { Api } from "grammy";

/**
 * Get a download URL for a file_id from a specific bot.
 * Telegram file_ids are bot-specific — a file_id obtained by bot A
 * cannot be used by bot B directly. This helper constructs a
 * temporary download URL that any bot can use to send the file.
 */
export async function getFileUrl(
  api: Api,
  botToken: string,
  fileId: string,
): Promise<string> {
  const file = await api.getFile(fileId);
  if (!file.file_path) {
    throw new Error("Telegram did not return a file_path for this file_id");
  }
  return `https://api.telegram.org/file/bot${botToken}/${file.file_path}`;
}
