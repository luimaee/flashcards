import { parseWikiLinks } from "@/lib/search/index";
import type { Store } from "./db";
import type { Note, Op } from "./schema";

/**
 * Recompute a note's outgoing links from the [[Title]] references in all of
 * its text blocks. Returns an update op when the link set changed, else null.
 */
export async function linkOpsForNote(store: Store, note: Note): Promise<Op | null> {
  const titles = new Set<string>();
  for (const pageId of note.pageIds) {
    for (const block of await store.listTextBlocks(pageId)) {
      for (const t of parseWikiLinks(block.text)) titles.add(t.toLowerCase());
    }
  }
  if (titles.size === 0 && note.links.length === 0) return null;
  const all = await store.listNotes();
  const ids = all.filter((n) => n.id !== note.id && titles.has(n.title.toLowerCase())).map((n) => n.id);
  const same = ids.length === note.links.length && ids.every((id) => note.links.includes(id));
  if (same) return null;
  return store.update("note", note, { links: ids });
}
