import { extractPdfPageText, loadPdf, pdfPageSize } from "@/lib/pdf/client";
import { checkUpload } from "@/lib/upload";
import type { Store } from "./db";
import type { Note, Page } from "./schema";

/**
 * Bring outside material into notes: a PDF becomes a note with one page per
 * PDF page (the PDF drawn underneath, ink and text on top); an image becomes
 * an image block on an existing page.
 *
 * No size caps here beyond what the browser can hold. Assets are content
 * addressed, so importing the same file twice stores it once.
 */

export interface ImportProgress {
  page: number;
  total: number;
}

export async function importPdfAsNote(
  store: Store,
  file: File,
  notebookId: string,
  onProgress?: (p: ImportProgress) => void,
): Promise<{ noteId: string; pages: number }> {
  const bytes = await file.arrayBuffer();
  const check = checkUpload(new Uint8Array(bytes));
  if (!check.ok) {
    throw new Error(check.reason === "unsupported" ? "That file is not a PDF." : check.reason === "empty" ? "That file is empty." : "That file is too large.");
  }
  const asset = await store.putAsset(new Blob([bytes], { type: "application/pdf" }), file.name);
  const doc = await loadPdf(bytes.slice(0));
  const total = doc.numPages;

  const noteOp = store.create("note", {
    notebookId,
    title: file.name.replace(/\.pdf$/i, ""),
    tags: [],
    links: [],
    pageIds: [],
    sourceAsset: asset.id,
  });
  const pageOps = [];
  for (let n = 1; n <= total; n += 1) {
    const size = await pdfPageSize(doc, n);
    pageOps.push(
      store.create("page", {
        noteId: noteOp.entityId,
        width: Math.round(size.width),
        height: Math.round(size.height),
        background: "plain",
        pdf: { assetId: asset.id, pageNumber: n },
      }),
    );
    onProgress?.({ page: n, total });
  }
  await store.commit([noteOp, ...pageOps]);
  const note = await store.get("note", noteOp.entityId);
  if (note) await store.commit([store.update("note", note, { pageIds: pageOps.map((p) => p.entityId) })]);

  // Text extraction can lag behind the note appearing; it only feeds search and region selection.
  void indexPdfText(store, doc, asset.id, noteOp.entityId, pageOps.map((p) => p.entityId));
  return { noteId: noteOp.entityId, pages: total };
}

async function indexPdfText(store: Store, doc: Awaited<ReturnType<typeof loadPdf>>, assetId: string, noteId: string, pageIds: string[]) {
  for (let n = 1; n <= doc.numPages; n += 1) {
    try {
      const { text, items } = await extractPdfPageText(doc, n);
      await store.putPdfText({ assetId, pageNumber: n, text, items });
      if (text.trim()) {
        await store.putSearchEntry({ key: `${noteId}:${pageIds[n - 1]}:pdf`, noteId, pageId: pageIds[n - 1], entityId: `pdf:${assetId}:${n}`, kind: "pdf", text });
      }
    } catch {
      // A page that fails to extract is simply not searchable.
    }
  }
  store.notify();
}

const MAX_IMAGE_WIDTH_FRACTION = 0.8;

export async function importImageToPage(store: Store, page: Page, file: File, at: { x: number; y: number }): Promise<void> {
  if (!file.type.startsWith("image/")) throw new Error("That file is not an image.");
  const asset = await store.putAsset(file, file.name);
  const natural = await imageSize(file);
  const maxWidth = page.width * MAX_IMAGE_WIDTH_FRACTION;
  const scale = natural.width > maxWidth ? maxWidth / natural.width : 1;
  const width = Math.round(natural.width * scale);
  const height = Math.round(natural.height * scale);
  await store.commit([
    store.create("imageBlock", {
      pageId: page.id,
      x: Math.max(0, Math.min(page.width - width, at.x)),
      y: Math.max(0, Math.min(page.height - height, at.y)),
      width,
      height,
      assetId: asset.id,
    }),
  ]);
}

function imageSize(file: Blob): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That image could not be read."));
    };
    img.src = url;
  });
}

export function noteTitleForFile(note: Note | undefined, file: File): string {
  return note?.title || file.name;
}
