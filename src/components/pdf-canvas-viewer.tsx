"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Minus, Plus, RotateCcw } from "lucide-react";
import { loadPdfjs, type PdfJsDocument } from "@/lib/pdfjs-loader";

// In-browser PDF viewer that renders each page to its own <canvas> via
// pdfjs-dist. Beats an <iframe> pointed at the raw PDF because Chrome's
// built-in viewer ignores #zoom=N fragments on same-origin URLs in
// practice — we were getting a 44% fit-width default no matter what.
//
// With canvas rendering we control the scale directly:
//   - Default is "fit to container width", which is the practical
//     definition of 100% zoom for most users (page fills the reader).
//   - Zoom buttons step in/out by 25% and persist for the session.
//   - Device pixel ratio is baked into the canvas bitmap so it stays
//     sharp on retina / hi-dpi screens at any zoom.
//
// pdfjs is lazy-loaded once per page via the shared loader (see
// src/lib/pdfjs-loader.ts for why we don't touch it inline here).

export type PdfCanvasViewerProps = {
  src: string;
  className?: string;
  // Start zoom level. Default "fit" measures the container width and scales
  // pages up so each fills it. Pass a number to force a specific scale
  // (1.0 = 100% PDF-native, 1.5 = 150%, etc.).
  initialScale?: "fit" | number;
};

const MIN_SCALE = 0.5;
const MAX_SCALE = 3.0;

export function PdfCanvasViewer({ src, className, initialScale = "fit" }: PdfCanvasViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const docRef = useRef<PdfJsDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [scale, setScale] = useState<number>(typeof initialScale === "number" ? initialScale : 1.0);
  const [fitScale, setFitScale] = useState<number | null>(null);
  const [usingFit, setUsingFit] = useState<boolean>(initialScale === "fit");

  // Load the PDF once per src.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    docRef.current = null;
    (async () => {
      try {
        const pdfjsLib = await loadPdfjs();
        const res = await fetch(src, { credentials: "include", cache: "no-store" });
        if (!res.ok) throw new Error(`Fetch failed ${res.status}`);
        const buf = await res.arrayBuffer();
        if (cancelled) return;
        const doc = await pdfjsLib.getDocument({ data: buf }).promise;
        if (cancelled) return;
        docRef.current = doc;
        setLoading(false);
      } catch (e) {
        if (cancelled) return;
        setErr(e instanceof Error ? e.message : "PDF load failed");
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [src]);

  // Recompute fit-width scale when container size changes (or when doc loads).
  const recomputeFit = useCallback(async () => {
    const doc = docRef.current;
    const container = containerRef.current;
    if (!doc || !container) return;
    const firstPage = await doc.getPage(1);
    const natural = firstPage.getViewport({ scale: 1 });
    // Subtract padding so the canvas never overflows and forces a horizontal
    // scrollbar. 32 = 16px padding on each side.
    const available = Math.max(240, container.clientWidth - 32);
    const fit = available / natural.width;
    setFitScale(fit);
  }, []);

  useEffect(() => {
    if (loading || !docRef.current) return;
    void recomputeFit();
    const obs = new ResizeObserver(() => {
      void recomputeFit();
    });
    if (containerRef.current) obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, [loading, recomputeFit]);

  // Render every page at the current effective scale.
  useEffect(() => {
    const doc = docRef.current;
    const host = canvasHostRef.current;
    if (!doc || !host || loading) return;
    const effective = usingFit && fitScale ? fitScale : scale;
    // Guard: don't render if fit hasn't been measured yet and we're using fit.
    if (usingFit && !fitScale) return;
    let cancelled = false;
    (async () => {
      host.innerHTML = "";
      const dpr = typeof window !== "undefined" ? Math.max(1, window.devicePixelRatio || 1) : 1;
      for (let p = 1; p <= doc.numPages; p++) {
        if (cancelled) return;
        const page = await doc.getPage(p);
        const viewport = page.getViewport({ scale: effective });
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(viewport.width * dpr);
        canvas.height = Math.round(viewport.height * dpr);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        canvas.className = "block rounded-md bg-white shadow-sm";
        host.appendChild(canvas);
        const ctx = canvas.getContext("2d");
        if (!ctx) continue;
        ctx.scale(dpr, dpr);
        await page.render({ canvasContext: ctx, viewport }).promise;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loading, scale, fitScale, usingFit]);

  function zoomIn() {
    setUsingFit(false);
    setScale((s) => {
      const base = usingFit && fitScale ? fitScale : s;
      return Math.min(MAX_SCALE, Math.round((base + 0.25) * 100) / 100);
    });
  }
  function zoomOut() {
    setUsingFit(false);
    setScale((s) => {
      const base = usingFit && fitScale ? fitScale : s;
      return Math.max(MIN_SCALE, Math.round((base - 0.25) * 100) / 100);
    });
  }
  function resetFit() {
    setUsingFit(true);
    void recomputeFit();
  }

  const displayedScale = usingFit && fitScale ? fitScale : scale;
  const pct = Math.round(displayedScale * 100);

  return (
    <div
      ref={containerRef}
      className={"flex flex-col overflow-hidden bg-muted/30 " + (className ?? "")}
    >
      <div className="flex items-center justify-between border-b border-border bg-white px-3 py-1.5">
        <div className="text-[11px] text-muted-foreground">
          {loading ? "Loading…" : err ? "Failed to load" : `${pct}%${usingFit ? " · fit to width" : ""}`}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={zoomOut}
            disabled={loading || !!err || displayedScale <= MIN_SCALE}
            className="inline-flex h-6 w-6 items-center justify-center rounded border border-border bg-white text-navy-400 hover:text-navy disabled:opacity-40"
            title="Zoom out"
          >
            <Minus className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={resetFit}
            disabled={loading || !!err}
            className="inline-flex h-6 items-center gap-1 rounded border border-border bg-white px-2 text-[11px] text-navy-400 hover:text-navy disabled:opacity-40"
            title="Fit to width"
          >
            <RotateCcw className="h-3 w-3" /> Fit
          </button>
          <button
            type="button"
            onClick={zoomIn}
            disabled={loading || !!err || displayedScale >= MAX_SCALE}
            className="inline-flex h-6 w-6 items-center justify-center rounded border border-border bg-white text-navy-400 hover:text-navy disabled:opacity-40"
            title="Zoom in"
          >
            <Plus className="h-3 w-3" />
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-auto p-4">
        {loading && (
          <div className="flex h-full min-h-[400px] items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading PDF…
          </div>
        )}
        {err && !loading && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-xs text-red-800">
            Couldn&apos;t render this PDF in the browser: {err}. Use Download to open it instead.
          </div>
        )}
        <div ref={canvasHostRef} className="flex flex-col items-center gap-3" />
      </div>
    </div>
  );
}
