import { describe, expect, it } from "vitest";
import { MAX_UPLOAD_BYTES, checkUpload, hasPdfMagic } from "@/lib/upload";
import { blankPdf, pdfWithText } from "./fixtures";

describe("upload validation", () => {
  it("accepts a real PDF by its bytes", () => {
    expect(checkUpload(pdfWithText())).toEqual({ ok: true, kind: "pdf" });
    expect(checkUpload(blankPdf())).toEqual({ ok: true, kind: "pdf" });
  });

  it("rejects files that are not PDFs even if they claim to be", () => {
    const docx = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00]); // zip header
    expect(checkUpload(docx)).toEqual({ ok: false, reason: "unsupported" });
    const text = new Uint8Array(Buffer.from("Photosynthesis notes.pdf is just text", "utf8"));
    expect(checkUpload(text)).toEqual({ ok: false, reason: "unsupported" });
  });

  it("rejects empty files", () => {
    expect(checkUpload(new Uint8Array(0))).toEqual({ ok: false, reason: "empty" });
  });

  it("rejects files over the size limit", () => {
    const big = new Uint8Array(MAX_UPLOAD_BYTES + 1);
    big.set([0x25, 0x50, 0x44, 0x46, 0x2d]);
    expect(checkUpload(big)).toEqual({ ok: false, reason: "too-large" });
  });

  it("finds the PDF header within the first kilobyte only", () => {
    const junk = new Uint8Array(2000);
    junk.set([0x25, 0x50, 0x44, 0x46, 0x2d], 500);
    expect(hasPdfMagic(junk)).toBe(true);
    const late = new Uint8Array(2000);
    late.set([0x25, 0x50, 0x44, 0x46, 0x2d], 1500);
    expect(hasPdfMagic(late)).toBe(false);
  });
});
