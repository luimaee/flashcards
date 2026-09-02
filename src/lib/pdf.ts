import { extractText, getDocumentProxy } from "unpdf";
import { normaliseText } from "./text";

/**
 * PDF text extraction (in memory, nothing written to disk).
 *
 * Uses unpdf, a maintained wrapper around Mozilla's PDF.js. Only text that is
 * actually stored in the PDF is returned; scanned or image-only PDFs come back
 * empty and the caller must tell the student to paste the text instead.
 */

export type PdfExtractResult =
  | { ok: true; text: string; pageCount: number }
  | { ok: false; reason: "unreadable" | "empty"; pageCount?: number };

export async function extractPdfText(bytes: Uint8Array): Promise<PdfExtractResult> {
  let pageCount = 0;
  let rawText = "";
  try {
    const pdf = await getDocumentProxy(bytes);
    pageCount = pdf.numPages;
    const result = await extractText(pdf, { mergePages: true });
    rawText = result.text;
  } catch {
    return { ok: false, reason: "unreadable" };
  }
  const text = normaliseText(rawText);
  // A page of real text has hundreds of characters; a handful means the PDF
  // is effectively image-only or empty.
  if (text.replace(/\s+/g, "").length < 20) {
    return { ok: false, reason: "empty", pageCount };
  }
  return { ok: true, text, pageCount };
}
