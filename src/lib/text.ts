/** Text helpers shared by upload handling and the mock provider. */

export const MIN_SOURCE_CHARS = 200;
/** Default cap. A provider can raise it via `maxSourceChars`. */
export const MAX_SOURCE_CHARS = 60_000;
/** Roughly one card per this many characters (about one sentence), until the 10-card cap. */
export const CHARS_PER_CARD = 120;
export const TARGET_CARD_COUNT = 10;
/** Pieces longer than this are split further so excerpts stay readable. */
export const MAX_PIECE_CHARS = 400;

/** Collapse odd whitespace and strip control characters from extracted text. */
export function normaliseText(input: string): string {
  return input
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * PDF text often keeps the hyphen from a line break: "crite- rion".
 * Join the fragment when the continuation is lowercase ("criterion").
 * When the continuation is capitalised it is usually a real hyphenated name
 * ("Fornell- Larcker" -> "Fornell-Larcker"). A spaced dash (" - ") is left alone.
 */
export function joinHyphenatedLineBreaks(text: string): string {
  return text
    .replace(/(\p{L})-[ \n]+(\p{Ll})/gu, "$1$2")
    .replace(/(\p{L})-[ \n]+(\p{Lu})/gu, "$1-$2");
}

const SENTENCE_BOUNDARY = /(?<=[.!?])\s+(?=[A-Z0-9"“(\[•\-–])/;
const ENDS_SENTENCE = /[.!?]["”)]?$/;
const STARTS_LIKE_NEW_LINE = /^[A-Z"“(\[•\-–]/;
/** A line ending in one of these is mid-sentence, whatever the next line looks like. */
const ENDS_MID_SENTENCE =
  /\b(the|a|an|and|or|but|of|to|in|on|at|by|for|with|from|as|is|are|was|were|be|that|which|than|into|between|about|over|under|because|while|when|if|not|no|very|more|less|both|either|neither|nor|so|such|their|its|his|her|our|your)$/i;

/**
 * Split text into pieces that read on their own.
 *
 * Sentences are split on punctuation. Lines that never end in punctuation
 * (slide bullets, headings, PDF text with lost breaks) are still usable:
 * a dangling line is kept as a piece when it is long enough and the next
 * line starts fresh. Anything still too long is cut at a word boundary.
 */
export function splitSentences(text: string): string[] {
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const pieces: string[] = [];
  let carry = "";

  for (let i = 0; i < lines.length; i += 1) {
    const line = (carry ? `${carry} ` : "") + lines[i];
    carry = "";
    const parts = line.split(SENTENCE_BOUNDARY).map((p) => p.trim()).filter(Boolean);
    if (parts.length === 0) continue;
    const last = parts[parts.length - 1];
    const complete = parts.slice(0, -1);
    pieces.push(...complete);

    const next = lines[i + 1];
    const lastIsDone = ENDS_SENTENCE.test(last) || next === undefined;
    const nextStartsFresh = next !== undefined && STARTS_LIKE_NEW_LINE.test(next);
    const midSentence = ENDS_MID_SENTENCE.test(last) || /[,;:\-–]$/.test(last);
    if (lastIsDone || (last.length >= 40 && nextStartsFresh && !midSentence) || last.length > MAX_PIECE_CHARS) {
      pieces.push(last);
    } else {
      carry = last;
    }
  }
  if (carry) pieces.push(carry);

  return pieces.flatMap(chunkLongPiece).map((p) => p.replace(/\s+/g, " ").trim()).filter((p) => p.length > 0);
}

/** Cut a long piece at word boundaries into pieces of at most MAX_PIECE_CHARS. */
function chunkLongPiece(piece: string): string[] {
  if (piece.length <= MAX_PIECE_CHARS) return [piece];
  const out: string[] = [];
  let rest = piece;
  while (rest.length > MAX_PIECE_CHARS) {
    // Prefer a clause break, then any space, in the window [200, MAX].
    const window = rest.slice(0, MAX_PIECE_CHARS);
    let cut = Math.max(window.lastIndexOf("; "), window.lastIndexOf(": "), window.lastIndexOf(", "));
    if (cut < 200) cut = window.lastIndexOf(" ");
    if (cut < 200) cut = MAX_PIECE_CHARS;
    out.push(rest.slice(0, cut + 1).trim());
    rest = rest.slice(cut + 1).trim();
  }
  if (rest) out.push(rest);
  return out;
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
