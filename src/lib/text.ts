/** Text helpers shared by upload handling and the mock provider. */

export const MIN_SOURCE_CHARS = 200;
export const MAX_SOURCE_CHARS = 60_000;
/** Roughly one card per this many characters (about one sentence), until the 10-card cap. */
export const CHARS_PER_CARD = 120;
export const TARGET_CARD_COUNT = 10;

/** Collapse odd whitespace and strip control characters from extracted text. */
export function normaliseText(input: string): string {
  return input
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Split text into sentences that read on their own. */
export function splitSentences(text: string): string[] {
  const flat = text.replace(/\s+/g, " ").trim();
  if (!flat) return [];
  const parts = flat.split(/(?<=[.!?])\s+(?=[A-Z0-9"“(])/);
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

/**
 * How many cards a source can honestly support. Short sources get fewer
 * cards; anything long enough gets the full target.
 */
export function cardCountFor(text: string, target = TARGET_CARD_COUNT): number {
  const usable = Math.floor(text.length / CHARS_PER_CARD);
  return Math.max(1, Math.min(target, usable));
}

export function isTooShort(text: string): boolean {
  return text.length < MIN_SOURCE_CHARS;
}
