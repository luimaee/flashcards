import type { Flashcard } from "./flashcards/schema";

/**
 * Anki-friendly CSV export.
 *
 * The file starts with Anki "file header" directives (lines beginning with
 * `#`). Anki reads them for settings and never imports them as notes, which
 * is why we use them instead of a plain header row: a plain "Front,Back"
 * row would be imported as a card.
 *
 * Columns (in order): Front, Back, Tags, Difficulty, Source
 * - Front / Back map straight onto Anki's Basic note type.
 * - Tags are space-separated; `#tags column:3` tells Anki where they are.
 * - Difficulty and Source are extra fields; map them to note fields or
 *   ignore them in Anki's import dialog.
 *
 * Every value is quoted; quotes are doubled; line breaks stay inside quotes.
 * Other spreadsheet apps show the `#` lines as ordinary rows.
 */

export const CSV_COLUMNS = ["Front", "Back", "Tags", "Difficulty", "Source"] as const;

export const ANKI_DIRECTIVES = [
  "#separator:Comma",
  "#html:false",
  `#columns:${CSV_COLUMNS.join(",")}`,
  "#tags column:3",
] as const;

export function escapeCsvField(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

export function toCsvRow(fields: string[]): string {
  return fields.map(escapeCsvField).join(",");
}

export function cardsToCsv(cards: Flashcard[]): string {
  const rows = cards.map((card) =>
    toCsvRow([
      card.question,
      card.answer,
      card.tags.map((t) => t.replace(/\s+/g, "_")).join(" "),
      card.difficulty,
      card.sourceExcerpt,
    ]),
  );
  // \r\n line endings and a UTF-8 byte-order mark keep Excel and Anki happy.
  return "﻿" + [...ANKI_DIRECTIVES, ...rows].join("\r\n") + "\r\n";
}

/**
 * Minimal CSV parser used only by tests to prove the export round-trips.
 * Handles quoted fields, doubled quotes, line breaks inside quotes, and
 * skips Anki `#` directive lines.
 */
export function parseCsv(csv: string): string[][] {
  const text = csv.startsWith("﻿") ? csv.slice(1) : csv;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let atLineStart = true;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (atLineStart && !inQuotes && ch === "#") {
      const end = text.indexOf("\n", i);
      i = end === -1 ? text.length : end;
      continue;
    }
    atLineStart = false;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\r" && text[i + 1] === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += 1;
      atLineStart = true;
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      atLineStart = true;
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
