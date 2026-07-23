"use client";

import { useEffect, useState } from "react";
import {
  evalGenerate, listEvalItems, addEvalItem, deleteEvalItem, evalRun, type EvalItem,
} from "@/lib/retriever";
import { useWorkspace } from "@/lib/workspace";
import InfoBox from "@/components/infobox";
import Tooltip from "@/components/tooltip";
import ToolShell from "@/components/tool-shell";
import EditorNote, { useCanEdit } from "@/components/editor-gate";

interface RunResult {
  question: string; answer: string; latency_ms: number; has_citations: boolean; errored?: boolean;
  faithfulness: number | null; answer_relevancy: number | null; context_relevance: number | null; reason: string;
}
interface Summary {
  n: number; scored?: number; errored?: number; faithfulness: number; answer_relevancy: number; context_relevance: number;
  avg_latency_ms: number; citation_rate: number; thresholds: Record<string, number>; pass: boolean;
}
const fmt = (v: number | null) => (v === null || v === undefined ? "—" : v.toFixed(2));

const METRIC_HELP: Record<string, string> = {
  faithfulness: "Is every claim in the answer supported by the retrieved context? Low = hallucination.",
  answer_relevancy: "Does the answer actually address the question asked?",
  context_relevance: "Were the retrieved passages relevant/sufficient for the question? (retrieval quality)",
};

function scoreColor(v: number, t: number) {
  return v >= t ? "text-teal" : v >= t - 0.15 ? "text-amber" : "text-rust";
}

export default function EvalPage() {
  const { collection } = useWorkspace();
  const canEdit = useCanEdit();
  const [items, setItems] = useState<EvalItem[]>([]);
  const [q, setQ] = useState("");
  const [strategy, setStrategy] = useState("hybrid");
  const [rerank, setRerank] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [results, setResults] = useState<RunResult[]>([]);

  async function refresh() { try { setItems(await listEvalItems(collection)); } catch { setItems([]); } }
  useEffect(() => { refresh(); setSummary(null); setResults([]); /* eslint-disable-next-line */ }, [collection]);

  async function gen() {
    setBusy(true); setMsg("Generating golden questions…");
    try { const d = await evalGenerate(collection, 6); setMsg(d.error ? d.error : `Added ${d.added} questions.`); await refresh(); }
    catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  }
  async function add() { if (!q.trim()) return; await addEvalItem(collection, q); setQ(""); refresh(); }
  async function run() {
    setBusy(true); setMsg("Running eval (retrieve → answer → judge each)…"); setSummary(null); setResults([]);
    try {
      const d = await evalRun(collection, strategy, rerank);
      if (d.error) setMsg(d.error);
      else { setSummary(d.summary); setResults(d.results); setMsg(""); }
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  }

  const sidebar = (
    <>
      <InfoBox title="What is evaluation?">
        <p>We measure answer quality on a set of golden questions using an <b className="text-sand">LLM-as-judge</b>:
          faithfulness (no hallucination), answer relevance, and retrieval (context) relevance — plus latency
          and citation rate. Change retrieval settings and re-run to compare.</p>
      </InfoBox>

      {canEdit ? (
        <div className="space-y-2">
          <button onClick={gen} disabled={busy} className="btn w-full">✦ Auto-generate golden set (6)</button>
          <div className="flex gap-2">
            <input value={q} onChange={(e) => setQ(e.target.value)} className="field flex-1" placeholder="add a question" onKeyDown={(e) => e.key === "Enter" && add()} />
            <button onClick={add} className="btn px-3">+</button>
          </div>
        </div>
      ) : <EditorNote action="Building and running evals" />}

      <div className="border-t border-line pt-3">
        <p className="eyebrow mb-2">golden set ({items.length})</p>
        <div className="max-h-56 space-y-1 overflow-y-auto">
          {items.map((it) => (
            <div key={it.id} className="group flex items-start gap-1 rounded px-1 py-1 text-xs hover:bg-raised">
              <span className="min-w-0 flex-1 text-ash">{it.question}</span>
              {canEdit && <button onClick={() => deleteEvalItem(it.id).then(refresh)} className="hidden text-faint hover:text-rust group-hover:block">✕</button>}
            </div>
          ))}
          {items.length === 0 && <p className="text-xs text-faint">No questions yet — generate or add.</p>}
        </div>
      </div>

      <div className="space-y-2 border-t border-line pt-3">
        <div className="flex items-center gap-3 text-xs text-ash">
          <label className="flex items-center gap-1">retrieval
            <select value={strategy} onChange={(e) => setStrategy(e.target.value)} className="field py-1">
              <option value="semantic">semantic</option><option value="hybrid">hybrid</option>
              <option value="hyde">HyDE</option><option value="graphrag">GraphRAG</option>
            </select>
          </label>
          <label className="flex items-center gap-1"><input type="checkbox" checked={rerank} onChange={(e) => setRerank(e.target.checked)} /> rerank</label>
        </div>
        {canEdit && <button onClick={run} disabled={busy || items.length === 0} className="btn-accent w-full">{busy ? "Running…" : "Run evaluation"}</button>}
      </div>
      {msg && <p className="text-xs text-ash">{msg}</p>}
    </>
  );

  return (
    <ToolShell eyebrow="Inspect" title="Evaluation" subtitle="Measure answer quality on a golden set (LLM-as-judge)." sidebar={sidebar}>
      {!summary && <p className="mt-10 text-center text-sm text-faint">Build a golden set on the left, then run an evaluation.</p>}

      {summary && (
        <>
          <div className={`mb-4 rounded-xl border p-4 ${summary.pass ? "border-teal/40 bg-teal/[0.06]" : "border-amber/40 bg-amber/[0.06]"}`}>
            <span className="font-display text-lg text-sand">{summary.pass ? "✓ Passed thresholds" : "△ Below thresholds"}</span>
            <span className="ml-2 font-mono text-xs text-faint">{summary.n} questions{summary.errored ? ` (${summary.errored} judge-errored, excluded)` : ""} · {strategy}{rerank ? " + rerank" : ""} · {summary.avg_latency_ms}ms avg · {Math.round(summary.citation_rate * 100)}% cited</span>
          </div>

          <div className="mb-6 grid grid-cols-3 gap-3">
            {(["faithfulness", "answer_relevancy", "context_relevance"] as const).map((k) => (
              <div key={k} className="rounded-xl border border-line bg-surface p-4 text-center">
                <div className={`font-display text-3xl ${scoreColor(summary[k], summary.thresholds[k])}`}>{summary[k].toFixed(2)}</div>
                <Tooltip content={METRIC_HELP[k]}>
                  <div className="mt-1 cursor-help border-b border-dotted border-faint text-xs text-ash">{k.replace("_", " ")}</div>
                </Tooltip>
                <div className="mt-1 font-mono text-[10px] text-faint">min {summary.thresholds[k]}</div>
              </div>
            ))}
          </div>

          <p className="eyebrow mb-2">per-question</p>
          <div className="space-y-2">
            {results.map((r, i) => (
              <div key={i} className="rounded-xl border border-line bg-surface p-3 text-sm">
                <div className="mb-1 flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sand">{r.question}</span>
                  {r.errored ? <span className="font-mono text-xs text-faint">judge errored</span> : <>
                    <span className={`font-mono text-xs ${scoreColor(r.faithfulness ?? 0, 0.85)}`}>f {fmt(r.faithfulness)}</span>
                    <span className={`font-mono text-xs ${scoreColor(r.answer_relevancy ?? 0, 0.8)}`}>a {fmt(r.answer_relevancy)}</span>
                    <span className={`font-mono text-xs ${scoreColor(r.context_relevance ?? 0, 0.7)}`}>c {fmt(r.context_relevance)}</span>
                  </>}
                </div>
                <p className="line-clamp-2 text-xs text-ash">{r.answer}</p>
                {r.reason && <p className="mt-1 text-[11px] text-faint">judge: {r.reason}</p>}
              </div>
            ))}
          </div>
        </>
      )}
    </ToolShell>
  );
}
