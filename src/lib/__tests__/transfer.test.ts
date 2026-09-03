import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { packPoints } from "@/lib/ink/geometry";
import { Store } from "@/lib/store/db";
import { exportAll, importAll } from "@/lib/store/transfer";

let n = 0;
const fresh = () => Store.open(`transfer-${Date.now()}-${(n += 1)}`);

describe("export / import file", () => {
  it("round-trips notes, strokes, assets and PDF text into a fresh store", async () => {
    const a = await fresh();
    const nb = a.create("notebook", { title: "Biology" });
    const note = a.create("note", { notebookId: nb.entityId, title: "Lecture 3", tags: ["bio"], links: [], pageIds: [] });
    const page = a.create("page", { noteId: note.entityId, width: 595, height: 842, background: "lined" });
    await a.commit([nb, note, page]);
    const noteDoc = (await a.get("note", note.entityId))!;
    await a.commit([a.update("note", noteDoc, { pageIds: [page.entityId] })]);
    const points = packPoints([{ x: 1, y: 2, p: 0.5, t: 0 }, { x: 5, y: 6, p: 0.7, t: 9 }]);
    await a.commit([a.create("stroke", { pageId: page.entityId, tool: "pen", color: "#000", size: 2, points, count: 2, bbox: [1, 2, 5, 6] })]);
    const asset = await a.putAsset(new Blob(["%PDF-1.4 fake"], { type: "application/pdf" }), "x.pdf");
    await a.putPdfText({ assetId: asset.id, pageNumber: 1, text: "Chlorophyll absorbs light", items: [] });

    const file = await exportAll(a);
    expect(file.ops.length).toBe(5);
    expect(file.assets).toHaveLength(1);
    // JSON-safe: no ArrayBuffers left in the payload.
    const json = JSON.stringify(file);
    expect(json).toContain("$bytes");

    const b = await fresh();
    const summary = await importAll(b, JSON.parse(json));
    expect(summary.applied).toBe(5);
    expect(summary.assets).toBe(1);
    expect((await b.listNotes()).map((x) => x.title)).toEqual(["Lecture 3"]);
    const strokes = await b.listStrokes(page.entityId);
    expect(strokes).toHaveLength(1);
    expect(Array.from(new Float32Array(strokes[0].points))).toEqual(Array.from(new Float32Array(points)));
    expect((await b.getAsset(asset.id))?.size).toBe(13);
    expect((await b.getPdfText(asset.id, 1))?.text).toBe("Chlorophyll absorbs light");

    // Importing the same file again changes nothing.
    const again = await importAll(b, JSON.parse(json));
    expect(again.applied).toBe(0);
    expect(again.skipped).toBe(5);
    a.close();
    b.close();
  });

  it("rejects files that are not exports or come from a newer schema", async () => {
    const s = await fresh();
    await expect(importAll(s, { hello: "world" })).rejects.toThrow(/not a Lecture Cards/);
    const file = await exportAll(s);
    await expect(importAll(s, { ...file, schemaVersion: 99 })).rejects.toThrow(/newer version/);
    s.close();
  });
});
