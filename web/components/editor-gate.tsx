"use client";

import { useAuth } from "@/lib/auth";

/** True when the current user may create/modify (editor or admin, or auth off). */
export function useCanEdit(): boolean {
  return useAuth().can("editor");
}

/** Inline notice shown to read-only (viewer) users above a gated action. */
export default function EditorNote({ action = "This action" }: { action?: string }) {
  if (useAuth().can("editor")) return null;
  return (
    <p className="rounded-lg border border-line bg-ink/40 px-3 py-2 text-[11px] text-ash">
      🔒 {action} requires the <span className="text-amber">editor</span> role — you have read-only access.
    </p>
  );
}
