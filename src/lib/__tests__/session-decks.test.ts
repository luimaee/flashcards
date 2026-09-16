import { describe, expect, it } from "vitest";
import type { Flashcard } from "@/lib/flashcards/schema";
import { initialSession, sessionReducer, type SessionState } from "@/lib/session";

const card = (id: string): Flashcard => ({ id, question: `Q ${id}?`, answer: "A", sourceExcerpt: "S", difficulty: "easy", tags: [] });

describe("session: saved deck", () => {
  it("keeps the deck id across regenerate-all so edits land in the same file", () => {
    let s: SessionState = { ...initialSession, phase: "done", source: { kind: "text", text: "x" }, cards: [card("1")] };
    s = sessionReducer(s, { type: "deckCreated", deck: { id: "d1", title: "T", folder: "/tmp" }, savedAt: 1 });
    s = sessionReducer(s, { type: "generateStart", source: s.source! });
    s = sessionReducer(s, { type: "generateSuccess", cards: [card("9")], notice: undefined });
    expect(s.deck?.id).toBe("d1");
    expect(s.cards[0].id).toBe("9");
  });

  it("opening a saved deck restores cards, source and title in one step", () => {
    const s = sessionReducer(initialSession, {
      type: "deckOpened",
      deck: { id: "d2", title: "Lecture 3", folder: "/tmp" },
      cards: [card("1"), card("2")],
      source: { kind: "text", text: "the lecture text" },
      savedAt: 5,
    });
    expect(s.phase).toBe("done");
    expect(s.cards).toHaveLength(2);
    expect(s.source).toEqual({ kind: "text", text: "the lecture text" });
    expect(s.deck?.title).toBe("Lecture 3");
    expect(s.saveState).toBe("saved");
  });

  it("tracks saving, saved and failed states without losing cards", () => {
    let s: SessionState = { ...initialSession, phase: "done", cards: [card("1")], deck: { id: "d", title: "T", folder: null } };
    s = sessionReducer(s, { type: "saveStart" });
    expect(s.saveState).toBe("saving");
    s = sessionReducer(s, { type: "saveFailure", message: "disk full" });
    expect(s.saveState).toBe("error");
    expect(s.saveError).toBe("disk full");
    expect(s.cards).toHaveLength(1);
    s = sessionReducer(s, { type: "saveSuccess", savedAt: 9 });
    expect(s.saveState).toBe("saved");
    expect(s.savedAt).toBe(9);
    expect(s.saveError).toBeNull();
  });

  it("renames only when a deck exists and start over forgets it", () => {
    expect(sessionReducer(initialSession, { type: "setTitle", title: "x" }).deck).toBeNull();
    let s: SessionState = { ...initialSession, deck: { id: "d", title: "T", folder: null } };
    s = sessionReducer(s, { type: "setTitle", title: "New" });
    expect(s.deck?.title).toBe("New");
    expect(sessionReducer(s, { type: "startOver" }).deck).toBeNull();
  });
});
