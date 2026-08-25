import dotenv from "dotenv";
import { isAbsolute, resolve } from "node:path";
import { z } from "zod";

export interface AppConfig {
  nodeEnv: "development" | "test" | "production";
  port: number;
  databaseUrl: string;
  clientBotToken: string;
  clientBotUsername?: string;
  managerBotToken: string;
  courierBotToken: string;
  updatesMode: "webhook" | "polling";
  checkoutImageFileId?: string;
  webhookSecretToken?: string;
}

dotenv.config();

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.string().optional().default("3000"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  CLIENT_BOT_TOKEN: z.string().min(1, "CLIENT_BOT_TOKEN is required"),
  CLIENT_BOT_USERNAME: z.string().trim().min(1).optional(),
  MANAGER_BOT_TOKEN: z.string().min(1, "MANAGER_BOT_TOKEN is required"),
  COURIER_BOT_TOKEN: z.string().min(1, "COURIER_BOT_TOKEN is required"),
  UPDATES_MODE: z.enum(["auto", "webhook", "polling"]).optional().default("polling"),
  CHECKOUT_IMAGE_FILE_ID: z.string().optional(),
  WEBHOOK_SECRET_TOKEN: z.string().optional(),
});

export function resolveDatabaseUrl(databaseUrl: string): string {
  if (!databaseUrl.startsWith("file:")) return databaseUrl;
  const match = /^file:([^?#]+)([?#].*)?$/.exec(databaseUrl);
  if (!match) return databaseUrl;
  const databasePath = match[1];
  if (isAbsolute(databasePath)) return databaseUrl;

  // Pin relative SQLite URLs to the schema directory. Prisma CLI migrations
  // already resolve them there, while generated clients can otherwise resolve
  // against node_modules/.prisma/client and open a different empty database.
  return `file:${resolve(process.cwd(), "prisma", databasePath)}${match[2] ?? ""}`;
}

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

  const databaseUrl = resolveDatabaseUrl(env.DATABASE_URL);
  // PrismaClient reads DATABASE_URL directly when it is instantiated after this
  // function in main.ts, so update the process environment as well as config.
  process.env.DATABASE_URL = databaseUrl;

  let updatesMode: "webhook" | "polling";
  if (env.UPDATES_MODE === "webhook") {
    updatesMode = "webhook";
  } else if (env.UPDATES_MODE === "polling") {
    updatesMode = "polling";
  } else {
    updatesMode = "polling";
  }

  return {
    nodeEnv: env.NODE_ENV,
    port,
    databaseUrl,
    clientBotToken: env.CLIENT_BOT_TOKEN,
    clientBotUsername: env.CLIENT_BOT_USERNAME?.replace(/^@/, ""),
    managerBotToken: env.MANAGER_BOT_TOKEN,
    courierBotToken: env.COURIER_BOT_TOKEN,
    updatesMode,
    checkoutImageFileId: env.CHECKOUT_IMAGE_FILE_ID,
    webhookSecretToken: env.WEBHOOK_SECRET_TOKEN,
  };
}
