"use client";

import { useId } from "react";
import { DIFFICULTIES, type Difficulty, type Flashcard } from "@/lib/flashcards/schema";

interface CardEditorProps {
  card: Flashcard;
  index: number;
  busy: boolean;
  onChange: (card: Flashcard) => void;
  onDelete: (id: string) => void;
  onRegenerate: (id: string) => void;
}

const DIFFICULTY_STYLE: Record<Difficulty, string> = {
  easy: "bg-easy-soft text-easy",
  medium: "bg-medium-soft text-medium",
  hard: "bg-hard-soft text-hard",
};

/** One editable card: question, answer, difficulty, tags and the source excerpt. */
export function CardEditor({ card, index, busy, onChange, onDelete, onRegenerate }: CardEditorProps) {
  const qId = useId();
  const aId = useId();
  const dId = useId();

  return (
    <li className="rounded-2xl border border-line bg-card p-5 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-ink-soft">Card {index + 1}</span>
        <div className="flex items-center gap-2">
          <label htmlFor={dId} className="sr-only">
            Difficulty
          </label>
          <select
            id={dId}
            value={card.difficulty}
            disabled={busy}
            onChange={(event) => onChange({ ...card, difficulty: event.target.value as Difficulty })}
            className={`rounded-full border-0 px-3 py-1 text-xs font-medium capitalize ${DIFFICULTY_STYLE[card.difficulty]}`}
          >
            {DIFFICULTIES.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={busy}
            onClick={() => onRegenerate(card.id)}
            className="rounded-full px-3 py-1 text-xs font-medium text-ink-soft transition hover:bg-line/60 disabled:opacity-50"
          >
            Regenerate
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onDelete(card.id)}
            className="rounded-full px-3 py-1 text-xs font-medium text-hard transition hover:bg-hard-soft disabled:opacity-50"
          >
            Delete
          </button>
        </div>
      </div>

      <label htmlFor={qId} className="block text-xs font-medium text-ink-soft">
        Question
      </label>
      <textarea
        id={qId}
        value={card.question}
        rows={2}
        disabled={busy}
        onChange={(event) => onChange({ ...card, question: event.target.value })}
        className="mt-1 w-full resize-y rounded-xl border border-transparent bg-paper p-3 text-base font-medium leading-6 text-ink outline-none hover:border-line focus:border-accent focus:ring-2 focus:ring-accent/30"
      />

      <label htmlFor={aId} className="mt-3 block text-xs font-medium text-ink-soft">
        Answer
      </label>
      <textarea
        id={aId}
        value={card.answer}
        rows={3}
        disabled={busy}
        onChange={(event) => onChange({ ...card, answer: event.target.value })}
        className="mt-1 w-full resize-y rounded-xl border border-transparent bg-paper p-3 text-sm leading-6 text-ink outline-none hover:border-line focus:border-accent focus:ring-2 focus:ring-accent/30"
      />

      {card.tags.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Tags">
          {card.tags.map((tag) => (
            <li key={tag} className="rounded-full bg-line/50 px-2.5 py-0.5 text-xs text-ink-soft">
              {tag}
            </li>
          ))}
        </ul>
      )}

      <details className="mt-4 rounded-xl bg-paper/70 px-3 py-2 text-sm">
        <summary className="cursor-pointer select-none text-xs font-medium text-ink-soft">
          From the lecture (check the answer against this)
        </summary>
        <blockquote className="mt-2 border-l-2 border-accent/50 pl-3 text-sm leading-6 text-ink-soft">
          {card.sourceExcerpt}
        </blockquote>
      </details>
    </li>
  );
}
