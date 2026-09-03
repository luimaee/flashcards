import { describe, expect, it } from "vitest";
import { packPoints } from "@/lib/ink/geometry";
import { regionContent, textBlockBox } from "@/lib/notes/region";
import type { Stroke, TextBlock } from "@/lib/store/schema";

const v = { device: "d", seq: 1 };
const block = (id: string, x: number, y: number, text: string): TextBlock => ({
  id, version: v, createdAt: 0, updatedAt: 0, pageId: "p", x, y, width: 200, text, fontSize: 12,
});
const stroke = (id: string, bbox: [number, number, number, number]): Stroke => ({
  id, version: v, createdAt: 0, updatedAt: 0, pageId: "p", tool: "pen", color: "#000", size: 2,
  points: packPoints([{ x: bbox[0], y: bbox[1], p: 0.5, t: 0 }]), count: 1, bbox,
});

describe("region content", () => {
  it("collects typed text blocks that intersect the region, with anchors", () => {
    const blocks = [block("t1", 50, 50, "Chlorophyll absorbs red light"), block("t2", 50, 600, "Unrelated")];
    const out = regionContent({ textBlocks: blocks, strokes: [] }, [40, 40, 300, 120]);
    expect(out.text).toBe("Chlorophyll absorbs red light");
    expect(out.anchors).toEqual([{ type: "text", textBlockId: "t1", start: 0, end: 29 }]);
    expect(out.inkOnly).toBe(false);
  });

  it("adds PDF text covered by the region and its char range", () => {
    const pdf = {
      pageNumber: 2,
      text: "Alpha beta\ngamma delta\nepsilon",
      items: [
        { str: "Alpha beta", x: 72, y: 60, w: 60, h: 12, start: 0 },
        { str: "gamma delta", x: 72, y: 80, w: 60, h: 12, start: 11 },
        { str: "epsilon", x: 72, y: 100, w: 40, h: 12, start: 23 },
      ],
    };
    const out = regionContent({ textBlocks: [], strokes: [], pdf }, [60, 55, 140, 95]);
    expect(out.text).toBe("Alpha beta\ngamma delta");
    expect(out.anchors).toEqual([{ type: "pdf", pageNumber: 2, start: 0, end: 22 }]);
  });

  it("reports ink-only selections so the UI can explain there is no text", () => {
    const out = regionContent({ textBlocks: [], strokes: [stroke("s1", [10, 10, 40, 40]), stroke("s2", [500, 500, 520, 520])] }, [0, 0, 100, 100]);
    expect(out.text).toBe("");
    expect(out.inkOnly).toBe(true);
    expect(out.strokeIds).toEqual(["s1"]);
    expect(out.anchors).toEqual([{ type: "ink", strokeIds: ["s1"] }]);
  });

  it("accepts regions dragged in any direction", () => {
    const out = regionContent({ textBlocks: [block("t1", 50, 50, "x y z")], strokes: [] }, [300, 120, 40, 40]);
    expect(out.text).toBe("x y z");
  });

  it("estimates a text block box from its line count", () => {
    const [, y0, , y1] = textBlockBox(block("t", 0, 100, "one\ntwo\nthree"));
    expect(y0).toBe(100);
    expect(y1).toBeGreaterThan(100 + 3 * 12);
  });
});
