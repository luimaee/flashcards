import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { FlashcardSchema, type Flashcard } from "@/lib/flashcards/schema";

/**
 * Local deck library: one JSON file per batch of cards, in a folder on this
 * computer. The app runs locally, so the server side can read and write the
 * student's own files directly. Nothing leaves the machine.
 *
 * Folder: $LECTURE_CARDS_DIR, or ~/LectureCards by default.
 *   decks/<id>.json    saved decks (human-readable JSON)
 *   trash/<id>.json    deleted decks; never hard-deleted by the app
 *   README.txt         explains the folder to anyone who opens it
 *
 * Writes are atomic (temp file then rename) so a crash cannot leave a
 * half-written deck.
 */

export const DECK_FILE_VERSION = 1;

export const DeckFileSchema = z
  .object({
    version: z.literal(DECK_FILE_VERSION),
    id: z.string().regex(/^[0-9]{8}-[0-9]{6}-[a-z0-9]{4}$/),
    title: z.string().trim().min(1).max(200),
    createdAt: z.number(),
    updatedAt: z.number(),
    provider: z.string(),
    source: z.object({
      kind: z.enum(["pdf", "text"]),
      name: z.string().optional(),
      /** Kept so cards can be regenerated later. Her own material, on her own disk. */
      text: z.string(),
    }),
    cards: z.array(FlashcardSchema),
  })
  .strict();

export type DeckFile = z.infer<typeof DeckFileSchema>;

export interface DeckSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  cardCount: number;
  provider: string;
  sourceKind: "pdf" | "text";
}

const README_TEXT = `Lecture Cards

This folder is where the Lecture Cards app keeps your saved card decks.

  decks/   one .json file per batch of cards. You can open them in any text
           editor, copy them to another computer, or back them up.
  trash/   decks you deleted in the app. Delete these files yourself if you
           want them gone for good.

Do not rename files inside decks/ while the app is running.
`;

export function decksDir(env: Record<string, string | undefined> = process.env): string {
  const configured = env.LECTURE_CARDS_DIR?.trim();
  return configured && configured.length > 0 ? path.resolve(configured) : path.join(os.homedir(), "LectureCards");
}

async function ensureLayout(root: string): Promise<void> {
  await fs.mkdir(path.join(root, "decks"), { recursive: true });
  await fs.mkdir(path.join(root, "trash"), { recursive: true });
  const readme = path.join(root, "README.txt");
  try {
    await fs.access(readme);
  } catch {
    await fs.writeFile(readme, README_TEXT, "utf8");
  }
}

export function newDeckId(now = new Date()): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const rand = Math.random().toString(36).slice(2, 6).padEnd(4, "0");
  return `${stamp}-${rand}`;
}

function isSafeId(id: string): boolean {
  return /^[0-9]{8}-[0-9]{6}-[a-z0-9]{4}$/.test(id);
}

export class DeckStoreError extends Error {
  constructor(
    message: string,
    public readonly code: "not-found" | "invalid" | "io",
  ) {
    super(message);
    this.name = "DeckStoreError";
  }
}

export class DeckStore {
  constructor(readonly root: string = decksDir()) {}

  private deckPath(id: string): string {
    if (!isSafeId(id)) throw new DeckStoreError("Bad deck id", "invalid");
    return path.join(this.root, "decks", `${id}.json`);
  }

  async list(): Promise<DeckSummary[]> {
    await ensureLayout(this.root);
    const dir = path.join(this.root, "decks");
    const names = (await fs.readdir(dir)).filter((n) => n.endsWith(".json"));
    const summaries: DeckSummary[] = [];
    for (const name of names) {
      const id = name.replace(/\.json$/, "");
      if (!isSafeId(id)) continue;
      try {
        const deck = await this.read(id);
        summaries.push({
          id: deck.id,
          title: deck.title,
          createdAt: deck.createdAt,
          updatedAt: deck.updatedAt,
          cardCount: deck.cards.length,
          provider: deck.provider,
          sourceKind: deck.source.kind,
        });
      } catch {
        // A damaged or foreign file is skipped, never deleted.
      }
    }
    return summaries.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async read(id: string): Promise<DeckFile> {
    const file = this.deckPath(id);
    let raw: string;
    try {
      raw = await fs.readFile(file, "utf8");
    } catch {
      throw new DeckStoreError("That deck was not found", "not-found");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new DeckStoreError("That deck file is not valid JSON", "invalid");
    }
    const result = DeckFileSchema.safeParse(parsed);
    if (!result.success) throw new DeckStoreError("That deck file has an unexpected shape", "invalid");
    return result.data;
  }

  async create(input: { title: string; provider: string; source: DeckFile["source"]; cards: Flashcard[] }): Promise<DeckFile> {
    await ensureLayout(this.root);
    const now = Date.now();
    const deck: DeckFile = {
      version: DECK_FILE_VERSION,
      id: newDeckId(new Date(now)),
      title: input.title.trim() || "Untitled deck",
      createdAt: now,
      updatedAt: now,
      provider: input.provider,
      source: input.source,
      cards: input.cards,
    };
    await this.writeAtomic(deck);
    return deck;
  }

  /** Save edits. Only title and cards can change; source and timestamps are managed here. */
  async update(id: string, patch: { title?: string; cards?: Flashcard[] }): Promise<DeckFile> {
    const current = await this.read(id);
    const next: DeckFile = {
      ...current,
      title: patch.title !== undefined ? patch.title.trim() || current.title : current.title,
      cards: patch.cards ?? current.cards,
      updatedAt: Date.now(),
    };
    DeckFileSchema.parse(next);
    await this.writeAtomic(next);
    return next;
  }

  /** Move to trash/. The file is kept; the student can recover it by hand. */
  async trash(id: string): Promise<void> {
    const file = this.deckPath(id);
    await ensureLayout(this.root);
    try {
      await fs.rename(file, path.join(this.root, "trash", `${id}.json`));
    } catch {
      throw new DeckStoreError("That deck was not found", "not-found");
    }
  }

  private async writeAtomic(deck: DeckFile): Promise<void> {
    const file = this.deckPath(deck.id);
    const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
    try {
      await fs.writeFile(tmp, JSON.stringify(deck, null, 2), "utf8");
      await fs.rename(tmp, file);
    } catch (error) {
      await fs.rm(tmp, { force: true });
      throw new DeckStoreError(error instanceof Error ? error.message : "Could not write the deck file", "io");
    }
  }
}

/** A readable title from the source: file name without extension, else the first words of the text. */
export function titleFor(source: { kind: "pdf" | "text"; name?: string; text: string }): string {
  if (source.name) return source.name.replace(/\.pdf$/i, "").slice(0, 80);
  const words = source.text.replace(/\s+/g, " ").trim().split(" ").slice(0, 8).join(" ");
  return words.length > 0 ? `${words.slice(0, 70)}${words.length > 70 ? "…" : ""}` : "Untitled deck";
}
