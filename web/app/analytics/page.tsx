"use client";

import { useEffect, useState } from "react";
import { getAnalytics } from "@/lib/retriever";
import { useWorkspace } from "@/lib/workspace";
import InfoBox from "@/components/infobox";
import ToolShell from "@/components/tool-shell";

interface Analytics {
  conversations: number; questions: number; answers: number;
  refusals: number; refusal_rate: number; avg_confidence: number; low_confidence_answers: number;
  strategy_usage: Record<string, number>;
  top_cited: [string, number][];
  unused_documents: string[];
  recent_questions: string[];
  feedback: { up: number; down: number };
}

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className="font-display text-2xl text-sand">{value}</div>
      <div className="mt-1 text-xs text-ash">{label}</div>
      {hint && <div className="font-mono text-[10px] text-faint">{hint}</div>}
    </div>
  );
}

export default function AnalyticsPage() {
  const { collection } = useWorkspace();
  const [a, setA] = useState<Analytics | null>(null);
  const [err, setErr] = useState("");

  async function load() {
    setErr("");
    try { setA(await getAnalytics(collection)); } catch (e) { setErr((e as Error).message); }
  }
  useEffect(() => {
    let active = true;
    setA(null);
    getAnalytics(collection).then((d) => active && setA(d)).catch((e) => active && setErr(e.message));
    return () => { active = false; };
  }, [collection]);

  const sidebar = (
    <>
      <InfoBox title="What is this?">
        <p>Usage &amp; quality signals for this workspace, from real chat history: how much it's used, how
          often it refuses (out-of-scope), average citation confidence, which documents get cited vs.
          ignored, retrieval-strategy mix, and 👍/👎 feedback.</p>
        <p>Use it to spot coverage gaps (unused docs), weak retrieval (low confidence / high refusals), and
          what users actually ask.</p>
      </InfoBox>
      <button onClick={load} className="btn w-full">Refresh</button>
      {a && a.feedback && (
        <div className="rounded-xl border border-line bg-surface p-4">
          <p className="eyebrow mb-2">satisfaction</p>
          <div className="flex items-center gap-4 text-sm">
            <span className="text-teal">👍 {a.feedback.up}</span>
            <span className="text-rust">👎 {a.feedback.down}</span>
            <span className="ml-auto font-mono text-xs text-faint">
              {a.feedback.up + a.feedback.down > 0 ? `${Math.round((a.feedback.up / (a.feedback.up + a.feedback.down)) * 100)}%` : "—"}
            </span>
          </div>
        </div>
      )}
    </>
  );

  return (
    <ToolShell eyebrow="Inspect" title="Analytics" subtitle={`Usage & quality for ${collection}`} sidebar={sidebar}>
      {err && <p className="text-sm text-rust">Error: {err}</p>}
      {!a && !err && <p className="mt-10 text-center text-sm text-faint">Loading…</p>}
      {a && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="conversations" value={a.conversations} />
            <Stat label="questions" value={a.questions} />
            <Stat label="avg confidence" value={a.avg_confidence.toFixed(2)} hint="top citation score" />
            <Stat label="refusal rate" value={`${Math.round(a.refusal_rate * 100)}%`} hint={`${a.refusals} out-of-scope`} />
          </div>

          <div className="grid gap-6 sm:grid-cols-2">
            <section>
              <p className="eyebrow mb-2">most-cited documents</p>
              {a.top_cited.length === 0 ? <p className="text-sm text-faint">No citations yet.</p> : (
                <div className="space-y-1">
                  {a.top_cited.map(([name, n]) => {
                    const max = a.top_cited[0][1] || 1;
                    return (
                      <div key={name} className="text-xs">
                        <div className="mb-0.5 flex justify-between"><span className="truncate text-sand">{name}</span><span className="font-mono text-faint">{n}</span></div>
                        <div className="h-1.5 rounded bg-raised"><div className="h-full rounded bg-amber" style={{ width: `${(n / max) * 100}%` }} /></div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            <section>
              <p className="eyebrow mb-2">unused documents ({a.unused_documents.length})</p>
              {a.unused_documents.length === 0 ? <p className="text-sm text-faint">All documents have been cited.</p> : (
                <div className="space-y-1">
                  {a.unused_documents.map((d) => (
                    <div key={d} className="truncate rounded border border-line bg-surface px-2 py-1 text-xs text-ash">{d}</div>
                  ))}
                </div>
              )}
            </section>

            <section>
              <p className="eyebrow mb-2">retrieval strategy mix</p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(a.strategy_usage).map(([s, n]) => (
                  <span key={s} className="chip border-amber/30 text-amber">{s} · {n}</span>
                ))}
              </div>
            </section>

            <section>
              <p className="eyebrow mb-2">recent questions</p>
              <div className="space-y-1">
                {a.recent_questions.map((q, i) => (
                  <div key={i} className="truncate rounded px-2 py-1 text-xs text-ash hover:bg-raised">{q}</div>
                ))}
                {a.recent_questions.length === 0 && <p className="text-sm text-faint">No questions yet.</p>}
              </div>
            </section>
          </div>
        </div>
      )}
    </ToolShell>
  );
}
