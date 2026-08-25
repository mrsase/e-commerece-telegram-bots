import { InputFile } from "grammy";
import type { Api } from "grammy";

const CROSS_BOT_DOWNLOAD_TIMEOUT_MS = 30_000;
const inFlightDownloads = new Map<string, Promise<InputFile>>();

/**
 * Download a file from one bot and return an InputFile that any bot can upload.
 *
 * Telegram file_ids are bot-specific — a file_id obtained by bot A cannot be
 * used by bot B directly. Concurrent requests for the same source are folded
 * into one bounded download to avoid duplicate 20 MiB buffers in memory.
 */
export async function crossBotFile(
  api: Api,
  botToken: string,
  fileId: string,
): Promise<InputFile> {
  const key = `${botToken}:${fileId}`;
  const existing = inFlightDownloads.get(key);
  if (existing) return existing;

  const download = (async () => {
    const file = await api.getFile(fileId);
    if (!file.file_path) {
      throw new Error("Telegram did not return a file_path for this file_id");
    }
    const url = `https://api.telegram.org/file/bot${botToken}/${file.file_path}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(CROSS_BOT_DOWNLOAD_TIMEOUT_MS) });
    if (!res.ok) {
      throw new Error(`Failed to download file: ${res.status} ${res.statusText}`);
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    const ext = file.file_path.split(".").pop() || "jpg";
    return new InputFile(buffer, `file.${ext}`);
  })();

  inFlightDownloads.set(key, download);
  try {
    return await download;
  } finally {
    if (inFlightDownloads.get(key) === download) inFlightDownloads.delete(key);
  }
}
