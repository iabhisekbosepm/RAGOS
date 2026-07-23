"use client";

import { useEffect, useState } from "react";
import { listWorkspaces, createWorkspace, deleteWorkspace, type Workspace } from "@/lib/retriever";
import { useWorkspace } from "@/lib/workspace";
import InfoBox from "@/components/infobox";
import ToolShell from "@/components/tool-shell";
import { useAuth } from "@/lib/auth";

export default function Workspaces() {
  const { collection, setWorkspace } = useWorkspace();
  const isAdmin = useAuth().can("admin");
  const [items, setItems] = useState<Workspace[]>([]);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [err, setErr] = useState("");

  async function load() { try { setItems(await listWorkspaces()); } catch (e) { setErr((e as Error).message); } }
  useEffect(() => { load(); }, []);

  async function create() {
    setErr("");
    const coll = (slug || name).toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
    if (!coll) return setErr("enter a name");
    try { await createWorkspace(coll, name || coll); setName(""); setSlug(""); setWorkspace(coll); await load(); }
    catch (e) { setErr((e as Error).message); }
  }
  async function remove(coll: string) {
    if (!confirm(`Delete workspace "${coll}" and all its documents + chats? This cannot be undone.`)) return;
    await deleteWorkspace(coll); if (coll === collection) setWorkspace("ccragos_chunks"); await load();
  }

  const sidebar = (
    <>
      <InfoBox title="What is a workspace?">
        <p>An isolated knowledge base: its own documents, embeddings, graph, and chat history. Switch the
          active one from the top-right selector — every panel then works against it only.</p>
      </InfoBox>
      {isAdmin ? (
        <div className="space-y-2">
          <label className="block"><span className="eyebrow">name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. HR Team" className="field mt-1 w-full" />
          </label>
          <label className="block"><span className="eyebrow">id (optional)</span>
            <input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="auto from name" className="field mt-1 w-full" />
          </label>
          <button onClick={create} className="btn-accent w-full">Create workspace</button>
          {err && <p className="text-sm text-rust">{err}</p>}
        </div>
      ) : (
        <p className="rounded-lg border border-line bg-ink/40 px-3 py-2 text-[11px] text-ash">
          🔒 Creating or deleting workspaces requires the <span className="text-amber">admin</span> role.
        </p>
      )}
    </>
  );

  return (
    <ToolShell eyebrow="Manage" title="Workspaces" subtitle="Separate knowledge bases — one per team, project, or client." sidebar={sidebar}>
      <p className="eyebrow mb-2">all workspaces ({items.length})</p>
      <ul className="grid gap-2 sm:grid-cols-2">
        {items.map((w) => (
          <li key={w.collection} className={`flex items-center justify-between rounded-xl border p-3 text-sm ${w.collection === collection ? "border-amber/60 bg-amber/[0.06]" : "border-line bg-surface"}`}>
            <div className="min-w-0">
              <div className="truncate font-medium text-sand">{w.name}</div>
              <div className="font-mono text-[11px] text-faint">{w.collection} · {w.chunks} chunks</div>
            </div>
            <div className="flex shrink-0 gap-2">
              {w.collection === collection
                ? <span className="chip border-amber/40 text-amber">active</span>
                : <button onClick={() => setWorkspace(w.collection)} className="btn px-2 py-1 text-xs">Switch</button>}
              {isAdmin && <button onClick={() => remove(w.collection)} className="rounded-lg border border-rust/40 px-2 py-1 text-xs text-rust hover:bg-rust/10">Delete</button>}
            </div>
          </li>
        ))}
      </ul>
    </ToolShell>
  );
}
