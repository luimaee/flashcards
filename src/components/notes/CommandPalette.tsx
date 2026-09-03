"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useSearchResults } from "@/lib/search/react";
import { useLiveQuery } from "@/lib/store/react";

/**
 * Cmd+K / Ctrl+K search over every note: titles, tags, typed text, PDF text.
 * Enter opens the best match at its page. Notes are found, not scrolled to.
 */
export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const hits = useSearchResults(query);
  const notes = useLiveQuery((s) => s.listNotes(), []);
  const titles = useMemo(() => new Map((notes ?? []).map((n) => [n.id, n.title || "Untitled note"])), [notes]);

  // Group hits by note so one note with many matches does not crowd out others.
  const grouped = useMemo(() => {
    const byNote = new Map<string, typeof hits>();
    for (const h of hits) {
      const list = byNote.get(h.noteId) ?? [];
      if (list.length < 3) list.push(h);
      byNote.set(h.noteId, list);
    }
    return Array.from(byNote.entries()).flatMap(([, list]) => list);
  }, [hits]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setQuery("");
        setCursor(0);
        setOpen((o) => !o);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function go(index: number) {
    const hit = grouped[index];
    if (!hit) return;
    setOpen(false);
    router.push(`/notes/${hit.noteId}${hit.pageId ? `#page=${hit.pageId}` : ""}`);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setQuery("");
          setCursor(0);
          setOpen(true);
        }}
        className="rounded-full border border-line px-3 py-1 text-xs text-ink-soft hover:text-ink" aria-label="Search notes">
        Search <kbd className="ml-1 rounded bg-line/60 px-1">⌘K</kbd>
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-ink/30 p-4 pt-[12vh]" onClick={() => setOpen(false)} role="dialog" aria-label="Search notes">
      <div className="w-full max-w-xl rounded-2xl border border-line bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
        <input
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setCursor(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setCursor((c) => Math.min(grouped.length - 1, c + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setCursor((c) => Math.max(0, c - 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              go(cursor);
            }
          }}
          placeholder="Search notes, tags, and text…"
          className="w-full rounded-t-2xl border-b border-line bg-transparent px-4 py-3 text-base text-ink outline-none"
        />
        <ul className="max-h-[50vh] overflow-auto py-1" role="listbox">
          {query && grouped.length === 0 && <li className="px-4 py-3 text-sm text-ink-soft">Nothing matches.</li>}
          {grouped.map((hit, i) => (
            <li key={hit.key} role="option" aria-selected={i === cursor}>
              <button
                type="button"
                onMouseEnter={() => setCursor(i)}
                onClick={() => go(i)}
                className={`flex w-full flex-col items-start gap-0.5 px-4 py-2 text-left ${i === cursor ? "bg-accent-soft" : "hover:bg-line/40"}`}
              >
                <span className="text-sm font-medium text-ink">
                  {titles.get(hit.noteId) ?? "Note"}
                  <span className="ml-2 text-xs font-normal text-ink-soft">{hit.kind === "pdf" ? "PDF text" : hit.kind}</span>
                </span>
                <span className="text-xs text-ink-soft">{hit.snippet}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
