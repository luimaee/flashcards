import type { FlashcardProvider, GenerateOptions } from "./provider";
import type { Difficulty, RawFlashcard } from "./schema";
import { LIMITS } from "./schema";
import { splitSentences } from "../text";

/**
 * Mock provider.
 *
 * Builds realistic-looking cards straight from the source text so the app can
 * be run and tested without any AI API. Every card's sourceExcerpt is a real
 * sentence from the material. Cards are simple, but they are honest: no
 * invented facts.
 */

const DEFINITION_PATTERN =
  /^(?<term>[A-Z][^.,;:]{1,80}?)\s+(?<verb>is|are|was|were|refers to|means|is defined as|is called|describes)\s+(?<rest>.{10,})$/;

const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "of", "in", "on", "to", "for", "with", "by",
  "at", "from", "as", "is", "are", "was", "were", "be", "this", "that", "these",
  "those", "it", "its", "which", "who", "what", "when", "where", "how", "why",
  "can", "will", "would", "should", "may", "might", "also", "than", "then",
  "into", "over", "under", "between", "about", "each", "such", "not", "but",
  "there", "their", "they", "have", "has", "had", "been", "because", "while",
  "refers", "means", "defined", "called", "describes", "include", "includes",
  "such", "most", "very", "first", "second", "other", "some", "many", "more",
]);

/** Words that make poor tags: roman numerals, tiny fragments, bare numbers. */
function isWeakTag(word: string): boolean {
  if (word.length < 3) return true;
  if (/^[IVXLC]+$/.test(word)) return true;
  if (/^\d+$/.test(word)) return true;
  return STOP_WORDS.has(word.toLowerCase());
}

export class MockProvider implements FlashcardProvider {
  readonly name = "mock";
  readonly sendsTextExternally = false;

  async generateFlashcards(text: string, options: GenerateOptions): Promise<RawFlashcard[]> {
    const used = new Set((options.avoid?.excerpts ?? []).map((e) => e.replace(/\s+/g, " ").trim()));
    const sentences = splitSentences(text).filter(
      (s) => s.length >= 40 && s.length <= LIMITS.sourceExcerpt && !used.has(s),
    );
    const ranked = rankSentences(sentences);
    const cards: RawFlashcard[] = [];
    for (const sentence of ranked) {
      if (cards.length >= options.count) break;
      const card = buildCard(sentence);
      if (card) cards.push(card);
    }
    return cards;
  }
}

/** Rank sentences: definitions, numbers and technical terms score higher. */
function rankSentences(sentences: string[]): string[] {
  return sentences
    .map((sentence, index) => {
      let score = 0;
      if (DEFINITION_PATTERN.test(sentence)) score += 5;
      if (/\d/.test(sentence)) score += 2;
      if (/[A-Z][a-z]+\s[A-Z][a-z]+/.test(sentence)) score += 1;
      if (/[=+\-*/^]|\b(formula|equation|theorem|law|principle)\b/i.test(sentence)) score += 2;
      if (sentence.length > 220) score -= 1;
      return { sentence, index, score };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((s) => s.sentence);
}

function buildCard(sentence: string): RawFlashcard | null {
  const excerpt = sentence.slice(0, LIMITS.sourceExcerpt);
  const match = sentence.match(DEFINITION_PATTERN);
  const tags = extractTags(sentence);

  if (match?.groups) {
    const term = match.groups.term.trim();
    const verb = match.groups.verb;
    const rest = match.groups.rest.trim().replace(/[.]+$/, "");
    const plural = verb === "are" || verb === "were";
    const termTag = term.replace(/^(the|a|an)\s+/i, "").slice(0, LIMITS.tag);
    return {
      question: `What ${plural ? "are" : "is"} ${term}?`,
      answer: capitalise(`${term} ${verb} ${rest}.`),
      sourceExcerpt: excerpt,
      difficulty: difficultyFor(sentence),
      tags: Array.from(new Set([termTag, ...tags])).slice(0, 3),
    };
  }

  const focus = tags[0] ?? keyPhrase(sentence);
  if (!focus) return null;
  return {
    question: `According to the lecture, what is said about ${focus}?`,
    answer: sentence.replace(/\s+/g, " ").trim(),
    sourceExcerpt: excerpt,
    difficulty: difficultyFor(sentence),
    tags,
  };
}

function difficultyFor(sentence: string): Difficulty {
  const words = sentence.split(/\s+/).length;
  const technical = (sentence.match(/[A-Z]{2,}|\d|[=+\-*/^]/g) ?? []).length;
  if (words < 18 && technical < 2) return "easy";
  if (words > 34 || technical > 5) return "hard";
  return "medium";
}

/** Pull a few meaningful words (capitalised terms first) as tags. */
function extractTags(sentence: string): string[] {
  const words = sentence.replace(/[^\p{L}\p{N}\s-]/gu, " ").split(/\s+/).filter(Boolean);
  const candidates: string[] = [];
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i];
    if (i > 0 && /^[A-Z]/.test(word) && !isWeakTag(word)) {
      candidates.push(word);
    }
  }
  if (candidates.length < 2) {
    for (const word of words) {
      const lower = word.toLowerCase();
      if (lower.length >= 6 && !isWeakTag(word) && !candidates.some((c) => c.toLowerCase() === lower)) {
        candidates.push(lower);
      }
    }
  }
  const unique = Array.from(new Set(candidates.map((c) => c.slice(0, LIMITS.tag))));
  return unique.slice(0, 3);
}

function keyPhrase(sentence: string): string | null {
  const words = sentence.replace(/[^\p{L}\p{N}\s-]/gu, " ").split(/\s+/).filter(Boolean);
  const meaningful = words.filter((w) => w.length >= 5 && !STOP_WORDS.has(w.toLowerCase()));
  if (meaningful.length === 0) return null;
  return meaningful.slice(0, 2).join(" ").toLowerCase();
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
