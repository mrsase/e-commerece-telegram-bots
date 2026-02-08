import dotenv from "dotenv";
import { z } from "zod";

export interface AppConfig {
  nodeEnv: "development" | "test" | "production";
  port: number;
  databaseUrl: string;
  clientBotToken: string;
  managerBotToken: string;
  courierBotToken: string;
  updatesMode: "webhook" | "polling";
  enableQueues: boolean;
  redisUrl?: string;
  checkoutChannelId?: string;
  webhookSecretToken?: string;
}

dotenv.config();

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.string().optional().default("3000"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  CLIENT_BOT_TOKEN: z.string().min(1, "CLIENT_BOT_TOKEN is required"),
  MANAGER_BOT_TOKEN: z.string().min(1, "MANAGER_BOT_TOKEN is required"),
  COURIER_BOT_TOKEN: z.string().min(1, "COURIER_BOT_TOKEN is required"),
  UPDATES_MODE: z.enum(["auto", "webhook", "polling"]).optional().default("auto"),
  ENABLE_QUEUES: z.string().optional().default("false"),
  REDIS_URL: z.string().optional(),
  CHECKOUT_CHANNEL_ID: z.string().optional(),
  WEBHOOK_SECRET_TOKEN: z.string().optional(),
});

export function loadAppConfigFromEnv(): AppConfig {
  const parsed = EnvSchema.safeParse(process.env);

  if (!parsed.success) {
    const fields = parsed.error.issues
      .map((issue) => issue.path.join("."))
      .filter((name) => name.length > 0)
      .join(", ");
    const detail = fields || "environment variables";
    throw new Error(`Invalid environment configuration: ${detail}`);
  }

  const env = parsed.data;

  const port = Number(env.PORT);
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error(`Invalid PORT environment variable: ${env.PORT}`);
  }

  let updatesMode: "webhook" | "polling";
  if (env.UPDATES_MODE === "webhook") {
    updatesMode = "webhook";
  } else if (env.UPDATES_MODE === "polling") {
    updatesMode = "polling";
  } else {
    // auto: polling in development, webhook otherwise
    updatesMode = env.NODE_ENV === "development" ? "polling" : "webhook";
  }

  const enableQueues = env.ENABLE_QUEUES === "true";

  if (enableQueues && !env.REDIS_URL) {
    throw new Error("REDIS_URL is required when ENABLE_QUEUES=true");
  }

  if (enableQueues && !env.CHECKOUT_CHANNEL_ID) {
    throw new Error("CHECKOUT_CHANNEL_ID is required when ENABLE_QUEUES=true");
  }

  return {
    nodeEnv: env.NODE_ENV,
    port,
    databaseUrl: env.DATABASE_URL,
    clientBotToken: env.CLIENT_BOT_TOKEN,
    managerBotToken: env.MANAGER_BOT_TOKEN,
    courierBotToken: env.COURIER_BOT_TOKEN,
    updatesMode,
    enableQueues,
    redisUrl: env.REDIS_URL,
    checkoutChannelId: env.CHECKOUT_CHANNEL_ID,
    webhookSecretToken: env.WEBHOOK_SECRET_TOKEN,
  };
}
