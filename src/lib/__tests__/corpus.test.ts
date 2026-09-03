/**
 * Runs real papers from test/fixtures through the API route in mock mode and
 * checks card quality rules that the Phase 2 review found broken.
 *
 * Only henseler-ringle-sarstedt-2015 ships with the repo (CC BY). The other
 * two are optional local files; the test skips any that are missing.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { POST } from "@/app/api/generate/route";
import { FlashcardSchema, type Flashcard } from "@/lib/flashcards/schema";
import { extractPdfText } from "@/lib/pdf";

const FIXTURES = [
  "henseler-ringle-sarstedt-2015-discriminant-validity",
  "lemon-verhoef-2016-customer-journey",
  "prahalad-ramaswamy-2004-co-creation",
];

const DEBUG_DIR = process.env.CORPUS_DEBUG_DIR;

function squash(s: string) {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

async function post(form: FormData) {
  const res = await POST(new Request("http://localhost/api/generate", { method: "POST", body: form }));
  return { status: res.status, body: (await res.json()) as { cards?: Flashcard[]; notice?: string; error?: { code: string } } };
}

describe("real-paper corpus (mock mode)", () => {
  for (const name of FIXTURES) {
    const path = `test/fixtures/${name}.pdf`;
    const run = existsSync(path) ? it : it.skip;

    run(`${name}: PDF upload and pasted text both give 10 clean cards`, async () => {
      const bytes = new Uint8Array(readFileSync(path));
      const extracted = await extractPdfText(bytes.slice());
      expect(extracted.ok).toBe(true);
      if (!extracted.ok) return;

      for (const path of ["pdf", "text"] as const) {
        const form = new FormData();
        if (path === "pdf") form.set("file", new File([bytes.slice()], `${name}.pdf`, { type: "application/pdf" }));
        else form.set("text", extracted.text);
        const { status, body } = await post(form);
        expect(status).toBe(200);
        const cards = body.cards ?? [];
        expect(cards).toHaveLength(10);

        const hay = squash(extracted.text);
        for (const card of cards) {
          expect(FlashcardSchema.safeParse(card).success).toBe(true);
          // Excerpt is really in the source.
          expect(hay).toContain(squash(card.sourceExcerpt));
          // No line-break hyphen fragments ("crite- rion").
          expect(card.question + card.answer).not.toMatch(/\p{Ll}- \p{Ll}/u);
          // No vague pronoun definitions.
          expect(card.question).not.toMatch(/^What (is|are) (it|this|that|these|those|there|nor|we|they|if|while|also|sometimes|both)\b/i);
          // No formula mojibake or author front matter.
          expect(card.answer).not.toMatch(/¼|þ|ð\d+Þ/);
          expect(card.answer).not.toMatch(/e-mail|@|researchgate|professor/i);
          for (const tag of card.tags) expect(tag.length).toBeLessThanOrEqual(40);
        }
        expect(new Set(cards.map((c) => squash(c.question))).size).toBe(10);

        if (DEBUG_DIR) {
          mkdirSync(DEBUG_DIR, { recursive: true });
          writeFileSync(
            `${DEBUG_DIR}/${name}.${path}.txt`,
            cards.map((c, i) => `${i + 1}. [${c.difficulty}] ${c.question}\n   ${c.answer}\n   tags=${c.tags.join(", ")}`).join("\n\n") +
              `\n\nnotice: ${body.notice ?? ""}\n`,
          );
        }
      }
    }, 60_000);
  }
});
