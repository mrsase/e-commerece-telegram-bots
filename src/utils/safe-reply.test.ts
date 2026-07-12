import type { Context } from "grammy";
import { describe, expect, it, vi } from "vitest";
import { safeDeleteChatMessage, safeRender } from "./safe-reply.js";

function contextWith(args: {
  edit?: ReturnType<typeof vi.fn>;
  remove?: ReturnType<typeof vi.fn>;
  reply?: ReturnType<typeof vi.fn>;
}): Context {
  return {
    editMessageText: args.edit ?? vi.fn(),
    deleteMessage: args.remove ?? vi.fn(),
    reply: args.reply ?? vi.fn(),
  } as unknown as Context;
}

describe("safeRender", () => {
  it("does nothing when Telegram says the message is unchanged", async () => {
    const edit = vi.fn().mockRejectedValue(new Error("400: Bad Request: message is not modified"));
    const remove = vi.fn();
    const reply = vi.fn();

    await safeRender(contextWith({ edit, remove, reply }), "same text");

    expect(remove).not.toHaveBeenCalled();
    expect(reply).not.toHaveBeenCalled();
  });

  it("quietly replaces a photo message that has no editable text", async () => {
    const edit = vi.fn().mockRejectedValue(new Error("400: Bad Request: there is no text in the message to edit"));
    const remove = vi.fn().mockResolvedValue(undefined);
    const reply = vi.fn().mockResolvedValue(undefined);
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await safeRender(contextWith({ edit, remove, reply }), "new text");

    expect(remove).toHaveBeenCalledOnce();
    expect(reply).toHaveBeenCalledOnce();
    expect(warning).not.toHaveBeenCalled();
    warning.mockRestore();
  });

  it("retries malformed Markdown as plain text without deleting the message", async () => {
    const edit = vi.fn()
      .mockRejectedValueOnce(new Error("400: Bad Request: can't parse entities: Can't find end of the entity"))
      .mockResolvedValueOnce(undefined);
    const remove = vi.fn();

    await safeRender(contextWith({ edit, remove }), "customer_input_", { parse_mode: "Markdown" });

    expect(edit).toHaveBeenCalledTimes(2);
    expect(edit.mock.calls[1][1]).not.toHaveProperty("parse_mode");
    expect(remove).not.toHaveBeenCalled();
  });
});

describe("safeDeleteChatMessage", () => {
  it("ignores a message that was already deleted", async () => {
    const api = {
      deleteMessage: vi.fn().mockRejectedValue(new Error("400: Bad Request: message to delete not found")),
    };

    await expect(safeDeleteChatMessage(api, "123", 10)).resolves.toBe(false);
  });

  it("preserves unexpected deletion errors", async () => {
    const api = { deleteMessage: vi.fn().mockRejectedValue(new Error("network unavailable")) };

    await expect(safeDeleteChatMessage(api, "123", 10)).rejects.toThrow("network unavailable");
  });
});
