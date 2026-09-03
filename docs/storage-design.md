# Notes storage design (proposal, v1)

Status: proposed, awaiting approval. Nothing in this document is implemented.

## Decision summary

| Question | Decision |
| --- | --- |
| Accounts in v1? | **No.** Device-local. Backup and moving devices via one export/import file. |
| Where notes live | **IndexedDB only.** The server never sees a note. |
| What the server does | Same as today: receives the *selected text* for card generation and returns cards. Nothing else. |
| Write model | **Append-only op log** per device with a monotonic sequence number, plus materialized tables rebuilt from the log. Deletes are tombstones that carry a version. Last-write-wins does not exist anywhere in the code. |
| Sync later | The op log is the sync unit. A future server is a relay of ops; conflicts that cannot be ordered keep both copies and surface to the user. Designing this now costs one table; adding it later would mean rewriting every write. |
| Schema versioning | `schemaVersion` in a `meta` row from the first commit. Migrations are ordered functions `migrate[n]`, run inside one IndexedDB upgrade transaction, tested with fixture databases. |
| Cards | **Persist now** (they need to point at notes). Study progress still does not persist. |

## Why device-local

Rules 2 and 5 together (never lose work, works offline, opens fast) are met most reliably by not having a server in the write path at all. Accounts add sign-in, password reset, and a sync engine before the first note can be written. The op log means a sync layer can be added without touching the editor.

Cost of this choice: a student on two devices moves notes by exporting a file. That is acceptable for v1 and stated in the UI.

## Storage layout (IndexedDB, database `lecturecards`, version 1)

Object stores, with key and indexes:

| Store | Key | Indexes | Purpose |
| --- | --- | --- | --- |
| `meta` | `key` | | `schemaVersion`, `deviceId`, `seq` (next op number), `installedAt` |
| `ops` | `opId` | `[deviceId, seq]`, `entityId`, `ts` | Append-only log. Never updated, never deleted except by explicit compaction after export. |
| `notebooks` | `id` | `updatedAt` | Materialized |
| `notes` | `id` | `notebookId`, `updatedAt`, `tags` (multiEntry) | Materialized |
| `pages` | `id` | `[noteId, index]` | Materialized |
| `strokes` | `id` | `pageId` | Materialized. Points stored as one `ArrayBuffer`. |
| `textBlocks` | `id` | `pageId` | Materialized |
| `imageBlocks` | `id` | `pageId` | Materialized |
| `assets` | `id` | `sha256` | Blobs: imported PDFs, images. Content-addressed, so the same PDF imported twice is stored once. |
| `pdfText` | `[assetId, pageNumber]` | `assetId` | Extracted text per PDF page with item positions, for search and region selection |
| `cards` | `id` | `noteId`, `deckId` | Materialized flashcards with provenance |
| `decks` | `id` | | A generated set of cards (one "Make cards" action = one deck) |
| `searchIndex` | `[noteId, pageId, entityId]` | `noteId` | Plain text per searchable entity; an in-memory MiniSearch index is built from this on open |
| `thumbnails` | `pageId` | | Small JPEG blobs, generated lazily, safe to drop |

Memory rule (design rule 4): only `pages` metadata is loaded for a note. Strokes and blocks load per page when the page enters the viewport, and page bitmaps live in an LRU cache of about ten pages.

## Versions and the op log

Every entity carries:

```ts
interface Version {
  device: string;   // this device's id (random, generated at install)
  seq: number;      // monotonic per device, never reused
}
```

Every mutation is one op:

```ts
interface Op {
  opId: string;                 // `${device}:${seq}`
  device: string;
  seq: number;
  ts: number;                   // wall clock, informational only
  entity: EntityKind;           // 'notebook' | 'note' | 'page' | 'stroke' | ...
  entityId: string;
  kind: 'create' | 'update' | 'delete' | 'restore';
  base: Version | null;         // version this op was applied on top of
  patch: Partial<EntityDoc>;    // fields written (create: full doc)
}
```

Rules:

1. Applying an op sets the entity's `version` to the op's `{device, seq}`.
2. A `delete` writes `deletedAt` and keeps the row. Materialized reads filter tombstones. Nothing is physically removed until the user empties trash, which itself is an op.
3. On the same device ops are totally ordered by `seq`, so no conflict is possible in v1.
4. When ops from another device arrive (future sync, or importing a file): an incoming op whose `base` equals the current version applies cleanly. If `base` is older than current, the entity is forked: the incoming state is written as a new entity with `conflictOf: originalId`, and the note shows "Two versions of this note exist." Strokes never conflict (each stroke is its own entity; two strokes just both exist). Tombstones win over nothing: a delete with a newer version than a restore stays deleted, and a restore is an explicit op, so a closed notebook cannot resurrect work.
5. Import is idempotent: ops already present by `opId` are skipped.

## Document schema (v1)

```ts
type Id = string;                 // ULID, sortable by time
interface Base { id: Id; version: Version; createdAt: number; updatedAt: number; deletedAt?: number; conflictOf?: Id }

interface Notebook extends Base { title: string; color?: string }

interface Note extends Base {
  notebookId: Id;
  title: string;
  tags: string[];                 // lower-case, deduped
  links: Id[];                    // outgoing note-to-note links; backlinks are computed
  pageIds: Id[];                  // display order
  sourceAsset?: Id;               // the imported PDF, if any
}

type Background = 'plain' | 'lined' | 'grid' | 'dots';
interface Page extends Base {
  noteId: Id;
  index: number;
  width: number; height: number;  // page units (points); default 612 x 792
  background: Background;
  pdf?: { assetId: Id; pageNumber: number };   // rendered underneath ink when present
}

type Tool = 'pen' | 'highlighter';
interface Stroke extends Base {
  pageId: Id;
  tool: Tool;
  color: string;                  // css hex
  size: number;                   // base width in page units
  points: ArrayBuffer;            // Float32 x, y, pressure(0..1), t(ms from stroke start), repeated
  count: number;                  // number of points
  bbox: [number, number, number, number];
}

interface TextBlock extends Base { pageId: Id; x: number; y: number; width: number; text: string; fontSize: number }
interface ImageBlock extends Base { pageId: Id; x: number; y: number; width: number; height: number; assetId: Id }

interface Asset { id: Id; sha256: string; mime: string; size: number; blob: Blob; name?: string }

interface PdfText {
  assetId: Id; pageNumber: number;
  text: string;                   // plain text of the page, after hyphen repair
  items: { str: string; x: number; y: number; w: number; h: number; start: number }[];  // positions for region select
}

interface Deck extends Base { noteId?: Id; title: string; provider: 'mock' | 'anthropic'; cardIds: Id[] }
```

### Card provenance

The existing `Flashcard` (question, answer, sourceExcerpt, difficulty, tags) is kept exactly, so the server, the validators, and the CSV export do not change. A persisted card adds a `source`:

```ts
interface Card extends Base, Flashcard {
  deckId: Id;
  source:
    | { kind: 'upload'; fileName?: string }                    // today's flow, no note
    | {
        kind: 'note';
        noteId: Id;
        pageId: Id;
        region: [number, number, number, number];             // page units, the lasso or selection bounds
        anchors: (
          | { type: 'text'; textBlockId: Id; start: number; end: number }
          | { type: 'pdf'; pageNumber: number; start: number; end: number }
          | { type: 'ink'; strokeIds: Id[] }
        )[];
      };
}
```

"From the lecture" on a note-sourced card opens the note, scrolls to `pageId`, draws the `region` as a highlight, and selects the anchored text if any. `sourceExcerpt` is still checked against the region's text by the existing server pipeline, so the honesty guarantee is unchanged. If the source note or page is later deleted, the card keeps its excerpt and shows "Source note was deleted".

## Search

Full-text search covers note titles, tags, text blocks, and `pdfText`. Ink is not searched in v1 (no OCR). A MiniSearch index is built in memory from `searchIndex` on open (a few thousand notes index in well under a second) and updated on every text op. Cmd+K opens it from anywhere; results jump to the note and page.

## Export / import file

`<name>.lecturecards` is a zip:

```
manifest.json     { schemaVersion, exportedAt, device, opCount }
ops.jsonl         one op per line, in (device, seq) order
assets/<id>       raw blobs
```

Import replays ops through the same reconciliation rules as sync, so importing a file made on another device is the sync story for v1. A plain-text and PDF export per note stays available for people who just want their notes out.

## What changes in existing code

- `src/lib/flashcards/schema.ts`: unchanged `Flashcard`; new `CardSchema` wraps it with `source`.
- `src/app/api/generate/route.ts`: unchanged. Region text is posted as `text`.
- `src/lib/pdf.ts`: gains a per-page variant returning positioned items (same `unpdf`/PDF.js, run in the browser for rendering and on the server for the existing upload path).
- `src/lib/csv.ts`: Source column becomes "Note title, page N: excerpt" for note-sourced cards.
- New: `src/lib/store/` (IndexedDB, ops, migrations), `src/lib/ink/` (stroke geometry, smoothing constant), `src/app/notes/`.

## New dependencies

| Package | Why | Size |
| --- | --- | --- |
| `perfect-freehand` | stroke outlines from pressure points | tiny |
| `idb` | typed promise wrapper over IndexedDB | tiny |
| `minisearch` | in-memory full-text index | small |
| `pdfjs-dist` | render PDF pages to canvas in the browser | large, loaded only on the notes pages |
| `ulid` | sortable ids | tiny |

No whiteboard SDKs.

## Open points for approval

1. Device-local with export/import, no accounts. Yes or no.
2. Cards persist from now on. Study progress still does not.
3. Default page size 612 x 792 points (US Letter proportions) with A4 as an option.
4. `pdfjs-dist` on the client is the one heavy dependency. Alternative is server-side page rendering to PNG, which costs bandwidth and breaks offline; not recommended.
