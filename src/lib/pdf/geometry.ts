import { joinHyphenatedLineBreaks } from "@/lib/text";

/**
 * Pure helpers for turning PDF.js text items into page-space rectangles and
 * a plain-text string with character offsets. DOM-free so they are testable.
 *
 * Page space here is PDF points with the origin at the top-left corner,
 * which is what pages, strokes, and text blocks all use.
 */

export interface RawTextItem {
  str: string;
  transform: number[]; // [a, b, c, d, e, f]; e,f = baseline origin in PDF user space (bottom-left origin)
  width: number;
  height: number;
  hasEOL: boolean;
}

export interface PositionedItem {
  str: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Character offset of this item in the page's plain text. */
  start: number;
}

/** Rectangle in top-left page space for one text item. */
export function itemRect(item: RawTextItem, pageHeight: number): { x: number; y: number; w: number; h: number } {
  const [a, b, , d, e, f] = item.transform;
  const fontHeight = Math.hypot(b, d) || Math.abs(d) || item.height;
  const w = item.width || Math.abs(a) * item.str.length * 0.5;
  const h = item.height || fontHeight;
  // f is the baseline; the glyph box sits above it (in PDF space). Flip to top-left origin.
  return { x: e, y: pageHeight - f - h, w, h };
}

/**
 * Build the page's plain text and positioned items. Items are joined with a
 * space unless PDF.js marks a line end, in which case a newline is used.
 * Hyphenated line breaks are repaired in the plain text, and item offsets are
 * recomputed against the repaired text so region selection stays aligned.
 */
export function buildPageText(items: RawTextItem[], pageHeight: number): { text: string; items: PositionedItem[] } {
  let raw = "";
  const positioned: PositionedItem[] = [];
  for (const item of items) {
    const str = item.str;
    if (str.length === 0 && !item.hasEOL) continue;
    const rect = itemRect(item, pageHeight);
    positioned.push({ str, ...rect, start: raw.length });
    raw += str;
    raw += item.hasEOL ? "\n" : " ";
  }
  const text = joinHyphenatedLineBreaks(raw).replace(/[ \t]+\n/g, "\n").replace(/\n{2,}/g, "\n").trim();
  // Re-anchor offsets against the repaired text: find each item's string in order.
  let cursor = 0;
  for (const p of positioned) {
    const probe = p.str.replace(/-$/, "").trimEnd();
    const at = probe ? text.indexOf(probe, cursor) : -1;
    if (at >= 0) {
      p.start = at;
      cursor = at + probe.length;
    } else {
      p.start = Math.min(cursor, text.length);
    }
  }
  return { text, items: positioned };
}

/** Items whose rectangle intersects the region, sorted by reading order. */
export function itemsInRegion(items: PositionedItem[], region: [number, number, number, number]): PositionedItem[] {
  const [x0, y0, x1, y1] = region;
  return items.filter((it) => it.x < x1 && it.x + it.w > x0 && it.y < y1 && it.y + it.h > y0);
}

/** The text covered by a region: from the first intersecting item to the last, in document order. */
export function textInRegion(text: string, items: PositionedItem[], region: [number, number, number, number]): { text: string; start: number; end: number } | null {
  const hits = itemsInRegion(items, region);
  if (hits.length === 0) return null;
  const start = Math.min(...hits.map((h) => h.start));
  const last = hits.reduce((a, b) => (a.start > b.start ? a : b));
  const end = Math.min(text.length, last.start + last.str.length);
  return { text: text.slice(start, end).trim(), start, end };
}
