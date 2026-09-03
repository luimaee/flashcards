import { describe, expect, it } from "vitest";
import { NotesSearch, normaliseTag, parseWikiLinks, snippetFor } from "@/lib/search/index";
import type { SearchEntry } from "@/lib/store/schema";

const entries: SearchEntry[] = [
  { key: "n1::title", noteId: "n1", pageId: "", entityId: "n1", kind: "title", text: "Photosynthesis lecture 3" },
  { key: "n1::tags", noteId: "n1", pageId: "", entityId: "n1", kind: "tag", text: "bio plants" },
  { key: "n1:p1:t1", noteId: "n1", pageId: "p1", entityId: "t1", kind: "text", text: "Chlorophyll a absorbs blue and red light most strongly." },
  { key: "n2::title", noteId: "n2", pageId: "", entityId: "n2", kind: "title", text: "Marketing: SERVQUAL" },
  { key: "n2:p3:pdf", noteId: "n2", pageId: "p3", entityId: "pdf", kind: "pdf", text: "The SERVQUAL instrument has 22 items across five dimensions." },
];

describe("full-text search", () => {
  it("finds titles, tags, typed text and PDF text", () => {
    const s = new NotesSearch();
    s.replaceAll(entries);
    expect(s.query("chlorophyll")[0]?.noteId).toBe("n1");
    expect(s.query("plants")[0]?.kind).toBe("tag");
    expect(s.query("servqual").map((h) => h.noteId)).toContain("n2");
    expect(s.query("22 items")[0]?.pageId).toBe("p3");
  });

  it("matches prefixes and small typos", () => {
    const s = new NotesSearch();
    s.replaceAll(entries);
    expect(s.query("photosyn").length).toBeGreaterThan(0);
    expect(s.query("chlorofyll").length).toBeGreaterThan(0);
  });

  it("updates and removes entries incrementally", () => {
    const s = new NotesSearch();
    s.replaceAll(entries);
    s.upsert({ key: "n1:p1:t1", noteId: "n1", pageId: "p1", entityId: "t1", kind: "text", text: "Completely different content about mitochondria" });
    expect(s.query("chlorophyll")).toHaveLength(0);
    expect(s.query("mitochondria")).toHaveLength(1);
    s.remove("n1:p1:t1");
    expect(s.query("mitochondria")).toHaveLength(0);
    expect(s.query("")).toHaveLength(0);
  });

  it("builds a snippet around the match", () => {
    const text = "a ".repeat(100) + "the Calvin cycle fixes carbon " + "b ".repeat(100);
    const snip = snippetFor(text, "calvin", 20);
    expect(snip).toMatch(/Calvin/);
    expect(snip.length).toBeLessThan(60);
    expect(snip.startsWith("…")).toBe(true);
  });
});

describe("wiki links and tags", () => {
  it("parses [[Title]] links, deduplicated", () => {
    expect(parseWikiLinks("see [[Lecture 2]] and [[lecture 2]] and [[Enzymes]]")).toEqual(["Lecture 2", "Enzymes"]);
    expect(parseWikiLinks("no links here")).toEqual([]);
    expect(parseWikiLinks("[[ ]] [[]]")).toEqual([]);
  });

  it("normalises tags", () => {
    expect(normaliseTag(" #Cell Biology ")).toBe("cell-biology");
    expect(normaliseTag("bio")).toBe("bio");
  });
});
