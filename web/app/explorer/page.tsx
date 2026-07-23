"use client";

import { useEffect, useState } from "react";
import { fetchChunks, type Chunk } from "@/lib/retriever";
import { useWorkspace } from "@/lib/workspace";
import InfoBox from "@/components/infobox";

export default function Explorer() {
  const { collection } = useWorkspace();
  const [chunks, setChunks] = useState<Chunk[]>([]);
  const [selected, setSelected] = useState<Chunk | null>(null);
  const [err, setErr] = useState("");

  async function load() {
    setErr(""); setSelected(null);
    try { setChunks(await fetchChunks(collection)); } catch (e) { setErr((e as Error).message); }
  }
  useEffect(() => {
    let active = true;
    setSelected(null); setChunks([]);
    fetchChunks(collection).then((c) => active && setChunks(c)).catch(() => active && setChunks([]));
    return () => { active = false; };
  }, [collection]);

  return (
    <div className="p-6 lg:p-8">
      <p className="eyebrow mb-1">Inspect</p>
      <h1 className="mb-1 font-display text-2xl text-sand">Chunk Explorer</h1>
      <p className="mb-4 text-sm text-ash">Inspect how a document was split up and indexed.</p>

      <InfoBox title="What is a “chunk”?">
        <p>Each upload is sliced into small passages called <b className="text-sand">chunks</b>. When you ask a
          question, the system searches these chunks and answers from the most relevant ones.</p>
        <p>Click any chunk to see its full text and metadata — a peek under the hood.</p>
      </InfoBox>

      <div className="mb-4 flex items-center gap-3 text-sm text-ash">
        <span>Workspace <span className="text-amber">{collection}</span> · {chunks.length} chunks</span>
        <button onClick={load} className="btn px-3 py-1 text-xs">Reload</button>
      </div>
      {err && <p className="mb-4 text-sm text-rust">Error: {err}</p>}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <ul className="max-h-[70vh] space-y-2 overflow-auto pr-1">
          {chunks.map((c) => (
            <li key={c.id} onClick={() => setSelected(c)}
              className={`cursor-pointer rounded-xl border p-3 text-sm transition-colors ${selected?.id === c.id ? "border-amber/60 bg-amber/[0.06]" : "border-line bg-surface hover:border-amber/40"}`}>
              <div className="mb-1 font-mono text-[10px] text-faint">
                {String(c.metadata.source ?? "")} · chunk {String(c.metadata.chunk_index ?? "?")}
                {c.metadata.chunk_strategy ? ` · ${c.metadata.chunk_strategy}` : ""}
              </div>
              <p className="line-clamp-2 text-ash">{c.content}</p>
            </li>
          ))}
          {chunks.length === 0 && !err && <p className="text-sm text-faint">No chunks in this workspace.</p>}
        </ul>

        <div className="panel h-fit p-4 text-sm">
          {selected ? (
            <>
              <h2 className="mb-2 font-display text-sand">Chunk detail</h2>
              <pre className="mb-3 whitespace-pre-wrap font-sans text-ash">{selected.content}</pre>
              <h3 className="eyebrow mb-1">Metadata</h3>
              <pre className="font-mono text-[11px] text-faint">{JSON.stringify(selected.metadata, null, 2)}</pre>
            </>
          ) : <p className="text-faint">Select a chunk.</p>}
        </div>
      </div>
    </div>
  );
}
