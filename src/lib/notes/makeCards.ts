import { ApiError, requestCards } from "@/lib/client";
import type { Flashcard } from "@/lib/flashcards/schema";
import { regionContent, type Region } from "@/lib/notes/region";
import { MIN_SOURCE_CHARS } from "@/lib/text";
import type { Store } from "@/lib/store/db";
import type { Card, Note, Page } from "@/lib/store/schema";

/**
 * "Make cards from this": gather the text under a region, send it through
 * the existing generation route, and persist the result as a deck of cards
 * that each remember exactly where they came from.
 */

export class MakeCardsError extends Error {
  constructor(
    message: string,
    public readonly code: "no-text" | "ink-only" | "too-short" | "api",
  ) {
    super(message);
    this.name = "MakeCardsError";
  }
}

export async function collectRegion(store: Store, page: Page, region: Region) {
  const [textBlocks, strokes] = await Promise.all([store.listTextBlocks(page.id), store.listStrokes(page.id)]);
  const pdf = page.pdf ? await store.getPdfText(page.pdf.assetId, page.pdf.pageNumber) : undefined;
  return regionContent(
    { textBlocks, strokes, pdf: pdf ? { pageNumber: pdf.pageNumber, text: pdf.text, items: pdf.items } : null },
    region,
  );
}

export async function makeCardsFromRegion(
  store: Store,
  note: Note,
  page: Page,
  region: Region,
  options: { count?: number; signal?: AbortSignal } = {},
): Promise<{ deckId: string; cards: Card[]; notice?: string }> {
  const content = await collectRegion(store, page, region);
  if (content.inkOnly) {
    throw new MakeCardsError(
      "That selection only contains handwriting. Handwriting is not read yet, so select typed text or PDF text, or type the notes out first.",
      "ink-only",
    );
  }
  if (!content.text.trim()) {
    throw new MakeCardsError("Nothing with text is inside that selection. Drag over typed text or PDF text.", "no-text");
  }
  if (content.text.trim().length < MIN_SOURCE_CHARS) {
    throw new MakeCardsError(
      `That selection is too short to make useful cards (about ${MIN_SOURCE_CHARS} characters, a paragraph, is the minimum). Select a bigger area.`,
      "too-short",
    );
  }

  let generated: Flashcard[];
  let notice: string | undefined;
  let provider: string;
  try {
    const result = await requestCards({ kind: "text", text: content.text }, { count: options.count, signal: options.signal });
    generated = result.cards;
    notice = result.notice;
    provider = result.provider;
  } catch (error) {
    throw new MakeCardsError(error instanceof ApiError ? error.message : "The cards could not be made. Please try again.", "api");
  }

  const deckOp = store.create("deck", {
    noteId: note.id,
    title: `${note.title || "Untitled note"} · page ${note.pageIds.indexOf(page.id) + 1}`,
    provider,
    cardIds: [],
  });
  const cardOps = generated.map((card) =>
    store.create("card", {
      question: card.question,
      answer: card.answer,
      sourceExcerpt: card.sourceExcerpt,
      difficulty: card.difficulty,
      tags: card.tags,
      deckId: deckOp.entityId,
      source: { kind: "note", noteId: note.id, pageId: page.id, region, anchors: content.anchors },
    }),
  );
  await store.commit([deckOp, ...cardOps]);
  const deck = await store.get("deck", deckOp.entityId);
  if (deck) await store.commit([store.update("deck", deck, { cardIds: cardOps.map((c) => c.entityId) })]);
  const cards = await store.listCards(deckOp.entityId);
  return { deckId: deckOp.entityId, cards, notice };
}

/** Link to a card's source: the note, scrolled to the page, with the region highlighted. */
export function sourceHref(card: Card): string | null {
  if (card.source.kind !== "note") return null;
  const [x0, y0, x1, y1] = card.source.region.map((n) => Math.round(n));
  return `/notes/${card.source.noteId}#page=${card.source.pageId}&region=${x0},${y0},${x1},${y1}`;
}
