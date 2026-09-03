import { openDB, type DBSchema, type IDBPDatabase, type IDBPTransaction, type StoreNames } from "idb";
import { applyOp, makeOp, newId, sortOps, type ApplyResult, type Clock, type Versioned } from "./ops";
import {
  ENTITY_SCHEMAS,
  SCHEMA_VERSION,
  type Asset,
  type Card,
  type Deck,
  type EntityKind,
  type EntityOf,
  type ImageBlock,
  type Note,
  type Notebook,
  type Op,
  type Page,
  type PdfText,
  type SearchEntry,
  type Stroke,
  type TextBlock,
} from "./schema";

/**
 * Local-first store on IndexedDB. See docs/storage-design.md.
 *
 * - `ops` is append-only. `commit()` writes the ops and the materialized rows
 *   in one transaction, so a crash can never leave them disagreeing.
 * - Materialized stores are a cache of the log; `rebuild()` regenerates them.
 * - Migrations are keyed by version and run inside the upgrade transaction.
 */

interface NotesDB extends DBSchema {
  meta: { key: string; value: { key: string; value: unknown } };
  ops: { key: string; value: Op; indexes: { byDeviceSeq: [string, number]; byEntity: string; byTs: number } };
  notebooks: { key: string; value: Notebook; indexes: { byUpdated: number } };
  notes: { key: string; value: Note; indexes: { byNotebook: string; byUpdated: number; byTag: string } };
  pages: { key: string; value: Page; indexes: { byNote: string } };
  strokes: { key: string; value: Stroke; indexes: { byPage: string } };
  textBlocks: { key: string; value: TextBlock; indexes: { byPage: string } };
  imageBlocks: { key: string; value: ImageBlock; indexes: { byPage: string } };
  assets: { key: string; value: Asset; indexes: { bySha: string } };
  pdfText: { key: [string, number]; value: PdfText; indexes: { byAsset: string } };
  decks: { key: string; value: Deck; indexes: { byNote: string } };
  cards: { key: string; value: Card; indexes: { byDeck: string; byNote: string } };
  searchIndex: { key: string; value: SearchEntry; indexes: { byNote: string } };
  thumbnails: { key: string; value: { pageId: string; blob: Blob; updatedAt: number } };
}

type EntityStoreName = "notebooks" | "notes" | "pages" | "strokes" | "textBlocks" | "imageBlocks" | "decks" | "cards";

const ENTITY_STORE: Record<EntityKind, EntityStoreName> = {
  notebook: "notebooks",
  note: "notes",
  page: "pages",
  stroke: "strokes",
  textBlock: "textBlocks",
  imageBlock: "imageBlocks",
  deck: "decks",
  card: "cards",
};

type UpgradeTx = IDBPTransaction<NotesDB, StoreNames<NotesDB>[], "versionchange">;

/** Ordered migrations. Add `2: (db, tx) => ...` when the schema changes; never edit `1`. */
const MIGRATIONS: Record<number, (db: IDBPDatabase<NotesDB>, tx: UpgradeTx) => void> = {
  1: (db) => {
    db.createObjectStore("meta", { keyPath: "key" });
    const ops = db.createObjectStore("ops", { keyPath: "opId" });
    ops.createIndex("byDeviceSeq", ["device", "seq"], { unique: true });
    ops.createIndex("byEntity", "entityId");
    ops.createIndex("byTs", "ts");
    db.createObjectStore("notebooks", { keyPath: "id" }).createIndex("byUpdated", "updatedAt");
    const notes = db.createObjectStore("notes", { keyPath: "id" });
    notes.createIndex("byNotebook", "notebookId");
    notes.createIndex("byUpdated", "updatedAt");
    notes.createIndex("byTag", "tags", { multiEntry: true });
    db.createObjectStore("pages", { keyPath: "id" }).createIndex("byNote", "noteId");
    db.createObjectStore("strokes", { keyPath: "id" }).createIndex("byPage", "pageId");
    db.createObjectStore("textBlocks", { keyPath: "id" }).createIndex("byPage", "pageId");
    db.createObjectStore("imageBlocks", { keyPath: "id" }).createIndex("byPage", "pageId");
    db.createObjectStore("assets", { keyPath: "id" }).createIndex("bySha", "sha256");
    db.createObjectStore("pdfText", { keyPath: ["assetId", "pageNumber"] }).createIndex("byAsset", "assetId");
    db.createObjectStore("decks", { keyPath: "id" }).createIndex("byNote", "noteId");
    const cards = db.createObjectStore("cards", { keyPath: "id" });
    cards.createIndex("byDeck", "deckId");
    cards.createIndex("byNote", "source.noteId");
    db.createObjectStore("searchIndex", { keyPath: "key" }).createIndex("byNote", "noteId");
    db.createObjectStore("thumbnails", { keyPath: "pageId" });
  },
};

export type Listener = (ops: Op[]) => void;

export interface CommitSummary {
  applied: number;
  skipped: number;
  forked: number;
  results: ApplyResult<Versioned>[];
}

export class Store {
  private listeners = new Set<Listener>();
  private seq: number;

  private constructor(
    readonly db: IDBPDatabase<NotesDB>,
    readonly device: string,
    seq: number,
  ) {
    this.seq = seq;
  }

  static async open(name = "lecturecards"): Promise<Store> {
    const db = await openDB<NotesDB>(name, SCHEMA_VERSION, {
      upgrade(db, oldVersion, _newVersion, tx) {
        for (let v = oldVersion + 1; v <= SCHEMA_VERSION; v += 1) MIGRATIONS[v]?.(db, tx as UpgradeTx);
      },
    });
    const meta = await db.getAll("meta");
    const get = (key: string) => meta.find((m) => m.key === key)?.value;
    let device = get("device") as string | undefined;
    if (!device) {
      device = newId();
      await db.put("meta", { key: "device", value: device });
      await db.put("meta", { key: "installedAt", value: Date.now() });
    }
    if (get("schemaVersion") !== SCHEMA_VERSION) await db.put("meta", { key: "schemaVersion", value: SCHEMA_VERSION });
    const seq = (get("seq") as number | undefined) ?? 0;
    return new Store(db, device, seq);
  }

  close() {
    this.db.close();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Wake listeners after out-of-log writes (assets, PDF text, search entries). */
  notify() {
    for (const l of this.listeners) l([]);
  }

  private clock(): Clock {
    return { device: this.device, next: () => (this.seq += 1), now: () => Date.now() };
  }

  // ----- op builders -------------------------------------------------------

  create<K extends EntityKind>(entity: K, doc: Omit<EntityOf<K>, "id" | "version" | "createdAt" | "updatedAt"> & { id?: string }): Op {
    const id = doc.id ?? newId();
    const now = Date.now();
    const { id: _ignored, ...rest } = doc;
    void _ignored;
    ENTITY_SCHEMAS[entity].parse({ ...rest, id, createdAt: now, updatedAt: now, version: { device: this.device, seq: 0 } });
    return makeOp(this.clock(), entity, id, "create", { ...rest, createdAt: now }, null);
  }

  update<K extends EntityKind>(entity: K, current: EntityOf<K>, patch: Partial<EntityOf<K>>): Op {
    return makeOp(this.clock(), entity, current.id, "update", patch as Record<string, unknown>, current.version);
  }

  delete<K extends EntityKind>(entity: K, current: EntityOf<K>): Op {
    return makeOp(this.clock(), entity, current.id, "delete", {}, current.version);
  }

  restore<K extends EntityKind>(entity: K, current: EntityOf<K>): Op {
    return makeOp(this.clock(), entity, current.id, "restore", {}, current.version);
  }

  // ----- commit ------------------------------------------------------------

  /** Write ops and materialize them atomically, then notify listeners. */
  async commit(ops: Op[]): Promise<CommitSummary> {
    const summary = await this.writeOps(ops, false);
    if (summary.applied > 0 || summary.forked > 0) for (const l of this.listeners) l(ops);
    return summary;
  }

  /** Replay ops from another device or an export file. Idempotent. */
  async importOps(ops: Op[]): Promise<CommitSummary> {
    const summary = await this.writeOps(sortOps(ops), true);
    if (summary.applied > 0 || summary.forked > 0) for (const l of this.listeners) l(ops);
    return summary;
  }

  private async writeOps(ops: Op[], foreign: boolean): Promise<CommitSummary> {
    const tx = this.db.transaction(
      ["meta", "ops", "notebooks", "notes", "pages", "strokes", "textBlocks", "imageBlocks", "decks", "cards", "searchIndex"],
      "readwrite",
    );
    const results: ApplyResult<Versioned>[] = [];
    let applied = 0;
    let skipped = 0;
    let forked = 0;
    for (const op of ops) {
      if (foreign && (await tx.objectStore("ops").get(op.opId))) {
        skipped += 1;
        results.push({ action: "skipped", reason: "already-applied" });
        continue;
      }
      await tx.objectStore("ops").put(op);
      const storeName = ENTITY_STORE[op.entity];
      const store = tx.objectStore(storeName);
      const current = ((await store.get(op.entityId)) as Versioned | undefined) ?? null;
      const result = applyOp(current, op);
      results.push(result);
      if (result.action === "skipped") {
        skipped += 1;
        continue;
      }
      if (result.action === "forked") {
        forked += 1;
        await store.put(result.fork as never);
        await this.indexEntity(tx, op.entity, result.fork);
        continue;
      }
      applied += 1;
      await store.put(result.doc as never);
      await this.indexEntity(tx, op.entity, result.doc);
    }
    await tx.objectStore("meta").put({ key: "seq", value: this.seq });
    await tx.done;
    return { applied, skipped, forked, results };
  }

  /** Keep the search index in step with note titles/tags and text blocks. */
  private async indexEntity(tx: IDBPTransaction<NotesDB, StoreNames<NotesDB>[], "readwrite">, entity: EntityKind, doc: Versioned) {
    const index = tx.objectStore("searchIndex");
    if (entity === "note") {
      const note = doc as Note;
      await index.delete(`${note.id}::title`);
      await index.delete(`${note.id}::tags`);
      if (!note.deletedAt) {
        await index.put({ key: `${note.id}::title`, noteId: note.id, pageId: "", entityId: note.id, kind: "title", text: note.title });
        if (note.tags.length > 0) await index.put({ key: `${note.id}::tags`, noteId: note.id, pageId: "", entityId: note.id, kind: "tag", text: note.tags.join(" ") });
      }
    } else if (entity === "textBlock") {
      const block = doc as TextBlock;
      const page = (await tx.objectStore("pages").get(block.pageId)) as Page | undefined;
      const noteId = page?.noteId ?? "";
      const key = `${noteId}:${block.pageId}:${block.id}`;
      if (block.deletedAt || !block.text.trim()) await index.delete(key);
      else await index.put({ key, noteId, pageId: block.pageId, entityId: block.id, kind: "text", text: block.text });
    }
  }

  // ----- reads -------------------------------------------------------------

  async get<K extends EntityKind>(entity: K, id: string): Promise<EntityOf<K> | undefined> {
    const doc = (await this.db.get(ENTITY_STORE[entity], id)) as EntityOf<K> | undefined;
    return doc && !doc.deletedAt ? doc : undefined;
  }

  async listNotebooks(): Promise<Notebook[]> {
    return (await this.db.getAll("notebooks")).filter(live).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async listNotes(notebookId?: string): Promise<Note[]> {
    const all = notebookId ? await this.db.getAllFromIndex("notes", "byNotebook", notebookId) : await this.db.getAll("notes");
    return all.filter(live).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async listNotesByTag(tag: string): Promise<Note[]> {
    return (await this.db.getAllFromIndex("notes", "byTag", tag)).filter(live);
  }

  async listPages(noteId: string): Promise<Page[]> {
    const note = await this.get("note", noteId);
    const pages = (await this.db.getAllFromIndex("pages", "byNote", noteId)).filter(live);
    if (!note) return pages;
    const order = new Map(note.pageIds.map((id, i) => [id, i]));
    return pages.sort((a, b) => (order.get(a.id) ?? 1e9) - (order.get(b.id) ?? 1e9));
  }

  async listStrokes(pageId: string): Promise<Stroke[]> {
    return (await this.db.getAllFromIndex("strokes", "byPage", pageId)).filter(live);
  }

  async listTextBlocks(pageId: string): Promise<TextBlock[]> {
    return (await this.db.getAllFromIndex("textBlocks", "byPage", pageId)).filter(live);
  }

  async listImageBlocks(pageId: string): Promise<ImageBlock[]> {
    return (await this.db.getAllFromIndex("imageBlocks", "byPage", pageId)).filter(live);
  }

  async listDecks(noteId?: string): Promise<Deck[]> {
    const all = noteId ? await this.db.getAllFromIndex("decks", "byNote", noteId) : await this.db.getAll("decks");
    return all.filter(live).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async listCards(deckId: string): Promise<Card[]> {
    return (await this.db.getAllFromIndex("cards", "byDeck", deckId)).filter(live);
  }

  async listCardsForNote(noteId: string): Promise<Card[]> {
    return (await this.db.getAllFromIndex("cards", "byNote", noteId)).filter(live);
  }

  async searchEntries(): Promise<SearchEntry[]> {
    return this.db.getAll("searchIndex");
  }

  async putSearchEntry(entry: SearchEntry): Promise<void> {
    await this.db.put("searchIndex", entry);
  }

  async exportOps(): Promise<Op[]> {
    return sortOps(await this.db.getAll("ops"));
  }

  // ----- assets (content-addressed, not in the op log) ----------------------

  async putAsset(blob: Blob, name?: string): Promise<Asset> {
    const sha256 = await sha256Hex(blob);
    const existing = await this.db.getFromIndex("assets", "bySha", sha256);
    if (existing) return existing;
    const asset: Asset = { id: newId(), sha256, mime: blob.type, size: blob.size, blob, name };
    await this.db.put("assets", asset);
    return asset;
  }

  async getAsset(id: string): Promise<Asset | undefined> {
    return this.db.get("assets", id);
  }

  async putPdfText(entry: PdfText): Promise<void> {
    await this.db.put("pdfText", entry);
  }

  async getPdfText(assetId: string, pageNumber: number): Promise<PdfText | undefined> {
    return this.db.get("pdfText", [assetId, pageNumber]);
  }

  async listPdfText(assetId: string): Promise<PdfText[]> {
    return this.db.getAllFromIndex("pdfText", "byAsset", assetId);
  }

  async putThumbnail(pageId: string, blob: Blob): Promise<void> {
    await this.db.put("thumbnails", { pageId, blob, updatedAt: Date.now() });
  }

  async getThumbnail(pageId: string): Promise<Blob | undefined> {
    return (await this.db.get("thumbnails", pageId))?.blob;
  }
}

function live<T extends { deletedAt?: number }>(doc: T): boolean {
  return !doc.deletedAt;
}

async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
