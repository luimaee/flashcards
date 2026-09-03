import { SCHEMA_VERSION, OpSchema, type Op, type PdfText } from "./schema";
import type { Store } from "./db";
import { z } from "zod";

/**
 * Export / import of everything on this device as one JSON file.
 *
 * The file is the op log plus the content-addressed assets and the extracted
 * PDF text. Importing replays the ops through the same reconciliation rules
 * as sync, so it is idempotent and never resurrects a deletion. This is the
 * v1 way to move notes between devices or keep a backup.
 */

export const TRANSFER_FORMAT = "lecturecards.notes";

const AssetEntrySchema = z.object({
  id: z.string(),
  sha256: z.string(),
  mime: z.string(),
  size: z.number(),
  name: z.string().optional(),
  base64: z.string(),
});

const PdfTextEntrySchema = z.object({
  assetId: z.string(),
  pageNumber: z.number(),
  text: z.string(),
  items: z.array(z.object({ str: z.string(), x: z.number(), y: z.number(), w: z.number(), h: z.number(), start: z.number() })),
});

export const TransferFileSchema = z.object({
  format: z.literal(TRANSFER_FORMAT),
  schemaVersion: z.number().int(),
  exportedAt: z.number(),
  device: z.string(),
  ops: z.array(OpSchema.extend({ patch: z.record(z.string(), z.unknown()) })),
  assets: z.array(AssetEntrySchema),
  pdfText: z.array(PdfTextEntrySchema),
});
export type TransferFile = z.infer<typeof TransferFileSchema>;

/** Stroke points are ArrayBuffers in ops; JSON needs them as base64. */
function encodePatch(patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    out[k] = v instanceof ArrayBuffer ? { $bytes: bytesToBase64(new Uint8Array(v)) } : v;
  }
  return out;
}

function decodePatch(patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v && typeof v === "object" && "$bytes" in (v as object) && typeof (v as { $bytes: unknown }).$bytes === "string") {
      out[k] = base64ToBytes((v as { $bytes: string }).$bytes).buffer;
    } else {
      out[k] = v;
    }
  }
  return out;
}

export async function exportAll(store: Store): Promise<TransferFile> {
  const ops = (await store.exportOps()).map((op) => ({ ...op, patch: encodePatch(op.patch) }));
  const assetRows = await store.db.getAll("assets");
  const assets = [];
  for (const a of assetRows) {
    assets.push({ id: a.id, sha256: a.sha256, mime: a.mime, size: a.size, name: a.name, base64: bytesToBase64(new Uint8Array(await a.blob.arrayBuffer())) });
  }
  const pdfText: PdfText[] = await store.db.getAll("pdfText");
  return { format: TRANSFER_FORMAT, schemaVersion: SCHEMA_VERSION, exportedAt: Date.now(), device: store.device, ops, assets, pdfText };
}

export interface ImportSummary {
  applied: number;
  skipped: number;
  forked: number;
  assets: number;
}

export async function importAll(store: Store, data: unknown): Promise<ImportSummary> {
  const parsed = TransferFileSchema.safeParse(data);
  if (!parsed.success) throw new Error("That file is not a Lecture Cards notes export.");
  const file = parsed.data;
  if (file.schemaVersion > SCHEMA_VERSION) {
    throw new Error(`That file was made by a newer version of the app (schema ${file.schemaVersion}). Update the app, then import it.`);
  }

  let assetCount = 0;
  for (const a of file.assets) {
    const existing = await store.db.getFromIndex("assets", "bySha", a.sha256);
    if (existing) continue;
    await store.db.put("assets", { id: a.id, sha256: a.sha256, mime: a.mime, size: a.size, name: a.name, blob: new Blob([base64ToBytes(a.base64)], { type: a.mime }) });
    assetCount += 1;
  }
  for (const p of file.pdfText) await store.putPdfText(p);

  const ops: Op[] = file.ops.map((op) => ({ ...op, patch: decodePatch(op.patch) }));
  const summary = await store.importOps(ops);
  // PDF search entries are not in the log; rebuild them from the text we just stored.
  await reindexPdfText(store);
  store.notify();
  return { applied: summary.applied, skipped: summary.skipped, forked: summary.forked, assets: assetCount };
}

async function reindexPdfText(store: Store) {
  const pages = await store.db.getAll("pages");
  for (const page of pages) {
    if (!page.pdf || page.deletedAt) continue;
    const text = await store.getPdfText(page.pdf.assetId, page.pdf.pageNumber);
    if (text?.text.trim()) {
      await store.putSearchEntry({ key: `${page.noteId}:${page.id}:pdf`, noteId: page.noteId, pageId: page.id, entityId: `pdf:${page.pdf.assetId}:${page.pdf.pageNumber}`, kind: "pdf", text: text.text });
    }
  }
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}
