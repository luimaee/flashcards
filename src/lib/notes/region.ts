import { bboxIntersects, type BBox } from "@/lib/ink/geometry";
import { textInRegion, type PositionedItem } from "@/lib/pdf/geometry";
import type { CardSource, Stroke, TextBlock } from "@/lib/store/schema";

/**
 * What a selected region of a page contains, in the form the card pipeline
 * and card provenance need. Pure so it can be tested without a DOM.
 */

export type Region = BBox; // [x0, y0, x1, y1] in page units

export type Anchor = Extract<CardSource, { kind: "note" }>["anchors"][number];

export interface RegionContent {
  /** Text to send for card generation: typed text first, then PDF text. */
  text: string;
  anchors: Anchor[];
  /** Ink was selected but carries no text (no OCR in v1). */
  inkOnly: boolean;
  strokeIds: string[];
}

export interface PageContent {
  textBlocks: TextBlock[];
  strokes: Stroke[];
  pdf?: { pageNumber: number; text: string; items: PositionedItem[] } | null;
}

/** Approximate line height for a text block, used to estimate its box. */
export function textBlockBox(block: TextBlock): BBox {
  const lines = Math.max(1, block.text.split("\n").length);
  const height = lines * block.fontSize * 1.35 + block.fontSize;
  return [block.x, block.y, block.x + block.width, block.y + height];
}

export function normaliseRegion(region: Region): Region {
  const [a, b, c, d] = region;
  return [Math.min(a, c), Math.min(b, d), Math.max(a, c), Math.max(b, d)];
}

export function regionContent(page: PageContent, rawRegion: Region): RegionContent {
  const region = normaliseRegion(rawRegion);
  const parts: string[] = [];
  const anchors: Anchor[] = [];

  for (const block of page.textBlocks) {
    if (!block.text.trim()) continue;
    if (bboxIntersects(textBlockBox(block), region)) {
      parts.push(block.text.trim());
      anchors.push({ type: "text", textBlockId: block.id, start: 0, end: block.text.length });
    }
  }

  if (page.pdf) {
    const covered = textInRegion(page.pdf.text, page.pdf.items, region);
    if (covered && covered.text) {
      parts.push(covered.text);
      anchors.push({ type: "pdf", pageNumber: page.pdf.pageNumber, start: covered.start, end: covered.end });
    }
  }

  const strokeIds = page.strokes.filter((s) => bboxIntersects(s.bbox, region)).map((s) => s.id);
  if (strokeIds.length > 0) anchors.push({ type: "ink", strokeIds });

  return {
    text: parts.join("\n\n"),
    anchors,
    inkOnly: parts.length === 0 && strokeIds.length > 0,
    strokeIds,
  };
}
