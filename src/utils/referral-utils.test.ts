import { describe, expect, it } from "vitest";
import { generateReferralCode } from "./referral-utils.js";

describe("generateReferralCode", () => {
  it("returns a string of the correct length", () => {
    const code = generateReferralCode("", 8);
    expect(code).toHaveLength(8);
  });

  it("respects a prefix", () => {
    const code = generateReferralCode("MGR_", 6);
    expect(code).toHaveLength(10); // 4 prefix + 6 random
    expect(code.startsWith("MGR_")).toBe(true);
  });

  it("uses only allowed characters", () => {
    const allowed = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    for (let i = 0; i < 20; i++) {
      const code = generateReferralCode("", 12);
      for (const ch of code) {
        expect(allowed).toContain(ch);
      }
    }
  });

  it("generates unique codes (probabilistic)", () => {
    const codes = new Set<string>();
    for (let i = 0; i < 100; i++) {
      codes.add(generateReferralCode());
    }
    // With 8 chars from 31-char alphabet, collision in 100 is near-impossible
    expect(codes.size).toBe(100);
  });
});
