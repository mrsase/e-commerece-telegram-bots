import { describe, expect, it } from "vitest";
import {
  normalizePaymentCardNumber,
  normalizePaymentHolderName,
  normalizeShebaNumber,
} from "./payment-details.js";
import { ChannelTexts } from "../i18n/texts.js";

describe("payment details", () => {
  it("normalizes valid card numbers and localized digits", () => {
    expect(normalizePaymentCardNumber("6219 8619 2850 4819")).toBe("6219861928504819");
    expect(normalizePaymentCardNumber("۶۲۱۹۸۶۱۹۲۸۵۰۴۸۱۹")).toBe("6219861928504819");
    expect(normalizePaymentCardNumber("6219-8619-2850-4819")).toBeNull();
  });

  it("accepts only IR followed by exactly 24 digits for Sheba", () => {
    expect(normalizeShebaNumber("ir12 3456 7890 1234 5678 9012 34")).toBe("IR123456789012345678901234");
    expect(normalizeShebaNumber("IR12345678901234567890123")).toBeNull();
    expect(normalizeShebaNumber("US123456789012345678901234")).toBeNull();
  });

  it("normalizes holder names and rejects empty or oversized values", () => {
    expect(normalizePaymentHolderName("  علی   رضایی  ")).toBe("علی رضایی");
    expect(normalizePaymentHolderName("A")).toBeNull();
    expect(normalizePaymentHolderName("x".repeat(101))).toBeNull();
  });

  it("renders both payment methods with their respective holder names", () => {
    const text = ChannelTexts.paymentMessage(42, 100_000, {
      cardNumber: "6219861928504819",
      cardHolderName: "علی رضایی",
      shebaNumber: "IR123456789012345678901234",
      shebaHolderName: "شرکت نمونه",
    });

    expect(text).toContain("شماره کارت: `6219861928504819`");
    expect(text).toContain("صاحب کارت: علی رضایی");
    expect(text).toContain("شماره شبا: `IR123456789012345678901234`");
    expect(text).toContain("صاحب شبا: شرکت نمونه");
    expect(text).toContain("به یکی از مشخصات پرداخت بالا");
  });
});
