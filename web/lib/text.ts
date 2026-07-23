/** Make raw chunk text readable for source previews (strip markdown-table & parser noise). */
export function cleanPreview(text: string, max = 240): string {
  let t = text
    .replace(/\[?<RawText children=['"](.*?)['"]>\]?/g, "$1") // Docling artifacts
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/`{1,3}/g, "") // stray code fences/ticks
    .replace(/\|?\s*-{3,}\s*\|?/g, " ") // table divider rows
    .replace(/\s*\|\s*/g, " · ") // table cell pipes → dots
    .replace(/\s+/g, " ")
    .trim();
  if (t.length > max) t = t.slice(0, max).trimEnd() + "…";
  return t;
}
