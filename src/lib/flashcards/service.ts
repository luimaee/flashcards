import { AnthropicProvider } from "./anthropic";
import { MockProvider } from "./mock";
import { ProviderError, type FlashcardProvider, type GenerateOptions } from "./provider";
import {
  InvalidProviderOutputError,
  assignIds,
  dedupeCards,
  keepSupportedCards,
  normaliseQuestion,
  validateProviderOutput,
  type Flashcard,
} from "./schema";
import {
  MAX_SOURCE_CHARS,
  TARGET_CARD_COUNT,
  cardCountFor,
  isTooShort,
  MIN_SOURCE_CHARS,
  normaliseText,
} from "../text";

/**
 * Generation pipeline, provider-agnostic:
 *   normalise text -> check length -> call provider -> validate JSON shape ->
 *   drop duplicates -> drop cards whose excerpt is not in the source ->
 *   assign ids.
 *
 * Anything that goes wrong is turned into a GenerationError with a
 * student-friendly message and a short code for logging.
 */

export type GenerationErrorCode =
  | "too-short"
  | "timeout"
  | "provider-unavailable"
  | "invalid-output"
  | "no-cards"
  | "misconfigured";

export class GenerationError extends Error {
  constructor(
    public readonly code: GenerationErrorCode,
    public readonly userMessage: string,
    public readonly detail?: string,
  ) {
    super(userMessage);
    this.name = "GenerationError";
  }
}

export interface GenerateInput {
  text: string;
  /** How many cards to ask for; defaults to TARGET_CARD_COUNT. */
  count?: number;
  /** Cards the student already has; new cards must not repeat them. */
  avoid?: Flashcard[];
  timeoutMs?: number;
}

export interface GenerateOutput {
  cards: Flashcard[];
  /** Plain-language note for the student when something was adjusted. */
  notice?: string;
  provider: string;
  sendsTextExternally: boolean;
}

export const DEFAULT_TIMEOUT_MS = 45_000;

/**
 * Resolve the configured provider from environment variables.
 *   AI_PROVIDER=mock (default)  -> MockProvider, no network
 *   AI_PROVIDER=anthropic       -> AnthropicProvider, needs ANTHROPIC_API_KEY
 */
export function getProvider(env: Record<string, string | undefined> = process.env): FlashcardProvider {
  const name = (env.AI_PROVIDER ?? "mock").trim().toLowerCase();
  if (name === "mock" || name === "") return new MockProvider();
  if (name === "anthropic") {
    const apiKey = (env.ANTHROPIC_API_KEY ?? "").trim();
    if (!apiKey) {
      throw new GenerationError(
        "misconfigured",
        "The app is set to use Anthropic but no API key is configured. Ask whoever runs the app to set ANTHROPIC_API_KEY, or switch AI_PROVIDER to mock.",
        "AI_PROVIDER=anthropic but ANTHROPIC_API_KEY is empty",
      );
    }
    return new AnthropicProvider({
      apiKey,
      model: env.ANTHROPIC_MODEL?.trim() || undefined,
      baseURL: env.ANTHROPIC_BASE_URL?.trim() || undefined,
    });
  }
  throw new GenerationError(
    "misconfigured",
    "The app's AI provider is not set up correctly. Ask whoever runs the app to set AI_PROVIDER to mock or anthropic.",
    `Unknown AI_PROVIDER "${name}"`,
  );
}

export async function generateFromText(
  input: GenerateInput,
  provider: FlashcardProvider = getProvider(),
): Promise<GenerateOutput> {
  const notices: string[] = [];
  let text = normaliseText(input.text);

  if (isTooShort(text)) {
    throw new GenerationError(
      "too-short",
      `That is too short to make useful cards from. Please add more of the lecture (at least about ${MIN_SOURCE_CHARS} characters, roughly a paragraph).`,
    );
  }

  const limit = provider.maxSourceChars ?? MAX_SOURCE_CHARS;
  if (text.length > limit) {
    text = text.slice(0, limit);
    notices.push(`The material was long, so only the first ${limit.toLocaleString()} characters were used.`);
  }

  const requested = Math.max(1, Math.min(input.count ?? TARGET_CARD_COUNT, TARGET_CARD_COUNT));
  const supported = cardCountFor(text);
  const count = Math.min(requested, supported);
  const wantedFullSet = (input.count ?? TARGET_CARD_COUNT) === TARGET_CARD_COUNT;

  const avoid = input.avoid ?? [];
  const options: GenerateOptions = {
    count,
    avoid: {
      questions: avoid.map((c) => c.question),
      excerpts: avoid.map((c) => c.sourceExcerpt),
    },
  };

  const rawCards = await callProviderWithTimeout(provider, text, options, input.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  // Providers are trusted to return the right type, but we validate anyway so
  // a real API cannot sneak malformed data past the boundary.
  let validated;
  try {
    validated = validateProviderOutput({ cards: rawCards });
  } catch (error) {
    if (error instanceof InvalidProviderOutputError) {
      throw new GenerationError(
        "invalid-output",
        "The AI returned cards in an unexpected format, so nothing was shown. Please try again.",
        error.issues.slice(0, 5).join("; "),
      );
    }
    throw error;
  }

  const avoidKeys = new Set(avoid.map((c) => normaliseQuestion(c.question)));
  const fresh = dedupeCards(validated).filter((c) => !avoidKeys.has(normaliseQuestion(c.question)));
  const { kept, droppedCount } = keepSupportedCards(fresh, text);
  if (droppedCount > 0) {
    notices.push(
      `${droppedCount} card${droppedCount === 1 ? " was" : "s were"} left out because their source excerpt could not be found in the material.`,
    );
  }

  if (kept.length === 0) {
    throw new GenerationError(
      "no-cards",
      "No usable cards could be made from this material. Try pasting a clearer or longer section of the lecture.",
    );
  }

  // Report the number actually returned, not the number we hoped for.
  if (wantedFullSet && kept.length < TARGET_CARD_COUNT) {
    const reason = supported < TARGET_CARD_COUNT ? "The material is fairly short" : "Only part of the material was usable";
    notices.unshift(
      `${reason}, so ${kept.length} card${kept.length === 1 ? " was" : "s were"} made instead of ${TARGET_CARD_COUNT}.`,
    );
  }

  return {
    cards: assignIds(kept),
    notice: notices.length > 0 ? notices.join(" ") : undefined,
    provider: provider.name,
    sendsTextExternally: provider.sendsTextExternally,
  };
}

async function callProviderWithTimeout(
  provider: FlashcardProvider,
  text: string,
  options: GenerateOptions,
  timeoutMs: number,
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await Promise.race([
      provider.generateFlashcards(text, { ...options, signal: controller.signal }),
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener("abort", () =>
          reject(new ProviderError("Provider timed out", "timeout")),
        );
      }),
    ]);
  } catch (error) {
    if (error instanceof GenerationError) throw error;
    if (error instanceof ProviderError && error.kind === "timeout") {
      throw new GenerationError(
        "timeout",
        "Making the cards took too long. Please try again, or try a shorter section.",
      );
    }
    if (error instanceof InvalidProviderOutputError) {
      throw new GenerationError(
        "invalid-output",
        "The AI returned cards in an unexpected format, so nothing was shown. Please try again.",
        error.issues.slice(0, 5).join("; "),
      );
    }
    throw new GenerationError(
      "provider-unavailable",
      "The card generator is not responding right now. Please try again in a moment.",
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    clearTimeout(timer);
  }
}
