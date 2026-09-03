import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { packPoints } from "@/lib/ink/geometry";
import { Store } from "@/lib/store/db";
import { applyOp, makeOp, type Clock } from "@/lib/store/ops";
import { SCHEMA_VERSION, type Note, type Notebook, type Op } from "@/lib/store/schema";

let counter = 0;
async function freshStore() {
  counter += 1;
  return Store.open(`test-${Date.now()}-${counter}`);
}

async function seedNote(store: Store) {
  const nbOp = store.create("notebook", { title: "Biology" });
  const noteOp = store.create("note", { notebookId: nbOp.entityId, title: "Photosynthesis", tags: ["bio"], links: [], pageIds: [] });
  const pageOp = store.create("page", { noteId: noteOp.entityId, width: 595, height: 842, background: "lined" });
  await store.commit([nbOp, noteOp, pageOp]);
  const note = (await store.get("note", noteOp.entityId))!;
  await store.commit([store.update("note", note, { pageIds: [pageOp.entityId] })]);
  return { notebookId: nbOp.entityId, noteId: noteOp.entityId, pageId: pageOp.entityId };
}

describe("store: open and migrate", () => {
  it("stamps the schema version and a device id on first open", async () => {
    const store = await freshStore();
    const meta = await store.db.getAll("meta");
    expect(meta.find((m) => m.key === "schemaVersion")?.value).toBe(SCHEMA_VERSION);
    expect(store.device).toMatch(/^[0-9A-Z]{26}$/);
    store.close();
  });
});

describe("store: ops and materialized rows", () => {
  let store: Store;
  beforeEach(async () => {
    store = await freshStore();
  });

  it("creates, lists, updates and keeps every op", async () => {
    const { notebookId, noteId, pageId } = await seedNote(store);
    expect((await store.listNotebooks()).map((n) => n.title)).toEqual(["Biology"]);
    const notes = await store.listNotes(notebookId);
    expect(notes).toHaveLength(1);
    expect(notes[0].pageIds).toEqual([pageId]);
    expect((await store.listPages(noteId)).map((p) => p.id)).toEqual([pageId]);
    const ops = await store.exportOps();
    expect(ops).toHaveLength(4);
    expect(ops.map((o) => o.seq)).toEqual([1, 2, 3, 4]);
  });

  it("delete is a tombstone that hides the row but keeps it, and restore brings it back", async () => {
    const { noteId } = await seedNote(store);
    const note = (await store.get("note", noteId))!;
    await store.commit([store.delete("note", note)]);
    expect(await store.get("note", noteId)).toBeUndefined();
    expect(await store.listNotes()).toHaveLength(0);
    const raw = (await store.db.get("notes", noteId)) as Note;
    expect(raw.deletedAt).toBeTypeOf("number");
    await store.commit([store.restore("note", raw)]);
    expect((await store.get("note", noteId))?.title).toBe("Photosynthesis");
  });

  it("stores strokes as packed buffers per page", async () => {
    const { pageId } = await seedNote(store);
    const points = packPoints([
      { x: 1, y: 2, p: 0.5, t: 0 },
      { x: 3, y: 4, p: 0.6, t: 8 },
    ]);
    await store.commit([store.create("stroke", { pageId, tool: "pen", color: "#000", size: 2, points, count: 2, bbox: [1, 2, 3, 4] })]);
    const strokes = await store.listStrokes(pageId);
    expect(strokes).toHaveLength(1);
    expect(new Float32Array(strokes[0].points)).toHaveLength(8);
  });

  it("indexes note titles, tags and text blocks for search", async () => {
    const { pageId, noteId } = await seedNote(store);
    await store.commit([store.create("textBlock", { pageId, x: 10, y: 10, width: 200, text: "Chlorophyll absorbs red light", fontSize: 12 })]);
    const entries = await store.searchEntries();
    expect(entries.map((e) => e.kind).sort()).toEqual(["tag", "text", "title"]);
    expect(entries.find((e) => e.kind === "text")?.noteId).toBe(noteId);
  });

  it("rejects invalid documents before they reach the log", async () => {
    expect(() => store.create("page", { noteId: "n", width: -1, height: 10, background: "lined" })).toThrow();
  });

  it("notifies subscribers once per commit", async () => {
    let calls = 0;
    const off = store.subscribe(() => {
      calls += 1;
    });
    await seedNote(store);
    expect(calls).toBe(2);
    off();
  });

  it("deduplicates assets by content", async () => {
    const a = await store.putAsset(new Blob(["same bytes"], { type: "text/plain" }), "a.txt");
    const b = await store.putAsset(new Blob(["same bytes"], { type: "text/plain" }), "b.txt");
    expect(a.id).toBe(b.id);
  });
});

describe("store: import from another device", () => {
  it("is idempotent and never resurrects a deletion", async () => {
    const here = await freshStore();
    const there = await freshStore();
    const { noteId } = await seedNote(there);
    const theirs = await there.exportOps();

    const first = await here.importOps(theirs);
    expect(first.applied).toBe(4);
    const again = await here.importOps(theirs);
    expect(again.applied).toBe(0);
    expect(again.skipped).toBe(4);

    // They delete; we import; note is gone here too and stays gone on re-import.
    const note = (await there.get("note", noteId))!;
    await there.commit([there.delete("note", note)]);
    await here.importOps(await there.exportOps());
    expect(await here.get("note", noteId)).toBeUndefined();
    await here.importOps(theirs); // replaying only the old create/update ops
    expect(await here.get("note", noteId)).toBeUndefined();
    here.close();
    there.close();
  });

  it("keeps both versions when two devices edited the same note", async () => {
    const here = await freshStore();
    const there = await freshStore();
    const { noteId } = await seedNote(there);
    await here.importOps(await there.exportOps());

    const mine = (await here.get("note", noteId))!;
    await here.commit([here.update("note", mine, { title: "Photosynthesis (mine)" })]);
    const theirs = (await there.get("note", noteId))!;
    await there.commit([there.update("note", theirs, { title: "Photosynthesis (theirs)" })]);

    const summary = await here.importOps(await there.exportOps());
    expect(summary.forked).toBe(1);
    const notes = await here.listNotes();
    expect(notes.map((n) => n.title).sort()).toEqual(["Photosynthesis (mine)", "Photosynthesis (theirs)"]);
    expect(notes.find((n) => n.conflictOf)?.conflictOf).toBe(noteId);
    here.close();
    there.close();
  });
});

describe("applyOp (pure rules)", () => {
  const clock = (device: string): Clock => {
    let seq = 0;
    return { device, next: () => (seq += 1), now: () => 1000 + seq };
  };

  it("update from the same device applies even without a matching base", () => {
    const c = clock("A");
    const create = makeOp(c, "notebook", "nb", "create", { title: "x", createdAt: 1 }, null);
    const created = applyOp<Notebook>(null, create);
    expect(created.action).toBe("created");
    if (created.action !== "created") return;
    const stale = makeOp(c, "notebook", "nb", "update", { title: "y" }, { device: "A", seq: 0 });
    expect(applyOp(created.doc, stale).action).toBe("updated");
  });

  it("an op applied twice is skipped the second time", () => {
    const c = clock("A");
    const create = makeOp(c, "notebook", "nb", "create", { title: "x", createdAt: 1 }, null);
    const first = applyOp<Notebook>(null, create);
    if (first.action !== "created") throw new Error("expected create");
    expect(applyOp(first.doc, create).action).toBe("skipped");
  });

  it("a delete never forks and a later restore is explicit", () => {
    const a = clock("A");
    const b = clock("B");
    const create = makeOp(a, "notebook", "nb", "create", { title: "x", createdAt: 1 }, null);
    const created = applyOp<Notebook>(null, create);
    if (created.action !== "created") throw new Error();
    const del: Op = makeOp(b, "notebook", "nb", "delete", {}, { device: "A", seq: 1 });
    const deleted = applyOp(created.doc, del);
    expect(deleted.action).toBe("deleted");
    if (deleted.action !== "deleted") return;
    expect(deleted.doc.deletedAt).toBeTypeOf("number");
    const restore = makeOp(a, "notebook", "nb", "restore", {}, deleted.doc.version);
    const restored = applyOp(deleted.doc, restore);
    expect(restored.action).toBe("restored");
    if (restored.action === "restored") expect(restored.doc.deletedAt).toBeUndefined();
  });
});
