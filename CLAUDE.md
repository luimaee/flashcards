@AGENTS.md

# Lecture Cards — project instructions

Student-first study app. Two entry points share one card pipeline:

1. **Cards from a file** (`/`): upload a lecture PDF or paste text, get 10
   editable flashcards with source excerpts, export an Anki CSV.
2. **Notes** (`/notes`): write or import notes (pen, typed text, PDF pages,
   images), select any region, make cards from it, study them. Cards keep a
   pointer back to the exact note and region.

Open source (MIT). Started as a private beta for one real university student.

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
    page.tsx                 cards-from-a-file flow; state from lib/session.ts
    ink-test/page.tsx        handwriting tuning page (sliders, raw points)
    notes/layout.tsx         StoreProvider + SearchProvider + Cmd+K palette
    notes/page.tsx           notebooks, notes, import PDF, export/import file
    notes/[noteId]/page.tsx  note editor
    notes/cards/[deckId]/    a deck made from a note region: edit, study, export
    api/generate/route.ts    POST: file or text -> cards. GET: provider info
  components/
    SourceForm.tsx, CardEditor.tsx          shared card UI
    ink/InkCanvas.tsx                       pen/highlighter/eraser canvas
    notes/NoteEditor.tsx                    toolbar, virtualized page column, selection
    notes/PageView.tsx                      one page: PDF, images, ink, text, region layer
    notes/TextBlockEditor.tsx, ImageLayer.tsx, PdfPageLayer.tsx, RegionSelectLayer.tsx
    notes/NoteSidebar.tsx                   tags, decks, links, backlinks
    notes/CommandPalette.tsx                Cmd+K search
    notes/StudyMode.tsx                     one card at a time, Got it / Not yet
  lib/
    session.ts               reducer for the file flow
    text.ts, upload.ts, pdf.ts, csv.ts, rateLimit.ts, client.ts
    flashcards/              schema (data contract), provider boundary, mock, anthropic, service
    ink/geometry.ts          points, packing, outlines, hit tests, HANDWRITING_TUNING
    ink/input.ts             pointer arbitration (pen beats touch)
    ink/render.ts            canvas drawing, backgrounds, page sizes
    store/schema.ts          notes document schema v1 (zod), Op, Version
    store/ops.ts             op builders and reconciliation rules (pure)
    store/db.ts              IndexedDB store: op log + materialized rows + migrations
    store/react.tsx          StoreProvider, useStore, useLiveQuery
    store/importers.ts       PDF -> note, image -> page
    store/transfer.ts        export/import everything as one JSON file
    store/links.ts           [[Title]] links -> note.links
    search/index.ts          MiniSearch wrapper, snippets, wiki links, tags
    pdf/geometry.ts          PDF.js text items -> page rects and offsets (pure)
    pdf/client.ts            PDF.js in the browser: load, render, extract text
    notes/region.ts          what a selected region contains (pure)
    notes/makeCards.ts       region -> generation route -> deck + cards with provenance
    __tests__/               vitest suites, fixtures (sample lecture, hand-built PDFs)
docs/storage-design.md       the approved storage design
test/fixtures/               real open-access paper(s) for corpus tests
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
subscription credentials in the app, ever.

## The AI provider boundary

All model access goes through `FlashcardProvider.generateFlashcards(text, options)`
in `src/lib/flashcards/provider.ts`. `service.ts` validates output against
the strict zod schema, removes duplicates, drops cards whose `sourceExcerpt`
is not in the source text, and assigns ids. Notes reuse this unchanged: a
selected region becomes `text` posted to the same route.

## Notes storage (see docs/storage-design.md)

- Device-local IndexedDB, database `lecturecards`, `SCHEMA_VERSION` in
  `store/schema.ts`. Migrations are ordered functions in `store/db.ts`;
  never edit an existing one, add the next number.
- Every write is an `Op` in the append-only `ops` store with a per-device
  monotonic `seq`. Materialized stores are derived. Deletes are tombstones;
  restores are explicit ops; a concurrent edit from another device forks the
  entity (`conflictOf`) instead of overwriting. No last-write-wins anywhere.
- Nothing is metered. No quota logic exists; if it ever does, it lives in
  one module.
- Strokes are packed Float32 (x, y, pressure, t) buffers; outlines are
  computed for display only. Page bitmaps are never stored.
- Page slots mount their content only near the viewport.
- Export/import is one JSON file (`store/transfer.ts`); import replays ops
  and is idempotent.

## Handwriting

Tuning constants in `src/lib/ink/geometry.ts` (`HANDWRITING_TUNING`); the
`/ink-test` page exposes them as sliders. Pen input uses coalesced pointer
events and a desynchronized canvas; touch is ignored for drawing while a pen
is active (`ink/input.ts`). No OCR: handwriting is capture only.

## Card provenance

`Card` = `Flashcard` + `deckId` + `source`. A note-sourced card stores
`noteId`, `pageId`, the `region` rectangle, and anchors (text block ranges,
PDF text ranges, stroke ids). `sourceHref()` builds
`/notes/<id>#page=<pageId>&region=x0,y0,x1,y1`, which the editor reads to
scroll and highlight.

## Privacy and safety behaviour

- Notes never leave the device except the selected text sent for card
  generation, which goes to the configured provider only.
- File uploads on `/` are read into memory, checked, parsed, discarded.
- Server logs are one JSON line per event with counts, codes, and timings.
  They never include lecture text or file contents.

## Known limitations

- No handwriting recognition; ink regions cannot make cards yet.
- No sync server; move notes with the export file.
- No undo yet (the op log makes it possible), no page reordering, no image
  resize, whole-stroke eraser only.
- Mock mode is heuristic; connect Claude for real card quality.
- Tests cover libraries, the store, the reducer, and the API route, not
  React rendering. UI flows are verified by hand in the browser.

## Do not add without discussion

Accounts, payments, credit counters or paywalls, a database server,
spaced repetition, real-time collaboration, an infinite canvas, OCR, mobile
apps, analytics or tracking, storing uploaded files server-side, or any
provider wired to personal credentials. Keep the app small and calm.
