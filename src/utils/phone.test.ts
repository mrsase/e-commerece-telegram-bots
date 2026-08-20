import { describe, expect, it } from "vitest";
import { formatPhoneForDisplay, normalizeIranianPhone } from "./phone.js";

describe("Iranian phone utilities", () => {
  it.each([
    ["09123456789", "+989123456789"],
    ["+989123456789", "+989123456789"],
    ["00989123456789", "+989123456789"],
    ["989123456789", "+989123456789"],
    ["9123456789", "+989123456789"],
    ["0912 345 6789", "+989123456789"],
    ["+98 912 345 6789", "+989123456789"],
    // Plausible typo forms: user prepends the country code after the national 0.
    ["0989123456789", "+989123456789"], // 0 + 98 + 9xxxxxxxxx
    ["+98 0 912 345 6789", "+989123456789"],
    ["+980989123456789", "+989123456789"], // +98 + the 0989… form
    ["۰۹۱۲ ۳۴۵ ۶۷۸۹", "+989123456789"],
    ["٠٩١٢٣٤٥٦٧٨٩", "+989123456789"],
    ["۰۹۱۲-۳۴۵-۶۷۸۹", "+989123456789"],
  ])("normalizes %s", (input, expected) => {
    expect(normalizeIranianPhone(input)).toBe(expected);
  });

  it("rejects malformed or non-mobile values", () => {
    expect(normalizeIranianPhone("+98098912345678")).toBeNull();
    expect(normalizeIranianPhone("not a phone")).toBeNull();
    expect(normalizeIranianPhone("+15551234567")).toBeNull(); // non-Iranian
    expect(normalizeIranianPhone("985555123456")).toBeNull(); // wrong national prefix
    expect(normalizeIranianPhone("091234567890")).toBeNull(); // too long
    expect(normalizeIranianPhone("912345678")).toBeNull(); // too short
  });

  it("handles empty input safely", () => {
    expect(normalizeIranianPhone("")).toBeNull();
    expect(normalizeIranianPhone("   ")).toBeNull();
    expect(normalizeIranianPhone(null)).toBeNull();
    expect(normalizeIranianPhone(undefined)).toBeNull();
  });

  it("isolates the number for reliable RTL display", () => {
    expect(formatPhoneForDisplay("09123456789")).toBe("\u200E+989123456789\u200E");
    expect(formatPhoneForDisplay("+98 912 345 6789")).toBe("\u200E+989123456789\u200E");
    expect(formatPhoneForDisplay(null)).toBe("—");
  });

  it("honors a custom fallback without RTL isolation", () => {
    expect(formatPhoneForDisplay(null, "ثبت نشده")).toBe("ثبت نشده");
    expect(formatPhoneForDisplay("", "-")).toBe("-");
  });

  it("rejects an Iranian landline number", () => {
    expect(normalizeIranianPhone("02188776655")).toBeNull();
  });
});