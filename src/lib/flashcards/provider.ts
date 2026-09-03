import type { RawFlashcard } from "./schema";

/**
 * AI provider boundary.
 *
 * Everything that talks to an AI model lives behind this interface. The rest
 * of the app only ever calls `generateFlashcards(text, options)` and never
 * touches API keys, prompts, or vendor SDKs.
 *
 * - `mock` provider: no network, no key. Builds cards from the source text
 *   itself. Used automatically when no real provider is configured.
 * - Real providers are selected with the AI_PROVIDER environment variable and
 *   must read their own key from environment variables only.
 */

export interface GenerateOptions {
  /** Target number of cards. Provider may return fewer if the source is short. */
  count: number;
  /** Cards the student already has; providers should not repeat them. */
  avoid?: {
    questions: string[];
    excerpts: string[];
  };
  /** Abort signal so the route can enforce a timeout. */
  signal?: AbortSignal;
}

export interface FlashcardProvider {
  /** Short machine name, e.g. "mock". Safe to show to users. */
  readonly name: string;
  /** True when this provider sends lecture text to a third party. */
  readonly sendsTextExternally: boolean;
  /** Most characters of source text this provider can take. Defaults to MAX_SOURCE_CHARS. */
  readonly maxSourceChars?: number;
  /** Return raw cards (no ids). Output is validated by the caller. */
  generateFlashcards(text: string, options: GenerateOptions): Promise<RawFlashcard[]>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly kind: "timeout" | "unavailable" | "unknown" = "unknown",
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
