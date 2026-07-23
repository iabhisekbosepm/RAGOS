"use client";

import { useState, type ReactNode } from "react";

/** Collapsible plain-language help box for non-technical users. */
export default function InfoBox({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-6 rounded-xl border border-amber/25 bg-amber/[0.06] text-sm">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-4 py-2.5 text-left text-amber"
      >
        <span className="font-medium">✦ {title}</span>
        <span className="eyebrow text-amber/70">{open ? "hide" : "what is this?"}</span>
      </button>
      {open && <div className="space-y-2 border-t border-amber/20 px-4 py-3 text-ash">{children}</div>}
    </div>
  );
}
