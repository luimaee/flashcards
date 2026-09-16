import { z } from "zod";
import { DeckStore, DeckStoreError } from "@/lib/decks/store";
import { FlashcardSchema } from "@/lib/flashcards/schema";

/**
 * GET    /api/decks/:id   the full deck (cards + source text for regeneration)
 * PUT    /api/decks/:id   save edits { title?, cards? }
 * DELETE /api/decks/:id   move the file to the trash folder
 */

export const runtime = "nodejs";

const UpdateSchema = z.object({
  title: z.string().max(200).optional(),
  cards: z.array(FlashcardSchema).max(100).optional(),
});

function fail(status: number, code: string, message: string) {
  return Response.json({ error: { code, message } }, { status });
}

function fromStoreError(error: unknown): Response {
  if (error instanceof DeckStoreError) {
    const status = error.code === "not-found" ? 404 : error.code === "invalid" ? 400 : 500;
    return fail(status, error.code, error.message);
  }
  return fail(500, "io", "The deck folder could not be used.");
}

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  try {
    return Response.json({ deck: await new DeckStore().read(id) });
  } catch (error) {
    return fromStoreError(error);
  }
}

export async function PUT(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail(400, "bad-request", "The edits could not be read.");
  }
  const parsed = UpdateSchema.safeParse(body);
  if (!parsed.success) return fail(400, "bad-request", "The edits have an unexpected shape.");
  try {
    return Response.json({ deck: await new DeckStore().update(id, parsed.data) });
  } catch (error) {
    return fromStoreError(error);
  }
}

export async function DELETE(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  try {
    await new DeckStore().trash(id);
    return Response.json({ ok: true });
  } catch (error) {
    return fromStoreError(error);
  }
}
