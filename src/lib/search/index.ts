import MiniSearch from "minisearch";
import type { SearchEntry } from "@/lib/store/schema";

/**
 * In-memory full-text index over the `searchIndex` store. Rebuilt on open
 * (fast: a few thousand notes index in well under a second) and updated
 * incrementally as ops commit.
 */

export interface SearchHit {
  key: string;
  noteId: string;
  pageId: string;
  entityId: string;
  kind: SearchEntry["kind"];
  score: number;
  snippet: string;
}

export class NotesSearch {
  private index = new MiniSearch<SearchEntry>({
    idField: "key",
    fields: ["text"],
    storeFields: ["noteId", "pageId", "entityId", "kind", "text"],
    searchOptions: { prefix: true, fuzzy: 0.15, boost: { text: 1 } },
  });

  replaceAll(entries: SearchEntry[]) {
    this.index.removeAll();
    this.index.addAll(entries);
  }

  upsert(entry: SearchEntry) {
    if (this.index.has(entry.key)) this.index.replace(entry);
    else this.index.add(entry);
  }

  remove(key: string) {
    if (this.index.has(key)) this.index.discard(key);
  }

  get size() {
    return this.index.documentCount;
  }

  query(text: string, limit = 20): SearchHit[] {
    const q = text.trim();
    if (!q) return [];
    return this.index.search(q).slice(0, limit).map((r) => ({
      key: String(r.id),
      noteId: r.noteId as string,
      pageId: r.pageId as string,
      entityId: r.entityId as string,
      kind: r.kind as SearchEntry["kind"],
      score: r.score,
      snippet: snippetFor(r.text as string, q),
    }));
  }
}

/** A short window of the text around the first query term. */
export function snippetFor(text: string, query: string, radius = 60): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const lower = flat.toLowerCase();
  let at = -1;
  for (const t of terms) {
    at = lower.indexOf(t);
    if (at >= 0) break;
  }
  if (at < 0) return flat.slice(0, radius * 2) + (flat.length > radius * 2 ? "…" : "");
  const start = Math.max(0, at - radius);
  const end = Math.min(flat.length, at + radius);
  return (start > 0 ? "…" : "") + flat.slice(start, end) + (end < flat.length ? "…" : "");
}

/** `[[Note title]]` links inside typed text. Returns the titles, deduplicated, in order. */
export function parseWikiLinks(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(/\[\[([^\]\n]{1,120})\]\]/g)) {
    const title = match[1].trim();
    const key = title.toLowerCase();
    if (title && !seen.has(key)) {
      seen.add(key);
      out.push(title);
    }
  }
  return out;
}

/** Normalise a tag the way notes store them: lower-case, trimmed, no leading #. */
export function normaliseTag(tag: string): string {
  return tag.trim().replace(/^#/, "").toLowerCase().replace(/\s+/g, "-");
}
