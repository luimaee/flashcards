import type { StrokeOptions } from "perfect-freehand";
import { outlineToSvgPath, strokeOutline, toolOptions, type InkPoint, type InkTool } from "./geometry";

/**
 * Canvas drawing for pages. Everything takes a 2D context whose transform
 * already maps page units to device pixels, so the same code draws the live
 * editor, thumbnails, and exports.
 */

export type Background = "plain" | "lined" | "grid" | "dots";

export interface DrawableStroke {
  id: string;
  tool: InkTool;
  color: string;
  size: number;
  points: InkPoint[];
}

export const PAGE_SIZES = {
  letter: { width: 612, height: 792 },
  a4: { width: 595, height: 842 },
} as const;

export type PageSizeName = keyof typeof PAGE_SIZES;

/** Letter for US and Canada, A4 for everyone else. */
export function defaultPageSize(locale: string | undefined): PageSizeName {
  const region = (locale ?? "").split(/[-_]/)[1]?.toUpperCase();
  return region === "US" || region === "CA" ? "letter" : "a4";
}

const LINE_SPACING = 24; // page units; roughly college rule at 72 units per inch
const GRID_SPACING = 20;
const DOT_SPACING = 20;

export function drawBackground(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  background: Background,
  colors: { paper: string; line: string },
) {
  ctx.fillStyle = colors.paper;
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = colors.line;
  ctx.fillStyle = colors.line;
  ctx.lineWidth = 0.6;
  if (background === "lined") {
    for (let y = LINE_SPACING * 3; y < height; y += LINE_SPACING) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
  } else if (background === "grid") {
    for (let x = GRID_SPACING; x < width; x += GRID_SPACING) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = GRID_SPACING; y < height; y += GRID_SPACING) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
  } else if (background === "dots") {
    for (let x = DOT_SPACING; x < width; x += DOT_SPACING) {
      for (let y = DOT_SPACING; y < height; y += DOT_SPACING) {
        ctx.beginPath();
        ctx.arc(x, y, 0.9, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

export function drawStroke(
  ctx: CanvasRenderingContext2D,
  stroke: DrawableStroke,
  overrides: Partial<StrokeOptions> = {},
  last = true,
) {
  if (stroke.points.length === 0) return;
  const outline = strokeOutline(stroke.points, toolOptions(stroke.tool, stroke.size, overrides), last);
  const path = new Path2D(outlineToSvgPath(outline));
  ctx.save();
  ctx.fillStyle = stroke.color;
  if (stroke.tool === "highlighter") {
    ctx.globalAlpha = 0.35;
    ctx.globalCompositeOperation = "multiply";
  }
  ctx.fill(path);
  ctx.restore();
}

export function drawStrokes(ctx: CanvasRenderingContext2D, strokes: DrawableStroke[], overrides: Partial<StrokeOptions> = {}) {
  for (const stroke of strokes) drawStroke(ctx, stroke, overrides, true);
}

/** Debug view: the raw input polyline and its sample points. */
export function drawRawPoints(ctx: CanvasRenderingContext2D, points: InkPoint[], color = "#e5484d") {
  if (points.length === 0) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 0.4;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i].x, points[i].y);
  ctx.stroke();
  for (const p of points) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 0.6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
