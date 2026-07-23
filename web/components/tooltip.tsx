"use client";

import type { ReactNode } from "react";

/** Hover/focus tooltip. Trigger styling comes from `children`; explanation floats above. */
export default function Tooltip({ content, children }: { content: ReactNode; children: ReactNode }) {
  return (
    <span className="group relative inline-flex focus-within:z-30 hover:z-30">
      <span tabIndex={0} className="cursor-help outline-none">{children}</span>
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 hidden w-64 -translate-x-1/2 rounded-lg border border-line bg-surface p-3 text-left text-xs font-normal normal-case leading-relaxed tracking-normal text-ash shadow-panel group-hover:block group-focus-within:block"
      >
        {content}
        <span className="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-line" />
      </span>
    </span>
  );
}
