"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";

export default function Login() {
  const { login, enabled, ready, token } = useAuth();
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const expired = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("expired") === "1";

  // Already signed in, or auth disabled → no login needed.
  useEffect(() => {
    if (ready && (!enabled || token)) router.replace("/");
  }, [ready, enabled, token, router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr("");
    try { await login(username.trim(), password); router.replace("/"); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <form onSubmit={submit} className="panel w-full max-w-sm p-6">
        <div className="mb-1 flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br from-amber-2 to-amber font-display text-base font-semibold text-ink shadow-glow-sm">R</span>
          <h1 className="font-display text-xl text-sand">Sign in</h1>
        </div>
        <p className="eyebrow mb-5">CC-RAGOS workspace</p>

        {expired && (
          <p className="mb-4 rounded-lg border border-amber/30 bg-amber/[0.06] px-3 py-2 text-xs text-amber">
            Your session expired — please sign in again.
          </p>
        )}

        <label className="mb-3 block">
          <span className="eyebrow">username</span>
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus
            className="field mt-1 w-full" placeholder="username" />
        </label>
        <label className="mb-4 block">
          <span className="eyebrow">password</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
            className="field mt-1 w-full" placeholder="••••••••" />
        </label>

        {err && <p className="mb-3 text-sm text-rust">{err}</p>}
        <button type="submit" disabled={busy || !username || !password}
          className="btn-accent w-full shadow-glow-sm hover:shadow-glow">
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
