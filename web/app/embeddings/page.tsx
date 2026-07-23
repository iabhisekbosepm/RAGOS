"use client";

import { useMemo, useState } from "react";
import { fetchUmap, type UmapPoint } from "@/lib/retriever";
import { useWorkspace } from "@/lib/workspace";
import InfoBox from "@/components/infobox";
import Suggestions from "@/components/suggestions";

const W = 720, H = 480, PAD = 30;

export default function Embeddings() {
  const { collection } = useWorkspace();
  const [query, setQuery] = useState("");
  const [points, setPoints] = useState<UmapPoint[]>([]);
  const [hover, setHover] = useState<UmapPoint | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function load(preset?: string) {
    const q = preset ?? query;
    if (busy) return;
    setErr(""); setBusy(true);
    try { setPoints(await fetchUmap(collection, q)); } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  const scaled = useMemo(() => {
    if (points.length === 0) return [];
    const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
    const [minX, maxX] = [Math.min(...xs), Math.max(...xs)];
    const [minY, maxY] = [Math.min(...ys), Math.max(...ys)];
    const sx = (v: number) => PAD + ((v - minX) / (maxX - minX || 1)) * (W - 2 * PAD);
    const sy = (v: number) => PAD + ((v - minY) / (maxY - minY || 1)) * (H - 2 * PAD);
    return points.map((p) => ({ ...p, cx: sx(p.x), cy: sy(p.y) }));
  }, [points]);

  return (
    <div className="p-6 lg:p-8">
      <p className="eyebrow mb-1">Inspect</p>
      <h1 className="mb-1 font-display text-2xl text-sand">Embedding Explorer</h1>
      <p className="mb-4 text-sm text-ash">A map of your workspace's meaning. Enter a query to see where it lands.</p>

      <InfoBox title="What am I looking at?">
        <p>Every passage becomes a list of numbers capturing its <b className="text-sand">meaning</b>. Similar topics get similar numbers.</p>
        <p>Here they're flattened onto a 2-D map: <b className="text-sand">each dot is a passage</b>; nearby dots are about similar things.
          Type a question → the <b className="text-amber">amber dot</b> shows where it lands. That nearness is how retrieval decides relevance.</p>
      </InfoBox>

      <div className="mb-4 flex gap-2">
        <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load()} disabled={busy} className="field flex-1" placeholder="optional query to project" />
        <button onClick={() => load()} disabled={busy} className="btn-accent">{busy ? "Projecting…" : "Project"}</button>
      </div>
      <Suggestions collection={collection} onPick={(q) => { setQuery(q); load(q); }} disabled={busy} />

      {err && <p className="mb-4 text-sm text-rust">Error: {err}</p>}

      <div className="flex flex-wrap gap-4">
        <div className="relative">
        {busy && (
          <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 rounded-xl bg-ink/50 text-sm text-sand backdrop-blur-sm">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-amber border-t-transparent" />
            projecting embeddings…
          </div>
        )}
        <svg width={W} height={H} className="rounded-xl border border-line bg-surface">
          {scaled.map((p) => (
            <circle key={p.id} cx={p.cx} cy={p.cy} r={p.is_query ? 8 : 4}
              fill={p.is_query ? "#C8FF00" : "#22D3EE"} opacity={p.is_query ? 1 : 0.7}
              onMouseEnter={() => setHover(p)} className="cursor-pointer" />
          ))}
        </svg>
        </div>
        <div className="panel w-64 p-3 text-sm">
          {hover ? (
            <>
              <div className="eyebrow mb-1">{hover.is_query ? "query" : hover.source}</div>
              <p className="text-ash">{hover.content}</p>
            </>
          ) : <p className="text-faint">Hover a point. {points.length > 0 && `${points.length} points.`}</p>}
        </div>
      </div>
    </div>
  );
}
