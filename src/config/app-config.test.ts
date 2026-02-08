import { describe, expect, it, beforeEach, afterEach } from "vitest";
import type { AppConfig } from "./app-config.js";
import { loadAppConfigFromEnv } from "./app-config.js";

const ORIGINAL_ENV = process.env;

function setEnv(overrides: Partial<NodeJS.ProcessEnv>): void {
  process.env = { ...ORIGINAL_ENV, ...overrides };
}

describe("loadAppConfigFromEnv", () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it("loads a valid config from environment variables", () => {
    setEnv({
      NODE_ENV: "test",
      PORT: "4000",
      DATABASE_URL: "file:./dev.db",
      CLIENT_BOT_TOKEN: "TEST_CLIENT_TOKEN",
      MANAGER_BOT_TOKEN: "TEST_MANAGER_TOKEN",
      COURIER_BOT_TOKEN: "TEST_COURIER_TOKEN",
    });

    const config: AppConfig = loadAppConfigFromEnv();

    expect(config.nodeEnv).toBe("test");
    expect(config.port).toBe(4000);
    expect(config.databaseUrl).toBe("file:./dev.db");
    expect(config.clientBotToken).toBe("TEST_CLIENT_TOKEN");
    expect(config.managerBotToken).toBe("TEST_MANAGER_TOKEN");
    expect(config.courierBotToken).toBe("TEST_COURIER_TOKEN");
  });

  it("throws when a required variable is missing", () => {
    setEnv({
      NODE_ENV: "test",
      PORT: "3000",
      DATABASE_URL: "", // Intentionally missing
      CLIENT_BOT_TOKEN: "TEST_CLIENT_TOKEN",
      MANAGER_BOT_TOKEN: "TEST_MANAGER_TOKEN",
      COURIER_BOT_TOKEN: "TEST_COURIER_TOKEN",
    });

    expect(() => loadAppConfigFromEnv()).toThrow(/DATABASE_URL/);
  });

  it("defaults to development when NODE_ENV is not set", () => {
    setEnv({
      NODE_ENV: undefined,
      DATABASE_URL: "file:./dev.db",
      CLIENT_BOT_TOKEN: "TEST_CLIENT_TOKEN",
      MANAGER_BOT_TOKEN: "TEST_MANAGER_TOKEN",
      COURIER_BOT_TOKEN: "TEST_COURIER_TOKEN",
    });

    const config: AppConfig = loadAppConfigFromEnv();
    expect(config.nodeEnv).toBe("development");
  });
});
