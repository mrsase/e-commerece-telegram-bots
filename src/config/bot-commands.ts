import type { BotCommand } from "grammy/types";

/**
 * Client bot commands - visible to all users
 * Note: Only commands actually implemented in interactive mode are listed.
 * The interactive bot uses inline keyboards for navigation, so only /start is needed.
 */
export const CLIENT_BOT_COMMANDS: BotCommand[] = [
  { command: "start", description: "شروع و نمایش منوی اصلی" },
];

/**
 * Manager bot commands - visible to authorized managers
 * Note: Only commands actually implemented in interactive mode are listed.
 * The interactive bot uses inline keyboards for navigation, so only /start is needed.
 */
export const MANAGER_BOT_COMMANDS: BotCommand[] = [
  { command: "start", description: "شروع و نمایش داشبورد مدیریت" },
];
export const COURIER_BOT_COMMANDS: BotCommand[] = [
  { command: "start", description: "شروع و نمایش داشبورد پیک" },
];
