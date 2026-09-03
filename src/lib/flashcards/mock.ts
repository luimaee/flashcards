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
  "figure", "table", "section", "chapter", "page", "example",
]);

/** Words that cannot begin the subject of a definition ("It is...", "While these..."). */
const NON_SUBJECT_STARTS = new Set([
  "it", "this", "that", "these", "those", "there", "here", "nor", "we", "they",
  "he", "she", "i", "you", "if", "while", "also", "sometimes", "both", "one",
  "such", "some", "many", "most", "all", "each", "however", "thus", "therefore",
  "hence", "then", "so", "but", "and", "or", "yet", "as", "when", "where",
  "because", "although", "though", "since", "first", "second", "third", "finally",
  "what", "which", "who", "how", "why", "our", "their", "its", "his", "her", "my",
  "no", "not", "only", "even", "still", "again", "here", "now", "today", "very",
  "few", "in", "on", "at", "for", "from", "with", "by", "of", "to", "about",
  "after", "before", "during", "under", "over", "between", "among", "within",
  "without", "through", "across", "along", "around", "despite", "upon", "another",
]);

/** Verbs that show a "subject" is really a whole clause ("Very few studies report other..."). */
const VERB_IN_SUBJECT =
  /\b(report|reports|show|shows|find|finds|found|use|uses|used|make|makes|provide|provides|suggest|suggests|argue|argues|indicate|indicates|demonstrate|demonstrates|compare|compares|examine|examines|propose|proposes|present|presents|discuss|discusses|note|notes|want|wants|need|needs|expect|expects|call|calls|tend|tends|seem|seems|remain|remains|become|becomes|include|includes|require|requires)\b/i;

/** Section headings that PDF extraction glues onto the next sentence. */
const LEADING_HEADING =
  /^(Keywords?|Abstract|Introduction|Background|Conclusions?|Discussion|Methods?|Methodology|Results?|Findings|Summary|References|Appendix|Acknowledg(e)?ments?|Limitations|Implications)\s+(?=[A-Z])/;

/** Words inside a subject that show it is a clause, not a thing being defined. */
const CLAUSE_MARKERS = /\b(this|these|those|such|it|that|which|who|by|because|when|while|if)\b/i;

/** A definition's predicate should not start like a passive or a hedge. */
const NON_DEFINITION_PREDICATE = /^(not|also|often|usually|typically|being|still|then|now|more|less|very|just|only|confronted|expected|likely|able|unable|willing|\w+ed\b|\w+ing\b)/i;

/** Weak tags: roman numerals, tiny fragments, bare numbers, stop words. */
function isWeakTag(word: string): boolean {
  if (word.length < 3) return true;
  if (/^[IVXLC]+$/.test(word)) return true;
  if (/^\d+$/.test(word)) return true;
  return STOP_WORDS.has(word.toLowerCase());
}

/** Formula garbage from PDF fonts, or symbol soup. */
function looksGarbled(sentence: string): boolean {
  const mojibake = (sentence.match(/[¼½¾þðÞ§¶¤¢£¥]/g) ?? []).length;
  if (mojibake >= 2) return true;
  const symbols = (sentence.match(/[^\p{L}\p{N}\s.,;:()'"’“”\-–—%?!/]/gu) ?? []).length;
  return symbols / sentence.length > 0.06;
}

/** Author lines, emails, URLs, repository cover sheets, copyright notices. */
function looksLikeFrontMatter(sentence: string): boolean {
  if (/^[A-Z]{3,}(\s[A-Z]{2,})+\b/.test(sentence)) return true; // "VENKAT RAMASWAMY is the ..."
  return /@|https?:\/\/|www\.|\be-?mail\b|\bprofessor\b|\bfellow\b|©|copyright|all rights reserved|researchgate|downloaded|\bdoi\b|issn|isbn|published online|received:|accepted:|see discussions|citations? \d|reads \d|see profile|university of|school of management|business school/i.test(
    sentence,
  );
}

/** Drop a glued-on section heading ("Keywords Structural equation..." -> "Structural equation..."). */
function stripHeading(sentence: string): string {
  return sentence.replace(LEADING_HEADING, "");
}

export class MockProvider implements FlashcardProvider {
  readonly name = "mock";
  readonly sendsTextExternally = false;

  async generateFlashcards(text: string, options: GenerateOptions): Promise<RawFlashcard[]> {
    const used = new Set((options.avoid?.excerpts ?? []).map((e) => e.replace(/\s+/g, " ").trim()));
    const sentences = splitSentences(text)
      .map(stripHeading)
      .filter(
        (s) =>
          s.length >= 40 &&
          s.length <= LIMITS.sourceExcerpt &&
          !used.has(s) &&
          !looksGarbled(s) &&
          !looksLikeFrontMatter(s),
      );
    const ranked = rankSentences(sentences);
    const cards: RawFlashcard[] = [];
    const seenQuestions = new Set<string>();
    for (const sentence of ranked) {
      if (cards.length >= options.count) break;
      const card = buildCard(sentence);
      if (!card) continue;
      const key = card.question.toLowerCase();
      if (seenQuestions.has(key)) continue;
      seenQuestions.add(key);
      cards.push(card);
    }
    return cards;
  }
}

/** Rank sentences: definitions, numbers and technical terms score higher. */
function rankSentences(sentences: string[]): string[] {
  return sentences
    .map((sentence, index) => {
      let score = 0;
      if (parseDefinition(sentence)) score += 5;
      if (/\d/.test(sentence)) score += 1;
      if (/[A-Z][a-z]+\s[A-Z][a-z]+/.test(sentence)) score += 1;
      if (/\b(formula|equation|theorem|law|principle|defined|definition|model|criterion)\b/i.test(sentence)) score += 2;
      if (sentence.length > 260) score -= 1;
      if (!/[.!?]["”)]?$/.test(sentence)) score -= 1;
      return { sentence, index, score };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((s) => s.sentence);
}

interface Definition {
  term: string;
  verb: string;
  rest: string;
}

/** Return the definition parts when a sentence genuinely defines a thing. */
function parseDefinition(sentence: string): Definition | null {
  const match = sentence.match(DEFINITION_PATTERN);
  if (!match?.groups) return null;
  const term = match.groups.term.trim();
  const core = term.replace(/^(the|a|an)\s+/i, "");
  const words = core.split(/\s+/);
  if (words.length === 0 || words.length > 6) return null;
  if (NON_SUBJECT_STARTS.has(words[0].toLowerCase())) return null;
  if (CLAUSE_MARKERS.test(core)) return null;
  if (VERB_IN_SUBJECT.test(core)) return null;
  if (/ing$/i.test(words[0]) && words.length > 1) return null; // "Comparing the approaches by"
  const rest = match.groups.rest.trim();
  if (NON_DEFINITION_PREDICATE.test(rest)) return null;
  if (rest.split(/\s+/).length < 3) return null;
  return { term, verb: match.groups.verb, rest };
}

function buildCard(sentence: string): RawFlashcard | null {
  const excerpt = sentence.slice(0, LIMITS.sourceExcerpt);
  const tags = extractTags(sentence);
  const definition = parseDefinition(sentence);

  if (definition) {
    const { term, verb, rest } = definition;
    const plural = verb === "are" || verb === "were";
    const termForQuestion = questionCase(term);
    const termTag = term.replace(/^(the|a|an)\s+/i, "");
    const tagList = termTag.split(/\s+/).length <= 4 && termTag.length <= LIMITS.tag ? [termTag, ...tags] : tags;
    return {
      question: `What ${plural ? "are" : "is"} ${termForQuestion}?`,
      answer: capitalise(`${term} ${verb} ${rest.replace(/[.]+$/, "")}.`),
      sourceExcerpt: excerpt,
      difficulty: difficultyFor(sentence),
      tags: Array.from(new Set(tagList)).slice(0, 3),
    };
  }

  const focus = focusPhrase(sentence, tags);
  if (!focus) return null;
  return {
    question: `What does the lecture say about ${focus}?`,
    answer: sentence.replace(/\s+/g, " ").trim(),
    sourceExcerpt: excerpt,
    difficulty: difficultyFor(sentence),
    tags,
  };
}

/**
 * Lower-case a leading article so the question reads naturally:
 * "The compensation point" -> "the compensation point". Everything else keeps
 * its case, because we cannot tell a name ("Schmitt") from a common noun.
 */
function questionCase(term: string): string {
  return term.replace(/^(The|A|An)\s+/, (article) => article.toLowerCase());
}

function difficultyFor(sentence: string): Difficulty {
  const words = sentence.split(/\s+/).length;
  const technical = (sentence.match(/[A-Z]{2,}|\d|[=+*/^]/g) ?? []).length;
  if (words < 18 && technical < 2) return "easy";
  if (words > 40 || technical > 6) return "hard";
  return "medium";
}

/** Pull a few meaningful words (capitalised terms first) as tags. Whole words only. */
function extractTags(sentence: string): string[] {
  const words = sentence.replace(/[^\p{L}\p{N}\s-]/gu, " ").split(/\s+/).filter(Boolean);
  const candidates: string[] = [];
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i];
    if (i > 0 && /^[A-Z]/.test(word) && !isWeakTag(word)) candidates.push(word);
  }
  if (candidates.length < 2) {
    for (const word of words) {
      const lower = word.toLowerCase();
      if (lower.length >= 6 && !isWeakTag(word) && !candidates.some((c) => c.toLowerCase() === lower)) {
        candidates.push(lower);
      }
    }
  }
  const unique = Array.from(new Set(candidates.filter((c) => c.length <= LIMITS.tag)));
  return unique.slice(0, 3);
}

/** The thing a non-definition sentence is about: a name, else the first meaningful words. */
function focusPhrase(sentence: string, tags: string[]): string | null {
  const name = sentence.match(/\b([A-Z][a-z]+(?:\s(?:and|&)\s[A-Z][a-z]+|\s[A-Z][a-z]+)+)\b/);
  if (name && !looksLikeFrontMatter(name[1])) return name[1];
  const words = sentence.replace(/[^\p{L}\p{N}\s-]/gu, " ").split(/\s+/).filter(Boolean);
  const meaningful = words.filter((w) => w.length >= 5 && !STOP_WORDS.has(w.toLowerCase()) && !NON_SUBJECT_STARTS.has(w.toLowerCase()));
  if (meaningful.length >= 2) return meaningful.slice(0, 2).join(" ").toLowerCase();
  if (tags[0]) return tags[0];
  return null;
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
