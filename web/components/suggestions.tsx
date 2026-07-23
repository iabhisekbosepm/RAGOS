"use client";

import { useEffect, useState } from "react";
import { fetchSuggestions } from "@/lib/retriever";

/**
 * Workspace-specific starter questions as clickable chips. Fetches its own list
 * (cached server-side per workspace) and calls onPick with the chosen query.
 */
export default function Suggestions({
  collection,
  onPick,
  disabled,
}: {
  collection: string;
  onPick: (q: string) => void;
  disabled?: boolean;
}) {
  const [items, setItems] = useState<string[]>([]);

  useEffect(() => {
    let active = true;
    setItems([]);
    fetchSuggestions(collection).then((s) => active && setItems(s)).catch(() => active && setItems([]));
    return () => { active = false; };
  }, [collection]);

  if (items.length === 0) return null;
  return (
    <div className="mb-4">
      <p className="eyebrow mb-2">try asking</p>
      <div className="flex flex-wrap gap-2">
        {items.map((s) => (
          <button
            key={s}
            onClick={() => onPick(s)}
            disabled={disabled}
            className="rounded-full border border-line bg-surface px-3 py-1.5 text-left text-xs text-ash transition-colors hover:border-amber/50 hover:text-amber disabled:opacity-50"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}
