"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from "react";
import type { StrokeOptions } from "perfect-freehand";
import { strokeHitsCircle, thinPoints, type InkPoint, type InkTool } from "@/lib/ink/geometry";
import { PointerArbiter, pressureOf } from "@/lib/ink/input";
import { drawBackground, drawRawPoints, drawStroke, drawStrokes, type Background, type DrawableStroke } from "@/lib/ink/render";

export type CanvasTool = InkTool | "eraser";

export interface InkCanvasProps {
  width: number; // page units
  height: number;
  /** CSS pixels per page unit. */
  scale: number;
  background: Background;
  strokes: DrawableStroke[];
  tool: CanvasTool;
  color: string;
  size: number;
  eraserRadius?: number;
  /** Extra perfect-freehand options, used by the tuning page. */
  tuning?: Partial<StrokeOptions>;
  showRawPoints?: boolean;
  onStrokeCommit: (stroke: DrawableStroke) => void;
  onErase: (strokeIds: string[]) => void;
  onInputInfo?: (info: InputInfo) => void;
}

export interface InputInfo {
  pointerType: string;
  pressure: number;
  coalesced: number;
  pointsInStroke: number;
  touchSuppressed: boolean;
}

const COLORS = { paper: "#ffffff", line: "#d9dee7" };

function subscribeToResize(callback: () => void) {
  window.addEventListener("resize", callback);
  return () => window.removeEventListener("resize", callback);
}

function getDpr() {
  return window.devicePixelRatio || 1;
}

/**
 * Two stacked canvases: `base` holds the background and committed strokes
 * and is redrawn only when they change; `live` holds the stroke in progress
 * and is cleared every frame. Both use a desynchronized context so the
 * browser can present ink without waiting for the compositor.
 */
export function InkCanvas({
  width,
  height,
  scale,
  background,
  strokes,
  tool,
  color,
  size,
  eraserRadius = 6,
  tuning,
  showRawPoints = false,
  onStrokeCommit,
  onErase,
  onInputInfo,
}: InkCanvasProps) {
  const baseRef = useRef<HTMLCanvasElement>(null);
  const liveRef = useRef<HTMLCanvasElement>(null);
  const arbiter = useRef(new PointerArbiter());
  const current = useRef<{ points: InkPoint[]; startedAt: number; pointerType: string } | null>(null);
  const erased = useRef<Set<string>>(new Set());
  const frame = useRef<number | null>(null);
  const dpr = useSyncExternalStore(subscribeToResize, getDpr, () => 1);

  const cssWidth = width * scale;
  const cssHeight = height * scale;

  const getContext = useCallback(
    (canvas: HTMLCanvasElement | null) => {
      if (!canvas) return null;
      const ctx = canvas.getContext("2d", { desynchronized: true });
      if (!ctx) return null;
      ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
      return ctx;
    },
    [dpr, scale],
  );

  // Redraw the base layer when strokes, background, or size change.
  useEffect(() => {
    const ctx = getContext(baseRef.current);
    if (!ctx) return;
    drawBackground(ctx, width, height, background, COLORS);
    drawStrokes(ctx, strokes.filter((s) => !erased.current.has(s.id)), tuning);
    if (showRawPoints) for (const s of strokes) drawRawPoints(ctx, s.points);
  }, [strokes, background, width, height, getContext, tuning, showRawPoints]);

  const renderLive = useCallback(() => {
    frame.current = null;
    const ctx = getContext(liveRef.current);
    const stroke = current.current;
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    if (!stroke || tool === "eraser") return;
    drawStroke(ctx, { id: "live", tool, color, size, points: stroke.points }, tuning, false);
    if (showRawPoints) drawRawPoints(ctx, stroke.points);
  }, [getContext, width, height, tool, color, size, tuning, showRawPoints]);

  const scheduleLive = useCallback(() => {
    if (frame.current === null) frame.current = requestAnimationFrame(renderLive);
  }, [renderLive]);

  const toPage = useCallback(
    (ev: { clientX: number; clientY: number }) => {
      const rect = liveRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return { x: (ev.clientX - rect.left) / scale, y: (ev.clientY - rect.top) / scale };
    },
    [scale],
  );

  const eraseAt = useCallback(
    (x: number, y: number) => {
      const hits: string[] = [];
      for (const s of strokes) {
        if (erased.current.has(s.id)) continue;
        if (strokeHitsCircle(s.points, x, y, eraserRadius, s.size)) {
          erased.current.add(s.id);
          hits.push(s.id);
        }
      }
      if (hits.length > 0) {
        // Immediate visual feedback: redraw base without the erased strokes.
        const ctx = getContext(baseRef.current);
        if (ctx) {
          drawBackground(ctx, width, height, background, COLORS);
          drawStrokes(ctx, strokes.filter((s) => !erased.current.has(s.id)), tuning);
        }
      }
      return hits;
    },
    [strokes, eraserRadius, getContext, width, height, background, tuning],
  );

  const onPointerDown = (ev: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!arbiter.current.canStart(ev)) return;
    arbiter.current.start(ev);
    ev.currentTarget.setPointerCapture(ev.pointerId);
    ev.preventDefault();
    const { x, y } = toPage(ev);
    if (tool === "eraser") {
      erased.current = new Set();
      eraseAt(x, y);
      current.current = { points: [], startedAt: ev.timeStamp, pointerType: ev.pointerType };
      return;
    }
    current.current = {
      points: [{ x, y, p: pressureOf(ev.pointerType, ev.pressure), t: 0 }],
      startedAt: ev.timeStamp,
      pointerType: ev.pointerType,
    };
    scheduleLive();
  };

  const onPointerMove = (ev: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!arbiter.current.isActive(ev) || !current.current) return;
    ev.preventDefault();
    const native = ev.nativeEvent as globalThis.PointerEvent;
    const events = typeof native.getCoalescedEvents === "function" ? native.getCoalescedEvents() : [];
    const list = events.length > 0 ? events : [native];
    if (tool === "eraser") {
      for (const e of list) {
        const { x, y } = toPage(e);
        eraseAt(x, y);
      }
      return;
    }
    const stroke = current.current;
    for (const e of list) {
      const { x, y } = toPage(e);
      stroke.points.push({ x, y, p: pressureOf(e.pointerType, e.pressure), t: e.timeStamp - stroke.startedAt });
    }
    onInputInfo?.({
      pointerType: ev.pointerType,
      pressure: ev.pressure,
      coalesced: list.length,
      pointsInStroke: stroke.points.length,
      touchSuppressed: arbiter.current.touchSuppressed(ev.timeStamp),
    });
    scheduleLive();
  };

  const finish = (ev: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!arbiter.current.isActive(ev)) return;
    arbiter.current.end(ev);
    const stroke = current.current;
    current.current = null;
    if (tool === "eraser") {
      const ids = Array.from(erased.current);
      erased.current = new Set();
      if (ids.length > 0) onErase(ids);
      return;
    }
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }
    const ctx = getContext(liveRef.current);
    ctx?.clearRect(0, 0, width, height);
    if (stroke && stroke.points.length > 0) {
      onStrokeCommit({
        id: `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
        tool,
        color,
        size,
        points: thinPoints(stroke.points),
      });
    }
  };

  return (
    <div
      className="relative select-none"
      style={{ width: cssWidth, height: cssHeight, touchAction: "none" }}
      aria-label="Drawing surface"
    >
      <canvas
        ref={baseRef}
        width={Math.round(cssWidth * dpr)}
        height={Math.round(cssHeight * dpr)}
        style={{ width: cssWidth, height: cssHeight, position: "absolute", inset: 0 }}
      />
      <canvas
        ref={liveRef}
        width={Math.round(cssWidth * dpr)}
        height={Math.round(cssHeight * dpr)}
        style={{ width: cssWidth, height: cssHeight, position: "absolute", inset: 0, touchAction: "none", cursor: tool === "eraser" ? "cell" : "crosshair" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finish}
        onPointerCancel={finish}
        onLostPointerCapture={finish}
        onContextMenu={(e) => e.preventDefault()}
      />
    </div>
  );
}
