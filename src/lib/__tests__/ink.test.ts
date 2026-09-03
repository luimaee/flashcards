import { describe, expect, it } from "vitest";
import {
  HANDWRITING_TUNING,
  bboxIntersects,
  bboxOf,
  outlineToSvgPath,
  packPoints,
  strokeHitsCircle,
  strokeOutline,
  thinPoints,
  toolOptions,
  unpackPoints,
  type InkPoint,
} from "@/lib/ink/geometry";
import { PointerArbiter, TOUCH_GRACE_AFTER_PEN_MS, pressureOf } from "@/lib/ink/input";
import { defaultPageSize } from "@/lib/ink/render";

const line: InkPoint[] = Array.from({ length: 20 }, (_, i) => ({ x: 10 + i * 3, y: 50 + Math.sin(i / 2) * 4, p: 0.5 + (i % 3) * 0.1, t: i * 8 }));

describe("stroke geometry", () => {
  it("packs and unpacks points without loss beyond float32", () => {
    const back = unpackPoints(packPoints(line), line.length);
    expect(back).toHaveLength(line.length);
    for (let i = 0; i < line.length; i += 1) {
      expect(back[i].x).toBeCloseTo(line[i].x, 4);
      expect(back[i].y).toBeCloseTo(line[i].y, 4);
      expect(back[i].p).toBeCloseTo(line[i].p, 4);
      expect(back[i].t).toBeCloseTo(line[i].t, 4);
    }
  });

  it("computes a bounding box with padding", () => {
    const [x0, y0, x1, y1] = bboxOf(line, 2);
    expect(x0).toBeCloseTo(8);
    expect(x1).toBeCloseTo(10 + 19 * 3 + 2);
    expect(y0).toBeLessThan(50);
    expect(y1).toBeGreaterThan(50);
    expect(bboxIntersects([0, 0, 10, 10], [5, 5, 20, 20])).toBe(true);
    expect(bboxIntersects([0, 0, 10, 10], [11, 11, 20, 20])).toBe(false);
  });

  it("produces a closed outline and an SVG path", () => {
    const outline = strokeOutline(line, toolOptions("pen"));
    expect(outline.length).toBeGreaterThan(line.length);
    const d = outlineToSvgPath(outline);
    expect(d.startsWith("M ")).toBe(true);
    expect(d.endsWith(" Z")).toBe(true);
  });

  it("handwriting tuning is lower than perfect-freehand's sketch defaults", () => {
    expect(HANDWRITING_TUNING.smoothing).toBeLessThan(0.5);
    expect(HANDWRITING_TUNING.streamline).toBeLessThan(0.5);
    const opts = toolOptions("pen", 3, { streamline: 0.1 });
    expect(opts.size).toBe(3);
    expect(opts.streamline).toBe(0.1);
    expect(opts.simulatePressure).toBe(false);
  });

  it("eraser hit test respects stroke width and misses far points", () => {
    expect(strokeHitsCircle(line, 25, 50, 3, 2)).toBe(true);
    expect(strokeHitsCircle(line, 25, 80, 3, 2)).toBe(false);
    expect(strokeHitsCircle([{ x: 5, y: 5, p: 1, t: 0 }], 6, 6, 2, 2)).toBe(true);
  });

  it("thins near-duplicate points but keeps the ends", () => {
    const dense: InkPoint[] = Array.from({ length: 50 }, (_, i) => ({ x: i * 0.1, y: 0, p: 0.5, t: i }));
    const thinned = thinPoints(dense, 0.35);
    expect(thinned.length).toBeLessThan(dense.length);
    expect(thinned[0]).toEqual(dense[0]);
    expect(thinned[thinned.length - 1]).toEqual(dense[dense.length - 1]);
  });
});

describe("pointer arbitration (palm rejection)", () => {
  const pen = (id: number, t: number) => ({ pointerId: id, pointerType: "pen", timeStamp: t });
  const touch = (id: number, t: number) => ({ pointerId: id, pointerType: "touch", timeStamp: t });
  const mouse = (id: number, t: number) => ({ pointerId: id, pointerType: "mouse", timeStamp: t });

  it("ignores touch while a pen is in use and shortly after", () => {
    const a = new PointerArbiter();
    expect(a.canStart(pen(1, 1000))).toBe(true);
    a.start(pen(1, 1000));
    expect(a.canStart(touch(2, 1200))).toBe(false); // palm during stroke
    a.end(pen(1, 1500));
    expect(a.canStart(touch(2, 1500 + TOUCH_GRACE_AFTER_PEN_MS - 1))).toBe(false);
    expect(a.canStart(touch(2, 1500 + TOUCH_GRACE_AFTER_PEN_MS + 1))).toBe(true);
  });

  it("allows touch and mouse when no pen has been seen", () => {
    const a = new PointerArbiter();
    expect(a.canStart(touch(1, 10))).toBe(true);
    const b = new PointerArbiter();
    expect(b.canStart(mouse(1, 10))).toBe(true);
  });

  it("tracks one active pointer and rejects a second", () => {
    const a = new PointerArbiter();
    a.start(mouse(1, 0));
    expect(a.isActive(mouse(1, 5))).toBe(true);
    expect(a.isActive(mouse(9, 5))).toBe(false);
    expect(a.canStart(mouse(9, 5))).toBe(false);
    a.end(mouse(1, 10));
    expect(a.activeKind).toBeNull();
  });

  it("uses real pressure for pens and a constant for everything else", () => {
    expect(pressureOf("pen", 0.8)).toBe(0.8);
    expect(pressureOf("pen", 0)).toBe(0.5);
    expect(pressureOf("mouse", 1)).toBe(0.5);
    expect(pressureOf("touch", 0.2)).toBe(0.5);
  });
});

describe("page size default", () => {
  it("is Letter for US and Canada, A4 elsewhere", () => {
    expect(defaultPageSize("en-US")).toBe("letter");
    expect(defaultPageSize("fr-CA")).toBe("letter");
    expect(defaultPageSize("en-GB")).toBe("a4");
    expect(defaultPageSize("de")).toBe("a4");
    expect(defaultPageSize(undefined)).toBe("a4");
  });
});
