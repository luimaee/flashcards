import { z } from "zod";
import { DeckStore, DeckStoreError, titleFor } from "@/lib/decks/store";
import { FlashcardSchema } from "@/lib/flashcards/schema";

/**
 * GET  /api/decks   list saved decks (summaries) plus the folder path
 * POST /api/decks   save a new deck { title?, provider, source, cards }
 *
 * Runs on the student's own machine; the folder is on their disk.
 */

export const runtime = "nodejs";

const CreateSchema = z.object({
  title: z.string().max(200).optional(),
  provider: z.string().min(1).max(40),
  source: z.object({ kind: z.enum(["pdf", "text"]), name: z.string().max(200).optional(), text: z.string().max(300_000) }),
  cards: z.array(FlashcardSchema).max(100),
});

function fail(status: number, code: string, message: string) {
  return Response.json({ error: { code, message } }, { status });
}

function fromStoreError(error: unknown): Response {
  if (error instanceof DeckStoreError) {
    const status = error.code === "not-found" ? 404 : error.code === "invalid" ? 400 : 500;
    return fail(status, error.code, error.message);
  }
  console.info(JSON.stringify({ at: new Date().toISOString(), event: "deck-store-crashed", message: error instanceof Error ? error.message : String(error) }));
  return fail(500, "io", "The deck folder could not be used. Check that the app can write to your home folder.");
}

export async function GET() {
  const store = new DeckStore();
  try {
    const decks = await store.list();
    return Response.json({ folder: store.root, decks });
  } catch (error) {
    return fromStoreError(error);
  }
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail(400, "bad-request", "The deck could not be read.");
  }
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) return fail(400, "bad-request", "The deck has an unexpected shape.");
  const { title, provider, source, cards } = parsed.data;
  const store = new DeckStore();
  try {
    const deck = await store.create({ title: title?.trim() || titleFor(source), provider, source, cards });
    console.info(JSON.stringify({ at: new Date().toISOString(), event: "deck-saved", id: deck.id, cards: deck.cards.length }));
    return Response.json({ deck, folder: store.root }, { status: 201 });
  } catch (error) {
    return fromStoreError(error);
  }
}
