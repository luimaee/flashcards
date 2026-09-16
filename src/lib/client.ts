import type { DeckFile, DeckSummary } from "./decks/store";
import type { Flashcard } from "./flashcards/schema";

/** Browser-side helpers for talking to the local API. */

export interface GenerateResponse {
  cards: Flashcard[];
  notice?: string;
  provider: string;
  sendsTextExternally: boolean;
  /** Present on a fresh generation: the text the cards were made from. */
  sourceText?: string;
  sourceName?: string;
  sourceKind?: "pdf" | "text";
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

async function readJson<T>(response: Response, fallback: string): Promise<T> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) {
    const err = (body as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError(err?.code ?? "unknown", err?.message ?? fallback);
  }
  return body as T;
}

async function call(input: RequestInfo, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw new ApiError("cancelled", "Cancelled.");
    throw new ApiError("network", "Could not reach the app. Is it still running?");
  }
}

export async function requestCards(
  source: SourceInput,
  options: { count?: number; avoid?: Flashcard[]; signal?: AbortSignal } = {},
): Promise<GenerateResponse> {
  const form = new FormData();
  if (source.kind === "pdf") form.set("file", source.file, source.file.name);
  else form.set("text", source.text);
  if (options.count) form.set("count", String(options.count));
  if (options.avoid && options.avoid.length > 0) form.set("avoid", JSON.stringify(options.avoid));
  const response = await call("/api/generate", { method: "POST", body: form, signal: options.signal });
  return readJson<GenerateResponse>(response, "Something went wrong. Please try again.");
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

// ----- local deck library ---------------------------------------------------

export type { DeckFile, DeckSummary };

export async function listDecks(): Promise<{ folder: string; decks: DeckSummary[] }> {
  const response = await call("/api/decks");
  return readJson(response, "Your saved decks could not be listed.");
}

export async function getDeck(id: string): Promise<DeckFile> {
  const response = await call(`/api/decks/${encodeURIComponent(id)}`);
  return (await readJson<{ deck: DeckFile }>(response, "That deck could not be opened.")).deck;
}

export async function createDeck(input: {
  title?: string;
  provider: string;
  source: DeckFile["source"];
  cards: Flashcard[];
}): Promise<{ deck: DeckFile; folder: string }> {
  const response = await call("/api/decks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
  return readJson(response, "The deck could not be saved.");
}

export async function updateDeck(id: string, patch: { title?: string; cards?: Flashcard[] }): Promise<DeckFile> {
  const response = await call(`/api/decks/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  return (await readJson<{ deck: DeckFile }>(response, "The deck could not be saved.")).deck;
}

export async function deleteDeck(id: string): Promise<void> {
  const response = await call(`/api/decks/${encodeURIComponent(id)}`, { method: "DELETE" });
  await readJson(response, "The deck could not be deleted.");
}
