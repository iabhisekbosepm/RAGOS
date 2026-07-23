"use client";

import type { ReactNode } from "react";

/** Two-pane tool layout: a fixed control rail (left) + a wide output area (right). */
export default function ToolShell({
  eyebrow, title, subtitle, sidebar, children,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  sidebar: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="grid h-full grid-cols-1 lg:grid-cols-[360px_minmax(0,1fr)]">
      <aside className="overflow-y-auto border-b border-line p-6 lg:border-b-0 lg:border-r">
        <p className="eyebrow mb-1">{eyebrow}</p>
        <h1 className="font-display text-2xl text-sand">{title}</h1>
        {subtitle && <p className="mb-5 mt-1 text-sm text-ash">{subtitle}</p>}
        <div className="space-y-4">{sidebar}</div>
      </aside>
      <div className="overflow-y-auto p-6 lg:p-8">
        <div className="mx-auto max-w-4xl">{children}</div>
      </div>
    </div>
  );
}
