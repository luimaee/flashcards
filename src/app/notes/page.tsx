"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PAGE_SIZES, defaultPageSize } from "@/lib/ink/render";
import { useLiveQuery, useStore } from "@/lib/store/react";
import type { Notebook } from "@/lib/store/schema";

/** Notebooks and their notes. Everything here is local to this device. */
export default function NotesHome() {
  const store = useStore();
  const router = useRouter();
  const notebooks = useLiveQuery((s) => s.listNotebooks(), []);
  const [selected, setSelected] = useState<string | null>(null);
  const notebookId = selected ?? notebooks?.[0]?.id ?? null;
  const notes = useLiveQuery((s) => (notebookId ? s.listNotes(notebookId) : Promise.resolve([])), [notebookId]);
  const [newNotebook, setNewNotebook] = useState("");

  async function createNotebook() {
    const title = newNotebook.trim() || "Untitled notebook";
    const op = store.create("notebook", { title });
    await store.commit([op]);
    setSelected(op.entityId);
    setNewNotebook("");
  }

  async function createNote() {
    if (!notebookId) return;
    const size = PAGE_SIZES[defaultPageSize(navigator.language)];
    const noteOp = store.create("note", { notebookId, title: "Untitled note", tags: [], links: [], pageIds: [] });
    const pageOp = store.create("page", { noteId: noteOp.entityId, width: size.width, height: size.height, background: "lined" });
    await store.commit([noteOp, pageOp]);
    const note = await store.get("note", noteOp.entityId);
    if (note) await store.commit([store.update("note", note, { pageIds: [pageOp.entityId] })]);
    router.push(`/notes/${noteOp.entityId}`);
  }

  async function deleteNotebook(nb: Notebook) {
    if (!window.confirm(`Delete notebook "${nb.title}" and its notes? You can restore it from the trash later.`)) return;
    const ops = [store.delete("notebook", nb)];
    for (const note of await store.listNotes(nb.id)) ops.push(store.delete("note", note));
    await store.commit(ops);
    setSelected(null);
  }

  return (
    <div className="mx-auto grid w-full max-w-5xl flex-1 grid-cols-1 gap-6 px-5 py-8 md:grid-cols-[220px_1fr]">
      <aside>
        <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-soft">Notebooks</h2>
        <ul className="flex flex-col gap-1">
          {notebooks?.map((nb) => (
            <li key={nb.id} className="group flex items-center">
              <button
                type="button"
                onClick={() => setSelected(nb.id)}
                className={`flex-1 rounded-lg px-3 py-1.5 text-left text-sm ${nb.id === notebookId ? "bg-accent-soft text-ink" : "text-ink-soft hover:bg-line/50"}`}
              >
                {nb.title}
              </button>
              <button
                type="button"
                aria-label={`Delete notebook ${nb.title}`}
                onClick={() => deleteNotebook(nb)}
                className="px-2 text-xs text-ink-soft opacity-0 hover:text-hard group-hover:opacity-100"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void createNotebook();
          }}
          className="mt-3 flex gap-1"
        >
          <input
            value={newNotebook}
            onChange={(e) => setNewNotebook(e.target.value)}
            placeholder="New notebook"
            aria-label="New notebook title"
            className="min-w-0 flex-1 rounded-lg border border-line bg-paper px-2 py-1 text-sm outline-none focus:border-accent"
          />
          <button type="submit" className="rounded-lg bg-ink px-2 py-1 text-xs font-medium text-paper">
            Add
          </button>
        </form>
      </aside>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h1 className="text-lg font-semibold text-ink">{notebooks?.find((n) => n.id === notebookId)?.title ?? "Your notes"}</h1>
          <button
            type="button"
            onClick={createNote}
            disabled={!notebookId}
            className="rounded-full bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent-strong disabled:opacity-50"
          >
            New note
          </button>
        </div>
        {notebooks && notebooks.length === 0 && (
          <p className="rounded-2xl border border-dashed border-line px-5 py-10 text-center text-sm text-ink-soft">
            Make a notebook to start. Notes live only in this browser until you export them.
          </p>
        )}
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {notes?.map((note) => (
            <li key={note.id}>
              <Link href={`/notes/${note.id}`} className="block rounded-2xl border border-line bg-card p-4 hover:border-accent/60">
                <div className="font-medium text-ink">{note.title || "Untitled note"}</div>
                <div className="mt-1 text-xs text-ink-soft">
                  {note.pageIds.length} page{note.pageIds.length === 1 ? "" : "s"} · {new Date(note.updatedAt).toLocaleDateString()}
                  {note.conflictOf ? " · conflict copy" : ""}
                </div>
                {note.tags.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {note.tags.map((t) => (
                      <span key={t} className="rounded-full bg-line/50 px-2 py-0.5 text-xs text-ink-soft">
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </Link>
            </li>
          ))}
        </ul>
        {notebookId && notes && notes.length === 0 && <p className="text-sm text-ink-soft">No notes yet in this notebook.</p>}
      </section>
    </div>
  );
}
