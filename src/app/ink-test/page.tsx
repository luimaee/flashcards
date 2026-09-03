"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { InkCanvas, type CanvasTool, type InputInfo } from "@/components/ink/InkCanvas";
import { HANDWRITING_TUNING } from "@/lib/ink/geometry";
import { PAGE_SIZES, defaultPageSize, type Background, type DrawableStroke } from "@/lib/ink/render";

function noSubscribe() {
  return () => {};
}

function subscribeToResize(callback: () => void) {
  window.addEventListener("resize", callback);
  return () => window.removeEventListener("resize", callback);
}

/**
 * Smoothing test page. Write a line of cursive, then move the sliders until
 * small letters stay open. Nothing here is saved.
 */
export default function InkTestPage() {
  const [strokes, setStrokes] = useState<DrawableStroke[]>([]);
  const [tool, setTool] = useState<CanvasTool>("pen");
  const [color, setColor] = useState("#1f2430");
  const [size, setSize] = useState(HANDWRITING_TUNING.size);
  const [smoothing, setSmoothing] = useState(HANDWRITING_TUNING.smoothing);
  const [streamline, setStreamline] = useState(HANDWRITING_TUNING.streamline);
  const [thinning, setThinning] = useState(HANDWRITING_TUNING.thinning);
  const [background, setBackground] = useState<Background>("lined");
  const [showRaw, setShowRaw] = useState(false);
  const [info, setInfo] = useState<InputInfo | null>(null);
  const locale = useSyncExternalStore(noSubscribe, () => navigator.language, () => "");
  const [pageSizeChoice, setPageSize] = useState<keyof typeof PAGE_SIZES | null>(null);
  const pageSize = pageSizeChoice ?? defaultPageSize(locale);
  const viewportWidth = useSyncExternalStore(subscribeToResize, () => window.innerWidth, () => 1024);
  const scale = Math.min(1.4, Math.max(0.6, (viewportWidth - 48) / PAGE_SIZES.a4.width));

  const tuning = useMemo(() => ({ smoothing, streamline, thinning }), [smoothing, streamline, thinning]);
  const page = PAGE_SIZES[pageSize];

  const slider = (label: string, value: number, set: (v: number) => void, min: number, max: number, step: number) => (
    <label className="flex items-center gap-2 text-xs text-ink-soft">
      <span className="w-20">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => set(Number(e.target.value))} className="w-32" />
      <span className="w-10 tabular-nums text-ink">{value.toFixed(2)}</span>
    </label>
  );

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-6">
      <header>
        <h1 className="text-xl font-semibold text-ink">Handwriting tuning</h1>
        <p className="text-sm text-ink-soft">
          Write a line of cursive with a pen. Small letters should stay open: the top of a &ldquo;u&rdquo; must not close into an &ldquo;o&rdquo;. Defaults are in <code>src/lib/ink/geometry.ts</code>.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-card px-4 py-3">
        <div className="flex gap-1">
          {(["pen", "highlighter", "eraser"] as CanvasTool[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTool(t)}
              className={`rounded-full px-3 py-1 text-xs font-medium capitalize ${tool === t ? "bg-ink text-paper" : "text-ink-soft hover:bg-line/60"}`}
            >
              {t}
            </button>
          ))}
        </div>
        <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="Ink colour" className="h-7 w-9 rounded" />
        {slider("Size", size, setSize, 0.8, 8, 0.1)}
        {slider("Smoothing", smoothing, setSmoothing, 0, 1, 0.01)}
        {slider("Streamline", streamline, setStreamline, 0, 1, 0.01)}
        {slider("Thinning", thinning, setThinning, -1, 1, 0.05)}
        <select value={background} onChange={(e) => setBackground(e.target.value as Background)} className="rounded-full border border-line bg-paper px-2 py-1 text-xs">
          {(["plain", "lined", "grid", "dots"] as Background[]).map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
        <select value={pageSize} onChange={(e) => setPageSize(e.target.value as keyof typeof PAGE_SIZES)} className="rounded-full border border-line bg-paper px-2 py-1 text-xs">
          <option value="a4">A4</option>
          <option value="letter">Letter</option>
        </select>
        <label className="flex items-center gap-1 text-xs text-ink-soft">
          <input type="checkbox" checked={showRaw} onChange={(e) => setShowRaw(e.target.checked)} /> raw points
        </label>
        <button type="button" onClick={() => setStrokes((s) => s.slice(0, -1))} className="rounded-full px-3 py-1 text-xs text-ink-soft hover:bg-line/60">
          Undo
        </button>
        <button type="button" onClick={() => setStrokes([])} className="rounded-full px-3 py-1 text-xs text-hard hover:bg-hard-soft">
          Clear
        </button>
        <button
          type="button"
          onClick={() => {
            setSmoothing(HANDWRITING_TUNING.smoothing);
            setStreamline(HANDWRITING_TUNING.streamline);
            setThinning(HANDWRITING_TUNING.thinning);
            setSize(HANDWRITING_TUNING.size);
          }}
          className="rounded-full px-3 py-1 text-xs text-ink-soft hover:bg-line/60"
        >
          Reset tuning
        </button>
      </div>

      <div className="overflow-auto rounded-2xl border border-line bg-line/30 p-3">
        <div className="mx-auto shadow-md" style={{ width: page.width * scale }}>
          <InkCanvas
            width={page.width}
            height={page.height}
            scale={scale}
            background={background}
            strokes={strokes}
            tool={tool}
            color={color}
            size={size}
            tuning={tuning}
            showRawPoints={showRaw}
            onStrokeCommit={(s) => setStrokes((prev) => [...prev, s])}
            onErase={(ids) => setStrokes((prev) => prev.filter((s) => !ids.includes(s.id)))}
            onInputInfo={setInfo}
          />
        </div>
      </div>

      <p className="text-xs text-ink-soft tabular-nums">
        strokes {strokes.length} · points {strokes.reduce((n, s) => n + s.points.length, 0)}
        {info && (
          <>
            {" "}· last input {info.pointerType} pressure {info.pressure.toFixed(2)} · {info.coalesced} coalesced/event · {info.pointsInStroke} pts in stroke
            {info.touchSuppressed ? " · touch ignored (pen active)" : ""}
          </>
        )}
      </p>
    </div>
  );
}
