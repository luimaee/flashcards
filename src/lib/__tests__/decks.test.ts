import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DeckStore, DeckStoreError, decksDir, titleFor } from "@/lib/decks/store";
import type { Flashcard } from "@/lib/flashcards/schema";

const card = (n: number): Flashcard => ({
  id: `c${n}`,
  question: `Q${n}?`,
  answer: `A${n}`,
  sourceExcerpt: `S${n}`,
  difficulty: "easy",
  tags: [],
});

let root: string;
let store: DeckStore;

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "lecturecards-"));
  store = new DeckStore(root);
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("local deck library", () => {
  it("creates the folder layout and a README on first use", async () => {
    await store.list();
    expect(readdirSync(root).sort()).toEqual(["README.txt", "decks", "trash"]);
  });

  it("saves a deck as a readable JSON file and lists it", async () => {
    const deck = await store.create({ title: "Lecture 3", provider: "mock", source: { kind: "text", text: "some notes" }, cards: [card(1), card(2)] });
    const file = path.join(root, "decks", `${deck.id}.json`);
    const onDisk = JSON.parse(readFileSync(file, "utf8"));
    expect(onDisk.title).toBe("Lecture 3");
    expect(onDisk.cards).toHaveLength(2);
    const list = await store.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: deck.id, title: "Lecture 3", cardCount: 2, provider: "mock", sourceKind: "text" });
  });

  it("updates title and cards, keeps source and createdAt", async () => {
    const deck = await store.create({ title: "T", provider: "mock", source: { kind: "pdf", name: "l.pdf", text: "x".repeat(300) }, cards: [card(1)] });
    const updated = await store.update(deck.id, { title: "Renamed", cards: [card(1), card(2)] });
    expect(updated.title).toBe("Renamed");
    expect(updated.cards).toHaveLength(2);
    expect(updated.createdAt).toBe(deck.createdAt);
    expect(updated.source.text).toBe("x".repeat(300));
    expect((await store.read(deck.id)).title).toBe("Renamed");
  });

  it("moves deleted decks to trash instead of removing them", async () => {
    const deck = await store.create({ title: "T", provider: "mock", source: { kind: "text", text: "n" }, cards: [card(1)] });
    await store.trash(deck.id);
    expect(await store.list()).toHaveLength(0);
    expect(readdirSync(path.join(root, "trash"))).toEqual([`${deck.id}.json`]);
    await expect(store.read(deck.id)).rejects.toBeInstanceOf(DeckStoreError);
  });

  it("skips damaged or foreign files without touching them", async () => {
    await store.list();
    writeFileSync(path.join(root, "decks", "20260101-000000-zzzz.json"), "{ not json", "utf8");
    writeFileSync(path.join(root, "decks", "notes.txt"), "hello", "utf8");
    const good = await store.create({ title: "ok", provider: "mock", source: { kind: "text", text: "n" }, cards: [card(1)] });
    const list = await store.list();
    expect(list.map((d) => d.id)).toEqual([good.id]);
    expect(readdirSync(path.join(root, "decks")).length).toBe(3);
  });

  it("refuses ids that could escape the folder", async () => {
    await expect(store.read("../../etc/passwd")).rejects.toThrow(/Bad deck id/);
    await expect(store.trash("..\\x")).rejects.toThrow(/Bad deck id/);
  });

  it("never leaves temp files behind after a write", async () => {
    await store.create({ title: "T", provider: "mock", source: { kind: "text", text: "n" }, cards: [card(1)] });
    expect(readdirSync(path.join(root, "decks")).some((n) => n.includes(".tmp-"))).toBe(false);
  });

  it("uses LECTURE_CARDS_DIR when set, else ~/LectureCards", () => {
    expect(decksDir({ LECTURE_CARDS_DIR: root })).toBe(path.resolve(root));
    expect(decksDir({})).toBe(path.join(os.homedir(), "LectureCards"));
  });

  it("titles decks from the file name or the first words", () => {
    expect(titleFor({ kind: "pdf", name: "Lecture 3 - Enzymes.pdf", text: "" })).toBe("Lecture 3 - Enzymes");
    expect(titleFor({ kind: "text", text: "Photosynthesis converts light energy into chemical energy stored in glucose and more" })).toBe(
      "Photosynthesis converts light energy into chemical energy stored",
    );
    expect(titleFor({ kind: "text", text: "   " })).toBe("Untitled deck");
  });
});
