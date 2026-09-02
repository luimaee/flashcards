import type { Flashcard } from "./flashcards/schema";

/**
 * Anki-friendly CSV export.
 *
 * Columns (in order): Front, Back, Tags, Difficulty, Source
 * - Front / Back map straight onto Anki's Basic note type.
 * - Tags are space-separated, which is how Anki reads a tags column.
 * - Difficulty and Source are extra fields; map them to a note field or
 *   ignore them in Anki's import dialog.
 *
 * Every value is quoted; quotes are doubled; line breaks stay inside quotes.
 */

export const CSV_COLUMNS = ["Front", "Back", "Tags", "Difficulty", "Source"] as const;

export function escapeCsvField(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

export function toCsvRow(fields: string[]): string {
  return fields.map(escapeCsvField).join(",");
}

export function cardsToCsv(cards: Flashcard[]): string {
  const header = toCsvRow([...CSV_COLUMNS]);
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
  return "﻿" + [header, ...rows].join("\r\n") + "\r\n";
}

/**
 * Minimal CSV parser used only by tests to prove the export round-trips.
 * Handles quoted fields, doubled quotes and line breaks inside quotes.
 */
export function parseCsv(csv: string): string[][] {
  const text = csv.startsWith("﻿") ? csv.slice(1) : csv;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
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
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
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
