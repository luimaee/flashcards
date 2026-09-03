import type { PDFDocumentProxy } from "pdfjs-dist";
import { buildPageText, type PositionedItem, type RawTextItem } from "./geometry";

/**
 * Browser-side PDF handling with PDF.js. Loaded lazily so the library only
 * ships to pages that import PDFs. The server keeps using unpdf for the
 * upload-to-cards flow.
 */

let libPromise: Promise<typeof import("pdfjs-dist")> | null = null;

async function lib() {
  if (!libPromise) {
    libPromise = import("pdfjs-dist").then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
      return pdfjs;
    });
  }
  return libPromise;
}

export async function loadPdf(bytes: ArrayBuffer): Promise<PDFDocumentProxy> {
  const pdfjs = await lib();
  return pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise;
}

/** Small cache of open documents keyed by asset id, so page renders share one parse. */
const openDocs = new Map<string, Promise<PDFDocumentProxy>>();
const MAX_OPEN_DOCS = 4;

export function openPdfAsset(assetId: string, load: () => Promise<ArrayBuffer>): Promise<PDFDocumentProxy> {
  let doc = openDocs.get(assetId);
  if (!doc) {
    doc = load().then(loadPdf);
    openDocs.set(assetId, doc);
    if (openDocs.size > MAX_OPEN_DOCS) {
      const oldest = openDocs.keys().next().value;
      if (oldest && oldest !== assetId) {
        openDocs
          .get(oldest)
          ?.then((d) => (d as unknown as { destroy?: () => Promise<void> }).destroy?.())
          .catch(() => {});
        openDocs.delete(oldest);
      }
    }
  }
  return doc;
}

export async function pdfPageSize(doc: PDFDocumentProxy, pageNumber: number): Promise<{ width: number; height: number }> {
  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1 });
  return { width: viewport.width, height: viewport.height };
}

/** Render one page into a canvas at `scale` CSS pixels per point times `dpr`. */
export async function renderPdfPage(doc: PDFDocumentProxy, pageNumber: number, canvas: HTMLCanvasElement, scale: number, dpr: number): Promise<void> {
  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale: scale * dpr });
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  await page.render({ canvasContext: ctx, canvas, viewport }).promise;
}

export async function extractPdfPageText(doc: PDFDocumentProxy, pageNumber: number): Promise<{ text: string; items: PositionedItem[] }> {
  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const items: RawTextItem[] = [];
  for (const it of content.items) {
    if ("str" in it) items.push({ str: it.str, transform: it.transform, width: it.width, height: it.height, hasEOL: it.hasEOL });
  }
  return buildPageText(items, viewport.height);
}
