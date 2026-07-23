"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { listWorkspaces, type Workspace } from "@/lib/retriever";
import { useWorkspace } from "@/lib/workspace";
import { useAuth } from "@/lib/auth";

const LINKS = [
  { href: "/", label: "Workspace" },
  { href: "/documents", label: "Documents" },
  { href: "/analytics", label: "Analytics" },
  { href: "/learn", label: "Learn" },
  { href: "/workspaces", label: "Manage" },
];

export default function Nav() {
  const path = usePathname();
  const { collection, setWorkspace } = useWorkspace();
  const { enabled, user, logout, can } = useAuth();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);

  // Refetch when the active workspace changes (e.g. after creating one) so the
  // dropdown reflects new workspaces in real time.
  useEffect(() => {
    listWorkspaces().then(setWorkspaces).catch(() => setWorkspaces([]));
  }, [collection, path]);

  // Always ensure the active workspace has an option, even if the list is stale/loading.
  const options = workspaces.some((w) => w.collection === collection)
    ? workspaces
    : [{ collection, name: collection, chunks: 0, exists: true }, ...workspaces];

  if (path === "/login") return null;  // login screen is chromeless

  const navLinks = enabled && can("admin") ? [...LINKS, { href: "/users", label: "Users" }] : LINKS;

  return (
    <header className="flex h-16 shrink-0 items-center gap-4 border-b border-line bg-ink/70 px-5 backdrop-blur-md">
      {/* Brand */}
      <Link href="/" className="flex shrink-0 items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-amber-2 to-amber font-display text-base font-semibold text-ink shadow-glow-sm transition-shadow hover:shadow-glow">
          R
        </span>
        <span className="flex flex-col leading-none">
          <span className="font-display text-lg font-semibold tracking-tight text-sand">CC-RAGOS</span>
          <span className="mt-0.5 text-[10px] tracking-wide text-faint">by Abhisek Bose</span>
        </span>
      </Link>

      {/* Workspace switcher — styled pill with icon + custom chevron */}
      <div className="group relative ml-1 hidden items-center sm:flex">
        <LayersIcon />
        <select
          value={collection}
          onChange={(e) => setWorkspace(e.target.value)}
          aria-label="Active workspace"
          className="peer appearance-none rounded-lg border border-line bg-raised/70 py-1.5 pl-8 pr-8 text-sm text-sand transition-colors hover:border-amber/40 focus:border-amber/60 focus:outline-none"
        >
          {options.map((w) => (
            <option key={w.collection} value={w.collection}>
              {w.name} · {w.chunks}
            </option>
          ))}
        </select>
        <ChevronIcon />
      </div>

      {/* Primary nav — pill active state */}
      <nav className="ml-auto flex items-center gap-0.5 rounded-xl border border-line/60 bg-surface/40 p-1">
        {navLinks.map((l) => {
          const active = path === l.href;
          return (
            <Link
              key={l.href}
              href={l.href}
              aria-current={active ? "page" : undefined}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-all ${
                active
                  ? "bg-amber/15 text-amber shadow-[inset_0_0_0_1px_rgba(200,255,0,0.25)]"
                  : "text-ash hover:bg-raised hover:text-sand"
              }`}
            >
              {l.label}
            </Link>
          );
        })}
      </nav>

      {/* User + sign out */}
      {enabled && user && (
        <div className="flex shrink-0 items-center gap-2.5 border-l border-line pl-4">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-amber-2 to-amber font-display text-sm font-semibold text-ink shadow-glow-sm">
            {user.username.slice(0, 1).toUpperCase()}
          </span>
          <span className="hidden flex-col leading-tight md:flex">
            <span className="text-sm font-medium text-sand">{user.username}</span>
            <span className="font-mono text-[9px] uppercase tracking-[0.15em] text-amber">{user.role}</span>
          </span>
          <button
            onClick={logout}
            title="Sign out"
            aria-label="Sign out"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-line text-faint transition-colors hover:border-rust/50 hover:text-rust"
          >
            <LogoutIcon />
          </button>
        </div>
      )}
    </header>
  );
}

function LayersIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" className="pointer-events-none absolute left-2.5 text-faint">
      <path d="M12 3l9 5-9 5-9-5 9-5z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M3 12l9 5 9-5M3 16l9 5 9-5" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="pointer-events-none absolute right-2.5 text-faint transition-colors peer-hover:text-amber">
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path d="M15 12H4m0 0l3.5-3.5M4 12l3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10 4h8a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
