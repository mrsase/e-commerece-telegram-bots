/**
 * Escape Telegram Markdown V1 special characters in dynamic strings.
 * Characters: _ * ` [
 */
export function escapeMarkdown(text: string | null | undefined): string {
  if (!text) return "";
  return text.replace(/([_*`\[])/g, "\\$1");
}
