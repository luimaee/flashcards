/**
 * Regression tests for the bugs found in the Phase 2 corpus run.
 * Each block names the bug it guards. All of these failed before the fix.
 */
import { describe, expect, it } from "vitest";
import { parseCsv, cardsToCsv, ANKI_DIRECTIVES } from "@/lib/csv";
import { MockProvider } from "@/lib/flashcards/mock";
import type { Flashcard } from "@/lib/flashcards/schema";
import { generateFromText } from "@/lib/flashcards/service";
import { extractPdfText } from "@/lib/pdf";
import { initialSession, sessionReducer, type SessionState } from "@/lib/session";
import { joinHyphenatedLineBreaks, splitSentences } from "@/lib/text";
import { LECTURE_TEXT, buildPdf, textPage } from "./fixtures";

const card = (id: string, question = `Q ${id}?`): Flashcard => ({
  id,
  question,
  answer: `A ${id}`,
  sourceExcerpt: `S ${id}`,
  difficulty: "easy",
  tags: [],
});

describe("B1/B8: session state survives failures", () => {
  it("keeps existing cards and edits when regenerate-all fails", () => {
    let s: SessionState = { ...initialSession, phase: "done", source: { kind: "text", text: "x" }, cards: [card("1"), card("2")] };
    s = sessionReducer(s, { type: "updateCard", card: { ...card("1"), question: "Edited?" } });
    s = sessionReducer(s, { type: "generateStart", source: s.source! });
    s = sessionReducer(s, { type: "generateFailure", message: "Could not reach the server." });
    expect(s.phase).toBe("done");
    expect(s.cards).toHaveLength(2);
    expect(s.cards[0].question).toBe("Edited?");
    expect(s.error).toBe("Could not reach the server.");
  });

  it("keeps the pasted text when the first generation fails", () => {
    let s = sessionReducer(initialSession, { type: "setDraftText", text: "my lecture notes" });
    s = sessionReducer(s, { type: "generateStart", source: { kind: "text", text: "my lecture notes" } });
    s = sessionReducer(s, { type: "generateFailure", message: "boom" });
    expect(s.phase).toBe("idle");
    expect(s.draftText).toBe("my lecture notes");
    s = sessionReducer(s, { type: "dismissError" });
    expect(s.draftText).toBe("my lecture notes");
  });

  it("marks the session edited so regenerate-all can ask first", () => {
    let s: SessionState = { ...initialSession, phase: "done", cards: [card("1")] };
    expect(s.edited).toBe(false);
    s = sessionReducer(s, { type: "updateCard", card: { ...card("1"), answer: "new" } });
    expect(s.edited).toBe(true);
    s = sessionReducer(s, { type: "generateSuccess", cards: [card("9")], notice: undefined });
    expect(s.edited).toBe(false);
  });
});

describe("B2: mock does not turn pronoun clauses into definition cards", () => {
  it("never asks 'What is It?' style questions", async () => {
    const text = [
      "It is important to emphasize that our typology is much broader than the one used in the media literature.",
      "This means that HTMT.85 can point to discriminant validity problems in research situations.",
      "Firms are confronted with accelerating media and channel fragmentation, and omni-channel management has become the norm.",
      "Nor is it a scripting or staging of customer events around the various offerings of the firm.",
      "We demonstrate its superior performance by means of a Monte Carlo simulation study comparing the approaches.",
      "While these deviations are usually relatively small, they matter for the overall interpretation of the model.",
      "A persona is a semi-fictional representation of your ideal customer based on market research and real data.",
      "The compensation point is the light intensity at which the rate of photosynthesis equals the rate of respiration.",
    ].join(" ");
    const cards = await new MockProvider().generateFlashcards(text, { count: 10 });
    const questions = cards.map((c) => c.question);
    for (const q of questions) {
      expect(q).not.toMatch(/^What (is|are) (It|This|That|These|Those|There|Nor|We|They|He|She|If|While|Also|Sometimes|Both|Firms|One such)\b/i);
      expect(q).not.toMatch(/\bby\?$/);
    }
    expect(questions).toContain("What is a persona?");
    expect(questions).toContain("What is the compensation point?");
  });
});

describe("B3: hyphenated line breaks from PDFs are joined", () => {
  it("joins word fragments and keeps real hyphens", () => {
    expect(joinHyphenatedLineBreaks("the Fornell-Larcker crite- rion then indicates")).toBe(
      "the Fornell-Larcker criterion then indicates",
    );
    expect(joinHyphenatedLineBreaks("these devia- tions are small")).toBe("these deviations are small");
    expect(joinHyphenatedLineBreaks("the Fornell- Larcker criterion")).toBe("the Fornell-Larcker criterion");
    expect(joinHyphenatedLineBreaks("omni- channel management")).toBe("omnichannel management");
    expect(joinHyphenatedLineBreaks("a well-known result - and more")).toBe("a well-known result - and more");
  });

  it("applies to PDF extraction", async () => {
    const pdf = buildPdf([textPage(["The Fornell-Larcker crite-", "rion then indicates that discriminant validity holds."])]);
    const result = await extractPdfText(pdf);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.text).toContain("criterion then indicates");
  });
});

describe("B4: CSV uses Anki directives instead of a header row", () => {
  it("starts with #separator, #html and #columns lines and no plain header", () => {
    const csv = cardsToCsv([card("1")]);
    const lines = csv.replace(/^﻿/, "").split("\r\n");
    expect(lines[0]).toBe("#separator:Comma");
    expect(lines).toContain("#html:false");
    expect(lines).toContain("#columns:Front,Back,Tags,Difficulty,Source");
    expect(lines).toContain("#tags column:3");
    expect(lines.some((l) => l.startsWith('"Front"'))).toBe(false);
    expect(ANKI_DIRECTIVES.length).toBeGreaterThanOrEqual(4);
  });

  it("parses back to exactly the data rows", () => {
    const rows = parseCsv(cardsToCsv([card("1"), card("2")]));
    expect(rows).toHaveLength(2);
    expect(rows[0][0]).toBe("Q 1?");
  });
});

describe("B5: mostly-image PDFs are reported as scanned", () => {
  it("rejects a PDF where only a cover page has text", async () => {
    const cover = textPage([
      "See discussions, stats, and author profiles for this publication at researchgate.net",
      "SERVQUAL A Multiple-item Scale for Measuring Consumer Perceptions of Service Quality",
      "Article in Journal of Retailing January 1988 CITATIONS 6,148 READS 78,196 3 authors",
      "A Parsu Parasuraman University of Miami 157 PUBLICATIONS SEE PROFILE",
    ]);
    const pdf = buildPdf([cover, "", "", "", "", "", "", ""]);
    const result = await extractPdfText(pdf);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("empty");
  });

  it("still accepts a normal text PDF with one blank page", async () => {
    const lines = LECTURE_TEXT.split("\n");
    const pdf = buildPdf([textPage(lines.slice(0, 7)), textPage(lines.slice(7)), ""]);
    const result = await extractPdfText(pdf);
    expect(result.ok).toBe(true);
  });
});

describe("B6: text without sentence punctuation still yields cards", () => {
  it("splits long unpunctuated text into usable chunks", () => {
    const bullets = Array.from({ length: 12 }, (_, i) => `Bullet point number ${i + 1} explains the concept of item ${i + 1} in the lecture`).join("\n");
    const pieces = splitSentences(bullets);
    expect(pieces.length).toBeGreaterThanOrEqual(10);
    for (const p of pieces) expect(p.length).toBeLessThanOrEqual(600);
  });

  it("makes cards from a 70-page PDF whose lines end with page markers", async () => {
    const lines = LECTURE_TEXT.split("\n");
    const pages: string[] = [];
    for (let p = 0; p < 70; p += 1) {
      pages.push(textPage(Array.from({ length: 25 }, (_, i) => `${lines[(p * 25 + i) % lines.length]} [p${p + 1}]`)));
    }
    const extracted = await extractPdfText(buildPdf(pages));
    expect(extracted.ok).toBe(true);
    if (!extracted.ok) return;
    const result = await generateFromText({ text: extracted.text }, new MockProvider());
    expect(result.cards.length).toBe(10);
  });
});

describe("B7: notice reports the number of cards actually returned", () => {
  it("does not claim more cards than were made", async () => {
    // Mock returns fewer than the budget allows: only 2 usable sentences.
    const text = `${"Filler words without any sentence ending go here ".repeat(8)}. Photosynthesis is the process by which plants make glucose from light. RuBisCO is the enzyme that fixes carbon dioxide in the Calvin cycle.`;
    const result = await generateFromText({ text }, new MockProvider());
    expect(result.cards.length).toBeLessThan(10);
    if (result.notice) {
      const claimed = result.notice.match(/so (\d+) cards? (?:was|were) made/);
      if (claimed) expect(Number(claimed[1])).toBe(result.cards.length);
    }
  });
});

describe("B10/B11: mock skips garbage and front matter", () => {
  it("skips formula mojibake and author/email lines", async () => {
    const text = [
      "The AVE for construct ξj is defined as follows: AVEξ j ¼ XK j k¼1 λ2 jk XK j k¼1 λ2 jk þ Θ jk ; ð1Þ where λjk is the indicator loading.",
      "Katherine Lemon is Accenture Professor in Marketing, Carroll School of Management, Boston College (e-mail: kay.lemon@bc.edu).",
      "See discussions, stats, and author profiles for this publication at: https://www.researchgate.net/publication/200827786 which is interesting.",
      "Discriminant validity is the extent to which a construct is truly distinct from other constructs by empirical standards.",
      "The heterotrait-monotrait ratio is the average of the heterotrait-heteromethod correlations relative to the monotrait-heteromethod correlations.",
      "The Calvin cycle refers to the light-independent reactions that fix carbon dioxide into three-carbon sugars in the stroma.",
    ].join(" ");
    const cards = await new MockProvider().generateFlashcards(text, { count: 10 });
    const joined = cards.map((c) => c.sourceExcerpt).join("\n");
    expect(joined).not.toMatch(/¼|þ|ð1Þ/);
    expect(joined).not.toMatch(/e-mail|@bc\.edu|researchgate/i);
    expect(cards.length).toBeGreaterThanOrEqual(3);
  });
});

describe("B12: tags are whole words and short", () => {
  it("never cuts a tag mid-word or exceeds 40 characters", async () => {
    const text =
      "The interactions between companies and customers in emerging markets are not seen as a source of value creation by traditional firms. " +
      "Value exchange and extraction are the primary functions performed by the market, which is separated from value creation.";
    const cards = await new MockProvider().generateFlashcards(text, { count: 10 });
    for (const c of cards) {
      for (const t of c.tags) {
        expect(t.length).toBeLessThanOrEqual(40);
        expect(t).not.toMatch(/\s$/);
        expect(text.toLowerCase()).toContain(t.toLowerCase());
        expect(t.split(/\s+/).length).toBeLessThanOrEqual(4);
      }
    }
  });
});

describe("B9: source limit follows the provider", () => {
  it("lets a provider accept more text than the mock limit", async () => {
    const long = LECTURE_TEXT.repeat(60); // ~93k chars
    const seen: number[] = [];
    const provider = {
      name: "spy",
      sendsTextExternally: true,
      maxSourceChars: 200_000,
      async generateFlashcards(text: string) {
        seen.push(text.length);
        return [
          { question: "Q?", answer: "A", sourceExcerpt: "Photosynthesis is the process", difficulty: "easy" as const, tags: [] },
        ];
      },
    };
    const result = await generateFromText({ text: long }, provider);
    expect(seen[0]).toBeGreaterThan(60_000);
    expect(result.notice ?? "").not.toMatch(/only the first/);
  });
});
