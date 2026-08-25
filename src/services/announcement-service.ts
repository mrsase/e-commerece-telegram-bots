import {
  AnnouncementAudience,
  AnnouncementMediaType,
  AnnouncementType,
  DiscountType,
  type Announcement,
  type PrismaClient,
} from "@prisma/client";
import { GrammyError, type Bot, type InputFile } from "grammy";
import { formatPrice } from "../utils/format-price.js";
import { crossBotFile } from "../utils/cross-bot-file.js";

/** Telegram hard limits, measured in UTF-16 code units (what String#length counts). */
const TELEGRAM_CAPTION_MAX = 1024;
const TELEGRAM_TEXT_MAX = 4096;
/** Safe rendering margins below the Telegram hard limits. */
const CAPTION_SAFE_LIMIT = 1000;
const TEXT_SAFE_LIMIT = 4000;

/** Throttle between consecutive broadcast sends to stay under Telegram rate limits. */
const BROADCAST_DELAY_MS = 45;

/**
 * Media pre-fetched once by `broadcast` so that early per-recipient failures
 * (blocked chats, chat-not-found, …) never trigger a repeated cross-bot
 * download:
 * - `{ upload }` holds the downloaded InputFile, reused by every recipient
 *   until a successful send caches a client-bot file_id.
 * - `{ unavailable: true }` marks a failed pre-download: recipients fail fast
 *   instead of each re-downloading the (apparently broken) source file.
 */
type PreparedMedia = { upload: InputFile } | { unavailable: true };

/**
 * Telegram reports a stale or otherwise invalid file_id (plus other file
 * payload problems) as a 400 whose description names the media. Chat-level
 * failures — 403 blocked, chat-not-found — are excluded so a perfectly valid
 * cache is never cleared because a single chat rejected the message.
 */
function isStaleFileIdError(error: unknown): boolean {
  if (!(error instanceof GrammyError) || error.error_code !== 400) return false;
  return /wrong file identifier|HTTP URL|file (is too|has no)|photo|video/i.test(error.description);
}

export function announcementTypeLabel(type: AnnouncementType): string {
  if (type === AnnouncementType.CLOSURE) return "اطلاعیه تعطیلی";
  return "اطلاعیه فروشگاه ایرانی";
}

export function formatAnnouncement(
  announcement: Pick<Announcement, "type" | "title" | "message" | "discountType" | "discountValue">,
): string {
  const icon = announcement.type === AnnouncementType.CLOSURE ? "⛔" : "📣";
  const lines: string[] = [];
  if (announcement.title.trim()) lines.push(`${icon} ${announcement.title.trim()}`);
  if (announcement.message.trim()) lines.push(announcement.message.trim());
  if (announcement.discountType && announcement.discountValue) {
    const discount = announcement.discountType === DiscountType.PERCENT
      ? `${announcement.discountValue}٪`
      : formatPrice(announcement.discountValue);
    lines.push(`🎁 تخفیف عمومی: ${discount}`);
  }
  return lines.join("\n\n");
}

/**
 * Truncate `text` to at most `maxLength` UTF-16 code units without splitting a
 * surrogate pair. Telegram counts caption/message lengths in UTF-16 code units,
 * so String#length is the correct measure; cutting mid-pair would corrupt text.
 */
function truncateUtf16(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  const boundary = text.charCodeAt(maxLength - 1);
  const end = boundary >= 0xd800 && boundary <= 0xdbff ? maxLength - 1 : maxLength;
  return text.slice(0, end);
}

function truncateWithEllipsis(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${truncateUtf16(text, maxLength - 1)}…`;
}

/**
 * Caption for a media announcement. Telegram media captions are limited to 1024
 * UTF-16 characters, so the formatted text is truncated (with an ellipsis) to
 * stay below the hard limit. `maxLength` is clamped to the Telegram limit.
 */
export function formatAnnouncementCaption(
  announcement: Pick<Announcement, "type" | "title" | "message" | "discountType" | "discountValue">,
  maxLength = CAPTION_SAFE_LIMIT,
): string {
  return truncateWithEllipsis(formatAnnouncement(announcement), Math.min(maxLength, TELEGRAM_CAPTION_MAX));
}

/**
 * Text for a text-only announcement. Telegram text messages are limited to 4096
 * UTF-16 characters; truncate (with an ellipsis) to stay below the hard limit.
 * `maxLength` is clamped to the Telegram limit.
 */
export function formatAnnouncementText(
  announcement: Pick<Announcement, "type" | "title" | "message" | "discountType" | "discountValue">,
  maxLength = TEXT_SAFE_LIMIT,
): string {
  return truncateWithEllipsis(formatAnnouncement(announcement), Math.min(maxLength, TELEGRAM_TEXT_MAX));
}

export class AnnouncementService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly now: () => Date = () => new Date(),
    private readonly broadcastDelayMs: number = BROADCAST_DELAY_MS,
  ) {}

  async getActive(isTestUser = false): Promise<Announcement[]> {
    const now = this.now();
    return this.prisma.announcement.findMany({
      where: {
        isActive: true,
        startsAt: { lte: now },
        AND: [
          { OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
          { OR: [{ audience: AnnouncementAudience.ALL }, ...(isTestUser ? [{ audience: AnnouncementAudience.TEST }] : [])] },
        ],
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async getActiveClosure(isTestUser = false): Promise<Announcement | null> {
    const now = this.now();
    return this.prisma.announcement.findFirst({
      where: {
        type: AnnouncementType.CLOSURE,
        isActive: true,
        startsAt: { lte: now },
        AND: [
          { OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
          { OR: [{ audience: AnnouncementAudience.ALL }, ...(isTestUser ? [{ audience: AnnouncementAudience.TEST }] : [])] },
        ],
      },
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * Create an announcement. `mediaType`/`mediaFileId` are both optional and
   * independent of each other: rows without media (or legacy rows) render as
   * text, rows with media render as photo/video with an optional caption.
   */
  async create(args: {
    type: AnnouncementType;
    title: string;
    message?: string;
    discountType?: DiscountType | null;
    discountValue?: number | null;
    mediaType?: AnnouncementMediaType | null;
    mediaFileId?: string | null;
    audience?: AnnouncementAudience;
    managerId: number;
    durationDays: number | null;
  }): Promise<Announcement> {
    const startsAt = this.now();
    const endsAt = args.durationDays == null
      ? null
      : new Date(startsAt.getTime() + args.durationDays * 24 * 60 * 60 * 1000);

    return this.prisma.announcement.create({
      data: {
        type: args.type,
        audience: args.audience ?? AnnouncementAudience.ALL,
        title: args.title,
        message: args.message ?? "",
        discountType: args.type === AnnouncementType.GENERAL ? args.discountType : null,
        discountValue: args.type === AnnouncementType.GENERAL ? args.discountValue : null,
        mediaType: args.mediaType ?? null,
        mediaFileId: args.mediaFileId ?? null,
        startsAt,
        endsAt,
        createdByManagerId: args.managerId,
      },
    });
  }

  /**
   * Send one announcement to one chat.
   *
   * - Text-only announcements (no media, or media rows missing both file ids)
   *   keep the legacy behavior: a plain sendMessage.
   * - Photo/video announcements send the media with the caption if non-empty,
   *   or without a caption entirely if the announcement has no text.
   * - The manager bot's file_id is bot-scoped, so the first time a media
   *   announcement reaches the client bot it is downloaded and re-uploaded
   *   (crossBotFile) once; the resulting client-bot file_id is cached in the
   *   database and on the in-memory object, so every later send (broadcast to
   *   the rest of the audience, or replay to a user) reuses the cache.
   * - If a send that used the cached file_id fails with a file-id error
   *   (stale cache — e.g. the file was deleted on Telegram's side), the cache
   *   is cleared and the send is retried exactly once through the manager
   *   source file (`sourceBot`) or `preparedMedia` when available.
   *
   * `preparedMedia` is an optional broadcast-scoped media buffer; public
   * callers (client-bot replays) never pass it.
   */
  async sendToChat(
    announcement: Announcement,
    clientBot: Bot,
    chatId: string | number,
    sourceBot?: Bot,
    preparedMedia?: PreparedMedia,
  ): Promise<void> {
    if (!announcement.mediaType || (!announcement.clientMediaFileId && !announcement.mediaFileId)) {
      const text = formatAnnouncementText(announcement);
      if (text) await clientBot.api.sendMessage(chatId, text);
      return;
    }

    try {
      await this.sendMedia(announcement, clientBot, chatId, sourceBot, preparedMedia);
    } catch (error) {
      // The cached file_id wins over every other media source, so a failure
      // while one is set means the cache was used. If Telegram rejects it as
      // stale, clear the cache and retry once via the manager source file (or
      // the broadcast's buffered upload); any other error is propagated
      // unchanged so a valid cache survives chat-level failures.
      if (!announcement.clientMediaFileId || !isStaleFileIdError(error)) throw error;
      const canRetry =
        announcement.mediaFileId !== null &&
        (sourceBot !== undefined || (preparedMedia !== undefined && "upload" in preparedMedia));
      if (!canRetry) throw error;

      console.warn(
        `Cached media file_id for announcement ${announcement.id} was rejected; clearing cache and retrying via the source file.`,
      );
      await this.clearClientMediaFileId(announcement);
      await this.sendMedia(announcement, clientBot, chatId, sourceBot, preparedMedia);
    }
  }

  private async sendMedia(
    announcement: Announcement,
    clientBot: Bot,
    chatId: string | number,
    sourceBot: Bot | undefined,
    preparedMedia: PreparedMedia | undefined,
  ): Promise<void> {
    let media: string | InputFile;
    let needsClientFileId = false;

    if (announcement.clientMediaFileId) {
      media = announcement.clientMediaFileId;
    } else if (preparedMedia) {
      // Broadcast buffered the download up front: no network here. An explicit
      // `{ unavailable: true }` buffer is authoritative — recipients fail fast
      // instead of each re-downloading the (apparently broken) source file.
      if ("unavailable" in preparedMedia) {
        throw new Error("Announcement media is not available to the client bot");
      }
      media = preparedMedia.upload;
      needsClientFileId = true;
    } else if (sourceBot && announcement.mediaFileId) {
      media = await crossBotFile(sourceBot.api, sourceBot.token, announcement.mediaFileId);
      needsClientFileId = true;
    } else {
      throw new Error("Announcement media is not available to the client bot");
    }

    const caption = formatAnnouncementCaption(announcement);
    const captionOptions = caption ? { caption } : undefined;

    if (announcement.mediaType === AnnouncementMediaType.PHOTO) {
      const sent = await clientBot.api.sendPhoto(chatId, media, captionOptions);
      if (needsClientFileId) {
        const clientMediaFileId = sent.photo.at(-1)?.file_id;
        if (clientMediaFileId) await this.setClientMediaFileId(announcement, clientMediaFileId);
      }
      return;
    }

    const sent = await clientBot.api.sendVideo(chatId, media, captionOptions);
    if (needsClientFileId && sent.video) {
      await this.setClientMediaFileId(announcement, sent.video.file_id);
    }
  }

  /**
   * Broadcast to the announcement's audience (active, verified users; TEST
   * audience additionally requires isTestUser). Returns how many users were
   * targeted, sent, and failed. Per-user send errors are counted and logged,
   * never thrown.
   *
   * For media announcements the cross-bot download is buffered once up front
   * (see {@link PreparedMedia}), so early recipients that fail never trigger
   * repeated downloads.
   *
   * `broadcastAt` is only stamped when the broadcast actually delivered
   * something: a client bot was available, at least one user was targeted, and
   * at least one send succeeded. Fully failed attempts (every recipient
   * errored) and zero-target attempts are left unstamped, so the manager UI
   * never reports a failed/empty publish as successful.
   */
  async broadcast(
    announcement: Announcement,
    clientBot: Bot | undefined,
    sourceBot?: Bot,
  ): Promise<{ targeted: number; sent: number; failed: number }> {
    const users = await this.prisma.user.findMany({
      where: {
        isActive: true,
        isVerified: true,
        ...(announcement.audience === AnnouncementAudience.TEST ? { isTestUser: true } : {}),
      },
      select: { tgUserId: true },
    });

    if (!clientBot) return { targeted: users.length, sent: 0, failed: users.length };

    const hasDeliverableMedia = Boolean(
      announcement.mediaType && (announcement.clientMediaFileId || announcement.mediaFileId),
    );
    if (!hasDeliverableMedia && !formatAnnouncementText(announcement)) {
      return { targeted: users.length, sent: 0, failed: users.length };
    }

    // Pre-fetch the cross-bot media exactly once so per-recipient failures
    // that come after the download (blocked chats, chat-not-found, …) never
    // cause repeated downloads. A failed pre-download fails recipients fast.
    let preparedMedia: PreparedMedia | undefined;
    if (
      users.length > 0 &&
      announcement.mediaType &&
      !announcement.clientMediaFileId &&
      announcement.mediaFileId &&
      sourceBot
    ) {
      try {
        preparedMedia = { upload: await crossBotFile(sourceBot.api, sourceBot.token, announcement.mediaFileId) };
      } catch (error) {
        preparedMedia = { unavailable: true };
        console.error(`Failed to prepare media for announcement ${announcement.id}:`, error);
      }
    }

    let sent = 0;
    let failed = 0;
    for (const user of users) {
      try {
        await this.sendToChat(announcement, clientBot, user.tgUserId.toString(), sourceBot, preparedMedia);
        sent += 1;
      } catch (error) {
        failed += 1;
        console.error(`Failed to broadcast announcement ${announcement.id} to ${user.tgUserId}:`, error);
      }
      if (this.broadcastDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.broadcastDelayMs));
      }
    }

    // Mark the announcement as broadcast only on an actual successful delivery.
    if (users.length > 0 && sent > 0) {
      await this.prisma.announcement.update({
        where: { id: announcement.id },
        data: { broadcastAt: this.now() },
      });
    }
    return { targeted: users.length, sent, failed };
  }

  /** Write `clientMediaFileId` (or `null` to clear a stale cache) to the
   * database and the in-memory announcement. */
  private async setClientMediaFileId(announcement: Announcement, clientMediaFileId: string | null): Promise<void> {
    await this.prisma.announcement.update({
      where: { id: announcement.id },
      data: { clientMediaFileId },
    });
    announcement.clientMediaFileId = clientMediaFileId;
  }

  private async clearClientMediaFileId(announcement: Announcement): Promise<void> {
    await this.setClientMediaFileId(announcement, null);
  }
}
