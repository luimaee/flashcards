"use client";

import Link from "next/link";
import { useState } from "react";
import { normaliseTag } from "@/lib/search/index";
import { useLiveQuery, useStore } from "@/lib/store/react";
import type { Note } from "@/lib/store/schema";

/** Tags, outgoing links and backlinks for the open note. */
export function NoteSidebar({ note }: { note: Note }) {
  const store = useStore();
  const [tagDraft, setTagDraft] = useState("");
  const allNotes = useLiveQuery((s) => s.listNotes(), []);
  const linked = (allNotes ?? []).filter((n) => note.links.includes(n.id));
  const backlinks = (allNotes ?? []).filter((n) => n.links.includes(note.id) && n.id !== note.id);
  const decks = useLiveQuery((s) => s.listDecks(note.id), [note.id]);

  async function addTag() {
    const tag = normaliseTag(tagDraft);
    if (!tag || note.tags.includes(tag)) {
      setTagDraft("");
      return;
    }
    await store.commit([store.update("note", note, { tags: [...note.tags, tag] })]);
    setTagDraft("");
  }

  async function removeTag(tag: string) {
    await store.commit([store.update("note", note, { tags: note.tags.filter((t) => t !== tag) })]);
  }

  return (
    <aside className="flex w-56 shrink-0 flex-col gap-4 border-l border-line bg-card px-4 py-4 text-sm">
      <section>
        <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-soft">Tags</h3>
        <div className="flex flex-wrap gap-1">
          {note.tags.map((t) => (
            <span key={t} className="flex items-center gap-1 rounded-full bg-line/50 px-2 py-0.5 text-xs text-ink">
              {t}
              <button type="button" aria-label={`Remove tag ${t}`} onClick={() => removeTag(t)} className="text-ink-soft hover:text-hard">
                ×
              </button>
            </span>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void addTag();
          }}
          className="mt-2"
        >
          <input
            value={tagDraft}
            onChange={(e) => setTagDraft(e.target.value)}
            placeholder="Add tag, press Enter"
            aria-label="Add tag"
            className="w-full rounded-lg border border-line bg-paper px-2 py-1 text-xs outline-none focus:border-accent"
          />
        </form>
      </section>

      <section>
        <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-soft">Card decks</h3>
        {(decks ?? []).length === 0 && <p className="text-xs text-ink-soft">Use Select, drag over text, then &ldquo;Make cards from this&rdquo;.</p>}
        <ul className="flex flex-col gap-1">
          {(decks ?? []).map((d) => (
            <li key={d.id}>
              <Link href={`/notes/cards/${d.id}`} className="text-accent underline underline-offset-2">
                {d.title}
              </Link>
              <span className="ml-1 text-xs text-ink-soft">{d.cardIds.length} cards</span>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-soft">Links</h3>
        <p className="mb-1 text-xs text-ink-soft">Type [[Note title]] in a text block to link.</p>
        {linked.length === 0 && <p className="text-xs text-ink-soft">No links yet.</p>}
        <ul className="flex flex-col gap-1">
          {linked.map((n) => (
            <li key={n.id}>
              <Link href={`/notes/${n.id}`} className="text-accent underline underline-offset-2">
                {n.title || "Untitled note"}
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-soft">Linked from</h3>
        {backlinks.length === 0 && <p className="text-xs text-ink-soft">Nothing links here.</p>}
        <ul className="flex flex-col gap-1">
          {backlinks.map((n) => (
            <li key={n.id}>
              <Link href={`/notes/${n.id}`} className="text-accent underline underline-offset-2">
                {n.title || "Untitled note"}
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </aside>
  );
}
