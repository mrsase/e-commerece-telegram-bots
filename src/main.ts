import { PrismaClient } from "@prisma/client";
import { loadAppConfigFromEnv } from "./config/app-config.js";
import { CLIENT_BOT_COMMANDS, COURIER_BOT_COMMANDS, MANAGER_BOT_COMMANDS } from "./config/bot-commands.js";
import { createClientBot, createCourierBot, createManagerBot } from "./infra/telegram/bots.js";
import { createTelegramWebhookHandlers } from "./infra/telegram/webhooks.js";
import { registerInteractiveClientBot } from "./bots/client/client-bot-interactive.js";
import { registerInteractiveCourierBot } from "./bots/courier/courier-bot-interactive.js";
import { registerInteractiveManagerBot } from "./bots/manager/manager-bot-interactive.js";
import { buildServer } from "./infra/http/server.js";
import { startScheduler, type Scheduler } from "./infra/scheduler/interval-scheduler.js";

function startPolling(botName: string, bot: ReturnType<typeof createClientBot>): void {
  void bot.start().catch((error) => {
    console.error(`${botName} polling failed`, error);
    process.exit(1);
  });
}

async function main(): Promise<void> {
  const config = loadAppConfigFromEnv();

  const prisma = new PrismaClient();
  await prisma.$connect();

  // Backfill users with null username to use their profile name
  try {
    const nullUsernameUsers = await prisma.user.findMany({
      where: { username: null },
      select: { id: true, firstName: true, lastName: true },
    });
    for (const u of nullUsernameUsers) {
      const fallback = u.firstName || u.lastName || `user_${u.id}`;
      await prisma.user.update({
        where: { id: u.id },
        data: { username: fallback },
      });
    }
    if (nullUsernameUsers.length > 0) {
      console.log(`✓ Backfilled ${nullUsernameUsers.length} users with null usernames`);
    }
  } catch (error) {
    console.error("Failed to backfill null usernames:", error);
  }

  const clientBot = createClientBot(config.clientBotToken);
  const managerBot = createManagerBot(config.managerBotToken);
  const courierBot = createCourierBot(config.courierBotToken);

  registerInteractiveClientBot(clientBot, { 
    prisma, 
    managerBot,
    checkoutImageFileId: config.checkoutImageFileId,
    clientBotUsername: config.clientBotUsername,
  });
  registerInteractiveCourierBot(courierBot, { prisma, clientBot, managerBot });
  registerInteractiveManagerBot(managerBot, { 
    prisma, 
    clientBot,
    courierBot,
    checkoutImageFileId: config.checkoutImageFileId,
    clientBotUsername: config.clientBotUsername,
  });

  // Register bot command menus with Telegram
  try {
    await clientBot.api.setMyCommands(CLIENT_BOT_COMMANDS);
    console.log("✓ Client bot commands registered");
  } catch (error) {
    console.error("Failed to register client bot commands:", error);
  }

  try {
    await managerBot.api.setMyCommands(MANAGER_BOT_COMMANDS);
    console.log("✓ Manager bot commands registered");
  } catch (error) {
    console.error("Failed to register manager bot commands:", error);
  }

  try {
    await courierBot.api.setMyCommands(COURIER_BOT_COMMANDS);
    console.log("✓ Courier bot commands registered");
  } catch (error) {
    console.error("Failed to register courier bot commands:", error);
  }

  const isPollingMode = config.updatesMode === "polling";
  
  if (isPollingMode) {
    startPolling("Client bot", clientBot);
    startPolling("Manager bot", managerBot);
    startPolling("Courier bot", courierBot);
    console.log("✓ Bots started in polling mode");
  }

  const scheduler: Scheduler = startScheduler({
    prisma,
  });

  const app = !isPollingMode
    ? buildServer(createTelegramWebhookHandlers(clientBot, managerBot, courierBot), {
        webhookSecretToken: config.webhookSecretToken,
      })
    : undefined;

  const shutdown = async () => {
    console.log("Shutting down gracefully...");
    
    // Stop bots if running in polling mode
    if (isPollingMode) {
      console.log("Stopping bot polling...");
      await clientBot.stop();
      await managerBot.stop();
      await courierBot.stop();
    }
    
    console.log("Stopping scheduler...");
    scheduler.stop();
    
    if (app) {
      console.log("Closing HTTP server...");
      await app.close();
    }
    
    console.log("Disconnecting from database...");
    await prisma.$disconnect();
    
    console.log("Shutdown complete.");
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  if (app) {
    await app.listen({ port: config.port, host: "0.0.0.0" });
  }
}

// Only run main when executed directly, not when imported by tests.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("Fatal error starting telegram-bots service", err);
    process.exit(1);
  });
}
