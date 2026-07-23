"use client";

import { useEffect, useState } from "react";
import { fetchDocument, mediaUrl, type DocView } from "@/lib/retriever";

/**
 * Modal viewer for an uploaded source. Images show the original file; PDFs show the
 * per-page renders; plain documents (docx/md/csv — no original kept) show extracted text.
 */
export default function DocViewer({
  collection,
  source,
  onClose,
}: {
  collection: string;
  source: string;
  onClose: () => void;
}) {
  const [doc, setDoc] = useState<DocView | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    let active = true;
    setDoc(null);
    setErr("");
    fetchDocument(collection, source)
      .then((d) => active && setDoc(d))
      .catch((e) => active && setErr((e as Error).message));
    return () => {
      active = false;
    };
  }, [collection, source]);

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-line bg-surface"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex shrink-0 items-center gap-3 border-b border-line px-5 py-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-raised text-amber">◈</span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm text-sand">{source}</div>
            {doc && (
              <div className="font-mono text-[11px] text-faint">
                <span className="chip mr-1 border-amber/30 text-amber">{doc.type ?? "?"}</span>
                {doc.chunks} chunks{doc.pages.length > 0 && ` · ${doc.pages.length} pages`}
              </div>
            )}
          </div>
          <button onClick={onClose} className="rounded-lg border border-line px-2 py-1 text-xs text-ash hover:text-sand">
            Close ✕
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {err && <p className="text-sm text-rust">Could not load: {err}</p>}
          {!doc && !err && <p className="text-sm text-faint">Loading…</p>}

          {doc?.type === "image" && doc.image_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={mediaUrl(doc.image_url)} alt={source} className="mx-auto max-w-full rounded-lg border border-line" />
          )}

          {doc?.type === "pdf" && (
            <div className="space-y-4">
              {doc.pages.length === 0 && <p className="text-sm text-faint">No page renders stored.</p>}
              {doc.pages.map((p) => (
                <figure key={p.page} className="space-y-1">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={mediaUrl(p.image_url)} alt={`page ${p.page}`} className="mx-auto max-w-full rounded-lg border border-line" />
                  <figcaption className="text-center font-mono text-[11px] text-faint">page {p.page}</figcaption>
                </figure>
              ))}
            </div>
          )}

          {doc?.type === "text" && (
            <div className="space-y-2">
              <p className="text-xs text-faint">
                Original file isn&apos;t stored for text documents — showing the extracted text used for retrieval.
              </p>
              <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-ash">{doc.text}</pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
