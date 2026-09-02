import { z } from "zod";
import { FlashcardSchema } from "@/lib/flashcards/schema";
import { GenerationError, generateFromText, getProvider } from "@/lib/flashcards/service";
import { extractPdfText } from "@/lib/pdf";
import { GENERATE_RATE_LIMIT, RateLimiter, clientKeyFrom } from "@/lib/rateLimit";
import { MAX_SOURCE_CHARS, TARGET_CARD_COUNT } from "@/lib/text";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_LABEL, checkUpload } from "@/lib/upload";

/**
 * POST /api/generate
 *   multipart/form-data with either:
 *     - file:  a PDF (checked by bytes and size on the server), or
 *     - text:  pasted lecture text
 *   optional:
 *     - count: 1..10 (defaults to 10)
 *     - avoid: JSON array of existing cards, so "regenerate" gives new ones
 *
 * GET /api/generate
 *   returns which provider is active and whether it sends text externally,
 *   so the page can show an honest privacy note before the student uploads.
 *
 * Uploaded bytes live only in memory for the duration of the request.
 */

export const runtime = "nodejs";
export const maxDuration = 60;

const limiter = new RateLimiter(GENERATE_RATE_LIMIT);

const AvoidSchema = z.array(FlashcardSchema).max(50);

type ErrorBody = { error: { code: string; message: string } };

function fail(status: number, code: string, message: string, headers?: HeadersInit): Response {
  const body: ErrorBody = { error: { code, message } };
  return Response.json(body, { status, headers });
}

function log(event: string, fields: Record<string, unknown>) {
  // Diagnostic only. Never includes lecture text or file contents.
  console.info(JSON.stringify({ at: new Date().toISOString(), event, ...fields }));
}

export async function GET() {
  try {
    const provider = getProvider();
    return Response.json({
      provider: provider.name,
      sendsTextExternally: provider.sendsTextExternally,
      limits: { maxUploadBytes: MAX_UPLOAD_BYTES, maxSourceChars: MAX_SOURCE_CHARS, cards: TARGET_CARD_COUNT },
    });
  } catch (error) {
    if (error instanceof GenerationError) return fail(500, error.code, error.userMessage);
    return fail(500, "unknown", "Something went wrong on the server.");
  }
}

export async function POST(request: Request): Promise<Response> {
  const started = Date.now();
  const key = clientKeyFrom(request.headers);
  const limit = limiter.check(key);
  if (!limit.allowed) {
    const seconds = Math.ceil(limit.retryAfterMs / 1000);
    log("rate-limited", { key, retryAfterSeconds: seconds });
    return fail(
      429,
      "rate-limited",
      `You have made a lot of requests in a short time. Please wait about ${Math.max(1, Math.ceil(seconds / 60))} minute(s) and try again.`,
      { "Retry-After": String(seconds) },
    );
  }

  // Reject oversized bodies before reading them into memory.
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_UPLOAD_BYTES + 64 * 1024) {
    return fail(413, "too-large", `That file is too big. The limit is ${MAX_UPLOAD_LABEL}.`);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail(400, "bad-request", "The upload could not be read. Please try again.");
  }

  const file = form.get("file");
  const pastedText = form.get("text");
  const countField = form.get("count");
  const avoidField = form.get("avoid");

  let count: number | undefined;
  if (typeof countField === "string" && countField.trim() !== "") {
    const parsed = Number(countField);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > TARGET_CARD_COUNT) {
      return fail(400, "bad-request", `Card count must be between 1 and ${TARGET_CARD_COUNT}.`);
    }
    count = parsed;
  }

  let avoid: z.infer<typeof AvoidSchema> = [];
  if (typeof avoidField === "string" && avoidField.trim() !== "") {
    try {
      avoid = AvoidSchema.parse(JSON.parse(avoidField));
    } catch {
      return fail(400, "bad-request", "The existing cards could not be read. Please start over.");
    }
  }

  let sourceText: string;
  let sourceKind: "pdf" | "text";

  if (file instanceof File) {
    sourceKind = "pdf";
    if (file.size > MAX_UPLOAD_BYTES) {
      return fail(413, "too-large", `That file is too big. The limit is ${MAX_UPLOAD_LABEL}.`);
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const check = checkUpload(bytes);
    if (!check.ok) {
      log("upload-rejected", { key, reason: check.reason, size: bytes.length });
      if (check.reason === "too-large") {
        return fail(413, "too-large", `That file is too big. The limit is ${MAX_UPLOAD_LABEL}.`);
      }
      if (check.reason === "empty") {
        return fail(400, "empty-file", "That file is empty. Please choose a PDF with lecture text in it.");
      }
      return fail(
        415,
        "unsupported-type",
        "Only PDF files are supported right now. If your notes are in another format, paste the text instead.",
      );
    }

    const extracted = await extractPdfText(bytes);
    if (!extracted.ok) {
      log("pdf-failed", { key, reason: extracted.reason, pages: extracted.pageCount ?? null, size: bytes.length });
      if (extracted.reason === "empty") {
        return fail(
          422,
          "pdf-no-text",
          "No readable text was found in that PDF. It may be a scanned image. Please paste the text, or upload a PDF where you can select the text.",
        );
      }
      return fail(
        422,
        "pdf-unreadable",
        "That PDF could not be opened. It may be damaged or password-protected. Please try another file or paste the text.",
      );
    }
    sourceText = extracted.text;
    log("pdf-extracted", { key, pages: extracted.pageCount, chars: sourceText.length });
  } else if (typeof pastedText === "string") {
    sourceKind = "text";
    sourceText = pastedText;
  } else {
    return fail(400, "bad-request", "Please upload a PDF or paste some lecture text.");
  }

  try {
    const result = await generateFromText({ text: sourceText, count, avoid });
    log("generated", {
      key,
      source: sourceKind,
      provider: result.provider,
      chars: sourceText.length,
      cards: result.cards.length,
      ms: Date.now() - started,
    });
    return Response.json(result);
  } catch (error) {
    if (error instanceof GenerationError) {
      log("generation-failed", { key, source: sourceKind, code: error.code, detail: error.detail ?? null, ms: Date.now() - started });
      const status =
        error.code === "too-short" || error.code === "no-cards" ? 422 :
        error.code === "timeout" ? 504 :
        error.code === "misconfigured" ? 500 : 502;
      return fail(status, error.code, error.userMessage);
    }
    log("generation-crashed", { key, source: sourceKind, message: error instanceof Error ? error.message : String(error) });
    return fail(500, "unknown", "Something went wrong while making the cards. Please try again.");
  }
}
