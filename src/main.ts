import { PrismaClient } from "@prisma/client";
import { loadAppConfigFromEnv } from "./config/app-config.js";
import { CLIENT_BOT_COMMANDS, COURIER_BOT_COMMANDS, MANAGER_BOT_COMMANDS } from "./config/bot-commands.js";
import { createClientBot, createCourierBot, createManagerBot } from "./infra/telegram/bots.js";
import { createTelegramWebhookHandlers } from "./infra/telegram/webhooks.js";
import { registerInteractiveClientBot } from "./bots/client/client-bot-interactive.js";
import { registerInteractiveCourierBot } from "./bots/courier/courier-bot-interactive.js";
import { registerInteractiveManagerBot } from "./bots/manager/manager-bot-interactive.js";
import { buildServer } from "./infra/http/server.js";
import { setupQueues, type QueueManager } from "./infra/queue/bullmq.js";

async function main(): Promise<void> {
  const config = loadAppConfigFromEnv();

  const prisma = new PrismaClient();
  await prisma.$connect();

  const clientBot = createClientBot(config.clientBotToken);
  const managerBot = createManagerBot(config.managerBotToken);
  const courierBot = createCourierBot(config.courierBotToken);

  registerInteractiveClientBot(clientBot, { prisma });
  registerInteractiveCourierBot(courierBot, { prisma });
  registerInteractiveManagerBot(managerBot, { 
    prisma, 
    clientBot,
    checkoutChannelId: config.checkoutChannelId,
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

  const webhookHandlers = createTelegramWebhookHandlers(clientBot, managerBot, courierBot);

  const isPollingMode = config.updatesMode === "polling";
  
  if (isPollingMode) {
    clientBot.start();
    managerBot.start();
    courierBot.start();
  }

  let queues: QueueManager | undefined;
  if (config.enableQueues && config.redisUrl && config.checkoutChannelId) {
    queues = await setupQueues({
      prisma,
      redisUrl: config.redisUrl,
      clientBot,
      checkoutChannelId: config.checkoutChannelId,
    });
  }

  const app = buildServer(webhookHandlers, {
    webhookSecretToken: config.webhookSecretToken,
  });
  const port = config.port;
  const host = "0.0.0.0";

  const shutdown = async () => {
    console.log("Shutting down gracefully...");
    
    // Stop bots if running in polling mode
    if (isPollingMode) {
      console.log("Stopping bot polling...");
      await clientBot.stop();
      await managerBot.stop();
      await courierBot.stop();
    }
    
    if (queues) {
      console.log("Closing queue connections...");
      await queues.close();
    }
    
    console.log("Closing HTTP server...");
    await app.close();
    
    console.log("Disconnecting from database...");
    await prisma.$disconnect();
    
    console.log("Shutdown complete.");
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await app.listen({ port, host });
}

// Only run main when executed directly, not when imported by tests.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("Fatal error starting telegram-bots service", err);
    process.exit(1);
  });
}
