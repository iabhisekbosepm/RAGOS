"use client";

import { useEffect, useState } from "react";
import {
  generateAudio, listStudyArtifacts, getStudyArtifact, deleteStudyArtifact, mediaUrl, type StudyArtifact,
} from "@/lib/retriever";
import { useWorkspace } from "@/lib/workspace";
import { downloadFile } from "@/lib/download";
import InfoBox from "@/components/infobox";
import ToolShell from "@/components/tool-shell";
import EditorNote, { useCanEdit } from "@/components/editor-gate";

interface Turn { speaker: string; text: string }
interface AudioResult { script?: Turn[]; audio_url?: string | null; note?: string | null; error?: string }

export default function AudioOverview() {
  const { collection } = useWorkspace();
  const [topic, setTopic] = useState("");
  const [result, setResult] = useState<AudioResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [history, setHistory] = useState<StudyArtifact[]>([]);
  const canEdit = useCanEdit();

  async function refreshHistory() {
    try { const all = await listStudyArtifacts(collection); setHistory(all.filter((a) => a.tool === "audio")); }
    catch { setHistory([]); }
  }
  useEffect(() => { refreshHistory(); setResult(null); /* eslint-disable-next-line */ }, [collection]);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("id");
    if (id) load(id).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function run() {
    setBusy(true); setErr(""); setResult(null);
    try { const d: AudioResult = await generateAudio(collection, topic); if (d.error) setErr(d.error); else { setResult(d); refreshHistory(); } }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  async function load(id: string) { const a = await getStudyArtifact(id); if (!a.error) setResult(a.payload); }
  function downloadScript() {
    if (!result?.script) return;
    downloadFile("audio-overview.md", "# Audio Overview\n\n" + result.script.map((t) => `**${t.speaker}:** ${t.text}`).join("\n\n"), "text/markdown");
  }

  const sidebar = (
    <>
      <InfoBox title="What is Audio Overview?">
        <p>The AI writes a natural conversation between two hosts explaining your documents, then voices it as audio you can play or download.</p>
      </InfoBox>
      <label className="block"><span className="eyebrow">topic (optional)</span>
        <input value={topic} onChange={(e) => setTopic(e.target.value)} className="field mt-1 w-full" placeholder="blank = whole workspace" />
      </label>
      {canEdit
        ? <button onClick={run} disabled={busy} className="btn-accent w-full">{busy ? "Generating…" : "Generate"}</button>
        : <EditorNote action="Generating an audio overview" />}
      {err && <p className="text-sm text-rust">{err}</p>}

      {history.length > 0 && (
        <div className="border-t border-line pt-4">
          <p className="eyebrow mb-2">Saved overviews</p>
          <div className="space-y-1">
            {history.map((a) => (
              <div key={a.id} className="group flex items-center justify-between rounded-lg px-2 py-1.5 text-sm hover:bg-raised">
                <button onClick={() => load(a.id)} className="min-w-0 flex-1 truncate text-left text-ash">{a.topic || "whole workspace"}</button>
                {canEdit && <button onClick={() => deleteStudyArtifact(a.id).then(refreshHistory)} className="ml-1 hidden text-faint hover:text-rust group-hover:block">✕</button>}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );

  return (
    <ToolShell eyebrow="Create" title="Audio Overview" subtitle="Turn this workspace into a 2-host podcast." sidebar={sidebar}>
      {!result && !err && <p className="mt-10 text-center text-sm text-faint">Generate a podcast overview from the left.</p>}
      {result && (
        <div>
          {result.audio_url ? (
            <audio controls src={mediaUrl(result.audio_url)} className="mb-3 w-full" />
          ) : result.note && <p className="mb-3 rounded-lg border border-amber/40 bg-amber/[0.06] p-2 text-xs text-amber">{result.note}</p>}
          <div className="mb-3 flex justify-end"><button onClick={downloadScript} className="btn px-3 py-1 text-xs">⬇ Download script</button></div>
          <div className="space-y-2">
            {result.script?.map((t, i) => (
              <div key={i} className="rounded-xl border border-line bg-surface p-3 text-sm">
                <span className={`mr-2 font-medium ${t.speaker === "Guest" ? "text-teal" : "text-amber"}`}>{t.speaker}:</span>
                <span className="text-ash">{t.text}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </ToolShell>
  );
}
