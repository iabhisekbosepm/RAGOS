"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { buildGraph, fetchGraph } from "@/lib/retriever";
import { useWorkspace } from "@/lib/workspace";
import InfoBox from "@/components/infobox";
import { useCanEdit } from "@/components/editor-gate";

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), { ssr: false });

interface GraphData {
  nodes: { id: string; degree: number }[];
  links: { source: string; target: string; relation: string }[];
  built: boolean;
}

export default function GraphPage() {
  const { collection } = useWorkspace();
  const canEdit = useCanEdit();
  const [data, setData] = useState<GraphData>({ nodes: [], links: [], built: false });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fgRef = useRef<any>(null);
  const [size, setSize] = useState({ w: 800, h: 560 });

  // Track the canvas container size so the graph fills the panel responsively.
  useEffect(() => {
    const measure = () => { if (wrapRef.current) setSize({ w: wrapRef.current.clientWidth, h: wrapRef.current.clientHeight }); };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [data.nodes.length]);

  const fitGraph = useCallback(() => fgRef.current?.zoomToFit(400, 60), []);

  async function load() {
    setMsg("");
    try {
      const g = await fetchGraph(collection);
      setData({ nodes: g.nodes, links: g.edges, built: g.built });
      if (!g.built) setMsg("No graph yet — click Build.");
    } catch (e) { setMsg((e as Error).message); }
  }
  async function build() {
    setBusy(true); setMsg("Building graph (LLM extracting entities & relations)…");
    try { const r = await buildGraph(collection); setMsg(`Built ${r.nodes} entities, ${r.edges} relations.`); await load(); }
    catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [collection]);

  return (
    <div className="p-6 lg:p-8">
      <p className="eyebrow mb-1">Inspect</p>
      <h1 className="mb-1 font-display text-2xl text-sand">Knowledge Graph</h1>
      <p className="mb-4 text-sm text-ash">Entities and how they connect, extracted from your documents.</p>

      <InfoBox title="What is the Knowledge Graph?">
        <p>The AI pulls out the important <b className="text-sand">things</b> (people, tools, concepts) and the
          <b className="text-sand"> relationships</b> between them, then draws them as a map.</p>
        <p>Each dot is a concept; each line a relationship (“Qdrant — stores — vectors”). Click <b className="text-sand">Build</b> once to generate it.</p>
      </InfoBox>

      <div className="mb-4 flex items-center gap-3 text-sm text-ash">
        <span>Workspace <span className="text-amber">{collection}</span></span>
        <button onClick={load} className="btn px-3 py-1 text-xs">Load</button>
        {canEdit && (
          <button onClick={build} disabled={busy} className="btn-accent px-3 py-1 text-xs">{busy ? "Building…" : "Build / Rebuild"}</button>
        )}
        {!canEdit && <span className="text-[11px] text-faint">🔒 building needs the editor role</span>}
      </div>
      {msg && <p className="mb-4 text-sm text-ash">{msg}</p>}

      {data.nodes.length > 0 && (
        <div ref={wrapRef} className="relative h-[calc(100vh-14rem)] min-h-[440px] w-full overflow-hidden rounded-xl border border-line">
          <button
            onClick={fitGraph}
            className="absolute right-3 top-3 z-10 rounded-lg border border-line bg-ink/80 px-2 py-1 text-xs text-ash backdrop-blur hover:border-amber/50 hover:text-amber"
            title="Fit to screen"
          >
            Fit
          </button>
          <ForceGraph2D
            ref={fgRef}
            graphData={data}
            width={size.w}
            height={size.h}
            nodeLabel="id"
            nodeColor={() => "#C8FF00"}
            linkColor={() => "#26262B"}
            linkLabel="relation"
            nodeRelSize={4}
            backgroundColor="#141416"
            cooldownTicks={120}
            onEngineStop={fitGraph}
          />
          <p className="pointer-events-none absolute bottom-2 left-3 font-mono text-[10px] text-faint">scroll = zoom · drag = pan</p>
        </div>
      )}
    </div>
  );
}
