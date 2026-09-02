import { describe, expect, it } from "vitest";
import type { FlashcardProvider } from "@/lib/flashcards/provider";
import { GenerationError, generateFromText, getProvider } from "@/lib/flashcards/service";
import { MockProvider } from "@/lib/flashcards/mock";
import { LECTURE_TEXT, SHORT_TEXT } from "./fixtures";

function fakeProvider(output: unknown, delayMs = 0): FlashcardProvider {
  return {
    name: "fake",
    sendsTextExternally: true,
    async generateFlashcards(_text, options) {
      if (delayMs > 0) {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, delayMs);
          options.signal?.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(new Error("aborted"));
          });
        });
      }
      // Deliberately untyped so we can feed broken data through the boundary.
      return output as never;
    },
  };
}

async function expectGenerationError(promise: Promise<unknown>, code: string) {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(GenerationError);
    expect((error as GenerationError).code).toBe(code);
    return error as GenerationError;
  }
  throw new Error(`expected GenerationError ${code}`);
}

describe("generateFromText", () => {
  it("returns 10 cards with ids in mock mode for a normal lecture", async () => {
    const result = await generateFromText({ text: LECTURE_TEXT }, new MockProvider());
    expect(result.cards).toHaveLength(10);
    expect(result.provider).toBe("mock");
    expect(result.sendsTextExternally).toBe(false);
    expect(new Set(result.cards.map((c) => c.id)).size).toBe(10);
    expect(result.notice).toBeUndefined();
  });

  it("rejects text that is too short with a friendly message", async () => {
    const error = await expectGenerationError(generateFromText({ text: SHORT_TEXT }, new MockProvider()), "too-short");
    expect(error.userMessage).toMatch(/too short/i);
    expect(error.userMessage).not.toMatch(/stack|Error:/);
  });

  it("makes fewer cards for a short-but-usable source and says why", async () => {
    // Roughly 3 paragraphs: enough to pass the minimum, not enough for 10 cards.
    const shortSource = LECTURE_TEXT.split("\n").slice(0, 3).join("\n");
    const result = await generateFromText({ text: shortSource }, new MockProvider());
    expect(result.cards.length).toBeGreaterThan(0);
    expect(result.cards.length).toBeLessThan(10);
    expect(result.notice).toMatch(/fairly short/i);
  });

  it("refuses malformed provider output instead of showing broken cards", async () => {
    const broken = fakeProvider([{ question: "Only a question" }]);
    const error = await expectGenerationError(generateFromText({ text: LECTURE_TEXT }, broken), "invalid-output");
    expect(error.userMessage).toMatch(/unexpected format/i);
  });

  it("refuses provider output that is not even an array", async () => {
    const broken = fakeProvider("cards: none");
    await expectGenerationError(generateFromText({ text: LECTURE_TEXT }, broken), "invalid-output");
  });

  it("drops duplicate questions and cards whose excerpt is not in the source", async () => {
    const excerpt = "Photosynthesis is the process by which green plants convert light energy into chemical energy stored in glucose.";
    const card = { question: "What is photosynthesis?", answer: "A", sourceExcerpt: excerpt, difficulty: "easy", tags: [] };
    const provider = fakeProvider([
      card,
      { ...card, question: "what is photosynthesis" },
      { ...card, question: "What is made up?", sourceExcerpt: "This sentence is not in the lecture." },
    ]);
    const result = await generateFromText({ text: LECTURE_TEXT }, provider);
    expect(result.cards).toHaveLength(1);
    expect(result.notice).toMatch(/left out/);
  });

  it("does not return a card the student already has when regenerating", async () => {
    const first = await generateFromText({ text: LECTURE_TEXT }, new MockProvider());
    const again = await generateFromText({ text: LECTURE_TEXT, count: 1, avoid: first.cards }, new MockProvider());
    expect(again.cards).toHaveLength(1);
    expect(first.cards.map((c) => c.question)).not.toContain(again.cards[0].question);
  });

  it("times out slow providers", async () => {
    const slow = fakeProvider([], 500);
    const error = await expectGenerationError(
      generateFromText({ text: LECTURE_TEXT, timeoutMs: 20 }, slow),
      "timeout",
    );
    expect(error.userMessage).toMatch(/too long/i);
  });

  it("wraps provider crashes without leaking details to the student", async () => {
    const crashing: FlashcardProvider = {
      name: "crash",
      sendsTextExternally: true,
      async generateFlashcards() {
        throw new Error("401 Unauthorized: invalid api key sk-secret");
      },
    };
    const error = await expectGenerationError(generateFromText({ text: LECTURE_TEXT }, crashing), "provider-unavailable");
    expect(error.userMessage).not.toMatch(/sk-secret|401/);
    expect(error.detail).toMatch(/401/); // kept for server logs only
  });

  it("reports when no usable cards come back", async () => {
    await expectGenerationError(generateFromText({ text: LECTURE_TEXT }, fakeProvider([])), "no-cards");
  });
});

describe("getProvider", () => {
  it("defaults to mock when nothing is configured", () => {
    expect(getProvider({}).name).toBe("mock");
    expect(getProvider({ AI_PROVIDER: "mock" }).name).toBe("mock");
  });

  it("refuses unknown providers loudly", () => {
    expect(() => getProvider({ AI_PROVIDER: "gpt-9000" })).toThrow(GenerationError);
  });
});
