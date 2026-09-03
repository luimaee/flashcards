import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { ProviderError, type FlashcardProvider, type GenerateOptions } from "./provider";
import { DIFFICULTIES, InvalidProviderOutputError, type RawFlashcard } from "./schema";

/**
 * Anthropic provider.
 *
 * Sends the lecture text to the Claude API and asks for cards as structured
 * JSON. The API key comes from the ANTHROPIC_API_KEY environment variable and
 * nothing else: this provider deliberately refuses to fall back to any login
 * profile or session credential on the machine, so a personal Claude account
 * can never be used by accident.
 *
 * Output is validated again by the service layer, and every source excerpt is
 * checked against the source text before a card reaches the student.
 */

export const DEFAULT_ANTHROPIC_MODEL = "claude-opus-5";

/** Output shape requested from the model. Kept simple so it maps cleanly to a JSON schema. */
const OutputSchema = z.object({
  cards: z.array(
    z.object({
      question: z.string(),
      answer: z.string(),
      sourceExcerpt: z.string(),
      difficulty: z.enum(DIFFICULTIES),
      tags: z.array(z.string()),
    }),
  ),
});

const SYSTEM_PROMPT = `You write study flashcards for a university student from their own lecture material.

Rules:
- Make exactly the number of cards requested, unless the material genuinely cannot support that many. Then make fewer.
- Test important concepts, definitions, mechanisms, results and relationships. Skip trivia, page numbers, author affiliations and formatting.
- Every question must be answerable from the material alone. Never add outside knowledge.
- Every answer must be fully supported by the material. If the material is uncertain or hedged, the answer must say so too.
- No two cards may ask the same thing in different words.
- Use clear, plain language. Keep names, dates, numbers, formulas and technical terms exactly as written in the material.
- "sourceExcerpt" must be one continuous passage copied word for word from the material, at most 400 characters, that directly supports the answer. Do not paraphrase it, do not fix typos in it, do not join separate passages.
- "difficulty" is "easy", "medium" or "hard" for a student who attended the lecture.
- "tags" is 1 to 4 short topic labels.
- Do not repeat any question listed under "Already covered".`;

export interface AnthropicProviderConfig {
  apiKey: string;
  model?: string;
  baseURL?: string;
}

export class AnthropicProvider implements FlashcardProvider {
  readonly name = "anthropic";
  readonly sendsTextExternally = true;
  /** About 50k tokens: a long paper or a full lecture, still a few tens of cents per run. */
  readonly maxSourceChars = 200_000;
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(config: AnthropicProviderConfig) {
    if (!config.apiKey) {
      throw new ProviderError("ANTHROPIC_API_KEY is not set", "unavailable");
    }
    this.model = config.model || DEFAULT_ANTHROPIC_MODEL;
    this.client = new Anthropic({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
      maxRetries: 1,
    });
  }

  async generateFlashcards(text: string, options: GenerateOptions): Promise<RawFlashcard[]> {
    const avoid = options.avoid?.questions ?? [];
    const userMessage = [
      `Number of cards to make: ${options.count}.`,
      avoid.length > 0 ? `Already covered (do not repeat):\n${avoid.map((q) => `- ${q}`).join("\n")}` : "",
      "Lecture material:",
      "<material>",
      text,
      "</material>",
    ]
      .filter(Boolean)
      .join("\n\n");

    const response = await this.client.messages
      .parse(
        {
          model: this.model,
          max_tokens: 8000,
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: userMessage }],
          output_config: { format: zodOutputFormat(OutputSchema) },
        },
        { signal: options.signal },
      )
      .catch((error: unknown) => {
        throw toProviderError(error);
      });

    if (response.stop_reason === "refusal") {
      throw new ProviderError("The model declined to process this material", "unavailable");
    }
    if (response.stop_reason === "max_tokens") {
      throw new InvalidProviderOutputError("AI response was cut off before it finished", ["stop_reason: max_tokens"]);
    }
    const parsed = response.parsed_output;
    if (!parsed) {
      throw new InvalidProviderOutputError("AI response could not be parsed as JSON", ["parsed_output was null"]);
    }
    return parsed.cards;
  }
}

/** Map SDK errors to ProviderError without leaking key material or raw bodies. */
function toProviderError(error: unknown): Error {
  if (error instanceof Anthropic.AuthenticationError) {
    return new ProviderError("Anthropic rejected the API key (401)", "unavailable");
  }
  if (error instanceof Anthropic.PermissionDeniedError) {
    return new ProviderError("Anthropic API key lacks permission (403)", "unavailable");
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new ProviderError("Anthropic rate limit hit (429)", "unavailable");
  }
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return new ProviderError("Anthropic request timed out", "timeout");
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new ProviderError("Could not reach the Anthropic API", "unavailable");
  }
  if (error instanceof Anthropic.APIUserAbortError) {
    return new ProviderError("Request aborted", "timeout");
  }
  if (error instanceof Anthropic.APIError) {
    return new ProviderError(`Anthropic API error (${error.status ?? "unknown status"})`, "unavailable");
  }
  if (error instanceof Error && error.name === "AbortError") {
    return new ProviderError("Request aborted", "timeout");
  }
  return new ProviderError(error instanceof Error ? error.message : String(error), "unknown");
}
