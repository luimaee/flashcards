import { describe, expect, it } from "vitest";
import {
  FlashcardSchema,
  InvalidProviderOutputError,
  assignIds,
  dedupeCards,
  keepSupportedCards,
  parseProviderJson,
  validateProviderOutput,
} from "@/lib/flashcards/schema";

const validCard = {
  question: "What is photosynthesis?",
  answer: "The process by which plants convert light energy into chemical energy.",
  sourceExcerpt: "Photosynthesis is the process by which green plants convert light energy into chemical energy.",
  difficulty: "easy" as const,
  tags: ["biology", "energy"],
};

describe("flashcard schema", () => {
  it("accepts a valid card with an id", () => {
    const result = FlashcardSchema.safeParse({ id: "card-1", ...validCard });
    expect(result.success).toBe(true);
  });

  it("accepts valid provider output", () => {
    const cards = validateProviderOutput({ cards: [validCard, { ...validCard, question: "Another?" }] });
    expect(cards).toHaveLength(2);
    expect(cards[0].difficulty).toBe("easy");
  });

  it.each([
    ["missing answer", { cards: [{ ...validCard, answer: undefined }] }],
    ["empty question", { cards: [{ ...validCard, question: "   " }] }],
    ["bad difficulty", { cards: [{ ...validCard, difficulty: "impossible" }] }],
    ["tags not an array", { cards: [{ ...validCard, tags: "biology" }] }],
    ["extra field", { cards: [{ ...validCard, hint: "no" }] }],
    ["not an object", "just a string"],
    ["cards not an array", { cards: { ...validCard } }],
    ["missing cards key", { flashcards: [validCard] }],
  ])("rejects invalid AI output: %s", (_label, data) => {
    expect(() => validateProviderOutput(data)).toThrow(InvalidProviderOutputError);
  });

  it("reports which field was wrong without leaking anything else", () => {
    try {
      validateProviderOutput({ cards: [{ ...validCard, difficulty: "trivial" }] });
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidProviderOutputError);
      const issues = (error as InvalidProviderOutputError).issues;
      expect(issues.some((i) => i.startsWith("cards.0.difficulty"))).toBe(true);
    }
  });

  it("rejects non-JSON text and unwraps code fences", () => {
    expect(() => parseProviderJson("Here are your cards!")).toThrow(InvalidProviderOutputError);
    const fenced = "```json\n" + JSON.stringify({ cards: [validCard] }) + "\n```";
    expect(parseProviderJson(fenced)).toHaveLength(1);
  });
});

describe("duplicate filtering", () => {
  it("drops cards whose questions match ignoring case, punctuation and spacing", () => {
    const cards = dedupeCards([
      { question: "What is RuBisCO?" },
      { question: "what is rubisco" },
      { question: "  What  is   RuBisCO ?" },
      { question: "What does RuBisCO do?" },
    ]);
    expect(cards.map((c) => c.question)).toEqual(["What is RuBisCO?", "What does RuBisCO do?"]);
  });

  it("keeps the first occurrence", () => {
    const cards = dedupeCards([{ question: "A?", n: 1 }, { question: "a", n: 2 }]);
    expect(cards[0].n).toBe(1);
  });
});

describe("source support check", () => {
  it("keeps cards whose excerpt appears in the source and drops the rest", () => {
    const source = "Chlorophyll a is the primary pigment.\nThe   Calvin cycle fixes carbon.";
    const { kept, droppedCount } = keepSupportedCards(
      [
        { sourceExcerpt: "chlorophyll a is the primary pigment." },
        { sourceExcerpt: "The Calvin cycle fixes carbon." },
        { sourceExcerpt: "Mitochondria are the powerhouse of the cell." },
      ],
      source,
    );
    expect(kept).toHaveLength(2);
    expect(droppedCount).toBe(1);
  });
});

describe("assignIds", () => {
  it("gives every card a unique non-empty id", () => {
    const cards = assignIds([validCard, validCard, validCard]);
    const ids = new Set(cards.map((c) => c.id));
    expect(ids.size).toBe(3);
    for (const card of cards) expect(FlashcardSchema.safeParse(card).success).toBe(true);
  });
});
