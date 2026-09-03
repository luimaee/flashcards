"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { DEFAULT_TEXT_WIDTH, PageView, type PageTool } from "@/components/notes/PageView";
import { HANDWRITING_TUNING, HIGHLIGHTER_TUNING, bboxOf, packPoints } from "@/lib/ink/geometry";
import type { Background, DrawableStroke } from "@/lib/ink/render";
import { useLiveQuery, useStore } from "@/lib/store/react";
import type { Note, Page, TextBlock } from "@/lib/store/schema";

const TOOLS: { id: PageTool; label: string }[] = [
  { id: "pen", label: "Pen" },
  { id: "highlighter", label: "Highlighter" },
  { id: "eraser", label: "Eraser" },
  { id: "text", label: "Text" },
  { id: "select", label: "Select" },
];

const COLORS = ["#1f2430", "#2f7f6f", "#2b5fd9", "#c0392b", "#8a4b12"];
const HIGHLIGHT_COLORS = ["#ffe066", "#a8e6a3", "#ffb3c6", "#9bd3ff"];

function subscribeToResize(cb: () => void) {
  window.addEventListener("resize", cb);
  return () => window.removeEventListener("resize", cb);
}

/** The editor for one note: toolbar, title, and a virtualized column of pages. */
export function NoteEditor({ noteId }: { noteId: string }) {
  const note = useLiveQuery((s) => s.get("note", noteId), [noteId]);
  const pages = useLiveQuery((s) => s.listPages(noteId), [noteId]);
  const [tool, setTool] = useState<PageTool>("pen");
  const [color, setColor] = useState(COLORS[0]);
  const [highlight, setHighlight] = useState(HIGHLIGHT_COLORS[0]);
  const [size, setSize] = useState(HANDWRITING_TUNING.size);
  const [focusBlockId, setFocusBlockId] = useState<string | null>(null);
  const viewportWidth = useSyncExternalStore(subscribeToResize, () => window.innerWidth, () => 1024);

  const pageWidth = pages?.[0]?.width ?? 595;
  const scale = Math.min(1.6, Math.max(0.5, (Math.min(viewportWidth, 1100) - 48) / pageWidth));

  if (note === undefined || pages === undefined) return <div className="p-6 text-sm text-ink-soft">Opening note…</div>;
  if (note === null || !note) {
    return (
      <div className="p-6 text-sm text-ink-soft">
        This note does not exist or was deleted. <Link href="/notes" className="underline">Back to notes</Link>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-line bg-card/95 px-4 py-2 backdrop-blur">
        <Link href="/notes" className="text-sm text-ink-soft hover:text-ink">
          ← Notes
        </Link>
        <TitleField key={note.id} note={note} />
        <div className="ml-auto flex flex-wrap items-center gap-1">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTool(t.id)}
              className={`rounded-full px-3 py-1 text-xs font-medium ${tool === t.id ? "bg-ink text-paper" : "text-ink-soft hover:bg-line/60"}`}
            >
              {t.label}
            </button>
          ))}
          {tool === "highlighter"
            ? HIGHLIGHT_COLORS.map((c) => <Swatch key={c} color={c} active={c === highlight} onPick={() => setHighlight(c)} />)
            : COLORS.map((c) => <Swatch key={c} color={c} active={c === color} onPick={() => setColor(c)} />)}
          <label className="ml-2 flex items-center gap-1 text-xs text-ink-soft">
            <input type="range" min={1} max={8} step={0.2} value={size} onChange={(e) => setSize(Number(e.target.value))} className="w-20" aria-label="Pen size" />
          </label>
        </div>
      </div>

      <PageColumn
        note={note}
        pages={pages}
        scale={scale}
        tool={tool}
        color={tool === "highlighter" ? highlight : color}
        size={tool === "highlighter" ? HIGHLIGHTER_TUNING.size : size}
        focusBlockId={focusBlockId}
        onFocusBlock={setFocusBlockId}
      />
    </div>
  );
}

function Swatch({ color, active, onPick }: { color: string; active: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      aria-label={`Colour ${color}`}
      onClick={onPick}
      className={`h-5 w-5 rounded-full border-2 ${active ? "border-ink" : "border-transparent"}`}
      style={{ background: color }}
    />
  );
}

function TitleField({ note }: { note: Note }) {
  const store = useStore();
  const [draft, setDraft] = useState(note.title);
  const [seen, setSeen] = useState(note.title);
  if (seen !== note.title) {
    // The stored title changed underneath us (another tab, an import): follow it.
    setSeen(note.title);
    setDraft(note.title);
  }
  return (
    <input
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== note.title) void store.commit([store.update("note", note, { title: draft.trim() || "Untitled note" })]);
      }}
      aria-label="Note title"
      className="min-w-0 flex-1 rounded-lg bg-transparent px-2 py-1 text-base font-semibold text-ink outline-none focus:bg-paper"
    />
  );
}

interface PageColumnProps {
  note: Note;
  pages: Page[];
  scale: number;
  tool: PageTool;
  color: string;
  size: number;
  focusBlockId: string | null;
  onFocusBlock: (id: string | null) => void;
}

/** Renders every page slot at its final size, but mounts the heavy page view only near the viewport. */
function PageColumn({ note, pages, scale, tool, color, size, focusBlockId, onFocusBlock }: PageColumnProps) {
  const store = useStore();

  async function addPage(after?: Page) {
    const base = after ?? pages[pages.length - 1];
    const op = store.create("page", {
      noteId: note.id,
      width: base?.width ?? 595,
      height: base?.height ?? 842,
      background: base?.background ?? "lined",
    });
    const ids = [...note.pageIds];
    const at = after ? ids.indexOf(after.id) + 1 : ids.length;
    ids.splice(at, 0, op.entityId);
    await store.commit([op, store.update("note", note, { pageIds: ids })]);
  }

  async function duplicatePage(page: Page) {
    const pageOp = store.create("page", { noteId: note.id, width: page.width, height: page.height, background: page.background, pdf: page.pdf });
    const ops = [pageOp];
    for (const s of await store.listStrokes(page.id)) {
      ops.push(store.create("stroke", { pageId: pageOp.entityId, tool: s.tool, color: s.color, size: s.size, points: s.points.slice(0), count: s.count, bbox: s.bbox }));
    }
    for (const b of await store.listTextBlocks(page.id)) {
      ops.push(store.create("textBlock", { pageId: pageOp.entityId, x: b.x, y: b.y, width: b.width, text: b.text, fontSize: b.fontSize }));
    }
    const ids = [...note.pageIds];
    ids.splice(ids.indexOf(page.id) + 1, 0, pageOp.entityId);
    ops.push(store.update("note", note, { pageIds: ids }));
    await store.commit(ops);
  }

  async function deletePage(page: Page) {
    if (pages.length === 1) return;
    await store.commit([store.delete("page", page), store.update("note", note, { pageIds: note.pageIds.filter((id) => id !== page.id) })]);
  }

  async function setBackground(page: Page, background: Background) {
    await store.commit([store.update("page", page, { background })]);
  }

  return (
    <div className="flex flex-1 flex-col items-center gap-6 bg-line/30 px-4 py-6">
      {pages.map((page, index) => (
        <PageSlot
          key={page.id}
          page={page}
          index={index}
          total={pages.length}
          scale={scale}
          tool={tool}
          color={color}
          size={size}
          focusBlockId={focusBlockId}
          onFocusBlock={onFocusBlock}
          onAddAfter={() => addPage(page)}
          onDuplicate={() => duplicatePage(page)}
          onDelete={() => deletePage(page)}
          onBackground={(b) => setBackground(page, b)}
        />
      ))}
      <button type="button" onClick={() => addPage()} className="rounded-full border border-line bg-card px-4 py-2 text-sm text-ink hover:border-accent/60">
        Add page
      </button>
    </div>
  );
}

interface PageSlotProps {
  page: Page;
  index: number;
  total: number;
  scale: number;
  tool: PageTool;
  color: string;
  size: number;
  focusBlockId: string | null;
  onFocusBlock: (id: string | null) => void;
  onAddAfter: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onBackground: (b: Background) => void;
}

function PageSlot(props: PageSlotProps) {
  const { page, index, total, scale } = props;
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(index < 2);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) setNear(entry.isIntersecting);
      },
      { rootMargin: "800px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className="flex flex-col items-center gap-1" data-page-id={page.id}>
      <div className="flex w-full items-center justify-between text-xs text-ink-soft" style={{ width: page.width * scale }}>
        <span>
          Page {index + 1} of {total}
        </span>
        <span className="flex gap-2">
          <select value={page.background} onChange={(e) => props.onBackground(e.target.value as Background)} aria-label="Page background" className="rounded border border-line bg-paper px-1 py-0.5 text-xs">
            {(["plain", "lined", "grid", "dots"] as Background[]).map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
          <button type="button" onClick={props.onAddAfter} className="hover:text-ink">
            + page after
          </button>
          <button type="button" onClick={props.onDuplicate} className="hover:text-ink">
            duplicate
          </button>
          <button type="button" onClick={props.onDelete} disabled={total === 1} className="hover:text-hard disabled:opacity-40">
            delete
          </button>
        </span>
      </div>
      <div className="bg-white shadow-md" style={{ width: page.width * scale, height: page.height * scale }}>
        {near ? <LivePage {...props} /> : null}
      </div>
    </div>
  );
}

/** A mounted page: loads its strokes and text blocks and commits edits as ops. */
function LivePage({ page, scale, tool, color, size, focusBlockId, onFocusBlock }: PageSlotProps) {
  const store = useStore();
  const strokes = useLiveQuery((s) => s.listStrokes(page.id), [page.id]);
  const storedBlocks = useLiveQuery((s) => s.listTextBlocks(page.id), [page.id]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const blocks = useMemo<TextBlock[]>(
    () => (storedBlocks ?? []).map((b) => (drafts[b.id] !== undefined ? { ...b, text: drafts[b.id] } : b)),
    [storedBlocks, drafts],
  );

  const flush = useCallback(
    (block: TextBlock, text: string) => {
      clearTimeout(timers.current[block.id]);
      delete timers.current[block.id];
      setDrafts((d) => {
        const next = { ...d };
        delete next[block.id];
        return next;
      });
      if (text !== block.text) void store.commit([store.update("textBlock", block, { text })]);
    },
    [store],
  );

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const id of Object.keys(pending)) clearTimeout(pending[id]);
    };
  }, []);

  if (!strokes || !storedBlocks) return null;

  return (
    <PageView
      page={page}
      scale={scale}
      strokes={strokes}
      textBlocks={blocks}
      tool={tool}
      color={color}
      size={size}
      focusBlockId={focusBlockId}
      onStrokeCommit={(s: DrawableStroke) =>
        void store.commit([
          store.create("stroke", { pageId: page.id, tool: s.tool, color: s.color, size: s.size, points: packPoints(s.points), count: s.points.length, bbox: bboxOf(s.points, s.size) }),
        ])
      }
      onErase={(ids) => {
        const ops = strokes.filter((s) => ids.includes(s.id)).map((s) => store.delete("stroke", s));
        if (ops.length > 0) void store.commit(ops);
      }}
      onTextCreate={async (x, y) => {
        const op = store.create("textBlock", { pageId: page.id, x, y, width: DEFAULT_TEXT_WIDTH, text: "", fontSize: 13 });
        await store.commit([op]);
        onFocusBlock(op.entityId);
      }}
      onTextChange={(block, text) => {
        setDrafts((d) => ({ ...d, [block.id]: text }));
        clearTimeout(timers.current[block.id]);
        timers.current[block.id] = setTimeout(() => flush(block, text), 600);
      }}
      onTextMove={(block, x, y) => void store.commit([store.update("textBlock", block, { x, y })])}
      onTextDelete={(block) => {
        clearTimeout(timers.current[block.id]);
        void store.commit([store.delete("textBlock", block)]);
      }}
    />
  );
}
