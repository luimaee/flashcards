import { getStroke, type StrokeOptions } from "perfect-freehand";

/**
 * Stroke geometry. DOM-free so it can run in tests, workers, and export code.
 *
 * Points are kept as raw input (x, y in page units, pressure 0..1, t in ms
 * from the start of the stroke). Outlines are computed on demand for display
 * and never stored.
 */

export interface InkPoint {
  x: number;
  y: number;
  p: number;
  t: number;
}

export type InkTool = "pen" | "highlighter";

/**
 * Tunables for handwriting. These are deliberately low: perfect-freehand's
 * defaults (smoothing 0.5, streamline 0.5) are tuned for sketching and make
 * small letters merge, so the top of a "u" closes into an "o".
 *
 * - streamline: how much each new input point is pulled toward the previous
 *   one (0 = raw, 1 = frozen). Lower keeps sharp turns in small letters.
 * - smoothing: how much the outline's corners are rounded.
 * - thinning: how strongly pressure changes the width.
 */
export const HANDWRITING_TUNING = {
  size: 2.4,
  thinning: 0.6,
  smoothing: 0.3,
  streamline: 0.28,
};

export const HIGHLIGHTER_TUNING = {
  size: 16,
  thinning: 0,
  smoothing: 0.6,
  streamline: 0.45,
};

export function toolOptions(tool: InkTool, size?: number, overrides: Partial<StrokeOptions> = {}): StrokeOptions {
  const base = tool === "highlighter" ? HIGHLIGHTER_TUNING : HANDWRITING_TUNING;
  return {
    ...base,
    size: size ?? base.size,
    simulatePressure: false,
    start: { cap: true, taper: 0 },
    end: { cap: true, taper: 0 },
    ...overrides,
  };
}

/** Pack points into a compact Float32 buffer: x, y, p, t per point. */
export function packPoints(points: InkPoint[]): ArrayBuffer {
  const out = new Float32Array(points.length * 4);
  for (let i = 0; i < points.length; i += 1) {
    const pt = points[i];
    out[i * 4] = pt.x;
    out[i * 4 + 1] = pt.y;
    out[i * 4 + 2] = pt.p;
    out[i * 4 + 3] = pt.t;
  }
  return out.buffer;
}

export function unpackPoints(buffer: ArrayBuffer, count?: number): InkPoint[] {
  const view = new Float32Array(buffer);
  const n = count ?? Math.floor(view.length / 4);
  const points: InkPoint[] = new Array(n);
  for (let i = 0; i < n; i += 1) {
    points[i] = { x: view[i * 4], y: view[i * 4 + 1], p: view[i * 4 + 2], t: view[i * 4 + 3] };
  }
  return points;
}

export type BBox = [number, number, number, number];

export function bboxOf(points: InkPoint[], pad = 0): BBox {
  if (points.length === 0) return [0, 0, 0, 0];
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of points) {
    if (p.x < x0) x0 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.x > x1) x1 = p.x;
    if (p.y > y1) y1 = p.y;
  }
  return [x0 - pad, y0 - pad, x1 + pad, y1 + pad];
}

export function bboxIntersects(a: BBox, b: BBox): boolean {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

/** Outline polygon for a stroke, in page units. */
export function strokeOutline(points: InkPoint[], options: StrokeOptions, last = true): number[][] {
  if (points.length === 0) return [];
  return getStroke(
    points.map((p) => [p.x, p.y, p.p] as [number, number, number]),
    { ...options, last },
  );
}

/** SVG path data for an outline polygon (quadratic-smoothed closed shape). */
export function outlineToSvgPath(outline: number[][]): string {
  if (outline.length < 2) return "";
  const [first, ...rest] = outline;
  let d = `M ${first[0].toFixed(2)} ${first[1].toFixed(2)} Q`;
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    const b = rest[(i + 1) % rest.length];
    d += ` ${a[0].toFixed(2)} ${a[1].toFixed(2)} ${((a[0] + b[0]) / 2).toFixed(2)} ${((a[1] + b[1]) / 2).toFixed(2)}`;
  }
  return `${d} Z`;
}

function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  let t = lengthSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/** True when a circle (the eraser) touches the stroke's centre line, allowing for its width. */
export function strokeHitsCircle(points: InkPoint[], cx: number, cy: number, radius: number, strokeSize: number): boolean {
  const reach = radius + strokeSize / 2;
  if (points.length === 1) return Math.hypot(points[0].x - cx, points[0].y - cy) <= reach;
  for (let i = 1; i < points.length; i += 1) {
    if (distanceToSegment(cx, cy, points[i - 1].x, points[i - 1].y, points[i].x, points[i].y) <= reach) return true;
  }
  return false;
}

/** Drop points closer than `minDistance` to the previous kept point. Keeps first and last. */
export function thinPoints(points: InkPoint[], minDistance = 0.35): InkPoint[] {
  if (points.length <= 2) return points;
  const kept: InkPoint[] = [points[0]];
  for (let i = 1; i < points.length - 1; i += 1) {
    const prev = kept[kept.length - 1];
    if (Math.hypot(points[i].x - prev.x, points[i].y - prev.y) >= minDistance) kept.push(points[i]);
  }
  kept.push(points[points.length - 1]);
  return kept;
}
