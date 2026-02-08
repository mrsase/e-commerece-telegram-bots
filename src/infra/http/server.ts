import Fastify, {
  type FastifyInstance,
  type FastifyRequest,
  type FastifyReply,
} from "fastify";

export interface WebhookHandlers {
  handleClientUpdate: (update: unknown) => Promise<void> | void;
  handleManagerUpdate: (update: unknown) => Promise<void> | void;
  handleCourierUpdate: (update: unknown) => Promise<void> | void;
}

export interface ServerOptions {
  webhookSecretToken?: string;
  maxBodySize?: number;
}

/**
 * P0-4 Fix: Verify Telegram webhook secret token header
 */
function verifyWebhookSecret(
  request: FastifyRequest,
  secretToken: string | undefined
): boolean {
  if (!secretToken) {
    // No secret configured - allow all requests (dev mode)
    return true;
  }
  const headerToken = request.headers["x-telegram-bot-api-secret-token"];
  return headerToken === secretToken;
}

export function buildServer(
  handlers: WebhookHandlers,
  options: ServerOptions = {}
): FastifyInstance {
  const { webhookSecretToken, maxBodySize = 1024 * 1024 } = options; // 1MB default

  const app = Fastify({ 
    logger: true,
    bodyLimit: maxBodySize,
  });

  app.setErrorHandler(async (error, request, reply) => {
    request.log.error(
      {
        err: error,
        url: request.url,
        method: request.method,
      },
      "Unhandled error while processing request",
    );

    if (!reply.sent) {
      await reply.code(500).send({ error: "Internal Server Error" });
    }
  });

  app.get("/health", async () => {
    return {
      status: "ok",
    };
  });

  app.post("/webhook/client", async (request: FastifyRequest, reply: FastifyReply) => {
    // P0-4 Fix: Verify webhook secret token
    if (!verifyWebhookSecret(request, webhookSecretToken)) {
      request.log.warn("Unauthorized webhook request to /webhook/client");
      return reply.code(401).send({ error: "Unauthorized" });
    }

    if (request.body == null || typeof request.body !== "object") {
      return reply.code(400).send({ error: "Invalid payload" });
    }

    await handlers.handleClientUpdate(request.body);
    return reply.code(200).send({ ok: true });
  });

  app.post("/webhook/manager", async (request: FastifyRequest, reply: FastifyReply) => {
    // P0-4 Fix: Verify webhook secret token
    if (!verifyWebhookSecret(request, webhookSecretToken)) {
      request.log.warn("Unauthorized webhook request to /webhook/manager");
      return reply.code(401).send({ error: "Unauthorized" });
    }

    if (request.body == null || typeof request.body !== "object") {
      return reply.code(400).send({ error: "Invalid payload" });
    }

    await handlers.handleManagerUpdate(request.body);
    return reply.code(200).send({ ok: true });
  });

  app.post("/webhook/courier", async (request: FastifyRequest, reply: FastifyReply) => {
    // P0-4 Fix: Verify webhook secret token
    if (!verifyWebhookSecret(request, webhookSecretToken)) {
      request.log.warn("Unauthorized webhook request to /webhook/courier");
      return reply.code(401).send({ error: "Unauthorized" });
    }

    if (request.body == null || typeof request.body !== "object") {
      return reply.code(400).send({ error: "Invalid payload" });
    }

    await handlers.handleCourierUpdate(request.body);
    return reply.code(200).send({ ok: true });
  });

  return app;
}
