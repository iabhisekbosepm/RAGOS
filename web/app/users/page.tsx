"use client";

import { useCallback, useEffect, useState } from "react";
import {
  listUsers, createUser, updateUserRole, deleteUser, type AuthUser, type Role,
} from "@/lib/retriever";
import { useAuth } from "@/lib/auth";

const ROLES: Role[] = ["viewer", "editor", "admin"];

export default function Users() {
  const { enabled, ready, can, user: me } = useAuth();
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("viewer");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    listUsers().then(setUsers).catch(() => setUsers([]));
  }, []);
  useEffect(() => { if (ready && can("admin")) refresh(); }, [ready, can, refresh]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr("");
    try { await createUser(username.trim(), password, role); setUsername(""); setPassword(""); setRole("viewer"); refresh(); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  if (ready && (!enabled || !can("admin"))) {
    return <div className="p-8 text-sm text-ash">{enabled ? "Admins only." : "Auth is disabled — enable it to manage users."}</div>;
  }

  return (
    <div className="mx-auto max-w-3xl p-6">
      <p className="eyebrow">Manage</p>
      <h1 className="mb-6 font-display text-2xl text-sand">Users &amp; roles</h1>

      <form onSubmit={add} className="panel mb-6 flex flex-wrap items-end gap-3 p-4">
        <label className="flex-1"><span className="eyebrow">username</span>
          <input value={username} onChange={(e) => setUsername(e.target.value)} className="field mt-1 w-full" placeholder="new user" />
        </label>
        <label className="flex-1"><span className="eyebrow">password</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="field mt-1 w-full" placeholder="≥ 12 chars" />
        </label>
        <label><span className="eyebrow">role</span>
          <select value={role} onChange={(e) => setRole(e.target.value as Role)} className="field mt-1 py-2">
            {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>
        <button type="submit" disabled={busy || !username || password.length < 12} className="btn-accent">Add user</button>
      </form>
      {username && password.length > 0 && password.length < 12 &&
        <p className="mb-4 text-xs text-faint">Password needs ≥ 12 characters ({password.length}/12).</p>}
      {err && <p className="mb-4 text-sm text-rust">{err}</p>}

      <div className="panel divide-y divide-line">
        {users.length === 0 && <p className="p-4 text-sm text-faint">No users.</p>}
        {users.map((u) => (
          <div key={u.id} className="flex items-center gap-3 px-4 py-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-line font-display text-sm text-amber">
              {u.username.slice(0, 1).toUpperCase()}
            </span>
            <span className="flex-1">
              <span className="block text-sm text-sand">{u.username}{me?.id === u.id && <span className="ml-2 text-[10px] text-faint">(you)</span>}</span>
            </span>
            <select
              value={u.role}
              onChange={(e) => updateUserRole(u.id, e.target.value as Role).then(refresh)}
              disabled={me?.id === u.id}
              className="field py-1 text-xs"
              title={me?.id === u.id ? "You can't change your own role" : "Change role"}
            >
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <button
              onClick={() => deleteUser(u.id).then(refresh)}
              disabled={me?.id === u.id}
              className="text-faint hover:text-rust disabled:opacity-30"
              title={me?.id === u.id ? "You can't delete yourself" : "Delete user"}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
