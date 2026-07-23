interface StudyResult {
  tool: string;
  items?: unknown[];
  mermaid?: string;
  markdown?: string;
}

/** Convert a study result into downloadable text (markdown, or .mmd for diagrams). */
export function studyToFile(r: StudyResult): { filename: string; content: string; mime: string } {
  const stamp = r.tool;
  if (r.mermaid) return { filename: `${stamp}.mmd`, content: r.mermaid, mime: "text/plain" };
  if (r.markdown) return { filename: `${stamp}.md`, content: r.markdown, mime: "text/markdown" };

  const items = (r.items ?? []) as Array<Record<string, unknown>>;
  let md = `# ${r.tool}\n\n`;
  if (r.tool === "flashcards") {
    items.forEach((it, i) => (md += `**Q${i + 1}. ${it.front}**\n\n${it.back}\n\n---\n\n`));
  } else if (r.tool === "quiz") {
    items.forEach((it, i) => {
      md += `**${i + 1}. ${it.question}**\n\n`;
      (it.options as string[] | undefined)?.forEach(
        (o, oi) => (md += `- ${String.fromCharCode(65 + oi)}. ${o}${oi === it.answer_index ? "  ✅" : ""}\n`),
      );
      if (it.explanation) md += `\n> ${it.explanation}\n`;
      md += `\n`;
    });
  } else {
    items.forEach((it) => (md += `- **${it.point}** — ${it.detail ?? ""}\n`));
  }
  return { filename: `${stamp}.md`, content: md, mime: "text/markdown" };
}

export function downloadFile(filename: string, content: string, mime = "text/plain") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
