"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Answer from "@/components/answer";
import { useWorkspace } from "@/lib/workspace";
import { useAuth } from "@/lib/auth";
import {
  listConversations, getConversation, deleteConversation,
  listDocuments, mediaUrl, sendFeedback, fetchSuggestions,
  listStudyArtifacts, deleteStudyArtifact,
  type Conversation, type DocItem, type StudyArtifact,
} from "@/lib/retriever";

interface Citation { content: string; score: number; title?: string; metadata?: { type?: string; image_url?: string } }
interface Step { step: string; detail?: string }
interface Turn { role: "user" | "assistant"; content: string; query?: string; steps?: Step[]; citations?: Citation[]; images?: string[] }

const CREATE = [
  { label: "Audio Overview", href: "/audio", glyph: "◍", note: "2-host podcast" },
  { label: "Flashcards", href: "/study?tool=flashcards", glyph: "▤", note: "Q & A" },
  { label: "Quiz", href: "/study?tool=quiz", glyph: "◇", note: "MCQ" },
  { label: "Mind Map", href: "/study?tool=mindmap", glyph: "❋", note: "concepts" },
  { label: "Cheat Sheet", href: "/study?tool=cheatsheet", glyph: "≡", note: "condensed" },
  { label: "UML", href: "/study?tool=uml", glyph: "⇄", note: "sequence" },
  { label: "PRD", href: "/study?tool=prd", glyph: "▧", note: "doc" },
];
// Artifact tool → glyph + label + which page opens it (audio has its own page).
const TOOL_META: Record<string, { glyph: string; label: string }> = {
  audio: { glyph: "◍", label: "Audio Overview" },
  flashcards: { glyph: "▤", label: "Flashcards" },
  quiz: { glyph: "◇", label: "Quiz" },
  summary: { glyph: "≡", label: "Summary" },
  cheatsheet: { glyph: "≡", label: "Cheat Sheet" },
  prd: { glyph: "▧", label: "PRD" },
  mermaid: { glyph: "⇄", label: "Flowchart" },
  mindmap: { glyph: "❋", label: "Mind Map" },
  uml: { glyph: "⇄", label: "UML" },
};
const artifactMeta = (tool: string) => TOOL_META[tool] ?? { glyph: "◈", label: tool };
const artifactHref = (a: StudyArtifact) =>
  a.tool === "audio" ? `/audio?id=${a.id}` : `/study?tool=${a.tool}&id=${a.id}`;
function relTime(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const INSPECT = [
  { label: "Retrieval Playground", href: "/playground", glyph: "⚗", note: "compare strategies" },
  { label: "Chunk Explorer", href: "/explorer", glyph: "▦", note: "how it's split" },
  { label: "Embedding Explorer", href: "/embeddings", glyph: "✦", note: "meaning map" },
  { label: "Knowledge Graph", href: "/graph", glyph: "❈", note: "concept links" },
  { label: "Evaluation", href: "/eval", glyph: "◑", note: "answer quality" },
  { label: "Analytics", href: "/analytics", glyph: "◷", note: "usage & feedback" },
  { label: "How it works", href: "/learn", glyph: "❓", note: "guided tour" },
];

export default function Workspace() {
  const { collection } = useWorkspace();
  const { can } = useAuth();
  const canEdit = can("editor");
  const [docs, setDocs] = useState<DocItem[]>([]);
  const [query, setQuery] = useState("");
  const [attached, setAttached] = useState<string[]>([]);  // base64 data-URL reference images
  const [turns, setTurns] = useState<Turn[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [convos, setConvos] = useState<Conversation[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [showTune, setShowTune] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [strategy, setStrategy] = useState("hybrid");
  const [promptStyle, setPromptStyle] = useState("standard");
  const [rerank, setRerank] = useState(false);
  const [included, setIncluded] = useState<Set<string>>(new Set());
  const [rated, setRated] = useState<Record<number, number>>({});
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [studioTab, setStudioTab] = useState<"create" | "inspect" | "library">("create");
  const [artifacts, setArtifacts] = useState<StudyArtifact[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLeftOpen(localStorage.getItem("panel_sources") !== "0");
    setRightOpen(localStorage.getItem("panel_studio") !== "0");
  }, []);
  const toggleLeft = () => setLeftOpen((v) => { localStorage.setItem("panel_sources", v ? "0" : "1"); return !v; });
  const toggleRight = () => setRightOpen((v) => { localStorage.setItem("panel_studio", v ? "0" : "1"); return !v; });

  async function refresh() {
    listDocuments(collection).then(setDocs).catch(() => setDocs([]));
    listConversations(collection).then(setConvos).catch(() => setConvos([]));
  }
  function refreshArtifacts() {
    listStudyArtifacts(collection).then(setArtifacts).catch(() => setArtifacts([]));
  }
  async function removeArtifact(id: string) {
    await deleteStudyArtifact(id).catch(() => {});
    setArtifacts((a) => a.filter((x) => x.id !== id));
  }
  // Guard against out-of-order responses when the workspace changes.
  useEffect(() => {
    let active = true;
    setDocs([]); setConvos([]); setSuggestions([]); setArtifacts([]);
    listDocuments(collection).then((d) => { if (active) { setDocs(d); setIncluded(new Set(d.map((x) => x.source))); } }).catch(() => active && setDocs([]));
    listConversations(collection).then((c) => active && setConvos(c)).catch(() => active && setConvos([]));
    listStudyArtifacts(collection).then((a) => active && setArtifacts(a)).catch(() => active && setArtifacts([]));
    fetchSuggestions(collection).then((s) => active && setSuggestions(s)).catch(() => active && setSuggestions([]));
    newChat();
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collection]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns]);

  function newChat() {
    setTurns([]);
    setConversationId(null);
    setErr("");
  }
  function toggleSrc(s: string) {
    setIncluded((p) => { const n = new Set(p); n.has(s) ? n.delete(s) : n.add(s); return n; });
  }
  function rate(i: number, r: number, q?: string) {
    sendFeedback(collection, conversationId ?? "", r, q ?? "").catch(() => {});
    setRated((p) => ({ ...p, [i]: r }));
  }
  async function openConversation(id: string) {
    setShowHistory(false);
    const messages = await getConversation(id);
    setTurns(messages.map((m: { role: "user" | "assistant"; content: string; meta: { citations?: Citation[] } }) => ({
      role: m.role, content: m.content, citations: m.meta?.citations,
    })));
    setConversationId(id);
  }

  function fileToDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }
  async function addImages(files: FileList | File[]) {
    const imgs = [...files].filter((f) => f.type.startsWith("image/")).slice(0, 3);
    const urls = await Promise.all(imgs.map(fileToDataUrl));
    setAttached((a) => [...a, ...urls].slice(0, 3));  // cap 3 to bound latency/cost
  }
  function onPaste(e: React.ClipboardEvent) {
    const imgs = [...e.clipboardData.files].filter((f) => f.type.startsWith("image/"));
    if (imgs.length) { e.preventDefault(); addImages(imgs); }
  }

  async function ask(preset?: string) {
    const q = (preset ?? query).trim();
    if ((!q && attached.length === 0) || busy) return;
    const images = attached;
    setBusy(true); setErr("");
    setQuery(""); setAttached([]);
    setTurns((t) => [...t, { role: "user", content: q, images }, { role: "assistant", content: "", query: q, steps: [] }]);
    const patch = (fn: (a: Turn) => Turn) =>
      setTurns((t) => { const c = [...t]; c[c.length - 1] = fn(c[c.length - 1]); return c; });
    try {
      const res = await fetch("/api/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q, collection, strategy, prompt_style: promptStyle, rerank,
          conversation_id: conversationId,
          sources: included.size === docs.length ? [] : [...included],
          images }),
      });
      if (!res.body) throw new Error("no stream");
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = "";
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n"); buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          try {
            const ev = JSON.parse(line.slice(5).trim());
            if (ev.type === "conversation") setConversationId(ev.id);
            else if (ev.type === "step") patch((a) => ({ ...a, steps: [...(a.steps ?? []), { step: ev.step, detail: ev.detail }] }));
            else if (ev.type === "token") patch((a) => ({ ...a, content: a.content + ev.text }));
            else if (ev.type === "citations") patch((a) => ({ ...a, citations: ev.records }));
            else if (ev.type === "error") setErr(ev.detail);
          } catch { /* ignore */ }
        }
      }
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); refresh(); }
  }

  const docIcon = (d: DocItem) =>
    d.type === "image" ? "🖼" : d.type === "pdf_page" ? "▤" : "◈";

  return (
    <div className="flex h-full gap-3 p-3">
      {/* ── Sources ── */}
      {leftOpen ? (
      <aside className="panel hidden min-h-0 w-[290px] shrink-0 flex-col overflow-hidden transition-[width] duration-300 md:flex">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <div className="flex items-center gap-2">
            <h2 className="font-display text-base text-sand">Sources</h2>
            <span className="chip">{docs.length}</span>
          </div>
          <button onClick={toggleLeft} className="text-faint hover:text-amber" title="Collapse sources"><PanelIcon /></button>
        </div>
        <div className="px-4 py-3">
          {canEdit ? (
            <Link href="/documents" className="btn w-full">+ Add sources</Link>
          ) : (
            <span className="btn w-full cursor-not-allowed opacity-50" title="Editor role required to add sources">
              🔒 Add sources
            </span>
          )}
        </div>
        {docs.length > 0 && (
          <p className="px-4 pb-1 font-mono text-[10px] text-faint">chatting over {included.size}/{docs.length} · tick to scope</p>
        )}
        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-3">
          {docs.length === 0 && <p className="px-2 text-sm text-faint">No sources yet.</p>}
          {docs.map((d) => (
            <div key={d.source} className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm hover:bg-raised">
              <input type="checkbox" checked={included.has(d.source)} onChange={() => toggleSrc(d.source)} className="shrink-0" title="include in chat" />
              {d.image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={mediaUrl(d.image_url)} alt="" className="h-7 w-7 shrink-0 rounded object-cover" />
              ) : (
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-raised text-amber">{docIcon(d)}</span>
              )}
              <Link href="/documents" className="min-w-0 flex-1">
                <span className="block truncate text-sand">{d.source}</span>
                <span className="font-mono text-[10px] text-faint">{d.type} · {d.chunks}ch{d.pages ? ` · ${d.pages}p` : ""}</span>
              </Link>
            </div>
          ))}
        </div>
      </aside>
      ) : (
        <PanelRail label="Sources" onClick={toggleLeft} extra={`${docs.length}`} />
      )}

      {/* ── Chat ── */}
      <section className="panel relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <div className="flex items-center gap-3">
            <h2 className="font-display text-base text-sand">Chat</h2>
            <span className="eyebrow">{collection}</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowTune((v) => !v)} className="btn px-2 py-1" title="Retrieval & prompt">⚙</button>
            <div className="relative">
              <button onClick={() => setShowHistory((v) => !v)} className="btn px-2 py-1" title="History">☰</button>
              {showHistory && (
                <div className="absolute right-0 z-20 mt-2 max-h-80 w-72 overflow-y-auto rounded-xl border border-line bg-surface p-2 shadow-panel">
                  <button onClick={() => { newChat(); setShowHistory(false); }} className="btn-accent mb-2 w-full">+ New chat</button>
                  {convos.length === 0 && <p className="px-2 py-1 text-xs text-faint">No past chats.</p>}
                  {convos.map((c) => (
                    <div key={c.id} className="group flex items-center gap-1 rounded-lg px-2 py-1.5 hover:bg-raised">
                      <button onClick={() => openConversation(c.id)} className="flex-1 truncate text-left text-xs text-ash">{c.title}</button>
                      <button onClick={() => deleteConversation(c.id).then(refresh)} className="hidden text-faint hover:text-rust group-hover:block">✕</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {showTune && (
          <div className="flex flex-wrap items-center gap-4 border-b border-line bg-ink/40 px-5 py-2 text-xs text-ash">
            <label className="flex items-center gap-2">retrieval
              <select value={strategy} onChange={(e) => setStrategy(e.target.value)} className="field py-1">
                <option value="semantic">semantic</option><option value="hybrid">hybrid</option>
                <option value="hyde">HyDE</option><option value="graphrag">GraphRAG</option>
              </select>
            </label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={rerank} onChange={(e) => setRerank(e.target.checked)} /> rerank</label>
            <label className="flex items-center gap-2">prompt
              <select value={promptStyle} onChange={(e) => setPromptStyle(e.target.value)} className="field py-1">
                <option value="standard">standard</option><option value="cot">chain-of-thought</option><option value="concise">concise</option>
              </select>
            </label>
          </div>
        )}

        <div ref={scrollRef} className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-6">
          {turns.length === 0 && (
            <div className="mx-auto mt-16 max-w-xl text-center">
              <div className="mb-3 font-display text-2xl text-sand">Ask your knowledge base</div>
              <p className="text-sm text-ash">
                Grounded answers, every claim cited to its source — with the retrieval pipeline shown.
              </p>
              {suggestions.length > 0 && (
                <div className="mt-6">
                  <p className="eyebrow mb-2">try asking</p>
                  <div className="flex flex-wrap justify-center gap-2">
                    {suggestions.map((s) => (
                      <button
                        key={s}
                        onClick={() => ask(s)}
                        disabled={busy}
                        className="rounded-full border border-line bg-surface px-3 py-1.5 text-left text-xs text-ash transition-colors hover:border-amber/50 hover:text-amber disabled:opacity-50"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          {turns.map((t, i) =>
            t.role === "user" ? (
              <div key={i} className="flex animate-rise-in justify-end">
                <div className="bubble-user max-w-[85%]">
                  {t.images && t.images.length > 0 && (
                    <div className="mb-2 flex flex-wrap gap-2">
                      {t.images.map((src, k) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img key={k} src={src} alt="attached" className="h-20 w-20 rounded-lg border border-amber/30 object-cover" />
                      ))}
                    </div>
                  )}
                  {t.content}
                </div>
              </div>
            ) : (
              <div key={i} className="animate-rise-in">
                {t.steps && t.steps.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {t.steps.map((s, j) => {
                      const live = busy && !t.content && j === t.steps!.length - 1;
                      return (
                        <span key={j} className={`chip border-teal/30 text-teal ${live ? "animate-pulse-live" : ""}`}>
                          <span className="mr-0.5 inline-block h-1 w-1 rounded-full bg-teal" />
                          {s.step}{s.detail ? ` · ${s.detail}` : ""}
                        </span>
                      );
                    })}
                  </div>
                )}
                <Answer turnKey={`${conversationId ?? "new"}-${i}`} content={t.content} citations={t.citations} query={t.query} />
                {t.content && !busy && (
                  <div className="mt-2 flex items-center gap-2 text-xs text-faint">
                    {rated[i] ? <span className="text-teal">thanks for the feedback</span> : <>
                      <span>helpful?</span>
                      <button onClick={() => rate(i, 1, t.query)} className="hover:text-teal" title="good">👍</button>
                      <button onClick={() => rate(i, -1, t.query)} className="hover:text-rust" title="bad">👎</button>
                    </>}
                  </div>
                )}
              </div>
            ),
          )}
          {err && <p className="text-sm text-rust">Error: {err}</p>}
        </div>

        <div className="border-t border-line p-4">
          {attached.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {attached.map((src, k) => (
                <div key={k} className="group relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt="attachment" className="h-14 w-14 rounded-lg border border-line object-cover" />
                  <button
                    onClick={() => setAttached((a) => a.filter((_, j) => j !== k))}
                    className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-ink text-[10px] text-faint hover:text-rust"
                    title="Remove"
                  >✕</button>
                </div>
              ))}
            </div>
          )}
          <div
            className="flex items-end gap-2 rounded-xl border border-line bg-ink/60 px-3 py-2 focus-within:border-amber/50"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files.length) addImages(e.dataTransfer.files); }}
          >
            <label className="shrink-0 cursor-pointer self-center text-faint transition-colors hover:text-amber" title="Attach reference image">
              <input
                type="file" accept="image/*" multiple className="hidden"
                onChange={(e) => { if (e.target.files) addImages(e.target.files); e.target.value = ""; }}
              />
              <PaperclipIcon />
            </label>
            <textarea
              rows={1}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onPaste={onPaste}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(); } }}
              placeholder={attached.length ? "Ask about the attached image…" : "Ask this workspace…"}
              className="max-h-32 flex-1 resize-none bg-transparent py-1 text-sm text-sand placeholder:text-faint focus:outline-none"
            />
            <button onClick={() => ask()} disabled={busy} className="btn-accent px-3 py-1.5 shadow-glow-sm hover:shadow-glow">{busy ? "…" : "↑"}</button>
          </div>
          <p className="mt-1.5 text-center font-mono text-[10px] text-faint">
            {strategy}{rerank ? " + rerank" : ""} · {included.size === docs.length ? `all ${docs.length}` : `${included.size}/${docs.length}`} sources
            {attached.length ? ` · ${attached.length} image(s)` : ""} · grounded & cited
          </p>
        </div>
      </section>

      {/* ── Studio ── */}
      {rightOpen ? (
      <aside className="panel hidden min-h-0 w-[330px] shrink-0 flex-col overflow-hidden transition-[width] duration-300 xl:flex">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="font-display text-base text-sand">Studio</h2>
          <button onClick={toggleRight} className="text-faint hover:text-amber" title="Collapse studio"><PanelIcon flip /></button>
        </div>
        {/* Segmented mode switch — one group at a time keeps the panel scroll-free. */}
        <div className="px-4 pt-3">
          <div className="grid grid-cols-3 gap-1 rounded-lg border border-line bg-ink/50 p-1">
            {(["create", "inspect", "library"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => { setStudioTab(tab); if (tab === "library") refreshArtifacts(); }}
                className={`flex items-center justify-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium capitalize transition-all ${
                  studioTab === tab ? "bg-amber text-ink shadow-glow-sm" : "text-ash hover:text-sand"
                }`}
              >
                {tab}
                {tab === "library" && artifacts.length > 0 && (
                  <span className={`rounded-full px-1 font-mono text-[9px] ${studioTab === "library" ? "bg-ink/20 text-ink" : "bg-raised text-faint"}`}>
                    {artifacts.length}
                  </span>
                )}
              </button>
            ))}
          </div>
          <p className="eyebrow mt-2.5">
            {studioTab === "create" ? "make something from your sources"
              : studioTab === "inspect" ? "the RAG internals"
              : "everything generated in this workspace"}
          </p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-2">
          {studioTab === "create" && (
            <>
              {!canEdit && (
                <p className="mb-2 rounded-lg border border-line bg-ink/40 px-3 py-2 text-[11px] text-ash">
                  🔒 Creating requires the <span className="text-amber">editor</span> role — you have read access.
                </p>
              )}
              <div key="create" className="stagger grid grid-cols-2 gap-2">
                {CREATE.map((c, i) => <StudioCard key={c.label} {...c} i={i} locked={!canEdit} />)}
              </div>
            </>
          )}
          {studioTab === "inspect" && (
            <div key="inspect" className="stagger grid grid-cols-1 gap-2">
              {INSPECT.map((c, i) => <StudioCard key={c.label} {...c} i={i} wide />)}
            </div>
          )}
          {studioTab === "library" && (
            artifacts.length === 0 ? (
              <div className="mt-10 text-center">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl border border-line text-xl text-faint">◌</div>
                <p className="text-sm text-ash">Nothing created yet.</p>
                <button onClick={() => setStudioTab("create")} className="mt-3 text-xs text-amber hover:underline">Go to Create →</button>
              </div>
            ) : (
              <div key="library" className="stagger grid grid-cols-1 gap-2">
                {artifacts.map((a, i) => (
                  <div
                    key={a.id}
                    style={{ ["--i" as string]: i }}
                    className="group flex items-center gap-3 rounded-xl border border-line bg-raised/60 p-3 transition-all duration-200 hover:-translate-y-0.5 hover:border-amber/50 hover:bg-raised hover:shadow-glow-sm"
                  >
                    <Link href={artifactHref(a)} className="glyph-tile shrink-0">{artifactMeta(a.tool).glyph}</Link>
                    <Link href={artifactHref(a)} className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-sand">{artifactMeta(a.tool).label}</span>
                      <span className="block truncate font-mono text-[10px] text-faint">
                        {a.topic ? a.topic : "whole workspace"} · {relTime(a.created_at)}
                      </span>
                    </Link>
                    {canEdit && (
                      <button
                        onClick={() => removeArtifact(a.id)}
                        className="shrink-0 text-faint opacity-0 transition-opacity hover:text-rust group-hover:opacity-100"
                        title="Delete"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )
          )}
        </div>
      </aside>
      ) : (
        <PanelRail label="Studio" onClick={toggleRight} show="xl:flex" />
      )}
    </div>
  );
}

function PaperclipIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path d="M21 11.5l-8.6 8.6a5 5 0 0 1-7.1-7.1l8.6-8.6a3.3 3.3 0 0 1 4.7 4.7l-8.6 8.6a1.7 1.7 0 0 1-2.4-2.4l7.9-7.9"
        stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PanelIcon({ flip }: { flip?: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className={flip ? "scale-x-[-1]" : ""}>
      <rect x="3" y="4" width="18" height="16" rx="2.5" stroke="currentColor" strokeWidth="1.6" />
      <line x1="9" y1="4" x2="9" y2="20" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function PanelRail({ label, onClick, extra, show = "md:flex" }: { label: string; onClick: () => void; extra?: string; show?: string }) {
  return (
    <div className={`panel hidden w-[52px] shrink-0 flex-col items-center gap-4 py-4 transition-[width] duration-300 ${show}`}>
      <button onClick={onClick} className="text-faint hover:text-amber" title={`Expand ${label}`}>
        <PanelIcon />
      </button>
      <div className="flex flex-1 items-center">
        <span className="font-display text-sm text-ash [writing-mode:vertical-rl]">{label}</span>
      </div>
      {extra && <span className="chip">{extra}</span>}
    </div>
  );
}

function StudioCard({ label, href, glyph, note, wide, i = 0, locked }: { label: string; href: string; glyph: string; note: string; wide?: boolean; i?: number; locked?: boolean }) {
  const base = `group flex items-center gap-3 rounded-xl border border-line bg-raised/60 p-3 ${wide ? "" : "flex-col items-start"}`;
  const inner = (
    <>
      <span className="glyph-tile">{locked ? "🔒" : glyph}</span>
      <span className="min-w-0">
        <span className="block truncate text-sm text-sand">{label}</span>
        <span className="font-mono text-[10px] text-faint">{note}</span>
      </span>
    </>
  );
  if (locked) {
    return (
      <div style={{ ["--i" as string]: i }} className={`${base} cursor-not-allowed opacity-45`} title="Editor role required">
        {inner}
      </div>
    );
  }
  return (
    <Link href={href} style={{ ["--i" as string]: i }}
      className={`${base} transition-all duration-200 hover:-translate-y-0.5 hover:border-amber/50 hover:bg-raised hover:shadow-glow-sm`}>
      {inner}
    </Link>
  );
}
