import { describe, expect, it } from "vitest";
import { extractPdfText } from "@/lib/pdf";
import { blankPdf, brokenPdf, pdfWithText } from "./fixtures";

describe("PDF text extraction", () => {
  it("extracts text from a text-based PDF", async () => {
    const result = await extractPdfText(pdfWithText());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pageCount).toBe(2);
    expect(result.text).toContain("Photosynthesis");
    expect(result.text).toContain("RuBisCO");
  });

  it("reports a PDF with no extractable text as empty", async () => {
    const result = await extractPdfText(blankPdf());
    expect(result).toMatchObject({ ok: false, reason: "empty" });
  });

  it("reports a damaged file as unreadable or empty, never as success", async () => {
    const result = await extractPdfText(brokenPdf());
    expect(result.ok).toBe(false);
  });
});
