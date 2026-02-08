import type { Bot } from "grammy";
import type { WebhookHandlers } from "../http/server.js";

type BotUpdate = Parameters<Bot["handleUpdate"]>[0];

export function createTelegramWebhookHandlers(
  clientBot: Bot,
  managerBot: Bot,
  courierBot: Bot,
): WebhookHandlers {
  return {
    handleClientUpdate: async (update: unknown) => {
      try {
        await clientBot.handleUpdate(update as BotUpdate);
      } catch (error) {
        console.error("[ClientBot] Error handling update:", error);
        // Don't rethrow - we want to return 200 to Telegram to prevent retries
      }
    },
    handleManagerUpdate: async (update: unknown) => {
      try {
        await managerBot.handleUpdate(update as BotUpdate);
      } catch (error) {
        console.error("[ManagerBot] Error handling update:", error);
        // Don't rethrow - we want to return 200 to Telegram to prevent retries
      }
    },
    handleCourierUpdate: async (update: unknown) => {
      try {
        await courierBot.handleUpdate(update as BotUpdate);
      } catch (error) {
        console.error("[CourierBot] Error handling update:", error);
        // Don't rethrow - we want to return 200 to Telegram to prevent retries
      }
    },
  };
}
