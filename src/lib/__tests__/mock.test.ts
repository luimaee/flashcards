import { describe, expect, it } from "vitest";
import { MockProvider } from "@/lib/flashcards/mock";
import { RawFlashcardSchema, keepSupportedCards } from "@/lib/flashcards/schema";
import { LECTURE_TEXT } from "./fixtures";

describe("mock provider", () => {
  const provider = new MockProvider();

  it("makes the requested number of schema-valid cards from real lecture text", async () => {
    const cards = await provider.generateFlashcards(LECTURE_TEXT, { count: 10 });
    expect(cards).toHaveLength(10);
    for (const card of cards) {
      expect(RawFlashcardSchema.safeParse(card).success).toBe(true);
      expect(card.question.endsWith("?")).toBe(true);
    }
  });

  it("only uses excerpts that really appear in the source", async () => {
    const cards = await provider.generateFlashcards(LECTURE_TEXT, { count: 10 });
    const { droppedCount } = keepSupportedCards(cards, LECTURE_TEXT);
    expect(droppedCount).toBe(0);
  });

  it("turns definition sentences into 'What is X?' cards", async () => {
    const cards = await provider.generateFlashcards(LECTURE_TEXT, { count: 10 });
    const questions = cards.map((c) => c.question);
    expect(questions).toContain("What is Photosynthesis?");
  });

  it("does not repeat questions", async () => {
    const cards = await provider.generateFlashcards(LECTURE_TEXT, { count: 10 });
    const unique = new Set(cards.map((c) => c.question.toLowerCase()));
    expect(unique.size).toBe(cards.length);
  });

  it("skips excerpts the student already has when asked to avoid them", async () => {
    const first = await provider.generateFlashcards(LECTURE_TEXT, { count: 10 });
    const next = await provider.generateFlashcards(LECTURE_TEXT, {
      count: 1,
      avoid: { questions: first.map((c) => c.question), excerpts: first.map((c) => c.sourceExcerpt) },
    });
    expect(next).toHaveLength(1);
    expect(first.map((c) => c.sourceExcerpt)).not.toContain(next[0].sourceExcerpt);
  });

  it("sends nothing externally", () => {
    expect(provider.sendsTextExternally).toBe(false);
    expect(provider.name).toBe("mock");
  });
});
