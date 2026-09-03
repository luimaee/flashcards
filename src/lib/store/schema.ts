import { z } from "zod";
import { FlashcardSchema } from "@/lib/flashcards/schema";

/**
 * Notes document schema, version 1. See docs/storage-design.md.
 *
 * Every entity carries a Version {device, seq}. Every change is an Op in an
 * append-only log. Materialized rows are derived from ops and can always be
 * rebuilt from them.
 */

export const SCHEMA_VERSION = 1;

export const VersionSchema = z.object({ device: z.string().min(1), seq: z.number().int().nonnegative() });
export type Version = z.infer<typeof VersionSchema>;

const Id = z.string().min(1);

const BaseSchema = z.object({
  id: Id,
  version: VersionSchema,
  createdAt: z.number(),
  updatedAt: z.number(),
  deletedAt: z.number().optional(),
  conflictOf: Id.optional(),
});

export const NotebookSchema = BaseSchema.extend({
  title: z.string(),
  color: z.string().optional(),
});
export type Notebook = z.infer<typeof NotebookSchema>;

export const NoteSchema = BaseSchema.extend({
  notebookId: Id,
  title: z.string(),
  tags: z.array(z.string()),
  links: z.array(Id),
  pageIds: z.array(Id),
  sourceAsset: Id.optional(),
});
export type Note = z.infer<typeof NoteSchema>;

export const BackgroundSchema = z.enum(["plain", "lined", "grid", "dots"]);

export const PageSchema = BaseSchema.extend({
  noteId: Id,
  width: z.number().positive(),
  height: z.number().positive(),
  background: BackgroundSchema,
  pdf: z.object({ assetId: Id, pageNumber: z.number().int().positive() }).optional(),
});
export type Page = z.infer<typeof PageSchema>;

export const StrokeSchema = BaseSchema.extend({
  pageId: Id,
  tool: z.enum(["pen", "highlighter"]),
  color: z.string(),
  size: z.number().positive(),
  /** Float32 x, y, pressure, t per point. */
  points: z.instanceof(ArrayBuffer),
  count: z.number().int().nonnegative(),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
});
export type Stroke = z.infer<typeof StrokeSchema>;

export const TextBlockSchema = BaseSchema.extend({
  pageId: Id,
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  text: z.string(),
  fontSize: z.number().positive(),
});
export type TextBlock = z.infer<typeof TextBlockSchema>;

export const ImageBlockSchema = BaseSchema.extend({
  pageId: Id,
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
  assetId: Id,
});
export type ImageBlock = z.infer<typeof ImageBlockSchema>;

export const AssetSchema = z.object({
  id: Id,
  sha256: z.string(),
  mime: z.string(),
  size: z.number().int().nonnegative(),
  blob: z.instanceof(Blob),
  name: z.string().optional(),
});
export type Asset = z.infer<typeof AssetSchema>;

export const PdfTextSchema = z.object({
  assetId: Id,
  pageNumber: z.number().int().positive(),
  text: z.string(),
  items: z.array(z.object({ str: z.string(), x: z.number(), y: z.number(), w: z.number(), h: z.number(), start: z.number() })),
});
export type PdfText = z.infer<typeof PdfTextSchema>;

export const DeckSchema = BaseSchema.extend({
  noteId: Id.optional(),
  title: z.string(),
  provider: z.string(),
  cardIds: z.array(Id),
});
export type Deck = z.infer<typeof DeckSchema>;

export const CardSourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("upload"), fileName: z.string().optional() }),
  z.object({
    kind: z.literal("note"),
    noteId: Id,
    pageId: Id,
    region: z.tuple([z.number(), z.number(), z.number(), z.number()]),
    anchors: z.array(
      z.discriminatedUnion("type", [
        z.object({ type: z.literal("text"), textBlockId: Id, start: z.number(), end: z.number() }),
        z.object({ type: z.literal("pdf"), pageNumber: z.number(), start: z.number(), end: z.number() }),
        z.object({ type: z.literal("ink"), strokeIds: z.array(Id) }),
      ]),
    ),
  }),
]);
export type CardSource = z.infer<typeof CardSourceSchema>;

export const CardSchema = BaseSchema.merge(FlashcardSchema).extend({
  deckId: Id,
  source: CardSourceSchema,
});
export type Card = z.infer<typeof CardSchema>;

export const ENTITY_KINDS = ["notebook", "note", "page", "stroke", "textBlock", "imageBlock", "deck", "card"] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];

export type EntityOf<K extends EntityKind> = K extends "notebook"
  ? Notebook
  : K extends "note"
    ? Note
    : K extends "page"
      ? Page
      : K extends "stroke"
        ? Stroke
        : K extends "textBlock"
          ? TextBlock
          : K extends "imageBlock"
            ? ImageBlock
            : K extends "deck"
              ? Deck
              : Card;

export const ENTITY_SCHEMAS: Record<EntityKind, z.ZodTypeAny> = {
  notebook: NotebookSchema,
  note: NoteSchema,
  page: PageSchema,
  stroke: StrokeSchema,
  textBlock: TextBlockSchema,
  imageBlock: ImageBlockSchema,
  deck: DeckSchema,
  card: CardSchema,
};

export const OpSchema = z.object({
  opId: z.string(),
  device: z.string(),
  seq: z.number().int().nonnegative(),
  ts: z.number(),
  entity: z.enum(ENTITY_KINDS),
  entityId: Id,
  kind: z.enum(["create", "update", "delete", "restore"]),
  base: VersionSchema.nullable(),
  patch: z.record(z.string(), z.unknown()),
});
export type Op = z.infer<typeof OpSchema>;

export interface SearchEntry {
  key: string; // `${noteId}:${pageId}:${entityId}`
  noteId: string;
  pageId: string;
  entityId: string;
  kind: "title" | "tag" | "text" | "pdf";
  text: string;
}
