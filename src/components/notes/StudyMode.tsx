"use client";

import { useState } from "react";
import type { Flashcard } from "@/lib/flashcards/schema";

interface StudyModeProps {
  cards: Flashcard[];
  onClose: () => void;
}

/**
 * One card at a time. "Not yet" sends the card to the back of the queue;
 * "Got it" retires it. Nothing is saved: closing resets the session.
 */
export function StudyMode({ cards, onClose }: StudyModeProps) {
  const [queue, setQueue] = useState<Flashcard[]>(() => cards.filter((c) => c.question.trim() && c.answer.trim()));
  const [revealed, setRevealed] = useState(false);
  const [done, setDone] = useState(0);
  const [misses, setMisses] = useState(0);
  const total = done + queue.length;
  const current = queue[0];

  function next(gotIt: boolean) {
    setRevealed(false);
    if (gotIt) {
      setDone((d) => d + 1);
      setQueue((q) => q.slice(1));
    } else {
      setMisses((m) => m + 1);
      setQueue((q) => [...q.slice(1), q[0]]);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-paper" role="dialog" aria-label="Study">
      <div className="flex items-center justify-between border-b border-line px-5 py-3 text-sm">
        <span className="text-ink-soft">
          {done} of {total} known{misses > 0 ? ` · ${misses} to revisit` : ""}
        </span>
        <button type="button" onClick={onClose} className="rounded-full px-3 py-1 text-ink-soft hover:bg-line/60">
          Close
        </button>
      </div>

      <div className="flex flex-1 items-center justify-center p-6">
        {current ? (
          <button
            type="button"
            onClick={() => setRevealed(true)}
            className="flex min-h-[40vh] w-full max-w-2xl flex-col justify-center rounded-3xl border border-line bg-card p-8 text-left shadow-md"
          >
            <span className="text-xs font-medium uppercase tracking-wide text-ink-soft">Question</span>
            <span className="mt-2 text-xl font-medium leading-8 text-ink">{current.question}</span>
            {revealed ? (
              <>
                <span className="mt-6 text-xs font-medium uppercase tracking-wide text-ink-soft">Answer</span>
                <span className="mt-2 text-base leading-7 text-ink">{current.answer}</span>
                <span className="mt-4 text-xs text-ink-soft">From the lecture: {current.sourceExcerpt}</span>
              </>
            ) : (
              <span className="mt-6 text-sm text-ink-soft">Tap to reveal the answer</span>
            )}
          </button>
        ) : (
          <div className="text-center">
            <p className="text-xl font-medium text-ink">All {total} cards known.</p>
            <p className="mt-2 text-sm text-ink-soft">{misses > 0 ? `${misses} needed a second look.` : "First time through, no misses."}</p>
            <button type="button" onClick={onClose} className="mt-6 rounded-full bg-accent px-5 py-2 text-sm font-medium text-white">
              Back to cards
            </button>
          </div>
        )}
      </div>

      {current && revealed && (
        <div className="flex justify-center gap-3 border-t border-line px-5 py-4">
          <button type="button" onClick={() => next(false)} className="rounded-full border border-line px-6 py-2 text-sm font-medium text-ink hover:bg-line/40">
            Not yet
          </button>
          <button type="button" onClick={() => next(true)} className="rounded-full bg-accent px-6 py-2 text-sm font-medium text-white hover:bg-accent-strong">
            Got it
          </button>
        </div>
      )}
    </div>
  );
}
