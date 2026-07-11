import { describe, expect, it } from "vitest";
import { referralCodeFromStartMessage } from "./client-bot-interactive.js";

describe("referralCodeFromStartMessage", () => {
  it("extracts and normalizes a referral code from a Telegram start command", () => {
    expect(referralCodeFromStartMessage("/start mgr_abC-12")).toBe("MGR_ABC-12");
  });

  it("does not treat unrelated text as a referral command", () => {
    expect(referralCodeFromStartMessage("/start code extra")).toBeUndefined();
  });
});
