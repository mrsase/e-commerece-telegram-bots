import {
  AnnouncementAudience,
  AnnouncementMediaType,
  AnnouncementType,
  ManagerRole,
  PrismaClient,
} from "@prisma/client";
import { GrammyError, InputFile } from "grammy";
import type { Bot } from "grammy";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AnnouncementService,
  announcementTypeLabel,
  formatAnnouncement,
  formatAnnouncementCaption,
  formatAnnouncementText,
} from "./announcement-service.js";

const prisma = new PrismaClient();
let managerId: number;
let now = new Date("2026-07-11T08:00:00.000Z");

// ---------------------------------------------------------------------------
// Fake Telegram bots (no network): api methods are stubbed, `Bot` only exists
// so callers (sendToChat/broadcast) compile against the real grammY surface.
// Helpers return `{ bot, api }` — `bot` goes to the service, `api` is inspected.
// ---------------------------------------------------------------------------

interface FakeApi {
  sendMessage: ReturnType<typeof vi.fn>;
  sendPhoto: ReturnType<typeof vi.fn>;
  sendVideo: ReturnType<typeof vi.fn>;
  getFile: ReturnType<typeof vi.fn>;
}

interface FakeBot {
  bot: Bot;
  api: FakeApi;
}

function fakeApi(overrides: Partial<FakeApi> = {}): FakeApi {
  return {
    sendMessage: vi.fn(async () => ({ message_id: 1 })),
    sendPhoto: vi.fn(async () => ({
      message_id: 1,
      photo: [
        { file_id: "client-photo-small", width: 100, height: 100 },
        { file_id: "client-photo-large", width: 800, height: 800 },
      ],
    })),
    sendVideo: vi.fn(async () => ({
      message_id: 1,
      video: { file_id: "client-video-1", duration: 5, width: 640, height: 480 },
    })),
    getFile: vi.fn(async () => ({ file_id: "manager-file-1", file_path: "photos/announcement.jpg" })),
    ...overrides,
  };
}

function makeClientBot(apiOverrides: Partial<FakeApi> = {}): FakeBot {
  const api = fakeApi(apiOverrides);
  return { bot: { token: "123456:TEST-CLIENT", api } as unknown as Bot, api };
}

function makeSourceBot(apiOverrides: Partial<FakeApi> = {}): FakeBot {
  const api = fakeApi(apiOverrides);
  return { bot: { token: "654321:TEST-MANAGER", api } as unknown as Bot, api };
}

function stubFileDownload(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    statusText: "OK",
    arrayBuffer: async () => new ArrayBuffer(4),
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function makeGrammyError(errorCode: number, description: string): GrammyError {
  return new GrammyError(
    `Call to 'sendPhoto' failed!`,
    { ok: false, error_code: errorCode, description },
    "sendPhoto",
    {},
  );
}

function hasLoneSurrogate(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (i + 1 >= text.length || next < 0xdc00 || next > 0xdfff) return true;
      i += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Test users (unique referral codes) + cleanup
// ---------------------------------------------------------------------------

const createdUserIds: number[] = [];
let userSeq = 0;

async function createUser(overrides: {
  isActive?: boolean;
  isVerified?: boolean;
  isTestUser?: boolean;
} = {}): Promise<{ id: number; tgUserId: bigint }> {
  const user = await prisma.user.create({
    data: {
      tgUserId: BigInt(10_000_000 + userSeq),
      referralCode: `ANN_TEST_${userSeq++}`,
      isActive: true,
      isVerified: true,
      isTestUser: false,
      ...overrides,
    },
  });
  createdUserIds.push(user.id);
  return { id: user.id, tgUserId: user.tgUserId };
}

describe("AnnouncementService", () => {
  beforeEach(async () => {
    const manager = await prisma.manager.upsert({
      where: { tgUserId: BigInt(990011) },
      update: { isActive: true },
      create: { tgUserId: BigInt(990011), role: ManagerRole.ADMIN, isActive: true },
    });
    managerId = manager.id;
    await prisma.announcement.deleteMany({ where: { createdByManagerId: managerId } });
    // Self-heal against leftover users from an interrupted prior run: audience
    // counts in broadcast tests must start from a clean slate.
    await prisma.user.deleteMany({ where: { referralCode: { startsWith: "ANN_TEST_" } } });
    now = new Date("2026-07-11T08:00:00.000Z");
  });

  afterEach(async () => {
    if (createdUserIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
      createdUserIds.length = 0;
    }
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await prisma.announcement.deleteMany({ where: { createdByManagerId: managerId } });
    await prisma.$disconnect();
  });

  it("blocks checkout only while a closure announcement is active", async () => {
    const service = new AnnouncementService(prisma, () => now);
    const announcement = await service.create({
      type: AnnouncementType.CLOSURE,
      title: "تعطیلی فروشگاه",
      message: "فروشگاه به مناسبت تعطیلات بسته است.",
      managerId,
      durationDays: 2,
    });

    expect((await service.getActiveClosure())?.id).toBe(announcement.id);

    now = new Date("2026-07-14T08:00:00.000Z");
    expect(await service.getActiveClosure()).toBeNull();
  });

  it("formats a general announcement with an optional store-wide discount", async () => {
    const service = new AnnouncementService(prisma, () => now);
    const announcement = await service.create({
      type: AnnouncementType.GENERAL,
      title: "جشنواره تابستانی",
      discountType: "PERCENT",
      discountValue: 15,
      managerId,
      durationDays: 1,
    });

    expect(await service.getActiveClosure()).toBeNull();
    expect(formatAnnouncement(announcement)).toContain("📣 جشنواره تابستانی");
    expect(formatAnnouncement(announcement)).toContain("تخفیف عمومی: 15٪");
  });

  it("formats a fixed-amount store-wide discount in the announcement text", async () => {
    const service = new AnnouncementService(prisma, () => now);
    const announcement = await service.create({
      type: AnnouncementType.GENERAL,
      title: "تخفیف نقدی",
      discountType: "FIXED",
      discountValue: 25000,
      managerId,
      durationDays: 1,
    });

    expect(formatAnnouncement(announcement)).toContain("🎁 تخفیف عمومی: 25,000 تومان");
  });

  it("never attaches a discount to closure announcements", async () => {
    const service = new AnnouncementService(prisma, () => now);
    const announcement = await service.create({
      type: AnnouncementType.CLOSURE,
      title: "تعطیلی",
      discountType: "PERCENT",
      discountValue: 10,
      managerId,
      durationDays: 1,
    });

    expect(announcement.discountType).toBeNull();
    expect(announcement.discountValue).toBeNull();
    expect(formatAnnouncement(announcement)).not.toContain("تخفیف");
  });

  it("leaves an announcement open-ended when no duration is given", async () => {
    const service = new AnnouncementService(prisma, () => now);
    const announcement = await service.create({
      type: AnnouncementType.GENERAL,
      title: "بدون محدودیت",
      managerId,
      durationDays: null,
    });

    expect(announcement.endsAt).toBeNull();
    // Still active after the test clock advances arbitrarily far.
    now = new Date("2030-01-01T00:00:00.000Z");
    expect((await service.getActive()).map((a) => a.id)).toContain(announcement.id);
  });

  it("uses the system clock by default like the production bots do", async () => {
    const service = new AnnouncementService(prisma); // no injected clock
    const announcement = await service.create({
      type: AnnouncementType.CLOSURE,
      title: "تعطیلی",
      managerId,
      durationDays: 1,
    });

    expect(announcement.startsAt.getTime()).toBeLessThanOrEqual(Date.now());
    expect((await service.getActiveClosure())?.id).toBe(announcement.id);
  });

  it("keeps test-only announcements invisible to regular users", async () => {
    const service = new AnnouncementService(prisma, () => now);
    const announcement = await service.create({
      type: AnnouncementType.CLOSURE,
      title: "تعطیلی آزمایشی",
      audience: AnnouncementAudience.TEST,
      managerId,
      durationDays: 1,
    });

    expect(await service.getActiveClosure(false)).toBeNull();
    expect((await service.getActiveClosure(true))?.id).toBe(announcement.id);
  });

  it("labels announcement types for manager-facing texts", async () => {
    expect(announcementTypeLabel(AnnouncementType.CLOSURE)).toBe("اطلاعیه تعطیلی");
    expect(announcementTypeLabel(AnnouncementType.GENERAL)).toBe("اطلاعیه فروشگاه ایرانی");
  });

  it("lists only active, in-window announcements per user audience", async () => {
    const service = new AnnouncementService(prisma, () => now);
    const visible = await service.create({
      type: AnnouncementType.GENERAL,
      title: "فعال",
      managerId,
      durationDays: 1,
    });
    const testOnly = await service.create({
      type: AnnouncementType.GENERAL,
      title: "فقط آزمایشی",
      audience: AnnouncementAudience.TEST,
      managerId,
      durationDays: 1,
    });
    const inactive = await service.create({
      type: AnnouncementType.GENERAL,
      title: "غیرفعال",
      managerId,
      durationDays: 1,
    });
    await prisma.announcement.update({ where: { id: inactive.id }, data: { isActive: false } });
    const expired = await service.create({
      type: AnnouncementType.GENERAL,
      title: "منقضی",
      managerId,
      durationDays: 0, // endsAt == startsAt == now -> already expired
    });
    const scheduled = await prisma.announcement.create({
      data: {
        type: AnnouncementType.GENERAL,
        title: "آینده",
        message: "",
        startsAt: new Date(now.getTime() + 60_000),
        isActive: true,
        createdByManagerId: managerId,
      },
    });

    const regularIds = (await service.getActive(false)).map((a) => a.id);
    expect(regularIds).toEqual([visible.id]);
    expect(regularIds).not.toContain(testOnly.id);
    expect(regularIds).not.toContain(inactive.id);
    expect(regularIds).not.toContain(expired.id);
    expect(regularIds).not.toContain(scheduled.id);

    // Test users additionally see TEST-audience announcements, newest first.
    expect((await service.getActive(true)).map((a) => a.id)).toEqual([testOnly.id, visible.id]);
  });

  // -------------------------------------------------------------------------
  // Caption / text length safety
  // -------------------------------------------------------------------------

  it("keeps captions under the Telegram 1024 limit and adds an ellipsis when truncated", async () => {
    const announcement = {
      type: AnnouncementType.GENERAL,
      title: "a".repeat(1500),
      message: "b".repeat(1500),
      discountType: null,
      discountValue: null,
    };
    // Input is genuinely over the Telegram limit before truncation.
    expect(formatAnnouncement(announcement).length).toBeGreaterThan(1024);
    const caption = formatAnnouncementCaption(announcement);
    expect(caption.length).toBeLessThanOrEqual(1000);
    expect(caption.endsWith("…")).toBe(true);
  });

  it("clamps an explicit maxLength to the Telegram hard limit", () => {
    const announcement = {
      type: AnnouncementType.GENERAL,
      title: "a".repeat(2000),
      message: "",
      discountType: null,
      discountValue: null,
    };
    const caption = formatAnnouncementCaption(announcement, 5000);
    expect(caption.length).toBeLessThanOrEqual(1024);
  });

  it("does not split a surrogate pair (emoji) at the truncation boundary", async () => {
    // 995 BMP chars + 😀 (2 UTF-16 units) + "b": the ellipsis cut lands exactly
    // on the emoji's high surrogate inside the formatted caption.
    const announcement = {
      type: AnnouncementType.GENERAL,
      title: `${"a".repeat(995)}😀b`,
      message: "",
      discountType: null,
      discountValue: null,
    };
    const caption = formatAnnouncementCaption(announcement);
    expect(caption.length).toBeLessThanOrEqual(1000);
    expect(caption.endsWith("…")).toBe(true);
    expect(hasLoneSurrogate(caption)).toBe(false);
  });

  it("truncates text-only messages below the Telegram 4096 limit", async () => {
    const announcement = {
      type: AnnouncementType.GENERAL,
      title: "t",
      message: "م".repeat(5000),
      discountType: null,
      discountValue: null,
    };
    const text = formatAnnouncementText(announcement);
    expect(text.length).toBeLessThanOrEqual(4000);
    expect(text.endsWith("…")).toBe(true);
    expect(hasLoneSurrogate(text)).toBe(false);
  });

  // -------------------------------------------------------------------------
  // sendToChat: text-only backward compatibility
  // -------------------------------------------------------------------------

  it("sends text-only announcements via sendMessage (backward compatible)", async () => {
    const service = new AnnouncementService(prisma, () => now);
    const announcement = await service.create({
      type: AnnouncementType.GENERAL,
      title: "تخفیف",
      message: "متن اطلاعیه",
      managerId,
      durationDays: 1,
    });

    const client = makeClientBot();
    await service.sendToChat(announcement, client.bot, 12345, makeSourceBot().bot);

    expect(client.api.sendMessage).toHaveBeenCalledExactlyOnceWith(12345, "📣 تخفیف\n\nمتن اطلاعیه");
    expect(client.api.sendPhoto).not.toHaveBeenCalled();
    expect(client.api.sendVideo).not.toHaveBeenCalled();
    expect(client.api.getFile).not.toHaveBeenCalled();
  });

  it("skips sending when a text-only announcement has no content", async () => {
    const service = new AnnouncementService(prisma, () => now);
    const announcement = await service.create({
      type: AnnouncementType.GENERAL,
      title: "",
      message: "",
      managerId,
      durationDays: 1,
    });

    const client = makeClientBot();
    await service.sendToChat(announcement, client.bot, 12345);

    expect(client.api.sendMessage).not.toHaveBeenCalled();
  });

  it("treats a media-less announcement with a dangling mediaFileId as text (backward compatible)", async () => {
    const service = new AnnouncementService(prisma, () => now);
    const announcement = await service.create({
      type: AnnouncementType.GENERAL,
      title: "فقط متن",
      message: "بدون عکس",
      mediaFileId: "orphan-file-id",
      managerId,
      durationDays: 1,
    });

    const client = makeClientBot();
    await service.sendToChat(announcement, client.bot, 12345, makeSourceBot().bot);

    expect(client.api.sendMessage).toHaveBeenCalledExactlyOnceWith(12345, "📣 فقط متن\n\nبدون عکس");
    expect(client.api.sendPhoto).not.toHaveBeenCalled();
  });

  it("truncates over-length text-only messages before calling sendMessage", async () => {
    const service = new AnnouncementService(prisma, () => now);
    const announcement = await service.create({
      type: AnnouncementType.GENERAL,
      title: "ت",
      message: "م".repeat(5000),
      managerId,
      durationDays: 1,
    });

    const client = makeClientBot();
    await service.sendToChat(announcement, client.bot, 12345);

    const sentText = client.api.sendMessage.mock.calls[0][1] as string;
    expect(sentText.length).toBeLessThanOrEqual(4000);
    expect(sentText.endsWith("…")).toBe(true);
  });

  // -------------------------------------------------------------------------
  // sendToChat: photo/video media + cross-bot transfer-once + cache
  // -------------------------------------------------------------------------

  it("transfers manager media once via cross-bot upload and caches the client file_id", async () => {
    const service = new AnnouncementService(prisma, () => now);
    const announcement = await service.create({
      type: AnnouncementType.GENERAL,
      title: "عکس جدید",
      message: "توضیح عکس",
      mediaType: AnnouncementMediaType.PHOTO,
      mediaFileId: "manager-file-1",
      managerId,
      durationDays: 1,
    });

    const client = makeClientBot();
    const source = makeSourceBot();
    const fetchMock = stubFileDownload();

    await service.sendToChat(announcement, client.bot, 12345, source.bot);

    // Downloaded from the manager bot exactly once, via getFile + byte fetch.
    expect(source.api.getFile).toHaveBeenCalledExactlyOnceWith("manager-file-1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toMatch(/^https:\/\/api\.telegram\.org\/file\/bot654321:TEST-MANAGER\//);

    // Sent through the client bot with the formatted caption.
    expect(client.api.sendPhoto).toHaveBeenCalledExactlyOnceWith(12345, expect.any(InputFile), {
      caption: "📣 عکس جدید\n\nتوضیح عکس",
    });
    expect(client.api.sendMessage).not.toHaveBeenCalled();

    // The largest photo size's file_id is cached in memory and persisted.
    expect(announcement.clientMediaFileId).toBe("client-photo-large");
    const persisted = await prisma.announcement.findUniqueOrThrow({ where: { id: announcement.id } });
    expect(persisted.clientMediaFileId).toBe("client-photo-large");
    expect(persisted.mediaFileId).toBe("manager-file-1");
  });

  it("reuses the cached client file_id on later sends, including replay without the manager bot", async () => {
    const service = new AnnouncementService(prisma, () => now);
    const announcement = await service.create({
      type: AnnouncementType.GENERAL,
      title: "عکس جدید",
      mediaType: AnnouncementMediaType.PHOTO,
      mediaFileId: "manager-file-1",
      managerId,
      durationDays: 1,
    });

    const client = makeClientBot();
    const source = makeSourceBot();
    const fetchMock = stubFileDownload();

    await service.sendToChat(announcement, client.bot, 111, source.bot);
    await service.sendToChat(announcement, client.bot, 222, source.bot);
    // Active-announcement replay path: cached file_id, no source bot needed.
    await service.sendToChat(announcement, client.bot, 333);

    expect(source.api.getFile).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(client.api.sendPhoto).toHaveBeenCalledTimes(3);
    expect(client.api.sendPhoto).toHaveBeenNthCalledWith(1, 111, expect.any(InputFile), { caption: "📣 عکس جدید" });
    expect(client.api.sendPhoto).toHaveBeenNthCalledWith(2, 222, "client-photo-large", { caption: "📣 عکس جدید" });
    expect(client.api.sendPhoto).toHaveBeenNthCalledWith(3, 333, "client-photo-large", { caption: "📣 عکس جدید" });
  });

  it("sends media without a caption option when the announcement has no text", async () => {
    const service = new AnnouncementService(prisma, () => now);
    const announcement = await service.create({
      type: AnnouncementType.GENERAL,
      title: "",
      message: "",
      mediaType: AnnouncementMediaType.PHOTO,
      mediaFileId: "manager-file-1",
      managerId,
      durationDays: 1,
    });

    const client = makeClientBot();
    const fetchMock = stubFileDownload();
    await service.sendToChat(announcement, client.bot, 12345, makeSourceBot().bot);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(client.api.sendPhoto).toHaveBeenCalledExactlyOnceWith(12345, expect.any(InputFile), undefined);
  });

  it("sends video announcements, caches the video file_id, and reuses the cache", async () => {
    const service = new AnnouncementService(prisma, () => now);
    const announcement = await service.create({
      type: AnnouncementType.CLOSURE,
      title: "ویدیوی تعطیلی",
      message: "",
      mediaType: AnnouncementMediaType.VIDEO,
      mediaFileId: "manager-video-1",
      managerId,
      durationDays: 1,
    });

    const client = makeClientBot();
    const source = makeSourceBot();
    const fetchMock = stubFileDownload();
    await service.sendToChat(announcement, client.bot, 111, source.bot);
    await service.sendToChat(announcement, client.bot, 222, source.bot);

    expect(client.api.sendVideo).toHaveBeenCalledTimes(2);
    expect(client.api.sendVideo).toHaveBeenNthCalledWith(1, 111, expect.any(InputFile), {
      caption: "⛔ ویدیوی تعطیلی",
    });
    // Second send reuses the cached client-bot file_id: no re-upload.
    expect(client.api.sendVideo).toHaveBeenNthCalledWith(2, 222, "client-video-1", {
      caption: "⛔ ویدیوی تعطیلی",
    });
    expect(client.api.sendMessage).not.toHaveBeenCalled();
    expect(announcement.clientMediaFileId).toBe("client-video-1");
    expect(source.api.getFile).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws a clear error when media is not cached and no source bot is available", async () => {
    const service = new AnnouncementService(prisma, () => now);
    const announcement = await service.create({
      type: AnnouncementType.GENERAL,
      title: "عکس",
      mediaType: AnnouncementMediaType.PHOTO,
      mediaFileId: "manager-file-1",
      managerId,
      durationDays: 1,
    });

    await expect(service.sendToChat(announcement, makeClientBot().bot, 12345)).rejects.toThrow(
      "Announcement media is not available to the client bot",
    );
  });

  it("skips caching when the photo response has no photo array", async () => {
    const service = new AnnouncementService(prisma, () => now);
    const announcement = await service.create({
      type: AnnouncementType.GENERAL,
      title: "عکس",
      mediaType: AnnouncementMediaType.PHOTO,
      mediaFileId: "manager-file-1",
      managerId,
      durationDays: 1,
    });

    const client = makeClientBot({ sendPhoto: vi.fn(async () => ({ message_id: 1, photo: [] })) });
    const fetchMock = stubFileDownload();
    await service.sendToChat(announcement, client.bot, 12345, makeSourceBot().bot);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(client.api.sendPhoto).toHaveBeenCalledTimes(1);
    // No cache entry written, but no crash either: the next send re-uploads.
    expect(announcement.clientMediaFileId).toBeNull();
    const persisted = await prisma.announcement.findUniqueOrThrow({ where: { id: announcement.id } });
    expect(persisted.clientMediaFileId).toBeNull();
  });

  it("caps media captions at the safe limit during an actual send", async () => {
    const service = new AnnouncementService(prisma, () => now);
    const announcement = await service.create({
      type: AnnouncementType.GENERAL,
      title: "a".repeat(1500),
      message: "b".repeat(1500),
      mediaType: AnnouncementMediaType.PHOTO,
      mediaFileId: "manager-file-1",
      managerId,
      durationDays: 1,
    });

    const client = makeClientBot();
    stubFileDownload();
    await service.sendToChat(announcement, client.bot, 12345, makeSourceBot().bot);

    const captionOption = client.api.sendPhoto.mock.calls[0][2] as { caption?: string } | undefined;
    expect(captionOption?.caption?.length ?? 0).toBeGreaterThan(0);
    expect(captionOption!.caption!.length).toBeLessThanOrEqual(1000);
    expect(captionOption!.caption!.endsWith("…")).toBe(true);
  });

  // -------------------------------------------------------------------------
  // broadcast: audience, counts, failures, broadcastAt
  // -------------------------------------------------------------------------

  it("targets active+verified users for ALL and only test users for TEST", async () => {
    const regular = await createUser({ isTestUser: false });
    const testUser = await createUser({ isTestUser: true });
    await createUser({ isActive: false }); // inactive -> never targeted
    await createUser({ isVerified: false }); // unverified -> never targeted

    const service = new AnnouncementService(prisma, () => now, 0);
    const client = makeClientBot();

    const allAnnouncement = await service.create({
      type: AnnouncementType.GENERAL,
      title: "همه",
      managerId,
      durationDays: 1,
    });
    const allResult = await service.broadcast(allAnnouncement, client.bot, makeSourceBot().bot);
    expect(allResult).toEqual({ targeted: 2, sent: 2, failed: 0 });
    expect(client.api.sendMessage).toHaveBeenCalledTimes(2);
    const sentChats = new Set(client.api.sendMessage.mock.calls.map((call) => call[0]));
    expect(sentChats).toEqual(new Set([regular.tgUserId.toString(), testUser.tgUserId.toString()]));

    const testAnnouncement = await service.create({
      type: AnnouncementType.GENERAL,
      title: "آزمایشی",
      audience: AnnouncementAudience.TEST,
      managerId,
      durationDays: 1,
    });
    client.api.sendMessage.mockClear();
    const testResult = await service.broadcast(testAnnouncement, client.bot, makeSourceBot().bot);
    expect(testResult).toEqual({ targeted: 1, sent: 1, failed: 0 });
    expect(client.api.sendMessage).toHaveBeenCalledExactlyOnceWith(testUser.tgUserId.toString(), expect.any(String));
  });

  it("stamps broadcastAt after a broadcast attempt", async () => {
    await createUser();
    const service = new AnnouncementService(prisma, () => now, 0);
    const announcement = await service.create({
      type: AnnouncementType.GENERAL,
      title: "اطلاعیه",
      managerId,
      durationDays: 1,
    });
    expect(announcement.broadcastAt).toBeNull();

    await service.broadcast(announcement, makeClientBot().bot, makeSourceBot().bot);

    const persisted = await prisma.announcement.findUniqueOrThrow({ where: { id: announcement.id } });
    expect(persisted.broadcastAt).toEqual(now);
  });

  it("broadcasts with the default per-user throttle delay", async () => {
    await createUser();
    const service = new AnnouncementService(prisma, () => now); // default 45ms delay
    const announcement = await service.create({
      type: AnnouncementType.GENERAL,
      title: "اطلاعیه",
      managerId,
      durationDays: 1,
    });

    const result = await service.broadcast(announcement, makeClientBot().bot);

    expect(result).toEqual({ targeted: 1, sent: 1, failed: 0 });
  });

  it("counts per-user failures and still stamps broadcastAt", async () => {
    const userA = await createUser();
    await createUser();
    const service = new AnnouncementService(prisma, () => now, 0);
    const announcement = await service.create({
      type: AnnouncementType.GENERAL,
      title: "اطلاعیه",
      managerId,
      durationDays: 1,
    });

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const client = makeClientBot({
      sendMessage: vi.fn(async (chatId: number | string) => {
        if (chatId === userA.tgUserId.toString()) throw new Error("chat not found");
        return { message_id: 1 };
      }),
    });
    const result = await service.broadcast(announcement, client.bot, makeSourceBot().bot);
    errorSpy.mockRestore();

    expect(result).toEqual({ targeted: 2, sent: 1, failed: 1 });
    const persisted = await prisma.announcement.findUniqueOrThrow({ where: { id: announcement.id } });
    expect(persisted.broadcastAt).toEqual(now);
  });

  it("reports every targeted user as failed and does not stamp broadcastAt without a client bot", async () => {
    await createUser();
    const service = new AnnouncementService(prisma, () => now, 0);
    const announcement = await service.create({
      type: AnnouncementType.GENERAL,
      title: "اطلاعیه",
      managerId,
      durationDays: 1,
    });

    const result = await service.broadcast(announcement, undefined);

    expect(result).toEqual({ targeted: 1, sent: 0, failed: 1 });
    const persisted = await prisma.announcement.findUniqueOrThrow({ where: { id: announcement.id } });
    expect(persisted.broadcastAt).toBeNull();
  });

  it("does not count an empty text-only announcement as delivered", async () => {
    await createUser();
    const service = new AnnouncementService(prisma, () => now, 0);
    const announcement = await service.create({
      type: AnnouncementType.GENERAL,
      title: "",
      message: "",
      managerId,
      durationDays: 1,
    });
    const client = makeClientBot();

    const result = await service.broadcast(announcement, client.bot);

    expect(result).toEqual({ targeted: 1, sent: 0, failed: 1 });
    expect(client.api.sendMessage).not.toHaveBeenCalled();
    const persisted = await prisma.announcement.findUniqueOrThrow({ where: { id: announcement.id } });
    expect(persisted.broadcastAt).toBeNull();
  });

  it("transfers media exactly once across a whole broadcast and reuses the cache", async () => {
    await createUser();
    await createUser();
    const service = new AnnouncementService(prisma, () => now, 0);
    const announcement = await service.create({
      type: AnnouncementType.GENERAL,
      title: "عکس",
      message: "",
      mediaType: AnnouncementMediaType.PHOTO,
      mediaFileId: "manager-file-1",
      managerId,
      durationDays: 1,
    });

    const client = makeClientBot();
    const source = makeSourceBot();
    const fetchMock = stubFileDownload();

    const result = await service.broadcast(announcement, client.bot, source.bot);

    expect(result).toEqual({ targeted: 2, sent: 2, failed: 0 });
    expect(source.api.getFile).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(client.api.sendPhoto).toHaveBeenCalledTimes(2);
    const mediaArgs = client.api.sendPhoto.mock.calls.map((call) => call[1]);
    expect(mediaArgs[0]).toBeInstanceOf(InputFile);
    expect(mediaArgs[1]).toBe("client-photo-large");
  });

  // -------------------------------------------------------------------------
  // broadcast: buffered media download (no re-download on early failures)
  // -------------------------------------------------------------------------

  it("buffers the media download once and does not re-download when early recipients fail", async () => {
    const blocked = await createUser();
    await createUser();
    await createUser();
    const service = new AnnouncementService(prisma, () => now, 0);
    const announcement = await service.create({
      type: AnnouncementType.GENERAL,
      title: "عکس",
      message: "",
      mediaType: AnnouncementMediaType.PHOTO,
      mediaFileId: "manager-file-1",
      managerId,
      durationDays: 1,
    });

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const client = makeClientBot({
      sendPhoto: vi.fn(async (chatId: string | number) => {
        if (chatId === blocked.tgUserId.toString()) {
          throw makeGrammyError(403, "Forbidden: bot was blocked by the user");
        }
        return {
          message_id: 1,
          photo: [
            { file_id: "client-photo-small", width: 100, height: 100 },
            { file_id: "client-photo-large", width: 800, height: 800 },
          ],
        };
      }),
    });
    const source = makeSourceBot();
    const fetchMock = stubFileDownload();

    const result = await service.broadcast(announcement, client.bot, source.bot);
    errorSpy.mockRestore();

    expect(result).toEqual({ targeted: 3, sent: 2, failed: 1 });
    // Downloaded exactly once up front; the blocked chat's 403 did not trigger re-downloads.
    expect(source.api.getFile).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(client.api.sendPhoto).toHaveBeenCalledTimes(3);
    const calls = client.api.sendPhoto.mock.calls as [string | number, unknown][];
    const mediaByChat = new Map(calls.map(([chatId, media]) => [String(chatId), media]));
    // The blocked chat was attempted with the buffered upload (no re-download).
    expect(mediaByChat.get(blocked.tgUserId.toString())).toBeInstanceOf(InputFile);
    // Exactly one send used the cached client file_id (the second successful recipient).
    const stringSends = calls.filter(([, media]) => typeof media === "string");
    expect(stringSends).toHaveLength(1);
    expect(stringSends[0][1]).toBe("client-photo-large");
    // At least one delivery succeeded, so the attempt is marked as broadcast.
    const persisted = await prisma.announcement.findUniqueOrThrow({ where: { id: announcement.id } });
    expect(persisted.broadcastAt).toEqual(now);
  });

  it("fails recipients fast without per-recipient downloads when the media pre-download fails", async () => {
    await createUser();
    await createUser();
    const service = new AnnouncementService(prisma, () => now, 0);
    const announcement = await service.create({
      type: AnnouncementType.GENERAL,
      title: "عکس",
      message: "",
      mediaType: AnnouncementMediaType.PHOTO,
      mediaFileId: "manager-file-1",
      managerId,
      durationDays: 1,
    });

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const client = makeClientBot();
    // getFile throws before any fetch happens, so no network is ever touched.
    const source = makeSourceBot({ getFile: vi.fn(async () => {
      throw new Error("network down");
    }) });

    const result = await service.broadcast(announcement, client.bot, source.bot);
    errorSpy.mockRestore();

    expect(result).toEqual({ targeted: 2, sent: 0, failed: 2 });
    // One failed pre-download; recipients failed fast instead of re-downloading.
    expect(source.api.getFile).toHaveBeenCalledTimes(1);
    expect(client.api.sendPhoto).not.toHaveBeenCalled();
    const persisted = await prisma.announcement.findUniqueOrThrow({ where: { id: announcement.id } });
    expect(persisted.broadcastAt).toBeNull();
    expect(persisted.clientMediaFileId).toBeNull();
  });

  // -------------------------------------------------------------------------
  // sendToChat: stale cached clientMediaFileId clears + retries once
  // -------------------------------------------------------------------------

  it("clears a stale cached file_id and retries once via the manager source file", async () => {
    const service = new AnnouncementService(prisma, () => now);
    const announcement = await service.create({
      type: AnnouncementType.GENERAL,
      title: "عکس",
      message: "",
      mediaType: AnnouncementMediaType.PHOTO,
      mediaFileId: "manager-file-1",
      managerId,
      durationDays: 1,
    });
    await prisma.announcement.update({ where: { id: announcement.id }, data: { clientMediaFileId: "stale-client-id" } });
    announcement.clientMediaFileId = "stale-client-id";

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const client = makeClientBot({
      sendPhoto: vi.fn(async (_chatId: string | number, media: unknown) => {
        if (typeof media === "string") {
          throw makeGrammyError(400, "Bad Request: wrong file identifier/HTTP URL specified");
        }
        return {
          message_id: 1,
          photo: [
            { file_id: "client-photo-small", width: 100, height: 100 },
            { file_id: "client-photo-large-2", width: 800, height: 800 },
          ],
        };
      }),
    });
    const source = makeSourceBot();
    const fetchMock = stubFileDownload();

    await service.sendToChat(announcement, client.bot, 12345, source.bot);

    expect(client.api.sendPhoto).toHaveBeenCalledTimes(2);
    expect(client.api.sendPhoto.mock.calls[0][1]).toBe("stale-client-id");
    expect(client.api.sendPhoto.mock.calls[1][1]).toBeInstanceOf(InputFile);
    expect(source.api.getFile).toHaveBeenCalledExactlyOnceWith("manager-file-1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // The fresh upload's file_id is cached in memory and persisted.
    expect(announcement.clientMediaFileId).toBe("client-photo-large-2");
    const persisted = await prisma.announcement.findUniqueOrThrow({ where: { id: announcement.id } });
    expect(persisted.clientMediaFileId).toBe("client-photo-large-2");
    warnSpy.mockRestore();
  });

  it("retries a stale cached file_id with the broadcast's buffered upload, avoiding extra downloads", async () => {
    const service = new AnnouncementService(prisma, () => now);
    const announcement = await service.create({
      type: AnnouncementType.GENERAL,
      title: "عکس",
      message: "",
      mediaType: AnnouncementMediaType.PHOTO,
      mediaFileId: "manager-file-1",
      managerId,
      durationDays: 1,
    });
    await prisma.announcement.update({ where: { id: announcement.id }, data: { clientMediaFileId: "stale-client-id" } });
    announcement.clientMediaFileId = "stale-client-id";

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const client = makeClientBot({
      sendPhoto: vi.fn(async (_chatId: string | number, media: unknown) => {
        if (typeof media === "string") {
          throw makeGrammyError(400, "Bad Request: wrong file identifier/HTTP URL specified");
        }
        return {
          message_id: 1,
          photo: [{ file_id: "client-photo-buffered", width: 800, height: 800 }],
        };
      }),
    });
    // Buffered upload only: no source bot and no fetch stub, so any download
    // would hit real network and fail loudly — the retry must reuse the buffer.
    const buffered = { upload: new InputFile(new Uint8Array(4), "file.jpg") };

    await service.sendToChat(announcement, client.bot, 12345, undefined, buffered);

    expect(client.api.sendPhoto).toHaveBeenCalledTimes(2);
    expect(client.api.sendPhoto.mock.calls[0][1]).toBe("stale-client-id");
    expect(client.api.sendPhoto.mock.calls[1][1]).toBeInstanceOf(InputFile);
    expect(announcement.clientMediaFileId).toBe("client-photo-buffered");
    const persisted = await prisma.announcement.findUniqueOrThrow({ where: { id: announcement.id } });
    expect(persisted.clientMediaFileId).toBe("client-photo-buffered");
    warnSpy.mockRestore();
  });

  it("keeps a valid cache and does not re-download when a send fails at the chat level", async () => {
    const service = new AnnouncementService(prisma, () => now);
    const announcement = await service.create({
      type: AnnouncementType.GENERAL,
      title: "عکس",
      message: "",
      mediaType: AnnouncementMediaType.PHOTO,
      mediaFileId: "manager-file-1",
      managerId,
      durationDays: 1,
    });
    await prisma.announcement.update({ where: { id: announcement.id }, data: { clientMediaFileId: "cached-good-id" } });
    announcement.clientMediaFileId = "cached-good-id";

    const client = makeClientBot({
      sendPhoto: vi.fn(async () => {
        throw makeGrammyError(403, "Forbidden: bot was blocked by the user");
      }),
    });
    const source = makeSourceBot();
    // No fetch stub: any download attempt would touch the network and fail loudly.

    await expect(service.sendToChat(announcement, client.bot, 12345, source.bot)).rejects.toThrow(
      "bot was blocked by the user",
    );

    expect(source.api.getFile).not.toHaveBeenCalled();
    expect(announcement.clientMediaFileId).toBe("cached-good-id");
    const persisted = await prisma.announcement.findUniqueOrThrow({ where: { id: announcement.id } });
    expect(persisted.clientMediaFileId).toBe("cached-good-id");
  });

  it("propagates a failed retry without looping when the source download also fails", async () => {
    const service = new AnnouncementService(prisma, () => now);
    const announcement = await service.create({
      type: AnnouncementType.GENERAL,
      title: "عکس",
      message: "",
      mediaType: AnnouncementMediaType.PHOTO,
      mediaFileId: "manager-file-1",
      managerId,
      durationDays: 1,
    });
    await prisma.announcement.update({ where: { id: announcement.id }, data: { clientMediaFileId: "stale-client-id" } });
    announcement.clientMediaFileId = "stale-client-id";

    const client = makeClientBot({
      sendPhoto: vi.fn(async (_chatId: string | number, media: unknown) => {
        if (typeof media === "string") {
          throw makeGrammyError(400, "Bad Request: wrong file identifier/HTTP URL specified");
        }
        throw new Error("upload failed");
      }),
    });
    const source = makeSourceBot();
    const fetchMock = stubFileDownload();

    await expect(service.sendToChat(announcement, client.bot, 12345, source.bot)).rejects.toThrow("upload failed");

    // Stale-id attempt + exactly one retry; no loop.
    expect(client.api.sendPhoto).toHaveBeenCalledTimes(2);
    expect(source.api.getFile).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const persisted = await prisma.announcement.findUniqueOrThrow({ where: { id: announcement.id } });
    expect(persisted.clientMediaFileId).toBeNull(); // the stale cache was cleared
  });

  // -------------------------------------------------------------------------
  // broadcast: broadcastAt semantics (no success stamps for failed/empty runs)
  // -------------------------------------------------------------------------

  it("sends nothing and does not stamp broadcastAt for a zero-target media broadcast", async () => {
    const service = new AnnouncementService(prisma, () => now, 0);
    const announcement = await service.create({
      type: AnnouncementType.GENERAL,
      title: "عکس",
      message: "",
      mediaType: AnnouncementMediaType.PHOTO,
      mediaFileId: "manager-file-1",
      managerId,
      durationDays: 1,
    });

    const client = makeClientBot();
    const source = makeSourceBot();

    const result = await service.broadcast(announcement, client.bot, source.bot);

    expect(result).toEqual({ targeted: 0, sent: 0, failed: 0 });
    expect(client.api.sendPhoto).not.toHaveBeenCalled();
    expect(source.api.getFile).not.toHaveBeenCalled();
    const persisted = await prisma.announcement.findUniqueOrThrow({ where: { id: announcement.id } });
    expect(persisted.broadcastAt).toBeNull();
  });

  it("does not stamp broadcastAt when a media broadcast fails for every recipient", async () => {
    await createUser();
    await createUser();
    const service = new AnnouncementService(prisma, () => now, 0);
    const announcement = await service.create({
      type: AnnouncementType.GENERAL,
      title: "عکس",
      message: "",
      mediaType: AnnouncementMediaType.PHOTO,
      mediaFileId: "manager-file-1",
      managerId,
      durationDays: 1,
    });

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const client = makeClientBot({
      sendPhoto: vi.fn(async () => {
        throw makeGrammyError(403, "Forbidden: bot was blocked by the user");
      }),
    });
    const source = makeSourceBot();
    const fetchMock = stubFileDownload();

    const result = await service.broadcast(announcement, client.bot, source.bot);
    errorSpy.mockRestore();

    expect(result).toEqual({ targeted: 2, sent: 0, failed: 2 });
    expect(client.api.sendPhoto).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const persisted = await prisma.announcement.findUniqueOrThrow({ where: { id: announcement.id } });
    expect(persisted.broadcastAt).toBeNull();
  });
});
