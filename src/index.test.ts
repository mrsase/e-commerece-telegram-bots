import { describe, expect, it } from "vitest";
import { getServiceStartupMessage } from "./index.js";

describe("getServiceStartupMessage", () => {
  it("returns the expected startup message", () => {
    expect(getServiceStartupMessage()).toBe("telegram-bots service starting (dev)");
  });
});
