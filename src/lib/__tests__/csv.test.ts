import { describe, expect, it } from "vitest";
import { ANKI_DIRECTIVES, cardsToCsv, escapeCsvField, parseCsv } from "@/lib/csv";
import type { Flashcard } from "@/lib/flashcards/schema";

const nastyCard: Flashcard = {
  id: "card-1",
  question: 'What did the lecturer mean by "limiting factors", exactly?',
  answer: "Three things:\nlight, CO2, and temperature.\r\nEach one, on its own, can cap the rate.",
  sourceExcerpt: 'He said, "Limiting factors include light intensity, carbon dioxide concentration, and temperature."',
  difficulty: "medium",
  tags: ["limiting factors", "rate"],
};

const plainCard: Flashcard = {
  id: "card-2",
  question: "What is RuBisCO?",
  answer: "The enzyme that catalyses the first step of carbon fixation.",
  sourceExcerpt: "RuBisCO is the enzyme that catalyses the first major step of carbon fixation.",
  difficulty: "easy",
  tags: [],
};

describe("CSV export", () => {
  it("escapes commas, quotes and line breaks so the file round-trips", () => {
    const csv = cardsToCsv([nastyCard, plainCard]);
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0][0]).toBe(nastyCard.question);
    expect(rows[0][1]).toBe(nastyCard.answer);
    expect(rows[0][4]).toBe(nastyCard.sourceExcerpt);
    expect(rows[1][0]).toBe(plainCard.question);
    for (const directive of ANKI_DIRECTIVES) expect(csv).toContain(`${directive}\r\n`);
  });

  it("doubles quotes inside a field", () => {
    expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""');
  });

  it("turns spaces in tags into underscores so Anki reads them as separate tags", () => {
    const rows = parseCsv(cardsToCsv([nastyCard]));
    expect(rows[0][2]).toBe("limiting_factors rate");
  });

  it("starts with a UTF-8 byte-order mark and uses CRLF line endings", () => {
    const csv = cardsToCsv([plainCard]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.endsWith("\r\n")).toBe(true);
    // Only the record separators are bare CRLF; the multiline answer stays quoted.
    const multi = cardsToCsv([nastyCard]);
    expect(parseCsv(multi)).toHaveLength(1);
  });
});
