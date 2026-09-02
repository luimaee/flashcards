import { z } from "zod";

/**
 * Strict flashcard data contract.
 *
 * Every card that reaches the UI must satisfy FlashcardSchema. Providers
 * return "raw" cards (no id); the server validates them, assigns stable ids
 * for the session, and removes duplicates before responding.
 */

export const DIFFICULTIES = ["easy", "medium", "hard"] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export const LIMITS = {
  question: 500,
  answer: 2000,
  sourceExcerpt: 600,
  tag: 40,
  maxTags: 8,
} as const;

const trimmedString = (max: number) => z.string().trim().min(1).max(max);

/** Card as returned by an AI provider, before the server assigns an id. */
export const RawFlashcardSchema = z
  .object({
    question: trimmedString(LIMITS.question),
    answer: trimmedString(LIMITS.answer),
    sourceExcerpt: trimmedString(LIMITS.sourceExcerpt),
    difficulty: z.enum(DIFFICULTIES),
    tags: z.array(trimmedString(LIMITS.tag)).max(LIMITS.maxTags),
  })
  .strict();

export type RawFlashcard = z.infer<typeof RawFlashcardSchema>;

/** Card as shown to the student. */
export const FlashcardSchema = RawFlashcardSchema.extend({
  id: z.string().trim().min(1),
}).strict();

export type Flashcard = z.infer<typeof FlashcardSchema>;

/** Shape a provider must return: a JSON object with a `cards` array. */
export const ProviderResponseSchema = z
  .object({
    cards: z.array(RawFlashcardSchema),
  })
  .strict();

export type ProviderResponse = z.infer<typeof ProviderResponseSchema>;

export class InvalidProviderOutputError extends Error {
  constructor(
    message: string,
    public readonly issues: string[] = [],
  ) {
    super(message);
    this.name = "InvalidProviderOutputError";
  }
}

/**
 * Validate unknown provider output. Throws InvalidProviderOutputError with a
 * readable issue list when the shape is wrong. Never returns partial data.
 */
export function validateProviderOutput(data: unknown): RawFlashcard[] {
  const result = ProviderResponseSchema.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues.map(
      (issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`,
    );
    throw new InvalidProviderOutputError(
      "AI response did not match the flashcard schema",
      issues,
    );
  }
  return result.data.cards;
}

/** Parse a JSON string from a provider, then validate it. */
export function parseProviderJson(jsonText: string): RawFlashcard[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFence(jsonText));
  } catch {
    throw new InvalidProviderOutputError("AI response was not valid JSON");
  }
  return validateProviderOutput(parsed);
}

function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1] : trimmed;
}

/** Normalise a question for duplicate comparison. */
export function normaliseQuestion(question: string): string {
  return question
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Remove cards whose question (after normalisation) already appeared. */
export function dedupeCards<T extends { question: string }>(cards: T[]): T[] {
  const seen = new Set<string>();
  const unique: T[] = [];
  for (const card of cards) {
    const key = normaliseQuestion(card.question);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(card);
  }
  return unique;
}

/** Assign stable, unique ids for the current session. */
export function assignIds(cards: RawFlashcard[], prefix = "card"): Flashcard[] {
  const stamp = Date.now().toString(36);
  return cards.map((card, index) => ({
    id: `${prefix}-${stamp}-${index + 1}`,
    ...card,
  }));
}

/**
 * Check that every source excerpt really appears in the source text
 * (whitespace- and case-insensitive). Cards whose excerpt is not found are
 * dropped so the student is never shown a "source" that does not exist.
 */
export function keepSupportedCards<T extends { sourceExcerpt: string }>(
  cards: T[],
  sourceText: string,
): { kept: T[]; droppedCount: number } {
  const haystack = squash(sourceText);
  const kept = cards.filter((card) => haystack.includes(squash(card.sourceExcerpt)));
  return { kept, droppedCount: cards.length - kept.length };
}

function squash(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}
