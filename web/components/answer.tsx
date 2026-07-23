"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import VisualCitation from "@/components/visual-citation";
import { cleanPreview } from "@/lib/text";

export interface Citation {
  content: string;
  score: number;
  title?: string;
  metadata?: { type?: string; image_url?: string };
}

/** NotebookLM-style answer: rendered markdown + clickable [n] chips + clean source cards. */
export default function Answer({
  turnKey,
  content,
  citations = [],
  query = "",
}: {
  turnKey: string;
  content: string;
  citations?: Citation[];
  query?: string;
}) {
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [flash, setFlash] = useState<number | null>(null);

  const cid = (n: number) => `cite-${turnKey}-${n}`;

  function jumpTo(n: number) {
    const el = document.getElementById(cid(n));
    if (!el) return;
    setExpanded((e) => ({ ...e, [n]: true }));
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setFlash(n);
    setTimeout(() => setFlash(null), 1500);
  }

  // Turn inline [1] / [1, 2] into markdown links → rendered as citation chips.
  const linked = content.replace(/\[(\d+(?:\s*,\s*\d+)*)\]/g, (_m, group: string) =>
    group
      .split(/\s*,\s*/)
      .map((n) => `[${n}](#${cid(Number(n))})`)
      .join(""),
  );

  return (
    <div>
      <div className="prose-answer rounded-xl border border-line bg-raised/60 p-5 text-[15px] leading-relaxed text-sand">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            a: ({ href, children }) => {
              const n = Number((href ?? "").split("-").pop());
              if (href?.startsWith("#cite-") && !Number.isNaN(n)) {
                return (
                  <button
                    onClick={() => jumpTo(n)}
                    className="mx-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded bg-amber px-1 align-super text-[10px] font-medium text-ink hover:bg-amber-2"
                  >
                    {n}
                  </button>
                );
              }
              return <a href={href} className="text-amber underline">{children}</a>;
            },
            p: ({ children }) => <p className="mb-3 last:mb-0">{children}</p>,
            ul: ({ children }) => <ul className="mb-3 ml-5 list-disc space-y-1">{children}</ul>,
            ol: ({ children }) => <ol className="mb-3 ml-5 list-decimal space-y-1">{children}</ol>,
            strong: ({ children }) => <strong className="font-semibold text-sand">{children}</strong>,
            code: ({ children }) => <code className="rounded bg-ink px-1 py-0.5 font-mono text-xs text-amber">{children}</code>,
            h1: ({ children }) => <h3 className="mb-2 mt-1 font-display text-base">{children}</h3>,
            h2: ({ children }) => <h3 className="mb-2 mt-1 font-display text-base">{children}</h3>,
            table: ({ children }) => <table className="mb-3 w-full border-collapse text-xs">{children}</table>,
            td: ({ children }) => <td className="border border-line px-2 py-1">{children}</td>,
            th: ({ children }) => <th className="border border-line bg-raised px-2 py-1 text-left">{children}</th>,
          }}
        >
          {linked || "…"}
        </ReactMarkdown>
      </div>

      {citations.length > 0 && (
        <div className="mt-3">
          <h4 className="eyebrow mb-2">Sources ({citations.length})</h4>
          <div className="space-y-2">
            {citations.map((c, j) => {
              const n = j + 1;
              const visual = (c.metadata?.type === "image" || c.metadata?.type === "pdf_page") && c.metadata.image_url;
              const isImage = visual;
              const isOpen = expanded[n] || isImage;
              return (
                <div
                  key={j}
                  id={cid(n)}
                  className={`rounded-lg border p-3 text-xs transition-colors ${
                    flash === n ? "border-amber/70 bg-amber/10" : "border-line bg-surface hover:border-amber/30"
                  }`}
                >
                  <button
                    onClick={() => setExpanded((e) => ({ ...e, [n]: !e[n] }))}
                    className="flex w-full items-center justify-between text-left"
                  >
                    <span className="flex items-center gap-2 text-ash">
                      <span className="inline-flex h-5 w-5 items-center justify-center rounded bg-amber font-mono text-[10px] font-medium text-ink">
                        {n}
                      </span>
                      <span className="font-medium text-sand">{c.title ?? "source"}</span>
                      {isImage && <span>🖼</span>}
                    </span>
                    <span className="font-mono text-faint">{c.score?.toFixed(3)}</span>
                  </button>

                  {isImage ? (
                    <VisualCitation imageUrl={c.metadata!.image_url!} query={query} />
                  ) : (
                    <p className={`mt-2 text-ash ${isOpen ? "" : "line-clamp-2"}`}>
                      {isOpen ? cleanPreview(c.content, 1200) : cleanPreview(c.content, 180)}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
