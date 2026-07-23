"use client";

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  generateStudy, listStudyArtifacts, getStudyArtifact, deleteStudyArtifact, type StudyArtifact,
} from "@/lib/retriever";
import { useWorkspace } from "@/lib/workspace";
import { studyToFile, downloadFile } from "@/lib/download";
import InfoBox from "@/components/infobox";
import Mermaid from "@/components/mermaid";
import ToolShell from "@/components/tool-shell";
import EditorNote, { useCanEdit } from "@/components/editor-gate";

const TOOLS = [
  { id: "flashcards", label: "Flashcards" }, { id: "quiz", label: "Quiz (MCQ)" },
  { id: "summary", label: "Summary" }, { id: "cheatsheet", label: "Cheat Sheet" },
  { id: "prd", label: "PRD" }, { id: "mermaid", label: "Flowchart" },
  { id: "mindmap", label: "Mind Map" }, { id: "uml", label: "UML (sequence)" },
];

interface Item { front?: string; back?: string; question?: string; options?: string[]; answer_index?: number; explanation?: string; point?: string; detail?: string }
interface Result { tool: string; items?: Item[]; mermaid?: string; markdown?: string; error?: string }

const md = {
  h1: ({ children }: { children?: React.ReactNode }) => <h2 className="mb-2 mt-3 font-display text-lg text-sand">{children}</h2>,
  h2: ({ children }: { children?: React.ReactNode }) => <h3 className="mb-2 mt-3 font-display text-sand">{children}</h3>,
  ul: ({ children }: { children?: React.ReactNode }) => <ul className="mb-3 ml-5 list-disc space-y-1">{children}</ul>,
  ol: ({ children }: { children?: React.ReactNode }) => <ol className="mb-3 ml-5 list-decimal space-y-1">{children}</ol>,
  p: ({ children }: { children?: React.ReactNode }) => <p className="mb-3">{children}</p>,
  strong: ({ children }: { children?: React.ReactNode }) => <strong className="font-semibold text-sand">{children}</strong>,
};

export default function Study() {
  const { collection } = useWorkspace();
  const [tool, setTool] = useState("flashcards");
  const [topic, setTopic] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [reveal, setReveal] = useState<Record<number, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [history, setHistory] = useState<StudyArtifact[]>([]);
  const canEdit = useCanEdit();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get("tool");
    if (t && TOOLS.some((x) => x.id === t)) setTool(t);
    const id = params.get("id");
    if (id) loadArtifact(id).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  async function refreshHistory() {
    try { const all = await listStudyArtifacts(collection); setHistory(all.filter((a) => a.tool !== "audio")); }
    catch { setHistory([]); }
  }
  useEffect(() => { refreshHistory(); setResult(null); /* eslint-disable-next-line */ }, [collection]);

  async function run() {
    setBusy(true); setErr(""); setResult(null); setReveal({});
    try { const data: Result = await generateStudy(collection, tool, 6, topic); if (data.error) setErr(data.error); else { setResult(data); refreshHistory(); } }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  async function loadArtifact(id: string) {
    setErr(""); setReveal({});
    const a = await getStudyArtifact(id);
    if (a.error) return setErr(a.error);
    setTool(a.tool); setResult(a.payload);
  }
  function download() { if (result) { const f = studyToFile(result); downloadFile(f.filename, f.content, f.mime); } }

  const items = result?.items ?? [];

  const sidebar = (
    <>
      <InfoBox title="What are Study Tools?">
        <p>The AI reads this workspace's documents and turns them into study aids: revision cards, quizzes,
          summaries, cheat sheets, PRDs, and diagrams (flowchart / mind map / UML).</p>
      </InfoBox>
      <div className="space-y-2">
        <label className="block">
          <span className="eyebrow">tool</span>
          <select value={tool} onChange={(e) => setTool(e.target.value)} className="field mt-1 w-full">
            {TOOLS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="eyebrow">topic (optional)</span>
          <input value={topic} onChange={(e) => setTopic(e.target.value)} className="field mt-1 w-full" placeholder="blank = whole workspace" />
        </label>
        {canEdit
          ? <button onClick={run} disabled={busy} className="btn-accent w-full">{busy ? "Generating…" : "Generate"}</button>
          : <EditorNote action="Generating study material" />}
      </div>

      {history.length > 0 && (
        <div className="border-t border-line pt-4">
          <p className="eyebrow mb-2">Saved outputs</p>
          <div className="space-y-1">
            {history.map((a) => (
              <div key={a.id} className="group flex items-center justify-between rounded-lg px-2 py-1.5 text-sm hover:bg-raised">
                <button onClick={() => loadArtifact(a.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                  <span className="chip border-amber/30 text-amber">{a.tool}</span>
                  <span className="min-w-0 flex-1 truncate text-ash">{a.topic || "whole workspace"}</span>
                </button>
                {canEdit && <button onClick={() => deleteStudyArtifact(a.id).then(refreshHistory)} className="ml-1 hidden text-faint hover:text-rust group-hover:block">✕</button>}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );

  return (
    <ToolShell eyebrow="Create" title="Study Tools" subtitle="Auto-generate learning material from your workspace." sidebar={sidebar}>
      {err && <p className="mb-4 text-sm text-rust">Error: {err}</p>}
      {!result && !err && <p className="mt-10 text-center text-sm text-faint">Pick a tool on the left and hit Generate.</p>}

      {result && (
        <div className="mb-3 flex items-center justify-between">
          <span className="chip border-amber/30 text-amber">{result.tool}</span>
          <button onClick={download} className="btn px-3 py-1 text-xs">⬇ Download</button>
        </div>
      )}

      {result?.mermaid && <Mermaid code={result.mermaid} fill />}

      {result?.markdown && (
        <div className="panel prose-answer p-5 text-sm leading-relaxed text-ash">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={md}>{result.markdown}</ReactMarkdown>
        </div>
      )}

      {items.length > 0 && (
        <div className={result?.tool === "flashcards" ? "grid gap-3 sm:grid-cols-2" : "space-y-3"}>
          {items.map((it, i) => {
            if (result?.tool === "flashcards") return (
              <div key={i} onClick={() => setReveal((r) => ({ ...r, [i]: !r[i] }))} className="cursor-pointer rounded-xl border border-line bg-surface p-4 text-sm hover:border-amber/40">
                <p className="font-medium text-sand">{it.front}</p>
                {reveal[i] ? <p className="mt-2 text-amber">{it.back}</p> : <p className="mt-2 text-xs text-faint">click to reveal</p>}
              </div>
            );
            if (result?.tool === "quiz") return (
              <div key={i} className="rounded-xl border border-line bg-surface p-4 text-sm">
                <p className="mb-2 font-medium text-sand">{i + 1}. {it.question}</p>
                <ul className="space-y-1">
                  {it.options?.map((opt, oi) => (
                    <li key={oi} className={`rounded px-2 py-1 ${reveal[i] && oi === it.answer_index ? "bg-teal/15 text-teal" : "text-ash"}`}>{String.fromCharCode(65 + oi)}. {opt}</li>
                  ))}
                </ul>
                <button onClick={() => setReveal((r) => ({ ...r, [i]: !r[i] }))} className="mt-2 text-xs text-amber">{reveal[i] ? "hide answer" : "show answer"}</button>
                {reveal[i] && it.explanation && <p className="mt-2 text-xs text-faint">{it.explanation}</p>}
              </div>
            );
            return (
              <div key={i} className="rounded-xl border border-line bg-surface p-4 text-sm">
                <p className="font-medium text-sand">• {it.point}</p>
                {it.detail && <p className="mt-1 text-ash">{it.detail}</p>}
              </div>
            );
          })}
        </div>
      )}
    </ToolShell>
  );
}
