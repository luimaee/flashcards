import { describe, expect, it } from "vitest";
import { buildPageText, itemRect, itemsInRegion, textInRegion, type RawTextItem } from "@/lib/pdf/geometry";

const H = 842; // A4 height in points
const item = (str: string, x: number, baseline: number, width: number, hasEOL = false, size = 12): RawTextItem => ({
  str,
  transform: [size, 0, 0, size, x, baseline],
  width,
  height: size,
  hasEOL,
});

describe("PDF text geometry", () => {
  it("flips PDF coordinates to top-left page space", () => {
    const r = itemRect(item("Hello", 72, 770, 30), H);
    expect(r.x).toBe(72);
    expect(r.w).toBe(30);
    expect(r.h).toBe(12);
    expect(r.y).toBeCloseTo(842 - 770 - 12);
  });

  it("joins items into text with newlines at line ends and repairs hyphenation", () => {
    const items = [item("The Fornell-Larcker crite-", 72, 770, 150, true), item("rion then indicates validity.", 72, 755, 160, true)];
    const { text, items: positioned } = buildPageText(items, H);
    expect(text).toBe("The Fornell-Larcker criterion then indicates validity.");
    expect(positioned[0].start).toBe(0);
    expect(positioned[1].start).toBe(text.indexOf("rion"));
  });

  it("finds items inside a region and returns the covered text", () => {
    const items = [item("Alpha beta", 72, 770, 60, true), item("gamma delta", 72, 750, 60, true), item("epsilon", 72, 730, 40, true)];
    const { text, items: positioned } = buildPageText(items, H);
    const region: [number, number, number, number] = [60, H - 770 - 14, 140, H - 750 + 2];
    const hits = itemsInRegion(positioned, region);
    expect(hits.map((h) => h.str)).toEqual(["Alpha beta", "gamma delta"]);
    const covered = textInRegion(text, positioned, region);
    expect(covered?.text).toBe("Alpha beta\ngamma delta");
    expect(textInRegion(text, positioned, [400, 400, 500, 500])).toBeNull();
  });
});
