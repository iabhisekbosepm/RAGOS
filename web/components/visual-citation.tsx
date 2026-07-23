"use client";

import { useEffect, useState } from "react";
import { mediaUrl, visualCite, type BBox } from "@/lib/retriever";

/** Renders a source image with the answer region highlighted (query-specific bbox). */
export default function VisualCitation({ imageUrl, query }: { imageUrl: string; query: string }) {
  const [box, setBox] = useState<BBox | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    visualCite(imageUrl, query)
      .then((b) => !cancelled && setBox(b))
      .catch(() => !cancelled && setBox(null))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [imageUrl, query]);

  const [x, y, w, h] = box?.bbox ?? [0, 0, 0, 0];

  return (
    <div className="mt-2">
      <div className="relative inline-block max-w-full overflow-hidden rounded-lg border border-line">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={mediaUrl(imageUrl)} alt="source" className="block max-h-96 w-auto" />
        {box && w > 0 && (
          <div
            className="pointer-events-none absolute border-2 border-amber bg-amber/20"
            style={{
              left: `${x * 100}%`,
              top: `${y * 100}%`,
              width: `${w * 100}%`,
              height: `${h * 100}%`,
            }}
          />
        )}
      </div>
      <p className="mt-1 text-xs text-amber/80">
        {loading ? "locating answer in image…" : box?.explanation}
      </p>
    </div>
  );
}
