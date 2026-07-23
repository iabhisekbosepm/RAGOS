"use client";

import { useEffect, useState } from "react";
import { useWorkspace } from "@/lib/workspace";
import { mediaUrl, listDocuments, deleteDocument, mcpList, mcpIngestUrl, parseHeader, type DocItem, type McpResource } from "@/lib/retriever";
import InfoBox from "@/components/infobox";
import ToolShell from "@/components/tool-shell";
import DocViewer from "@/components/doc-viewer";
import EditorNote, { useCanEdit } from "@/components/editor-gate";

const INGESTION = process.env.NEXT_PUBLIC_INGESTION_URL ?? "http://localhost:8101";

type Status = "pending" | "active" | "done";
interface Step { key: string; label: string; status: Status; detail?: string }

const STEPS: Record<string, Step[]> = {
  document: [
    { key: "upload", label: "Uploaded", status: "pending" }, { key: "parse", label: "Parse", status: "pending" },
    { key: "chunk", label: "Chunk", status: "pending" }, { key: "embed", label: "Embed", status: "pending" },
    { key: "index", label: "Index", status: "pending" },
  ],
  image: [
    { key: "upload", label: "Uploaded", status: "pending" }, { key: "save", label: "Store", status: "pending" },
    { key: "caption", label: "Vision caption", status: "pending" }, { key: "embed", label: "Embed", status: "pending" },
    { key: "index", label: "Index", status: "pending" },
  ],
  pdf: [
    { key: "upload", label: "Uploaded", status: "pending" }, { key: "render", label: "Render + embed", status: "pending" },
    { key: "index", label: "Index", status: "pending" },
  ],
};
const MAP: Record<string, string> = {
  received: "upload", parsing: "parse", parsed: "parse", chunking: "chunk", chunked: "chunk",
  saving: "save", captioning: "caption", captioned: "caption", rendering: "render", page: "render",
  embedding: "embed", indexing: "index",
};
const ICON = { pending: "○", active: "◐", done: "●" } as const;
const kindOf = (n: string) => { const e = (n.split(".").pop() ?? "").toLowerCase(); return ["png", "jpg", "jpeg", "webp", "gif"].includes(e) ? "image" : e === "pdf" ? "pdf" : "document"; };

export default function Documents() {
  const { collection } = useWorkspace();
  const canEdit = useCanEdit();
  const [files, setFiles] = useState<File[]>([]);
  const [strategy, setStrategy] = useState("structure");
  const [chunkSize, setChunkSize] = useState(1200);
  const [overlap, setOverlap] = useState(200);
  const [contextual, setContextual] = useState(true);
  const [busy, setBusy] = useState(false);
  const [current, setCurrent] = useState<{ name: string; index: number; total: number } | null>(null);
  const [kind, setKind] = useState("document");
  const [steps, setSteps] = useState<Step[]>([]);
  const [err, setErr] = useState("");
  const [docs, setDocs] = useState<DocItem[]>([]);
  const [viewSource, setViewSource] = useState<string | null>(null);
  // MCP
  const [mcpUrl, setMcpUrl] = useState("");
  const [mcpTransport, setMcpTransport] = useState("auto");
  const [mcpHeader, setMcpHeader] = useState("");
  const [mcpRes, setMcpRes] = useState<McpResource[]>([]);
  const [mcpSel, setMcpSel] = useState<Set<string>>(new Set());
  const [mcpMsg, setMcpMsg] = useState("");
  const [mcpBusy, setMcpBusy] = useState(false);
  const [mcpProg, setMcpProg] = useState<Record<string, { status: Status; label: string }>>({});

  async function refreshDocs() { try { setDocs(await listDocuments(collection)); } catch { setDocs([]); } }
  // Guard against out-of-order responses when the workspace changes (e.g. hydration flip).
  useEffect(() => {
    let active = true;
    setDocs([]);
    listDocuments(collection).then((d) => active && setDocs(d)).catch(() => active && setDocs([]));
    return () => { active = false; };
  }, [collection]);

  function applyEvent(ev: Record<string, unknown>, curKind: string) {
    const stage = ev.stage as string;
    if (stage === "done") { setSteps((s) => s.map((x) => ({ ...x, status: "done" }))); return; }
    if (stage === "error") { setErr((ev.detail as string) ?? "error"); return; }
    const key = MAP[stage]; if (!key) return;
    const order = STEPS[curKind].map((s) => s.key); const idx = order.indexOf(key);
    const detail = stage === "page" ? `page ${ev.page}/${ev.total}` : (ev.detail as string) ?? (ev.count !== undefined ? `${ev.count} chunks` : undefined);
    setSteps((s) => s.map((x) => { const xi = order.indexOf(x.key); if (xi < idx) return { ...x, status: "done" }; if (xi === idx) return { ...x, status: "active", detail: detail ?? x.detail }; return x; }));
  }
  async function ingestOne(file: File) {
    const curKind = kindOf(file.name); setKind(curKind); setSteps(STEPS[curKind].map((s) => ({ ...s })));
    const form = new FormData();
    form.append("file", file); form.append("collection", collection); form.append("workspace", "default");
    form.append("strategy", strategy); form.append("chunk_size", String(chunkSize)); form.append("overlap", String(overlap));
    form.append("contextual", String(contextual));
    const res = await fetch(`${INGESTION}/ingest/stream`, { method: "POST", body: form });
    if (!res.body) throw new Error("no stream");
    const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = "";
    while (true) { const { done, value } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true }); const lines = buf.split("\n"); buf = lines.pop() ?? ""; for (const line of lines) if (line.startsWith("data:")) { try { applyEvent(JSON.parse(line.slice(5).trim()), curKind); } catch { /* */ } } }
  }
  async function uploadAll() {
    if (files.length === 0 || busy) return;
    setBusy(true); setErr("");
    for (let i = 0; i < files.length; i++) { setCurrent({ name: files[i].name, index: i + 1, total: files.length }); try { await ingestOne(files[i]); } catch (e) { setErr(`${files[i].name}: ${(e as Error).message}`); } }
    setBusy(false); setCurrent(null); setFiles([]); refreshDocs();
  }
  async function remove(source: string) { if (!confirm(`Remove "${source}" and all its chunks?`)) return; await deleteDocument(collection, source); refreshDocs(); }

  async function mcpConnect() {
    setMcpBusy(true); setMcpMsg("Connecting…"); setMcpRes([]); setMcpProg({});
    try {
      const d = await mcpList(mcpUrl.trim(), mcpTransport, parseHeader(mcpHeader));
      if (d.error) setMcpMsg(d.error);
      else { setMcpRes(d.resources ?? []); setMcpSel(new Set((d.resources ?? []).map((r) => r.uri))); setMcpMsg(`${(d.resources ?? []).length} resource(s) found`); }
    } catch (e) { setMcpMsg((e as Error).message); } finally { setMcpBusy(false); }
  }
  async function mcpIngest() {
    if (mcpSel.size === 0 || mcpBusy) return;
    setMcpBusy(true); setMcpMsg("MCP handshake…");
    const init: Record<string, { status: Status; label: string }> = {};
    [...mcpSel].forEach((u) => (init[u] = { status: "pending", label: "queued" }));
    setMcpProg(init);
    const set = (uri: string, status: Status, label: string) => setMcpProg((p) => ({ ...p, [uri]: { status, label } }));
    try {
      const res = await fetch(mcpIngestUrl, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: mcpUrl.trim(), transport: mcpTransport, headers: parseHeader(mcpHeader),
          collection, workspace: "default", uris: [...mcpSel], strategy, chunk_size: chunkSize, overlap }),
      });
      const reader = res.body!.getReader(); const dec = new TextDecoder(); let buf = "";
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true }); const lines = buf.split("\n"); buf = lines.pop() ?? "";
        for (const line of lines) if (line.startsWith("data:")) {
          try {
            const ev = JSON.parse(line.slice(5).trim());
            if (ev.stage === "connecting") setMcpMsg("connected · reading resources");
            else if (ev.stage === "resource_start") set(ev.uri, "active", "reading…");
            else if (ev.stage === "resource_chunked") set(ev.uri, "active", `chunk & embed · ${ev.count} chunks`);
            else if (ev.stage === "resource_done") set(ev.uri, "done", `indexed · ${ev.chunks} chunks`);
            else if (ev.stage === "done") setMcpMsg(`✓ indexed ${ev.ingested} chunks from ${ev.resources} resource(s)`);
            else if (ev.stage === "error") setMcpMsg(`error: ${ev.detail}`);
          } catch { /* */ }
        }
      }
      refreshDocs();
    } catch (e) { setMcpMsg((e as Error).message); } finally { setMcpBusy(false); }
  }
  function toggleUri(uri: string) { setMcpSel((s) => { const n = new Set(s); n.has(uri) ? n.delete(uri) : n.add(uri); return n; }); }

  const sidebar = !canEdit ? (
    <>
      <InfoBox title="Adding sources">
        <p>Uploading and indexing documents requires the <b className="text-sand">editor</b> role. You have read-only access — browse the library on the right.</p>
      </InfoBox>
      <EditorNote action="Adding sources" />
    </>
  ) : (
    <>
      <InfoBox title="What happens when I upload?">
        <p>Each file goes through <b className="text-sand">Parse → Chunk → Embed → Index</b>. Images are described by a vision model; PDFs are rendered per page. Multiple files allowed.</p>
      </InfoBox>
      <input type="file" multiple onChange={(e) => setFiles(Array.from(e.target.files ?? []))} className="block w-full text-sm text-ash file:mr-3 file:rounded-md file:border-0 file:bg-raised file:px-3 file:py-1.5 file:text-sand" />
      {files.length > 0 && !busy && <p className="text-xs text-ash">{files.length} file(s) selected</p>}

      <div className="space-y-2 border-t border-line pt-3">
        <label className="block"><span className="eyebrow">chunking (text docs)</span>
          <select value={strategy} onChange={(e) => setStrategy(e.target.value)} className="field mt-1 w-full">
            <option value="structure">structure — paragraph-aware</option><option value="fixed">fixed — char windows</option>
            <option value="sentence">sentence — sentence-packed</option><option value="parent_child">parent-child</option>
            <option value="semantic">semantic — meaning shifts</option>
          </select>
        </label>
        <div className="flex gap-2">
          <label className="flex-1"><span className="eyebrow">size</span><input type="number" value={chunkSize} min={200} max={4000} step={100} onChange={(e) => setChunkSize(Number(e.target.value))} className="field mt-1 w-full" /></label>
          <label className="flex-1"><span className="eyebrow">overlap</span><input type="number" value={overlap} min={0} max={800} step={20} onChange={(e) => setOverlap(Number(e.target.value))} className="field mt-1 w-full" /></label>
        </div>
        <label className="flex items-center gap-2 text-xs text-ash">
          <input type="checkbox" checked={contextual} onChange={(e) => setContextual(e.target.checked)} />
          contextual retrieval (prepend doc context to each chunk — better recall)
        </label>
      </div>
      <button onClick={uploadAll} disabled={files.length === 0 || busy} className="btn-accent w-full">{busy ? "Processing…" : `Ingest ${files.length || ""}`.trim()}</button>
      {err && <p className="text-sm text-rust">{err}</p>}

      {/* MCP source */}
      <div className="space-y-2 border-t border-line pt-3">
        <p className="eyebrow">or add via MCP endpoint</p>
        <p className="text-xs text-faint">Pull data from a remote MCP server at ingest time.</p>
        <label className="block"><span className="eyebrow">type</span>
          <select value={mcpTransport} onChange={(e) => setMcpTransport(e.target.value)} className="field mt-1 w-full">
            <option value="auto">Auto (HTTP → SSE)</option>
            <option value="http">Streamable HTTP</option>
            <option value="sse">Server-Sent Events (SSE)</option>
          </select>
        </label>
        <label className="block"><span className="eyebrow">url</span>
          <input value={mcpUrl} onChange={(e) => setMcpUrl(e.target.value)} className="field mt-1 w-full" placeholder="https://host/api/v1/mcp/sse" />
        </label>
        <label className="block"><span className="eyebrow">http header (optional)</span>
          <input value={mcpHeader} onChange={(e) => setMcpHeader(e.target.value)} className="field mt-1 w-full" placeholder="Authorization=Bearer <key>" />
        </label>
        <button onClick={mcpConnect} disabled={!mcpUrl.trim() || mcpBusy} className="btn w-full">Connect &amp; list resources</button>
        {mcpRes.length > 0 && (
          <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-line p-2">
            {mcpRes.map((r) => (
              <label key={r.uri} className="flex items-start gap-2 text-xs text-ash">
                <input type="checkbox" checked={mcpSel.has(r.uri)} onChange={() => toggleUri(r.uri)} className="mt-0.5" />
                <span className="min-w-0 flex-1"><span className="text-sand">{r.name}</span> <span className="text-faint">{r.uri}</span></span>
              </label>
            ))}
          </div>
        )}
        {mcpRes.length > 0 && (
          <button onClick={mcpIngest} disabled={mcpSel.size === 0 || mcpBusy} className="btn-accent w-full">Ingest {mcpSel.size} selected</button>
        )}
        {mcpMsg && <p className="text-xs text-ash">{mcpMsg}</p>}

        {Object.keys(mcpProg).length > 0 && (
          <div className="space-y-2 rounded-xl border border-line bg-surface p-3">
            {mcpRes.filter((r) => mcpProg[r.uri]).map((r) => {
              const st = mcpProg[r.uri];
              return (
                <div key={r.uri} className="flex items-start gap-2">
                  <span className={`text-base leading-none ${st.status === "done" ? "text-teal" : st.status === "active" ? "animate-pulse text-amber" : "text-faint"}`}>{ICON[st.status]}</span>
                  <div className="min-w-0 flex-1">
                    <div className={`truncate text-xs ${st.status === "pending" ? "text-faint" : "text-sand"}`}>{r.name}</div>
                    <div className="font-mono text-[10px] text-faint">{st.label}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );

  return (
    <ToolShell eyebrow="Sources" title="Document Library" subtitle="Upload one or many files — watch each pipeline run live." sidebar={sidebar}>
      {current && (
        <div className="mb-5 rounded-2xl border border-amber/30 bg-amber/[0.04] p-5">
          <div className="mb-4 flex items-center gap-2 text-sm">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-amber" />
            </span>
            <span className="eyebrow">ingesting live</span>
            <span className="chip border-amber/30 text-amber">{kind}</span>
            <span className="min-w-0 flex-1 truncate text-sand">{current.name}</span>
            {current.total > 1 && <span className="font-mono text-xs text-faint">file {current.index}/{current.total}</span>}
          </div>
          {/* Horizontal pipeline — reads clearly in the wide main pane. */}
          <ol className="flex flex-wrap items-stretch gap-2">
            {steps.map((s, i) => (
              <li key={s.key} className="flex items-center gap-2">
                <div className={`min-w-[120px] rounded-xl border px-3 py-2 transition-colors ${
                  s.status === "done" ? "border-teal/40 bg-teal/[0.06]"
                  : s.status === "active" ? "border-amber/50 bg-amber/[0.08]"
                  : "border-line bg-surface"}`}>
                  <div className="flex items-center gap-1.5">
                    <span className={`text-sm leading-none ${s.status === "done" ? "text-teal" : s.status === "active" ? "animate-pulse text-amber" : "text-faint"}`}>{ICON[s.status]}</span>
                    <span className={`text-xs font-medium ${s.status === "pending" ? "text-faint" : "text-sand"}`}>{s.label}</span>
                  </div>
                  {s.detail && s.status !== "pending" && <div className="mt-1 truncate font-mono text-[10px] text-faint">{s.detail}</div>}
                </div>
                {i < steps.length - 1 && <span className={`h-px w-4 ${s.status === "done" ? "bg-teal/50" : "bg-line"}`} />}
              </li>
            ))}
          </ol>
        </div>
      )}
      <div className="mb-3 flex items-center justify-between">
        <p className="eyebrow">documents in {collection} ({docs.length})</p>
        <button onClick={refreshDocs} className="text-xs text-faint hover:text-sand">refresh</button>
      </div>
      {docs.length === 0 ? <p className="text-sm text-faint">No documents yet — upload on the left.</p> : (
        <div className="grid gap-2 sm:grid-cols-2">
          {docs.map((d) => (
            <button
              key={d.source}
              type="button"
              onClick={() => setViewSource(d.source)}
              title="Click to view"
              className="group flex w-full items-center gap-3 rounded-xl border border-line bg-surface p-3 text-left transition-colors hover:border-amber/50"
            >
              {d.image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={mediaUrl(d.image_url)} alt="" className="h-10 w-10 shrink-0 rounded object-cover" />
              ) : <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-raised text-amber">◈</span>}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-sand group-hover:text-amber">{d.source}</div>
                <div className="font-mono text-[11px] text-faint">
                  <span className="chip mr-1 border-amber/30 text-amber">{d.type}</span>
                  {d.chunks}ch{d.pages > 0 && ` · ${d.pages}p`}
                </div>
              </div>
              {canEdit && (
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => { e.stopPropagation(); remove(d.source); }}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); remove(d.source); } }}
                  className="hidden cursor-pointer rounded-lg border border-rust/40 px-2 py-1 text-xs text-rust hover:bg-rust/10 group-hover:block"
                >
                  Delete
                </span>
              )}
            </button>
          ))}
        </div>
      )}
      {viewSource && <DocViewer collection={collection} source={viewSource} onClose={() => setViewSource(null)} />}
    </ToolShell>
  );
}
