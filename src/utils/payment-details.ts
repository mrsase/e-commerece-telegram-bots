const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

function toAsciiDigits(value: string): string {
  return value.replace(/[۰-۹٠-٩]/g, (digit) => {
    const persianIndex = PERSIAN_DIGITS.indexOf(digit);
    return String(persianIndex >= 0 ? persianIndex : ARABIC_DIGITS.indexOf(digit));
  });
}

/** Normalize a manager-entered card number while preserving strict validation. */
export function normalizePaymentCardNumber(value: string): string | null {
  const normalized = toAsciiDigits(value).replace(/\s+/g, "");
  return /^\d{16}$/.test(normalized) ? normalized : null;
}

/**
 * Normalize an Iranian IBAN (Sheba): the IR prefix followed by exactly 24
 * digits. Spaces are accepted for readability, but no other separators are.
 */
export function normalizeShebaNumber(value: string): string | null {
  const normalized = toAsciiDigits(value).trim().toUpperCase().replace(/\s+/g, "");
  return /^IR\d{24}$/.test(normalized) ? normalized : null;
}

/** Keep account-holder labels useful and safe for a Telegram settings flow. */
export function normalizePaymentHolderName(value: string): string | null {
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.length >= 2 && normalized.length <= 100 ? normalized : null;
}
