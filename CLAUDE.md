@AGENTS.md

# Lecture Cards — project instructions

Student-first flashcard web app. A student uploads one lecture PDF or pastes
lecture text, gets 10 editable flashcards with source excerpts, and exports
them as an Anki-compatible CSV. Open source (MIT). Started as a private beta
for one real university student.

## Commands

```bash
npm install          # install dependencies
npm run dev          # start the app at http://localhost:3000
npm run build        # production build
npm run lint         # ESLint (Next.js core-web-vitals + TypeScript rules)
npm run typecheck    # tsc --noEmit
npm test             # vitest, one run
npm run test:watch   # vitest in watch mode
npm run check        # lint + typecheck + test, in that order
```

Run `npm run check` after every meaningful change. Fix failures; never skip
or silence them. `CORPUS_DEBUG_DIR=<dir> npm test` also writes the cards made
from the real-paper fixtures to that directory for eyeballing.

## Folder structure

```
src/
  app/
    layout.tsx               root layout, fonts, metadata
    page.tsx                 the whole UI; state comes from lib/session.ts
    globals.css              Tailwind v4 theme tokens (calm palette, light + dark)
    api/generate/route.ts    POST: file or text -> cards. GET: provider info for the privacy note
  components/
    SourceForm.tsx           upload drop zone + paste textarea (controlled by the page)
    CardEditor.tsx           one editable card (question, answer, difficulty, tags, source)
  lib/
    session.ts               pure reducer for page state (keeps cards on failure, edited flag)
    text.ts                  normalisation, hyphen repair, sentence/line splitting, limits
    upload.ts                server-side upload checks (size + %PDF- magic bytes)
    pdf.ts                   PDF text extraction via unpdf, per page; rejects mostly-image PDFs
    csv.ts                   Anki CSV export with # directives + a tiny parser for tests
    rateLimit.ts             in-memory per-client request cap
    client.ts                browser-side fetch helpers and ApiError
    flashcards/
      schema.ts              zod schema (the data contract), validation, dedupe, source check, ids
      provider.ts            FlashcardProvider interface + GenerateOptions (the AI boundary)
      mock.ts                MockProvider: heuristic cards from sentences, no network
      anthropic.ts           AnthropicProvider: Claude API via structured outputs
      service.ts             generateFromText pipeline, getProvider, GenerationError
    __tests__/               vitest suites, fixtures (sample lecture, hand-built PDFs)
test/fixtures/               real open-access paper(s) for corpus tests; see its README
.env.example                 placeholder variable names only
vitest.config.mts            test config (node environment, "@/" alias)
```

## Environment variables

Copy `.env.example` to `.env.local`. Never commit `.env.local` or any secret.

| Variable             | Purpose                                                        | Default          |
| -------------------- | -------------------------------------------------------------- | ---------------- |
| `AI_PROVIDER`        | `mock` (no network) or `anthropic`                             | `mock`           |
| `ANTHROPIC_API_KEY`  | Required for `anthropic`. Separately funded API key only.      | unset            |
| `ANTHROPIC_MODEL`    | Model id for the anthropic provider                            | `claude-opus-5`  |
| `ANTHROPIC_BASE_URL` | Testing only: point the SDK at a proxy or fake endpoint        | unset            |

Rules: no personal logins, Claude Code sessions, OAuth tokens, or Max
subscription credentials in the app, ever. The Anthropic provider constructs
its client with an explicit `apiKey` so the SDK cannot fall back to a login
profile on the machine.

## The AI provider boundary

All model access goes through `FlashcardProvider.generateFlashcards(text, options)`
in `src/lib/flashcards/provider.ts`. `service.ts` calls it and then:

1. validates the result against `ProviderResponseSchema` (strict zod, no extra keys);
2. removes duplicate questions and anything already in `avoid`;
3. drops cards whose `sourceExcerpt` cannot be found in the source text;
4. assigns session ids;
5. words the "fewer cards than asked" notice from the count actually returned.

Invalid output is rejected as a whole with a friendly message. Nothing partial
is shown. A provider may set `maxSourceChars` to accept more text than the
60,000-character default (Anthropic: 200,000).

The Anthropic provider uses `client.messages.parse` with a zod output format,
no thinking configuration (Opus 5 default), `max_tokens` 8000, and maps SDK
errors to `ProviderError` without leaking bodies or keys. Tests for it inject
failures through `ANTHROPIC_BASE_URL` and a fake key; there is no recorded
real response in the suite.

## Data contract

Every card: `id`, `question`, `answer`, `sourceExcerpt`, `difficulty`
(`easy` | `medium` | `hard`), `tags` (string[]). Length limits live in
`LIMITS` in `schema.ts`. The schema is strict: unknown keys fail validation.

## CSV export

Starts with Anki directives (`#separator:Comma`, `#html:false`,
`#columns:Front,Back,Tags,Difficulty,Source`, `#tags column:3`), then one
quoted row per card. Quotes doubled, CRLF, UTF-8 BOM. Tags space-separated
with inner spaces turned into underscores. There is no plain header row:
Anki would import it as a note.

## Page state

`src/lib/session.ts` is a pure reducer. Guarantees covered by tests:
a failed "regenerate all" keeps the cards and edits on screen; a failed first
generation keeps the pasted text; edits set `edited` so "Regenerate all"
asks before replacing everything.

## Privacy and safety behaviour

- Uploads are read into memory, checked by size and magic bytes on the server,
  parsed, and discarded. Nothing is written to disk or a database.
- Server logs are one JSON line per event with counts, codes, and timings.
  They never include lecture text or file contents.
- Error responses carry a short `code` and a plain-language `message` only.
  No stack traces, no provider names, no keys.
- Rate limit: 30 generate requests per 10 minutes per client, in memory.

## Test corpus

`test/fixtures/henseler-ringle-sarstedt-2015-discriminant-validity.pdf` ships
(CC BY 4.0). `corpus.test.ts` also runs two other papers if they are present
locally and skips them otherwise. Do not commit other PDFs.

## Known limitations

- Mock mode is heuristic: sentence-based "What is X?" cards. Some are vague
  on real papers. It exists so the flow is testable without an API.
- No OCR. Scanned PDFs, including ones with a text cover sheet, are rejected.
- PDF formulas in special fonts extract as garbage; mock skips them.
- Long sources are truncated at the provider limit and the student is told.
- Rate limiter is per process and trusts `x-forwarded-for`.
- Tests cover the library, the reducer, and the API route, not React rendering.

## Do not add without discussion

Authentication, accounts, payments, a database, spaced repetition, social or
sharing features, mobile apps, university integrations, multi-user admin,
analytics or tracking, storing uploaded files, OCR, or any provider wired to
personal credentials. Keep the app small and calm.
