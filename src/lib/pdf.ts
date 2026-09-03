import { extractText, getDocumentProxy } from "unpdf";
import { joinHyphenatedLineBreaks, normaliseText } from "./text";

/**
 * PDF text extraction (in memory, nothing written to disk).
 *
 * Uses unpdf, a maintained wrapper around Mozilla's PDF.js. Only text that is
 * actually stored in the PDF is returned; scanned or image-only PDFs come back
 * empty and the caller must tell the student to paste the text instead.
 *
 * A scanned paper often carries one text page (a cover sheet added by a
 * repository) in front of image-only pages. That is treated as "no text" too,
 * otherwise the student would get cards about the cover sheet.
 */

export type PdfExtractResult =
  | { ok: true; text: string; pageCount: number }
  | { ok: false; reason: "unreadable" | "empty"; pageCount?: number };

/** A page with fewer characters than this is treated as image-only. */
const MIN_CHARS_PER_TEXT_PAGE = 80;

export async function extractPdfText(bytes: Uint8Array): Promise<PdfExtractResult> {
  let pageCount = 0;
  let pages: string[] = [];
  try {
    const pdf = await getDocumentProxy(bytes);
    pageCount = pdf.numPages;
    const result = await extractText(pdf, { mergePages: false });
    pages = result.text;
  } catch {
    return { ok: false, reason: "unreadable" };
  }

  const textPages = pages.filter((p) => p.replace(/\s+/g, "").length >= MIN_CHARS_PER_TEXT_PAGE).length;
  const raw = pages.join("\n");
  const text = normaliseText(joinHyphenatedLineBreaks(raw));

  if (text.replace(/\s+/g, "").length < 20) {
    return { ok: false, reason: "empty", pageCount };
  }
  // Mostly image-only: fewer than half the pages carry real text.
  if (pageCount >= 2 && textPages / pageCount < 0.5) {
    return { ok: false, reason: "empty", pageCount };
  }
  return { ok: true, text, pageCount };
}
