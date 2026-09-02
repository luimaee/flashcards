import type { Flashcard } from "./flashcards/schema";

/** Browser-side helpers for talking to /api/generate. */

export interface GenerateResponse {
  cards: Flashcard[];
  notice?: string;
  provider: string;
  sendsTextExternally: boolean;
}

export interface ProviderInfo {
  provider: string;
  sendsTextExternally: boolean;
  limits: { maxUploadBytes: number; maxSourceChars: number; cards: number };
}

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export type SourceInput = { kind: "pdf"; file: File } | { kind: "text"; text: string };

export async function requestCards(
  source: SourceInput,
  options: { count?: number; avoid?: Flashcard[]; signal?: AbortSignal } = {},
): Promise<GenerateResponse> {
  const form = new FormData();
  if (source.kind === "pdf") form.set("file", source.file, source.file.name);
  else form.set("text", source.text);
  if (options.count) form.set("count", String(options.count));
  if (options.avoid && options.avoid.length > 0) form.set("avoid", JSON.stringify(options.avoid));

  let response: Response;
  try {
    response = await fetch("/api/generate", { method: "POST", body: form, signal: options.signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ApiError("cancelled", "Cancelled.");
    }
    throw new ApiError("network", "Could not reach the server. Check your connection and try again.");
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    const err = (body as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError(err?.code ?? "unknown", err?.message ?? "Something went wrong. Please try again.");
  }
  return body as GenerateResponse;
}

export async function fetchProviderInfo(): Promise<ProviderInfo | null> {
  try {
    const response = await fetch("/api/generate", { method: "GET" });
    if (!response.ok) return null;
    return (await response.json()) as ProviderInfo;
  } catch {
    return null;
  }
}
