import { escapeMarkdown } from "./escape-markdown.js";

export type ReferralDisplayUser = {
  username?: string | null;
  firstName?: string | null;
} & ({ id: number; userId?: never } | { userId: number; id?: never });

function referralDisplayUserId(user: ReferralDisplayUser): number {
  return "id" in user && user.id !== undefined ? user.id : user.userId;
}

/** Stable plain-text user label used in Telegram buttons and contact metadata. */
export function referralUserLabel(user: ReferralDisplayUser): string {
  const id = referralDisplayUserId(user);
  const name = user.username?.trim() || user.firstName?.trim();
  return name ? `${name} (#${id})` : `کاربر #${id}`;
}

/** Markdown-safe version of referralUserLabel. */
export function referralUserLabelMarkdown(user: ReferralDisplayUser): string {
  const id = referralDisplayUserId(user);
  const name = user.username?.trim() || user.firstName?.trim();
  return name ? `${escapeMarkdown(name)} (#${id})` : `کاربر #${id}`;
}

/**
 * Describe who invited a user. Manager-created codes intentionally have no
 * parent User row, so they are shown as a direct manager invitation rather
 * than being mistaken for missing data.
 */
export function referralParentLabel(
  parent: ReferralDisplayUser | null | undefined,
  invitedByManager = false,
): string {
  if (parent) return referralUserLabel(parent);
  return invitedByManager ? "دعوت مستقیم مدیر" : "— بدون معرف ثبت‌شده";
}

export function referralParentLabelMarkdown(
  parent: ReferralDisplayUser | null | undefined,
  invitedByManager = false,
): string {
  if (parent) return referralUserLabelMarkdown(parent);
  return invitedByManager ? "دعوت مستقیم مدیر" : "— بدون معرف ثبت‌شده";
}

/** Keep dynamic button labels compact; Telegram still has practical UI limits. */
export function compactReferralUserLabel(user: ReferralDisplayUser, maxLength = 24): string {
  const name = user.username?.trim() || user.firstName?.trim() || `#${referralDisplayUserId(user)}`;
  if (name.length <= maxLength) return name;
  return `${name.slice(0, Math.max(1, maxLength - 1))}…`;
}
