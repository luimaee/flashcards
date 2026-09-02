import { describe, expect, it } from "vitest";
import { POST } from "@/app/api/generate/route";
import { FlashcardSchema } from "@/lib/flashcards/schema";
import { LECTURE_TEXT, SHORT_TEXT, blankPdf, brokenPdf, pdfWithText } from "./fixtures";

function post(form: FormData, headers: Record<string, string> = {}) {
  return POST(new Request("http://localhost/api/generate", { method: "POST", body: form, headers }));
}

async function body(response: Response) {
  return response.json() as Promise<{
    cards?: unknown[];
    notice?: string;
    error?: { code: string; message: string };
  }>;
}

describe("POST /api/generate", () => {
  it("makes 10 valid cards from pasted text in mock mode", async () => {
    const form = new FormData();
    form.set("text", LECTURE_TEXT);
    const response = await post(form);
    expect(response.status).toBe(200);
    const data = await body(response);
    expect(data.cards).toHaveLength(10);
    for (const card of data.cards ?? []) expect(FlashcardSchema.safeParse(card).success).toBe(true);
  });

  it("makes cards from a text-based PDF upload", async () => {
    const form = new FormData();
    form.set("file", new File([pdfWithText()], "lecture.pdf", { type: "application/pdf" }));
    const response = await post(form);
    expect(response.status).toBe(200);
    const data = await body(response);
    expect((data.cards ?? []).length).toBeGreaterThan(0);
  });

  it("rejects pasted text that is too short", async () => {
    const form = new FormData();
    form.set("text", SHORT_TEXT);
    const response = await post(form);
    expect(response.status).toBe(422);
    const data = await body(response);
    expect(data.error?.code).toBe("too-short");
  });

  it("rejects a non-PDF file even when it is named .pdf and claims the PDF type", async () => {
    const form = new FormData();
    const fake = new File(["PK\u0003\u0004 this is a docx really"], "notes.pdf", { type: "application/pdf" });
    form.set("file", fake);
    const response = await post(form);
    expect(response.status).toBe(415);
    const data = await body(response);
    expect(data.error?.code).toBe("unsupported-type");
    expect(data.error?.message).toMatch(/paste the text/i);
  });

  it("explains when a PDF has no readable text", async () => {
    const form = new FormData();
    form.set("file", new File([blankPdf()], "scan.pdf", { type: "application/pdf" }));
    const response = await post(form);
    expect(response.status).toBe(422);
    const data = await body(response);
    expect(data.error?.code).toBe("pdf-no-text");
    expect(data.error?.message).toMatch(/scanned|paste/i);
  });

  it("explains when a PDF cannot be opened", async () => {
    const form = new FormData();
    form.set("file", new File([brokenPdf()], "broken.pdf", { type: "application/pdf" }));
    const response = await post(form);
    expect(response.status).toBe(422);
    const data = await body(response);
    expect(["pdf-unreadable", "pdf-no-text"]).toContain(data.error?.code);
  });

  it("rejects an empty file", async () => {
    const form = new FormData();
    form.set("file", new File([], "empty.pdf", { type: "application/pdf" }));
    const response = await post(form);
    expect(response.status).toBe(400);
    expect((await body(response)).error?.code).toBe("empty-file");
  });

  it("rejects an oversized declared body before reading it", async () => {
    const form = new FormData();
    form.set("text", LECTURE_TEXT);
    const response = await post(form, { "content-length": String(50 * 1024 * 1024) });
    expect(response.status).toBe(413);
  });

  it("rejects a request with neither file nor text", async () => {
    const response = await post(new FormData());
    expect(response.status).toBe(400);
  });

  it("never includes a stack trace in an error body", async () => {
    const form = new FormData();
    form.set("file", new File([brokenPdf()], "broken.pdf", { type: "application/pdf" }));
    const text = await (await post(form)).text();
    expect(text).not.toMatch(/at .*\.(ts|js):\d+/);
    expect(text).not.toMatch(/node_modules/);
  });
});
