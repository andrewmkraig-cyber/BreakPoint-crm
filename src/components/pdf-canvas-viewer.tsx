"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Minus, Plus, RotateCcw } from "lucide-react";
import {
  loadPdfjs,
  type PdfJsDocument,
  type PdfJsLib,
  type PdfJsTextContent,
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
  // Optional in-document highlighting. When tokens is non-empty, each page
  // gets a transparent text-overlay built from getTextContent; matches are
  // wrapped in <mark> styled with highlightClassMap[token]. The mark sits
  // on top of the canvas-rendered glyphs so the bg-color reads as a
  // highlight over the original PDF text. Empty/undefined = canvas only.
  highlightTokens?: string[];
  // Map keyed by the original token string (case-sensitive); value is a
  // Tailwind class string applied to the <mark>'s background. Falls back
  // to a neutral amber if a match's token isn't in the map.
  highlightClassMap?: Map<string, string>;
};

const MIN_SCALE = 0.5;
const MAX_SCALE = 3.0;

// iOS Safari silently paints a BLANK (white) canvas — no error thrown —
// once a canvas's pixel area crosses an internal ceiling (~16.7M px on
// most devices), and the iPhone's devicePixelRatio of 3 triples the
// bitmap area, so it trips that ceiling far sooner than desktop. That's
// what was leaving mobile resume previews empty. We cap each canvas's
// area well under the limit and clamp the bitmap DPR below; CSS display
// size is untouched, so the page still fits-to-width — only the bitmap
// resolution drops on very large/zoomed pages.
const MAX_CANVAS_AREA = 12_000_000;
const MAX_DPR = 2;

export function PdfCanvasViewer({
  src,
  className,
  initialScale = "fit",
  highlightTokens,
  highlightClassMap,
}: PdfCanvasViewerProps) {
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
        if (!res.ok) {
          const message = (await res.text().catch(() => "")).trim();
          throw new Error(message || `PDF load failed (${res.status})`);
        }
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
    // Mobile Safari fires ResizeObserver on sub-pixel viewport wobble
    // (the address bar showing/hiding nudges the layout). Re-rendering
    // every page to canvas on each wobble churns canvas memory — exactly
    // what tips iOS into blanking them. Ignore deltas under ~1% so a
    // genuine width change still re-fits but noise doesn't.
    setFitScale((prev) => (prev != null && Math.abs(prev - fit) < 0.01 ? prev : fit));
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
    const tokens = highlightTokens ?? [];
    const classMap = highlightClassMap ?? new Map<string, string>();
    let cancelled = false;
    (async () => {
      try {
        const pdfjsLib = await loadPdfjs();
        if (cancelled) return;
        host.innerHTML = "";
        const rawDpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
        const dpr = Math.min(Math.max(1, rawDpr), MAX_DPR);
        for (let p = 1; p <= doc.numPages; p++) {
          if (cancelled) return;
          const page = await doc.getPage(p);
          const viewport = page.getViewport({ scale: effective });
          // Per-page wrapper so the absolute-positioned text overlay aligns
          // against the canvas. width/height match the CSS pixel size of the
          // canvas (not the DPR-scaled bitmap dimensions).
          const pageWrap = document.createElement("div");
          pageWrap.style.position = "relative";
          pageWrap.style.width = `${viewport.width}px`;
          pageWrap.style.height = `${viewport.height}px`;
          host.appendChild(pageWrap);

          // Bitmap resolution = clamped DPR, backed off further if the page
          // would exceed the iOS canvas-area ceiling (see MAX_CANVAS_AREA).
          // Display (CSS) size stays at viewport size either way.
          let outputScale = dpr;
          const area = viewport.width * viewport.height * outputScale * outputScale;
          if (area > MAX_CANVAS_AREA) {
            outputScale = Math.sqrt(
              MAX_CANVAS_AREA / (viewport.width * viewport.height),
            );
          }

          const canvas = document.createElement("canvas");
          canvas.width = Math.round(viewport.width * outputScale);
          canvas.height = Math.round(viewport.height * outputScale);
          canvas.style.width = `${viewport.width}px`;
          canvas.style.height = `${viewport.height}px`;
          // Literal white: PDF pages are paper — always render against a
          // white sheet regardless of Court Mode. A court-* surface token
          // would tint the page in Clay/Grass and make body text unreadable.
          canvas.className = "block rounded-md bg-white shadow-sm";
          pageWrap.appendChild(canvas);
          const ctx = canvas.getContext("2d");
          if (!ctx) continue;
          ctx.scale(outputScale, outputScale);
          await page.render({ canvasContext: ctx, viewport }).promise;
          if (cancelled) return;

          if (tokens.length > 0) {
            const textContent = await page.getTextContent();
            if (cancelled) return;
            const overlay = document.createElement("div");
            overlay.style.position = "absolute";
            overlay.style.inset = "0";
            overlay.style.overflow = "hidden";
            overlay.style.lineHeight = "1";
            overlay.style.pointerEvents = "none";
            overlay.setAttribute("aria-hidden", "true");
            pageWrap.appendChild(overlay);
            paintHighlightOverlay({
              overlay,
              textContent,
              viewportTransform: viewport.transform,
              viewportScale: viewport.scale,
              tokens,
              classMap,
              Util: pdfjsLib.Util,
            });
          }
        }
        // Reached only if every page rendered without throwing — clear any
        // stale error from a prior failed attempt (e.g. a zoom that was
        // too large succeeding after zooming back out).
        if (!cancelled) setErr(null);
      } catch (e) {
        // Without this the render loop failed silently and left a blank
        // white canvas (the mobile bug). Surface it so the error UI +
        // Download fallback show instead.
        if (cancelled) return;
        setErr(e instanceof Error ? e.message : "PDF render failed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loading, scale, fitScale, usingFit, highlightTokens, highlightClassMap]);

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
              Try reloading the page. This is usually a stale client bundle. If reloading doesn&apos;t help, use Download to open it instead.
            </div>
          </div>
        )}
        <div ref={canvasHostRef} className="flex flex-col items-center gap-3" />
      </div>
    </div>
  );
}

// Paints a transparent text-overlay on top of the canvas. Each pdfjs
// TextItem becomes an absolutely-positioned <span> with color:transparent
// so the canvas-rendered glyphs underneath remain visible; matched
// substrings get wrapped in <mark> with the token's chip class so the
// highlight bg shows through. Positioning math mirrors what pdfjs's own
// TextLayer does: combine viewport.transform with item.transform, then
// extract the baseline + font-height in screen pixels.
function paintHighlightOverlay({
  overlay,
  textContent,
  viewportTransform,
  viewportScale,
  tokens,
  classMap,
  Util,
}: {
  overlay: HTMLElement;
  textContent: PdfJsTextContent;
  viewportTransform: number[];
  // viewport.scale (CSS-px-per-PDF-unit) — multiplied with item.width to
  // get the canvas-rendered width of the text item in screen pixels, so
  // scaleX below can stretch the sans-serif overlay to match it.
  viewportScale: number;
  tokens: string[];
  classMap: Map<string, string>;
  Util: PdfJsLib["Util"];
}) {
  const escaped = tokens.map(escapeRegex).filter(Boolean);
  if (escaped.length === 0) return;
  // \b word boundaries keep "tax" from matching "taxonomy" or "syntax".
  // Identical pattern is reused by the per-item probe below and by
  // wrapMatches so the cheap pre-filter and the actual highlighter agree.
  const pattern = `\\b(${escaped.join("|")})\\b`;

  // Single off-DOM canvas used to measure sans-serif text widths. Reused
  // across every text item on the page so we're not allocating one per
  // call to measureText. Browser-only — paintHighlightOverlay is invoked
  // from a useEffect that itself only runs after pdfjs has loaded.
  const measureCanvas = document.createElement("canvas");
  const mctx = measureCanvas.getContext("2d");

  for (const raw of textContent.items) {
    if (!raw || typeof raw !== "object" || !("str" in raw)) continue;
    const item = raw as { str: string; transform: number[]; width: number };
    if (!item.str) continue;
    // Cheap rejection so we don't allocate spans for items that contain
    // no token match at all — typical resume page has hundreds of items
    // and only a handful match. Reset lastIndex before each test().
    const probe = new RegExp(pattern, "i");
    if (!probe.test(item.str)) continue;

    const tx = Util.transform(viewportTransform, item.transform);
    const fontHeight = Math.hypot(tx[2], tx[3]);
    const angle = Math.atan2(tx[1], tx[0]);
    const left = tx[4];
    const top = tx[5] - fontHeight;

    // Stretch the overlay span horizontally so its sans-serif rendering
    // occupies the same screen-px width as the canvas's PDF-font glyphs.
    // Without this, a multi-word item like "education teaching" measures
    // wider/narrower in sans-serif than in the embedded PDF font, and an
    // inline-flowed <mark> for "teaching" lands on top of "education"
    // (or floats past the canvas word entirely). Mirrors what pdfjs's
    // own TextLayer does with its per-item scaleX. transform-origin is
    // bottom-left below so the span's left edge stays pinned to `left`
    // — only the internal width scales.
    let scaleX = 1;
    if (mctx && item.width > 0) {
      mctx.font = `${fontHeight}px sans-serif`;
      const naturalWidth = mctx.measureText(item.str).width;
      const targetWidth = item.width * viewportScale;
      if (naturalWidth > 0) scaleX = targetWidth / naturalWidth;
    }

    const span = document.createElement("span");
    span.style.position = "absolute";
    span.style.left = `${left}px`;
    span.style.top = `${top}px`;
    span.style.fontSize = `${fontHeight}px`;
    // sans-serif is a deliberate approximation — the canvas renders with
    // the PDF's embedded font but we only need the overlay's <mark> bg
    // to sit on top of the same glyphs. The scaleX correction above
    // compensates for the sans-serif vs PDF-font width mismatch so the
    // mark's position inside the span aligns with the canvas word.
    span.style.fontFamily = "sans-serif";
    span.style.whiteSpace = "pre";
    span.style.color = "transparent";
    span.style.transformOrigin = "0% 100%";
    const transforms: string[] = [];
    if (Math.abs(angle) > 0.001) transforms.push(`rotate(${angle}rad)`);
    if (Math.abs(scaleX - 1) > 0.001) transforms.push(`scaleX(${scaleX})`);
    if (transforms.length > 0) span.style.transform = transforms.join(" ");
    span.innerHTML = wrapMatches(item.str, tokens, classMap, pattern);
    overlay.appendChild(span);
  }
}

function wrapMatches(
  text: string,
  tokens: string[],
  classMap: Map<string, string>,
  pattern: string,
): string {
  const re = new RegExp(pattern, "gi");
  let out = "";
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out += escapeHtml(text.slice(last, m.index));
    const hit = m[0];
    // Match the chip's color by the original token key (case-insensitive).
    const tokenKey = tokens.find((t) => t.toLowerCase() === hit.toLowerCase());
    const cls = (tokenKey && classMap.get(tokenKey)) || "bg-amber-200/70";
    // color:inherit — the parent span is color:transparent so the mark
    //   text also stays invisible (canvas glyphs underneath are the real
    //   text). mix-blend-mode:multiply layers the 200/70 highlight bg
    //   onto the canvas pixels so the wash reads as a Jax-style marker
    //   pass instead of an opaque sticker. pointer-events:none so the
    //   highlight never steals clicks from the underlying canvas.
    out += `<mark class="rounded-sm ${cls}" style="color:inherit;mix-blend-mode:multiply;pointer-events:none">${escapeHtml(hit)}</mark>`;
    last = m.index + hit.length;
    if (hit.length === 0) re.lastIndex++;
  }
  if (last < text.length) out += escapeHtml(text.slice(last));
  return out;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
