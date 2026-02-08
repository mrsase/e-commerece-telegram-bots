import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { WebhookHandlers } from "./server.js";
import { buildServer } from "./server.js";

let app: ReturnType<typeof buildServer>;
let handlers: WebhookHandlers;

beforeAll(async () => {
  const handleClientUpdate = vi.fn(async () => {});
  const handleManagerUpdate = vi.fn(async () => {});
  const handleCourierUpdate = vi.fn(async () => {});

  handlers = {
    handleClientUpdate,
    handleManagerUpdate,
    handleCourierUpdate,
  };

  app = buildServer(handlers);
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe("HTTP server", () => {
  it("responds to /health with status ok", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/health",
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { status: string };
    expect(body.status).toBe("ok");
  });

  it("forwards client webhook updates", async () => {
    const payload = { update_id: 1, message: { text: "hi" } };

    const response = await app.inject({
      method: "POST",
      url: "/webhook/client",
      payload,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { ok: boolean };
    expect(body.ok).toBe(true);
    expect(handlers.handleClientUpdate).toHaveBeenCalledTimes(1);
    expect(handlers.handleClientUpdate).toHaveBeenCalledWith(payload);
  });

  it("forwards manager webhook updates", async () => {
    const payload = { update_id: 2, message: { text: "manager" } };

    const response = await app.inject({
      method: "POST",
      url: "/webhook/manager",
      payload,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { ok: boolean };
    expect(body.ok).toBe(true);
    expect(handlers.handleManagerUpdate).toHaveBeenCalledTimes(1);
    expect(handlers.handleManagerUpdate).toHaveBeenCalledWith(payload);
  });

  it("forwards courier webhook updates", async () => {
    const payload = { update_id: 3, message: { text: "courier" } };

    const response = await app.inject({
      method: "POST",
      url: "/webhook/courier",
      payload,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { ok: boolean };
    expect(body.ok).toBe(true);
    expect(handlers.handleCourierUpdate).toHaveBeenCalledTimes(1);
    expect(handlers.handleCourierUpdate).toHaveBeenCalledWith(payload);
  });
});
