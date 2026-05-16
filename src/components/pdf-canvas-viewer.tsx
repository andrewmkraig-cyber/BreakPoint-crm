"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Minus, Plus, RotateCcw } from "lucide-react";
import {
  loadPdfjs,
  type PdfJsDocument,
  type PdfJsTextLayerInstance,
} from "@/lib/pdfjs-loader";

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
  // Case-insensitive keyword tokens to tint inside the PDF. When non-
  // empty the viewer mounts pdfjs's text layer on top of each canvas
  // page and tints any text run whose textContent contains a token.
  // Spans are transparent + pointer-events: none so the canvas stays
  // visually authoritative and the highlight reads as a tint over the
  // rasterized glyphs. Empty / undefined skips the text-layer pass
  // entirely so non-search renders pay no overhead.
  highlightTokens?: string[];
};

// Subtle amber tint. Lower alpha + multiply blend on the text-layer
// container (set at mount time below) means the highlight reads as a
// pen swipe over the rasterized glyphs rather than an opaque block.
const HIGHLIGHT_BG = "rgba(250, 204, 21, 0.25)";

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function tintMatchedSpans(spans: HTMLElement[], tokens: string[]): void {
  const cleaned = tokens.filter((t) => t.length > 0);
  if (cleaned.length === 0) return;
  // Word-boundary regex per token. Catches "tax" inside "tax credit"
  // but not inside "taxation" / "syntax". Escapes regex metacharacters
  // so tokens like "C++" / "C#" don't blow up the constructor. Built
  // once per call and reused across spans.
  const probes = cleaned.map((t) => new RegExp(`\\b${escapeRegex(t)}\\b`, "i"));
  for (const span of spans) {
    const text = span.textContent ?? "";
    if (!text.trim()) continue;
    if (probes.some((re) => re.test(text))) {
      span.style.backgroundColor = HIGHLIGHT_BG;
      span.style.borderRadius = "2px";
    }
  }
}

const MIN_SCALE = 0.5;
const MAX_SCALE = 3.0;

export function PdfCanvasViewer({
  src,
  className,
  initialScale = "fit",
  highlightTokens,
}: PdfCanvasViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const docRef = useRef<PdfJsDocument | null>(null);
  const libRef = useRef<Awaited<ReturnType<typeof loadPdfjs>> | null>(null);
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
        libRef.current = pdfjsLib;
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
    // Track in-flight text-layer renders so a fast zoom change can
    // cancel them before they paint into a wrapper that's about to
    // be torn down. Canvas-level cancellation is handled implicitly
    // by the `cancelled` flag short-circuiting the page loop.
    const activeTextLayers: PdfJsTextLayerInstance[] = [];
    (async () => {
      host.innerHTML = "";
      const dpr = typeof window !== "undefined" ? Math.max(1, window.devicePixelRatio || 1) : 1;
      const tokens = (highlightTokens ?? []).filter((t) => t.length > 0);
      const pdfjsLib = libRef.current;
      for (let p = 1; p <= doc.numPages; p++) {
        if (cancelled) return;
        const page = await doc.getPage(p);
        const viewport = page.getViewport({ scale: effective });
        // Per-page wrapper is the positioning context for the text-
        // layer overlay. Stacks canvas (z=0) below the highlight
        // spans (z=1) without needing explicit z-index — DOM order
        // already puts the text layer on top.
        const pageWrap = document.createElement("div");
        pageWrap.className = "relative";
        pageWrap.style.width = `${viewport.width}px`;
        pageWrap.style.height = `${viewport.height}px`;

        const canvas = document.createElement("canvas");
        canvas.width = Math.round(viewport.width * dpr);
        canvas.height = Math.round(viewport.height * dpr);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        // Literal white: PDF pages are paper — always render against a
        // white sheet regardless of Court Mode. A court-* surface token
        // would tint the page in Clay/Grass and make body text unreadable.
        canvas.className = "block rounded-md bg-white shadow-sm";
        pageWrap.appendChild(canvas);

        const ctx = canvas.getContext("2d");
        if (!ctx) {
          host.appendChild(pageWrap);
          continue;
        }
        ctx.scale(dpr, dpr);
        await page.render({ canvasContext: ctx, viewport }).promise;

        if (!cancelled && tokens.length > 0 && pdfjsLib) {
          // pdfjs v5 TextLayer reads --scale-factor from the host to
          // compensate the browser's text-zoom; setting it to the
          // current viewport scale lines spans up with rasterized
          // glyphs at every zoom level.
          const textLayerDiv = document.createElement("div");
          textLayerDiv.className = "absolute inset-0 overflow-hidden";
          textLayerDiv.style.color = "transparent";
          textLayerDiv.style.pointerEvents = "none";
          // Multiply blend lets the amber tint mix with the canvas
          // pixels underneath instead of laying down as flat color —
          // highlighted text reads through the tint at full sharpness.
          textLayerDiv.style.mixBlendMode = "multiply";
          textLayerDiv.style.setProperty("--scale-factor", String(effective));
          pageWrap.appendChild(textLayerDiv);
          try {
            const textContent = await page.getTextContent();
            if (cancelled) {
              host.appendChild(pageWrap);
              continue;
            }
            const tl = new pdfjsLib.TextLayer({
              textContentSource: textContent,
              container: textLayerDiv,
              viewport,
            });
            activeTextLayers.push(tl);
            await tl.render();
            if (cancelled) {
              host.appendChild(pageWrap);
              continue;
            }
            tintMatchedSpans(tl.textDivs, tokens);
          } catch {
            // Text layer is decorative — a getTextContent or TextLayer
            // failure must not block the canvas from rendering. The
            // rasterized PDF is still on screen; the user just won't
            // see token tints on this page.
          }
        }

        host.appendChild(pageWrap);
      }
    })();
    return () => {
      cancelled = true;
      for (const tl of activeTextLayers) {
        try {
          tl.cancel();
        } catch {
          // already torn down
        }
      }
    };
  }, [loading, scale, fitScale, usingFit, highlightTokens]);

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
      className={"flex flex-col overflow-hidden bg-court-surface-subtle/60 " + (className ?? "")}
    >
      <div className="flex items-center justify-between border-b border-court-border bg-court-surface px-3 py-1.5">
        <div className="text-[11px] text-court-fg-muted">
          {loading ? "Loading…" : err ? "Failed to load" : `${pct}%${usingFit ? " · fit to width" : ""}`}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={zoomOut}
            disabled={loading || !!err || displayedScale <= MIN_SCALE}
            className="inline-flex h-6 w-6 items-center justify-center rounded border border-court-border bg-court-surface text-court-fg-muted hover:text-court-fg disabled:opacity-40"
            title="Zoom out"
          >
            <Minus className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={resetFit}
            disabled={loading || !!err}
            className="inline-flex h-6 items-center gap-1 rounded border border-court-border bg-court-surface px-2 text-[11px] text-court-fg-muted hover:text-court-fg disabled:opacity-40"
            title="Fit to width"
          >
            <RotateCcw className="h-3 w-3" /> Fit
          </button>
          <button
            type="button"
            onClick={zoomIn}
            disabled={loading || !!err || displayedScale >= MAX_SCALE}
            className="inline-flex h-6 w-6 items-center justify-center rounded border border-court-border bg-court-surface text-court-fg-muted hover:text-court-fg disabled:opacity-40"
            title="Zoom in"
          >
            <Plus className="h-3 w-3" />
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-auto p-4">
        {loading && (
          <div className="flex h-full min-h-[400px] items-center justify-center gap-2 text-sm text-court-fg-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading PDF…
          </div>
        )}
        {err && !loading && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-xs text-red-800">
            <div className="font-semibold">Couldn&apos;t render this PDF in the browser.</div>
            <div className="mt-1 font-mono">{err}</div>
            <div className="mt-2">
              Try reloading the page — this is usually a stale client bundle. If reloading doesn&apos;t help, use Download to open it instead.
            </div>
          </div>
        )}
        <div ref={canvasHostRef} className="flex flex-col items-center gap-3" />
      </div>
    </div>
  );
}
