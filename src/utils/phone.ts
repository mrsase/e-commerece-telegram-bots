const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

function toAsciiDigits(value: string): string {
  return value.replace(/[۰-۹٠-٩]/g, (digit) => {
    const persianIndex = PERSIAN_DIGITS.indexOf(digit);
    if (persianIndex >= 0) return String(persianIndex);
    return String(ARABIC_DIGITS.indexOf(digit));
  });
}

/** Normalize Iranian mobile numbers to the international +989xxxxxxxxx format. */
export function normalizeIranianPhone(value: string | null | undefined): string | null {
  if (!value) return null;

  let digits = toAsciiDigits(value).replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  // Repeatedly strip leading national "0" or country-code "98" prefixes so
  // plausible doubled forms — "0989…", "+98 0 9…", "+98 0 98 9…" — all
  // normalize down to the bare 9xxxxxxxxx mobile number.
  let changed = true;
  while (changed) {
    changed = false;
    if (digits.startsWith("0")) {
      digits = digits.slice(1);
      changed = true;
    }
    if (digits.startsWith("98")) {
      digits = digits.slice(2);
      changed = true;
    }
  }

  if (!/^9\d{9}$/.test(digits)) return null;
  return `+98${digits}`;
}

/**
 * Keep an international number visually intact inside Persian/RTL messages.
 * LRM characters isolate the leading plus sign without adding visible text.
 */
export function formatPhoneForDisplay(value: string | null | undefined, fallback = "—"): string {
  const normalized = normalizeIranianPhone(value);
  const display = normalized ?? value?.trim();
  return display ? `\u200E${display}\u200E` : fallback;
}
