"use client";

import Link from "next/link";
import { use, useState } from "react";
import { CardEditor } from "@/components/CardEditor";
import { StudyMode } from "@/components/notes/StudyMode";
import { ApiError, requestCards } from "@/lib/client";
import { cardsToCsv } from "@/lib/csv";
import type { Flashcard } from "@/lib/flashcards/schema";
import { collectRegion, sourceHref } from "@/lib/notes/makeCards";
import { useLiveQuery, useStore } from "@/lib/store/react";
import type { Card } from "@/lib/store/schema";

/** A deck made from a note region: edit, regenerate, study, export. */
export default function DeckPage({ params }: { params: Promise<{ deckId: string }> }) {
  const { deckId } = use(params);
  const store = useStore();
  const deck = useLiveQuery((s) => s.get("deck", deckId), [deckId]);
  const cards = useLiveQuery((s) => s.listCards(deckId), [deckId]);
  const [studying, setStudying] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  if (deck === undefined || cards === undefined) return <div className="p-6 text-sm text-ink-soft">Opening deck…</div>;
  if (!deck) {
    return (
      <div className="p-6 text-sm text-ink-soft">
        This deck was deleted. <Link href="/notes" className="underline">Back to notes</Link>
      </div>
    );
  }

  const ordered = [...cards].sort((a, b) => deck.cardIds.indexOf(a.id) - deck.cardIds.indexOf(b.id));
  const first = ordered[0];
  const backHref = first ? sourceHref(first) ?? `/notes/${deck.noteId ?? ""}` : `/notes/${deck.noteId ?? ""}`;

  async function updateCard(card: Card, patch: Partial<Flashcard>) {
    await store.commit([store.update("card", card, patch)]);
  }

  async function regenerate(card: Card) {
    if (card.source.kind !== "note") return;
    const page = await store.get("page", card.source.pageId);
    if (!page) {
      setMessage("The source page was deleted, so this card cannot be regenerated.");
      return;
    }
    setBusyId(card.id);
    setMessage(null);
    try {
      const content = await collectRegion(store, page, card.source.region);
      const result = await requestCards({ kind: "text", text: content.text }, { count: 1, avoid: ordered });
      const fresh = result.cards[0];
      if (!fresh) {
        setMessage("No different card could be made for that spot. Try editing it instead.");
        return;
      }
      await store.commit([
        store.update("card", card, { question: fresh.question, answer: fresh.answer, sourceExcerpt: fresh.sourceExcerpt, difficulty: fresh.difficulty, tags: fresh.tags }),
      ]);
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : "Could not regenerate that card.");
    } finally {
      setBusyId(null);
    }
  }

  function exportCsv() {
    const csv = cardsToCsv(ordered);
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(deck?.title ?? "cards").replace(/[^\w.-]+/g, "_")}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-ink">{deck.title}</h1>
          <Link href={backHref} className="text-sm text-accent underline underline-offset-2">
            Open the source in the note
          </Link>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => setStudying(true)} disabled={ordered.length === 0} className="rounded-full bg-accent px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50">
            Study
          </button>
          <button type="button" onClick={exportCsv} disabled={ordered.length === 0} className="rounded-full border border-line px-4 py-1.5 text-sm font-medium text-ink disabled:opacity-50">
            Export CSV for Anki
          </button>
        </div>
      </div>

      <p className="mb-4 rounded-2xl border border-accent/30 bg-accent-soft px-5 py-3 text-sm text-ink">
        Check every card against your notes. &ldquo;From the lecture&rdquo; shows the passage each card came from, and the link above jumps to the exact spot on the page.
        {deck.provider === "mock" && <span className="block text-ink-soft">Sample mode: cards are built from sentences in the selection, without an AI model.</span>}
      </p>
      {message && (
        <p role="status" className="mb-4 rounded-xl bg-warn-soft px-4 py-2 text-sm text-warn">
          {message}
        </p>
      )}

      <ul className="flex flex-col gap-4">
        {ordered.map((card, index) => (
          <li key={card.id} className="flex flex-col gap-1">
            <CardEditor
              card={card}
              index={index}
              busy={busyId === card.id}
              onChange={(updated) => void updateCard(card, { question: updated.question, answer: updated.answer, difficulty: updated.difficulty, tags: updated.tags })}
              onDelete={() => void store.commit([store.delete("card", card), store.update("deck", deck, { cardIds: deck.cardIds.filter((id) => id !== card.id) })])}
              onRegenerate={() => void regenerate(card)}
            />
            {sourceHref(card) && (
              <Link href={sourceHref(card)!} className="self-end text-xs text-accent underline underline-offset-2">
                Show on the page
              </Link>
            )}
          </li>
        ))}
      </ul>
      {ordered.length === 0 && <p className="text-sm text-ink-soft">No cards left in this deck.</p>}

      {studying && <StudyMode cards={ordered} onClose={() => setStudying(false)} />}
    </div>
  );
}
