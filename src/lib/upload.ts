/**
 * Server-side upload validation.
 *
 * The browser also checks type and size, but the server never trusts the
 * browser. We check the real bytes (a PDF starts with "%PDF-"), not just the
 * filename or the MIME type the client claims.
 */

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_UPLOAD_LABEL = "10 MB";
export const SUPPORTED_UPLOAD_LABEL = "PDF";

export type UploadCheck =
  | { ok: true; kind: "pdf" }
  | { ok: false; reason: "too-large" | "unsupported" | "empty" };

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-

export function hasPdfMagic(bytes: Uint8Array): boolean {
  // Some writers put junk before the header; PDF spec allows it within 1024 bytes.
  const limit = Math.min(bytes.length - PDF_MAGIC.length, 1024);
  for (let offset = 0; offset <= limit; offset += 1) {
    let match = true;
    for (let i = 0; i < PDF_MAGIC.length; i += 1) {
      if (bytes[offset + i] !== PDF_MAGIC[i]) {
        match = false;
        break;
      }
    }
    if (match) return true;
  }
  return false;
}

export function checkUpload(bytes: Uint8Array): UploadCheck {
  if (bytes.length === 0) return { ok: false, reason: "empty" };
  if (bytes.length > MAX_UPLOAD_BYTES) return { ok: false, reason: "too-large" };
  if (!hasPdfMagic(bytes)) return { ok: false, reason: "unsupported" };
  return { ok: true, kind: "pdf" };
}
