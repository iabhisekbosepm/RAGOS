"use client";

import { useState } from "react";
import { comparePlayground, type Strategy } from "@/lib/retriever";
import { useWorkspace } from "@/lib/workspace";
import InfoBox from "@/components/infobox";
import Suggestions from "@/components/suggestions";

const ALL: Strategy[] = ["semantic", "hybrid", "hyde", "graphrag"];

export default function Playground() {
  const { collection } = useWorkspace();
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Strategy[]>(["semantic"]);
  const [rerank, setRerank] = useState(false);
  const [results, setResults] = useState<Record<string, unknown> | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  function toggle(s: Strategy) { setPicked((p) => (p.includes(s) ? p.filter((x) => x !== s) : [...p, s])); }
  async function run(preset?: string) {
    const q = preset ?? query;
    if (!q.trim() || busy) return;
    setErr(""); setBusy(true);
    try { setResults((await comparePlayground(collection, q, picked, 5, rerank)).results); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <div className="p-6 lg:p-8">
      <p className="eyebrow mb-1">Inspect</p>
      <h1 className="mb-1 font-display text-2xl text-sand">Retrieval Playground</h1>
      <p className="mb-4 text-sm text-ash">Same query, multiple strategies, side by side.</p>

      <InfoBox title="What am I comparing?">
        <p>Before answering, the AI must <b className="text-sand">find</b> the most relevant passages. There's more than one way — this runs them together so you can see which finds better passages.</p>
        <ul className="ml-4 list-disc">
          <li><b className="text-sand">Semantic</b> — by meaning. <b className="text-sand">Hybrid</b> — meaning + keywords. <b className="text-sand">HyDE</b> — drafts a guess first. <b className="text-sand">GraphRAG</b> — follows the concept graph.</li>
          <li><b className="text-sand">Rerank</b> — a sharper second pass that re-sorts results.</li>
        </ul>
      </InfoBox>

      <div className="mb-3 flex gap-2">
        <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && run()} disabled={busy} className="field flex-1" placeholder="query" />
        <button onClick={() => run()} disabled={busy || !query.trim()} className="btn-accent">{busy ? "Comparing…" : "Compare"}</button>
      </div>
      <Suggestions collection={collection} onPick={(q) => { setQuery(q); run(q); }} disabled={busy} />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {ALL.map((s) => (
          <button key={s} onClick={() => toggle(s)}
            className={`rounded-full border px-3 py-1 font-mono text-xs transition-colors ${picked.includes(s) ? "border-amber/60 bg-amber/15 text-amber" : "border-line text-ash hover:text-sand"}`}>{s}</button>
        ))}
        <label className="ml-2 flex items-center gap-1 text-xs text-ash"><input type="checkbox" checked={rerank} onChange={(e) => setRerank(e.target.checked)} /> rerank</label>
      </div>
      {err && <p className="mb-4 text-sm text-rust">Error: {err}</p>}

      {busy && (
        <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${picked.length}, minmax(0,1fr))` }}>
          {picked.map((s) => (
            <div key={s} className="panel p-3">
              <h2 className="mb-2 flex items-center gap-2 font-display text-sm capitalize text-sand">
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-amber border-t-transparent" />{s}
              </h2>
              <div className="space-y-2">
                {[0, 1, 2].map((i) => <div key={i} className="h-12 animate-pulse rounded-lg border border-line bg-surface" />)}
              </div>
            </div>
          ))}
        </div>
      )}

      {!busy && results && (
        <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${picked.length}, minmax(0,1fr))` }}>
          {picked.map((s) => {
            const r = results[s] as unknown;
            const rows = Array.isArray(r) ? (r as { score: number; content: string; title?: string }[]) : null;
            return (
              <div key={s} className="panel p-3">
                <h2 className="mb-2 font-display text-sm capitalize text-sand">{s}</h2>
                {rows ? (
                  <ol className="space-y-2">
                    {rows.map((hit, i) => (
                      <li key={i} className="rounded-lg border border-line bg-surface p-2 text-xs">
                        <div className="mb-1 flex justify-between font-mono text-faint">
                          <span>#{i + 1} {hit.title}</span><span className="text-amber">{hit.score?.toFixed(4)}</span>
                        </div>
                        <p className="line-clamp-3 text-ash">{hit.content}</p>
                      </li>
                    ))}
                  </ol>
                ) : <p className="text-xs text-rust">{JSON.stringify(r)}</p>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
