@AGENTS.md

# Lecture Cards — project instructions

Student-first flashcard web app. A student uploads one lecture PDF or pastes
lecture text, gets 10 editable flashcards with source excerpts, and exports
them as an Anki-compatible CSV. Private beta; the first user is a real
university student using real lecture material.

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
or silence them.

## Folder structure

```
src/
  app/
    layout.tsx               root layout, fonts, metadata
    page.tsx                 the whole UI: upload/paste -> progress -> editable results
    globals.css              Tailwind v4 theme tokens (calm palette, light + dark)
    api/generate/route.ts    POST: file or text -> cards. GET: provider info for the privacy note
  components/
    SourceForm.tsx           upload drop zone + paste textarea, browser-side checks
    CardEditor.tsx           one editable card (question, answer, difficulty, tags, source)
  lib/
    text.ts                  normalisation, sentence split, min/max sizes, card budget
    upload.ts                server-side upload checks (size + %PDF- magic bytes)
    pdf.ts                   PDF text extraction via unpdf (in memory only)
    csv.ts                   Anki CSV export + a tiny parser used by tests
    rateLimit.ts             in-memory per-client request cap
    client.ts                browser-side fetch helpers and ApiError
    flashcards/
      schema.ts              zod schema (the data contract), validation, dedupe, source check, ids
      provider.ts            FlashcardProvider interface + GenerateOptions (the AI boundary)
      mock.ts                MockProvider: builds cards from sentences in the source, no network
      service.ts             generateFromText pipeline, getProvider, GenerationError
    __tests__/               vitest tests + fixtures (sample lecture, hand-built PDFs)
.env.example                 placeholder variable names only
vitest.config.mts            test config (node environment, "@/" alias)
```

## Environment variables

Copy `.env.example` to `.env.local`. Never commit `.env.local` or any secret.

| Variable      | Purpose                                                      | Default |
| ------------- | ------------------------------------------------------------ | ------- |
| `AI_PROVIDER` | Which provider makes cards. Only `mock` exists today.        | `mock`  |
| `AI_API_KEY`  | Reserved for a future real provider. Unused in mock mode.    | unset   |

Rules: no personal logins, Claude Code sessions, OAuth tokens, or Max
subscription credentials in the app, ever. A real provider must use a
separately funded API key read from the environment.

## The AI provider boundary

All model access goes through `FlashcardProvider.generateFlashcards(text, options)`
in `src/lib/flashcards/provider.ts`. `service.ts` calls it and then:

1. validates the result against `ProviderResponseSchema` (strict zod, no extra keys);
2. removes duplicate questions and anything already in `avoid`;
3. drops cards whose `sourceExcerpt` cannot be found in the source text;
4. assigns session ids.

Invalid output is rejected as a whole with a friendly message. Nothing partial
is shown. To add a real provider: create `src/lib/flashcards/<name>.ts`
implementing the interface, set `sendsTextExternally: true`, return only raw
cards (no ids), and register it in `getProvider()`. The UI reads
`sendsTextExternally` from `GET /api/generate` to show the right privacy note.

## Data contract

Every card: `id`, `question`, `answer`, `sourceExcerpt`, `difficulty`
(`easy` | `medium` | `hard`), `tags` (string[]). Length limits live in
`LIMITS` in `schema.ts`. The schema is strict: unknown keys fail validation.

## CSV export

Columns: `Front, Back, Tags, Difficulty, Source`. Every field quoted, quotes
doubled, CRLF line endings, UTF-8 BOM. Tags are space-separated (Anki style),
with spaces inside a tag turned into underscores.

## Privacy and safety behaviour

- Uploads are read into memory, checked by size and magic bytes on the server,
  parsed, and discarded. Nothing is written to disk or a database.
- Server logs are one JSON line per event with counts, codes, and timings.
  They never include lecture text or file contents.
- Error responses carry a short `code` and a plain-language `message` only.
  No stack traces, no provider names, no keys.
- Rate limit: 30 generate requests per 10 minutes per client, in memory.

## Known limitations

- Mock mode builds cards from sentences; it does not understand the material.
  Cards are honest but simple. A real provider is needed for good cards.
- No OCR. Scanned or image-only PDFs are rejected with a message asking the
  student to paste the text.
- Only PDF uploads. Other formats must be pasted as text.
- Sources over 60,000 characters are truncated (the student is told).
- State lives in the browser tab. Refreshing clears the cards.
- The rate limiter is per process and resets on restart.
- Tests cover the library and the API route, not the React components.

## Do not add without discussion

Authentication, accounts, payments, a database, spaced repetition, social or
sharing features, mobile apps, university integrations, multi-user admin,
analytics or tracking, storing uploaded files, OCR, or a real AI provider
wired to personal credentials. Keep the app small and calm.
