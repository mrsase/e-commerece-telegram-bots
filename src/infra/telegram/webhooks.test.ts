import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Bot } from "grammy";
import { buildServer } from "../http/server.js";
import { createTelegramWebhookHandlers } from "./webhooks.js";

type BotWithSpy = Bot & {
  __spy?: ReturnType<typeof vi.fn>;
};

let clientBot: Bot;
let managerBot: Bot;
let courierBot: Bot;
let app: ReturnType<typeof buildServer>;

beforeAll(async () => {
  clientBot = new Bot("TEST_CLIENT_TOKEN");
  managerBot = new Bot("TEST_MANAGER_TOKEN");
  courierBot = new Bot("TEST_COURIER_TOKEN");

  const clientSpy = vi
    .spyOn(clientBot, "handleUpdate")
    .mockResolvedValue(undefined);
  const managerSpy = vi
    .spyOn(managerBot, "handleUpdate")
    .mockResolvedValue(undefined);
  const courierSpy = vi
    .spyOn(courierBot, "handleUpdate")
    .mockResolvedValue(undefined);

  // Keep references on the bot instances so we can assert later.
  (clientBot as BotWithSpy).__spy = clientSpy;
  (managerBot as BotWithSpy).__spy = managerSpy;
  (courierBot as BotWithSpy).__spy = courierSpy;

  const handlers = createTelegramWebhookHandlers(clientBot, managerBot, courierBot);
  app = buildServer(handlers);
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe("Telegram webhook handlers", () => {
  it("invokes client bot handleUpdate for client webhook", async () => {
    const payload = { update_id: 1, message: { text: "client" } };

    const response = await app.inject({
      method: "POST",
      url: "/webhook/client",
      payload,
    });

    expect(response.statusCode).toBe(200);
    const clientSpy = (clientBot as BotWithSpy).__spy as ReturnType<
      typeof vi.fn
    >;
    expect(clientSpy).toHaveBeenCalledTimes(1);
    expect(clientSpy).toHaveBeenCalledWith(payload);
  });

  it("invokes manager bot handleUpdate for manager webhook", async () => {
    const payload = { update_id: 2, message: { text: "manager" } };

    const response = await app.inject({
      method: "POST",
      url: "/webhook/manager",
      payload,
    });

    expect(response.statusCode).toBe(200);
    const managerSpy = (managerBot as BotWithSpy).__spy as ReturnType<
      typeof vi.fn
    >;
    expect(managerSpy).toHaveBeenCalledTimes(1);
    expect(managerSpy).toHaveBeenCalledWith(payload);
  });

  it("invokes courier bot handleUpdate for courier webhook", async () => {
    const payload = { update_id: 3, message: { text: "courier" } };

    const response = await app.inject({
      method: "POST",
      url: "/webhook/courier",
      payload,
    });

    expect(response.statusCode).toBe(200);
    const courierSpy = (courierBot as BotWithSpy).__spy as ReturnType<typeof vi.fn>;
    expect(courierSpy).toHaveBeenCalledTimes(1);
    expect(courierSpy).toHaveBeenCalledWith(payload);
  });
});
