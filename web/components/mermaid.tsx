"use client";

import { useCallback, useEffect, useRef, useState } from "react";

let idSeq = 0;

/** Renders Mermaid diagram code to SVG (client-only).
 *  `fill` → large viewport with fit-to-frame + zoom + drag-pan (for big mind maps). */
export default function Mermaid({ code, fill = false }: { code: string; fill?: boolean }) {
  const frameRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [err, setErr] = useState("");
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  const fit = useCallback(() => {
    if (!fill || !frameRef.current || !nat) return;
    const fw = frameRef.current.clientWidth, fh = frameRef.current.clientHeight;
    const s = Math.min(fw / nat.w, fh / nat.h) * 0.95;
    setScale(s);
    setOffset({ x: (fw - nat.w * s) / 2, y: (fh - nat.h * s) / 2 });
  }, [fill, nat]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({ startOnLoad: false, theme: "dark", securityLevel: "loose" });
        const id = `mmd-${idSeq++}`;
        const { svg } = await mermaid.render(id, code);
        if (cancelled || !contentRef.current) return;
        contentRef.current.innerHTML = svg;
        const el = contentRef.current.querySelector("svg");
        if (el && fill) {
          const vb = el.getAttribute("viewBox")?.split(/\s+/).map(Number);
          const w = vb?.[2] || el.clientWidth || 800;
          const h = vb?.[3] || el.clientHeight || 600;
          el.setAttribute("width", String(w));
          el.setAttribute("height", String(h));
          el.style.maxWidth = "none";
          el.style.display = "block";
          setNat({ w, h });
        }
      } catch (e) {
        if (!cancelled) setErr((e as Error).message);
      }
    })();
    return () => { cancelled = true; };
  }, [code, fill]);

  // Fit once we know the natural size (and on window resize).
  useEffect(() => { fit(); }, [fit]);
  useEffect(() => {
    if (!fill) return;
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [fill, fit]);

  const zoom = (factor: number) => setScale((s) => Math.min(4, Math.max(0.1, s * factor)));

  const onWheel = (e: React.WheelEvent) => {
    if (!fill) return;
    e.preventDefault();
    zoom(e.deltaY < 0 ? 1.1 : 0.9);
  };
  const onPointerDown = (e: React.PointerEvent) => {
    if (!fill) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    setOffset({ x: drag.current.ox + (e.clientX - drag.current.x), y: drag.current.oy + (e.clientY - drag.current.y) });
  };
  const onPointerUp = () => { drag.current = null; };

  if (err)
    return (
      <div className="rounded-lg border border-rust/50 p-3 text-xs text-rust">
        Diagram error: {err}
        <pre className="mt-2 whitespace-pre-wrap text-faint">{code}</pre>
      </div>
    );

  if (!fill) return <div ref={contentRef} className="overflow-auto rounded-xl border border-line bg-surface p-4" />;

  return (
    <div className="relative h-[calc(100vh-12rem)] min-h-[420px] w-full overflow-hidden rounded-xl border border-line bg-surface">
      {/* zoom controls */}
      <div className="absolute right-3 top-3 z-10 flex items-center gap-1 rounded-lg border border-line bg-ink/80 p-1 backdrop-blur">
        <button onClick={() => zoom(1.2)} className="flex h-7 w-7 items-center justify-center rounded text-ash hover:bg-raised hover:text-amber" title="Zoom in">+</button>
        <button onClick={() => zoom(0.83)} className="flex h-7 w-7 items-center justify-center rounded text-ash hover:bg-raised hover:text-amber" title="Zoom out">−</button>
        <button onClick={fit} className="flex h-7 items-center justify-center rounded px-2 text-xs text-ash hover:bg-raised hover:text-amber" title="Fit to screen">Fit</button>
        <span className="px-1 font-mono text-[10px] text-faint">{Math.round(scale * 100)}%</span>
      </div>
      <div
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        className="h-full w-full cursor-grab active:cursor-grabbing"
      >
        <div
          ref={contentRef}
          style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`, transformOrigin: "0 0" }}
          className="origin-top-left"
        />
      </div>
      <p className="pointer-events-none absolute bottom-2 left-3 font-mono text-[10px] text-faint">scroll = zoom · drag = pan</p>
    </div>
  );
}
