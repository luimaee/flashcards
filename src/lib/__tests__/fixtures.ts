/** Shared test fixtures: a realistic lecture excerpt and tiny hand-built PDFs. */

export const LECTURE_TEXT = `
Photosynthesis is the process by which green plants convert light energy into chemical energy stored in glucose.
The overall reaction is 6CO2 + 6H2O + light -> C6H12O6 + 6O2, which takes place inside the chloroplast.
Chlorophyll a is the primary pigment that absorbs light most strongly in the blue and red regions of the spectrum.
The light-dependent reactions occur in the thylakoid membranes and produce ATP and NADPH.
Photosystem II is the first protein complex in the light-dependent reactions and it splits water to release oxygen.
The Calvin cycle refers to the light-independent reactions that fix carbon dioxide into three-carbon sugars in the stroma.
RuBisCO is the enzyme that catalyses the first major step of carbon fixation, and it is the most abundant protein on Earth.
Melvin Calvin was awarded the Nobel Prize in Chemistry in 1961 for mapping the carbon fixation pathway.
C4 plants such as maize and sugarcane concentrate carbon dioxide in bundle sheath cells to reduce photorespiration.
CAM plants open their stomata at night to take in carbon dioxide and store it as malic acid until daylight.
The compensation point is the light intensity at which the rate of photosynthesis equals the rate of respiration.
Limiting factors for photosynthesis include light intensity, carbon dioxide concentration, and temperature.
At very high temperatures the enzymes involved denature and the rate of photosynthesis falls sharply.
Stomata are small pores on the leaf surface that regulate gas exchange and water loss through transpiration.
`.trim();

export const SHORT_TEXT = "Photosynthesis makes glucose from light, water and carbon dioxide.";

/**
 * Build a minimal but valid PDF from a list of page content streams.
 * Passing an empty content stream gives a blank page with no text.
 */
export function buildPdf(pageContents: string[]): Uint8Array<ArrayBuffer> {
  const objects: string[] = [];
  const pageIds: number[] = [];
  // 1 = catalog, 2 = pages, 3 = font, then page/content pairs.
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push("PLACEHOLDER_PAGES");
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  for (const content of pageContents) {
    const contentId = objects.length + 2;
    const pageId = objects.length + 1;
    pageIds.push(pageId);
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`,
    );
    objects.push(`<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`);
  }
  objects[1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;

  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((obj, index) => {
    offsets.push(Buffer.byteLength(body, "latin1"));
    body += `${index + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(body, "latin1");
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Uint8Array.from(Buffer.from(body, "latin1"));
}

export function textPage(lines: string[]): string {
  const ops = lines
    .map((line, i) => `BT /F1 12 Tf 72 ${740 - i * 16} Td (${line.replace(/[()\\]/g, "\\$&")}) Tj ET`)
    .join("\n");
  return ops;
}

export function pdfWithText(): Uint8Array<ArrayBuffer> {
  const lines = LECTURE_TEXT.split("\n");
  return buildPdf([textPage(lines.slice(0, 7)), textPage(lines.slice(7))]);
}

export function blankPdf(): Uint8Array<ArrayBuffer> {
  return buildPdf([""]);
}

export function brokenPdf(): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(Buffer.from("%PDF-1.4\nthis is not really a pdf at all\n", "latin1"));
}
