import { InputFile } from "grammy";
import type { Api } from "grammy";

/**
 * Download a file from one bot and return an InputFile that any bot can upload.
 *
 * Telegram file_ids are bot-specific — a file_id obtained by bot A
 * cannot be used by bot B directly.  Telegram also cannot fetch its
 * own api.telegram.org download URLs, so we must download the bytes
 * ourselves and re-upload them.
 */
export async function crossBotFile(
  api: Api,
  botToken: string,
  fileId: string,
): Promise<InputFile> {
  const file = await api.getFile(fileId);
  if (!file.file_path) {
    throw new Error("Telegram did not return a file_path for this file_id");
  }
  const url = `https://api.telegram.org/file/bot${botToken}/${file.file_path}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download file: ${res.status} ${res.statusText}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  const ext = file.file_path.split(".").pop() || "jpg";
  return new InputFile(buffer, `file.${ext}`);
}
