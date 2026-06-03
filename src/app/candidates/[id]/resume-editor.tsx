"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Eraser, Loader2, Save, Stamp, Undo2, X } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import {
  brandCandidateResume,
  type BrandPlacement,
  type RedactionRect,
} from "@/app/candidates/[id]/brand-resume-actions";
import { BRAND_LOGO_TRANSPARENT_BASE64 } from "@/lib/default-brand-logo";
import { loadPdfjs, type PdfJsDocument, type PdfJsRenderTask } from "@/lib/pdfjs-loader";
import { Button } from "@/components/ui/button";

// Phase 5A.5.b — Edit Resume modal. The unified editor lets the
// recruiter both place the BreakPoint logo AND draw redaction
// rectangles on the same canvas, then saves the combined output as a
// new CandidateResume row in one call. Replaces the earlier
// two-tab Brand/Redact split.
//
// Mobile sizing mirrors PdfCanvasViewer (src/components/pdf-canvas-viewer.tsx):
// fit each page to the scroll pane's clientWidth so phone viewports don't
// overflow, clamp bitmap DPR to 2, and back the bitmap off when its area
// exceeds the iOS canvas-area ceiling. Without these the editor's canvas
// blanked silently on the installed PWA (same symptom PdfCanvasViewer's
// MAX_DPR / MAX_CANVAS_AREA comments call out). MIN_FIT_SCALE keeps the
// rendered page large enough to drag the logo / draw redactions even when
// the container measures absurdly narrow.
const MIN_FIT_SCALE = 0.5;
const MAX_DPR = 2;
const MAX_CANVAS_AREA = 12_000_000;
const DEFAULT_LOGO_WIDTH = 80;
const MIN_LOGO_WIDTH = 40;
const MAX_LOGO_WIDTH = 200;

type PageMeta = { pageNumber: number; widthPx: number; heightPx: number };
type LogoState = {
  pageIndex: number; // 0-based
  xNorm: number;
  yNorm: number;
  widthPx: number;
};
type LiveRedactionRect = {
  page: number; // 1-based
  x: number;
  y: number;
  w: number;
  h: number;
};

export function ResumeEditor({
  candidateId,
  sourceResumeId,
  baseResumeUrl,
  baseResumeFilename,
  onClose,
  onSaved,
}: {
  candidateId: string;
  sourceResumeId: string;
  baseResumeUrl: string;
  baseResumeFilename: string;
  onClose: () => void;
  // Saving creates a new CandidateResume row; we pass its id back so
  // the parent dropdown can auto-select the freshly saved version
  // instead of staying on whatever was selected when the modal opened.
  onSaved: (newResumeId: string) => void;
}) {
  const router = useRouter();
  const [loadingDoc, setLoadingDoc] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pages, setPages] = useState<PageMeta[]>([]);
  const [logo, setLogo] = useState<LogoState | null>(null);
  const [applyToAll, setApplyToAll] = useState(false);
  const [rects, setRects] = useState<LiveRedactionRect[]>([]);
  const [redactDragStart, setRedactDragStart] = useState<{ page: number; x: number; y: number } | null>(null);
  const [redactDragCurrent, setRedactDragCurrent] = useState<{ page: number; x: number; y: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const canvasRefs = useRef<Map<number, HTMLCanvasElement>>(new Map());
  // In-flight pdfjs RenderTask per page (keyed by 1-based page number).
  // Canvases are persistent DOM nodes (canvasRefs), so a fit-scale change
  // can re-run the render effect while a prior page.render() is still
  // painting the SAME canvas — pdfjs then throws "Cannot use the same
  // canvas during multiple render() operations" and the interrupted task
  // leaves the 2D-context transform half-applied, flipping/mirroring the
  // page. We cancel the prior task before re-rendering and on cleanup so
  // pdfjs unwinds its transform cleanly before the next pass.
  const renderTasksRef = useRef<Map<number, PdfJsRenderTask>>(new Map());
  // Logo drag uses a ref instead of state so a fast pointer doesn't
  // lose deltas to async setState batching. pointerId is captured at
  // pointerdown so move/up can verify the gesture belongs to the
  // same finger / mouse — mirrors useDraggableResizable's drag ref.
  const logoDragRef = useRef<{
    pointerId: number;
    pointerOffsetX: number;
    pointerOffsetY: number;
  } | null>(null);
  // Same pattern for the redaction-draw gesture so a second finger
  // mid-draw can't hijack the rect.
  const redactDragPointerIdRef = useRef<number>(-1);
  // Holds the loaded PDF across re-renders so a fit-scale change
  // doesn't refetch + reparse the bytes — only re-renders into the
  // existing canvases at the new viewport.
  const docRef = useRef<PdfJsDocument | null>(null);
  // The scroll pane the pages sit in. Width is measured off this ref
  // (clientWidth - padding) and the ResizeObserver re-fits when the
  // mobile address bar wobbles the viewport.
  const scrollPaneRef = useRef<HTMLDivElement | null>(null);
  // null until the first measurement lands; render effects no-op until then.
  const [fitScale, setFitScale] = useState<number | null>(null);
  // Default logo placement is a one-shot per modal open — guards against
  // re-centering the logo every time fit scale wobbles (and against
  // re-placing after the recruiter clicked "Remove logo").
  const defaultLogoPlacedRef = useRef(false);

  // Load the PDF once per modal open. Bytes are cached on docRef so the
  // recompute-fit and render effects can re-render at new sizes without
  // refetching.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const pdfjsLib = await loadPdfjs();
        const res = await fetch(baseResumeUrl, { credentials: "include" });
        if (!res.ok) throw new Error(`Couldn't load resume (${res.status}).`);
        const buf = await res.arrayBuffer();
        const doc = await pdfjsLib.getDocument({ data: buf }).promise;
        if (cancelled) return;
        docRef.current = doc;
        setLoadingDoc(false);
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : "Failed to load PDF.";
        setLoadError(msg);
        setLoadingDoc(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [baseResumeUrl]);

  // Measure fit-to-container scale off the scroll pane's clientWidth
  // (matches PdfCanvasViewer's recomputeFit). 32 = 16px padding on each
  // side of the pane (px-4). MIN_FIT_SCALE floors the rendered page so
  // drag targets stay usable even when the pane measures absurdly narrow.
  // 1% threshold suppresses the iOS Safari address-bar wobble — the same
  // dampener PdfCanvasViewer uses.
  const recomputeFit = useCallback(async () => {
    const doc = docRef.current;
    const pane = scrollPaneRef.current;
    if (!doc || !pane) return;
    const firstPage = await doc.getPage(1);
    const natural = firstPage.getViewport({ scale: 1 });
    const available = Math.max(240, pane.clientWidth - 32);
    const fit = Math.max(MIN_FIT_SCALE, available / natural.width);
    setFitScale((prev) => (prev != null && Math.abs(prev - fit) < 0.01 ? prev : fit));
  }, []);

  useEffect(() => {
    if (loadingDoc || !docRef.current) return;
    void recomputeFit();
    const obs = new ResizeObserver(() => {
      void recomputeFit();
    });
    if (scrollPaneRef.current) obs.observe(scrollPaneRef.current);
    return () => obs.disconnect();
  }, [loadingDoc, recomputeFit]);

  // When fit scale changes, re-measure each page's CSS-pixel size.
  // Updating pages[i].widthPx/heightPx is what keeps the logo's
  // normalized xNorm/yNorm and the 0–1 redaction rects aligned with the
  // resized page chrome — the overlay math reads back from these values.
  useEffect(() => {
    const doc = docRef.current;
    if (!doc || loadingDoc || fitScale == null) return;
    let cancelled = false;
    (async () => {
      const metas: PageMeta[] = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const viewport = page.getViewport({ scale: fitScale });
        metas.push({ pageNumber: i, widthPx: viewport.width, heightPx: viewport.height });
      }
      if (cancelled) return;
      setPages(metas);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadingDoc, fitScale]);

  // One-shot default-logo centering on first page after pages first land.
  // Subsequent fit-scale changes don't re-run this — the recruiter's drag
  // position (or explicit Remove) wins.
  useEffect(() => {
    if (defaultLogoPlacedRef.current) return;
    if (pages.length === 0) return;
    defaultLogoPlacedRef.current = true;
    const first = pages[0];
    // Default landing spot is the top-right corner with a small inset.
    // xNorm/yNorm are the logo's normalized LEFT/TOP edge, so the right
    // edge sits at (1 - margin): left = 1 - logoWidth/pageWidth - margin.
    // Drag logic (onPagePointerMove) is untouched — this only seeds the
    // first position; the recruiter can drag freely from here.
    const DEFAULT_LOGO_MARGIN = 0.03;
    setLogo({
      pageIndex: 0,
      xNorm: 1 - DEFAULT_LOGO_WIDTH / first.widthPx - DEFAULT_LOGO_MARGIN,
      yNorm: DEFAULT_LOGO_MARGIN,
      widthPx: DEFAULT_LOGO_WIDTH,
    });
  }, [pages]);

  // Render each page into its canvas after React has committed the page
  // wrappers (so canvasRefs is populated). Re-runs whenever pages change
  // (initial load AND fit-scale-driven resize). Mirrors PdfCanvasViewer's
  // mobile guards: DPR clamped to MAX_DPR, bitmap area capped at
  // MAX_CANVAS_AREA so iOS Safari doesn't silently blank the canvas.
  useEffect(() => {
    const doc = docRef.current;
    if (!doc || pages.length === 0 || fitScale == null) return;
    let cancelled = false;
    // Stable Map instance (the ref never swaps); captured here so the
    // cleanup closure reads the same object the effect body wrote to,
    // per react-hooks/exhaustive-deps.
    const renderTasks = renderTasksRef.current;
    (async () => {
      try {
        const rawDpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
        const dpr = Math.min(Math.max(1, rawDpr), MAX_DPR);
        for (let i = 1; i <= doc.numPages; i++) {
          if (cancelled) return;
          const canvas = canvasRefs.current.get(i);
          if (!canvas) continue;
          const page = await doc.getPage(i);
          const viewport = page.getViewport({ scale: fitScale });
          let outputScale = dpr;
          const area = viewport.width * viewport.height * outputScale * outputScale;
          if (area > MAX_CANVAS_AREA) {
            outputScale = Math.sqrt(
              MAX_CANVAS_AREA / (viewport.width * viewport.height),
            );
          }
          // Cancel any render still in flight on THIS canvas before we
          // touch its bitmap/transform — otherwise pdfjs sees two render()
          // ops on one canvas (the error) and the old task corrupts the
          // transform we're about to set.
          const prevTask = renderTasks.get(i);
          if (prevTask) {
            prevTask.cancel();
            renderTasks.delete(i);
          }
          canvas.width = Math.round(viewport.width * outputScale);
          canvas.height = Math.round(viewport.height * outputScale);
          canvas.style.width = `${viewport.width}px`;
          canvas.style.height = `${viewport.height}px`;
          const ctx = canvas.getContext("2d");
          if (!ctx) continue;
          // Reset the transform before scaling — a re-render at a new
          // fit scale would otherwise compound the previous ctx.scale()
          // and paint at the wrong resolution.
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.scale(outputScale, outputScale);
          const task = page.render({ canvasContext: ctx, viewport });
          renderTasks.set(i, task);
          await task.promise;
          renderTasks.delete(i);
        }
      } catch (e) {
        if (cancelled) return;
        // A cancel() (re-trigger or cleanup) rejects the promise with
        // pdfjs's RenderingCancelledException — that's the intended path,
        // not a failure, so swallow it instead of surfacing a red error.
        if (isRenderingCancelled(e)) return;
        const msg = e instanceof Error ? e.message : "Failed to render PDF.";
        setLoadError(msg);
      }
    })();
    return () => {
      cancelled = true;
      // Abort every still-painting render so the next effect run never
      // starts a second render() on a canvas pdfjs is still using, and so
      // it can unwind its transform before that next pass.
      renderTasks.forEach((task) => task.cancel());
      renderTasks.clear();
    };
  }, [pages, fitScale]);

  // Logo handlers — Pointer Events instead of mouse so iOS PWA touch
  // gestures fire too. setPointerCapture routes every subsequent move
  // back to the logo even if the finger drifts off it, so a fast drag
  // can't escape the handler (same pattern as use-draggable-resizable).
  const onLogoPointerDown = useCallback(
    (pageIndex: number, e: React.PointerEvent<HTMLImageElement>) => {
      if (!logo) return;
      e.preventDefault();
      e.stopPropagation();
      const img = e.currentTarget.getBoundingClientRect();
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // Older Safari can throw if the pointer was already released
        // between dispatch and capture; safe to ignore — the drag still
        // works via the page wrapper's pointermove fallback.
      }
      logoDragRef.current = {
        pointerId: e.pointerId,
        pointerOffsetX: e.clientX - img.left,
        pointerOffsetY: e.clientY - img.top,
      };
      // Snap state to the page the logo lives on so move math uses
      // the right page rect.
      if (logo.pageIndex !== pageIndex) {
        setLogo({ ...logo, pageIndex });
      }
    },
    [logo],
  );

  const onSizeChange = useCallback(
    (next: number) => {
      if (!logo) return;
      const clamped = Math.max(MIN_LOGO_WIDTH, Math.min(MAX_LOGO_WIDTH, next));
      setLogo({ ...logo, widthPx: clamped });
    },
    [logo],
  );

  function onRemoveLogo() {
    setLogo(null);
  }

  function onAddLogo() {
    const first = pages[0];
    if (!first) return;
    setLogo({
      pageIndex: 0,
      xNorm: 0.5 - DEFAULT_LOGO_WIDTH / 2 / first.widthPx,
      yNorm: 0.5,
      widthPx: DEFAULT_LOGO_WIDTH,
    });
  }

  // Page event router — disambiguates logo drag from redaction draw
  // by checking whether the pointerdown target is the logo overlay.
  // setPointerCapture on the page wrapper so a redaction draw that
  // strays off the page edge still routes its moves back here instead
  // of triggering touch-scroll on whatever ancestor catches the gesture.
  const onPagePointerDown = useCallback(
    (pageIndex: number, e: React.PointerEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement;
      if (target.dataset.brandLogo === "true") return; // logo handles its own drag start
      const meta = pages[pageIndex];
      if (!meta) return;
      e.preventDefault();
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // See onLogoPointerDown — older Safari edge case, safe to ignore.
      }
      redactDragPointerIdRef.current = e.pointerId;
      const rect = e.currentTarget.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;
      setRedactDragStart({ page: pageIndex + 1, x, y });
      setRedactDragCurrent({ page: pageIndex + 1, x, y });
    },
    [pages],
  );

  const onPagePointerMove = useCallback(
    (pageIndex: number, e: React.PointerEvent<HTMLDivElement>) => {
      // Active logo drag wins over redaction drawing.
      if (logoDragRef.current && logoDragRef.current.pointerId === e.pointerId && logo) {
        const meta = pages[pageIndex];
        if (!meta) return;
        // preventDefault during an active drag stops the iOS WebView
        // from interpreting the finger move as a background pan/scroll.
        // touch-action: none on the page wrapper covers the gesture
        // start; this covers the duration.
        e.preventDefault();
        const pageRect = e.currentTarget.getBoundingClientRect();
        const xPx = e.clientX - pageRect.left - logoDragRef.current.pointerOffsetX;
        const yPx = e.clientY - pageRect.top - logoDragRef.current.pointerOffsetY;
        const clampedX = Math.max(0, Math.min(meta.widthPx - logo.widthPx, xPx));
        const clampedY = Math.max(0, Math.min(meta.heightPx - 8, yPx));
        setLogo({
          pageIndex,
          xNorm: clampedX / meta.widthPx,
          yNorm: clampedY / meta.heightPx,
          widthPx: logo.widthPx,
        });
        return;
      }
      if (
        redactDragPointerIdRef.current === e.pointerId &&
        redactDragStart &&
        redactDragStart.page === pageIndex + 1
      ) {
        e.preventDefault();
        const target = e.currentTarget.getBoundingClientRect();
        const x = Math.max(0, Math.min(1, (e.clientX - target.left) / target.width));
        const y = Math.max(0, Math.min(1, (e.clientY - target.top) / target.height));
        setRedactDragCurrent({ page: pageIndex + 1, x, y });
      }
    },
    [logo, pages, redactDragStart],
  );

  // End handler is wired to onPointerUp + onPointerCancel +
  // onLostPointerCapture on every element that owns a gesture, so the
  // drag always ends the frame the pointer leaves the capturing element
  // — no "stuck to finger" drift if the user lifts off-screen.
  const onPointerEnd = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      // Logo drag end.
      if (logoDragRef.current && logoDragRef.current.pointerId === e.pointerId) {
        try {
          e.currentTarget.releasePointerCapture(e.pointerId);
        } catch {
          // Already released (e.g. via lostpointercapture) — safe to ignore.
        }
        logoDragRef.current = null;
        return;
      }
      // Redaction draw end.
      if (redactDragPointerIdRef.current === e.pointerId) {
        try {
          e.currentTarget.releasePointerCapture(e.pointerId);
        } catch {
          // Same rationale as above.
        }
        redactDragPointerIdRef.current = -1;
        if (
          redactDragStart &&
          redactDragCurrent &&
          redactDragStart.page === redactDragCurrent.page
        ) {
          const x = Math.min(redactDragStart.x, redactDragCurrent.x);
          const y = Math.min(redactDragStart.y, redactDragCurrent.y);
          const w = Math.abs(redactDragCurrent.x - redactDragStart.x);
          const h = Math.abs(redactDragCurrent.y - redactDragStart.y);
          if (w > 0.005 && h > 0.005) {
            setRects((prev) => [...prev, { page: redactDragStart.page, x, y, w, h }]);
          }
        }
        setRedactDragStart(null);
        setRedactDragCurrent(null);
      }
    },
    [redactDragStart, redactDragCurrent],
  );

  function onUndoRect() {
    setRects((prev) => prev.slice(0, -1));
  }

  function onClearPage(page: number) {
    setRects((prev) => prev.filter((r) => r.page !== page));
  }

  async function onSave() {
    if (!logo && rects.length === 0) {
      toast.error("Place the logo or draw a redaction box first.");
      return;
    }
    if (pages.length === 0) {
      toast.error("PDF still loading.");
      return;
    }
    const placements: BrandPlacement[] = logo
      ? applyToAll
        ? pages.map((p) => ({
            pageIndex: p.pageNumber - 1,
            xNorm: logo.xNorm,
            yNorm: logo.yNorm,
            widthPx: logo.widthPx,
          }))
        : [
            {
              pageIndex: logo.pageIndex,
              xNorm: logo.xNorm,
              yNorm: logo.yNorm,
              widthPx: logo.widthPx,
            },
          ]
      : [];
    const redactions: RedactionRect[] = rects.map((r) => ({
      pageIndex: r.page - 1,
      xNorm: r.x,
      yNorm: r.y,
      wNorm: r.w,
      hNorm: r.h,
    }));
    const renderedPageWidthPx = pages[0].widthPx;
    setSaving(true);
    const toastId = toast.loading("Saving version…");
    try {
      const res = await brandCandidateResume({
        sourceResumeId,
        renderedPageWidthPx,
        placements,
        redactions,
      });
      if (!res.ok) {
        toast.error("Couldn't save version", {
          id: toastId,
          description: res.error,
        });
        return;
      }
      toast.success("Version saved", { id: toastId });
      router.refresh();
      onSaved(res.value.resumeId);
    } catch (e) {
      toast.error("Couldn't save version", {
        id: toastId,
        description: e instanceof Error ? e.message : "Unknown error.",
      });
    } finally {
      setSaving(false);
    }
  }

  const logoSrc = useMemo(
    () => `data:image/png;base64,${BRAND_LOGO_TRANSPARENT_BASE64}`,
    [],
  );

  const liveRect = redactDragStart && redactDragCurrent && redactDragStart.page === redactDragCurrent.page
    ? {
        page: redactDragStart.page,
        x: Math.min(redactDragStart.x, redactDragCurrent.x),
        y: Math.min(redactDragStart.y, redactDragCurrent.y),
        w: Math.abs(redactDragCurrent.x - redactDragStart.x),
        h: Math.abs(redactDragCurrent.y - redactDragStart.y),
      }
    : null;

  // Reference candidateId/baseResumeFilename so eslint doesn't flag
  // them as unused — kept on the prop type for API stability with
  // callers that pass them.
  void candidateId;
  void baseResumeFilename;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/70 p-4">
      <div className="flex h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-court-border bg-court-surface shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-court-border px-5 py-3">
          <div>
            <h2 className="font-serif text-lg font-semibold text-court-fg">Edit Resume</h2>
            <p className="text-xs text-court-fg-muted">
              Position the BreakPoint logo and draw redaction boxes. Saves a new version.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={onSave}
              disabled={saving || loadingDoc || (!logo && rects.length === 0)}
            >
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
              Save
            </Button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-md p-1 text-court-fg-muted hover:bg-court-surface-subtle"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-court-border bg-court-surface-subtle/40 px-5 py-2 text-xs">
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1 text-court-fg-muted">
              <Eraser className="h-3.5 w-3.5" />
              {rects.length === 0
                ? "No redactions yet."
                : `${rects.length} redaction${rects.length === 1 ? "" : "s"} pending.`}
            </span>
            <button
              type="button"
              onClick={onUndoRect}
              disabled={rects.length === 0 || saving}
              className="inline-flex items-center gap-1 rounded-md border border-court-border bg-court-surface px-2 py-1 font-medium text-court-fg-muted shadow-sm transition hover:text-court-fg disabled:opacity-50"
            >
              <Undo2 className="h-3 w-3" /> Undo last
            </button>
          </div>
          <div className="flex items-center gap-3">
            {logo ? (
              <>
                <label className="inline-flex items-center gap-1 text-court-fg-muted">
                  <Stamp className="h-3 w-3" />
                  <span className="uppercase tracking-wider">Size</span>
                  <input
                    type="range"
                    min={MIN_LOGO_WIDTH}
                    max={MAX_LOGO_WIDTH}
                    step={5}
                    value={logo.widthPx}
                    onChange={(e) => onSizeChange(Number(e.target.value))}
                    className="h-1 w-32 cursor-pointer accent-brand"
                    aria-label="Logo size"
                  />
                  <span className="w-10 text-right tabular-nums text-court-fg">
                    {logo.widthPx}px
                  </span>
                </label>
                {pages.length > 1 && (
                  <label className="inline-flex items-center gap-1 text-court-fg-muted">
                    <input
                      type="checkbox"
                      checked={applyToAll}
                      onChange={(e) => setApplyToAll(e.target.checked)}
                      className="h-3 w-3 cursor-pointer accent-brand"
                    />
                    <span>Apply to all pages</span>
                  </label>
                )}
                <button
                  type="button"
                  onClick={onRemoveLogo}
                  className="text-court-fg-muted underline hover:text-court-fg"
                >
                  Remove logo
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={onAddLogo}
                disabled={loadingDoc}
                className="inline-flex items-center gap-1 rounded-md border border-court-border bg-court-surface px-2 py-1 font-medium text-court-fg-muted shadow-sm transition hover:text-court-fg disabled:opacity-50"
              >
                <Stamp className="h-3 w-3" /> Add logo
              </button>
            )}
          </div>
        </div>

        <div
          ref={scrollPaneRef}
          className="flex-1 overflow-auto bg-court-surface-subtle/60 p-4"
        >
          {loadingDoc && (
            <div className="flex h-full items-center justify-center text-sm text-court-fg-muted">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading PDF…
            </div>
          )}
          {loadError && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              {loadError}
            </div>
          )}
          <div className="mx-auto flex max-w-3xl flex-col items-center gap-4">
            {pages.map((p) => {
              const pageIndex = p.pageNumber - 1;
              const showLogo = !!logo && (applyToAll || logo.pageIndex === pageIndex);
              const pageRects = rects.filter((r) => r.page === p.pageNumber);
              return (
                <div key={p.pageNumber} className="w-fit">
                  <div className="mb-1 flex items-center justify-between text-[11px] text-court-fg-muted">
                    <span>
                      Page {p.pageNumber} of {pages.length}
                      {showLogo && " · logo"}
                      {pageRects.length > 0 &&
                        ` · ${pageRects.length} redaction${pageRects.length === 1 ? "" : "s"}`}
                    </span>
                    {pageRects.length > 0 && (
                      <button
                        type="button"
                        onClick={() => onClearPage(p.pageNumber)}
                        className="text-[11px] underline hover:text-court-fg"
                      >
                        Clear page
                      </button>
                    )}
                  </div>
                  <div
                    className="relative cursor-crosshair select-none border border-court-border/40 bg-white shadow-sm"
                    // touch-action: none tells iOS Safari this element
                    // owns its touch gestures — without it a one-finger
                    // drag pans the nearest scrollable ancestor and the
                    // editor's redaction draw never starts.
                    style={{ width: p.widthPx, height: p.heightPx, touchAction: "none" }}
                    onPointerDown={(e) => onPagePointerDown(pageIndex, e)}
                    onPointerMove={(e) => onPagePointerMove(pageIndex, e)}
                    onPointerUp={onPointerEnd}
                    onPointerCancel={onPointerEnd}
                    onLostPointerCapture={onPointerEnd}
                  >
                    <canvas
                      ref={(el) => {
                        if (el) canvasRefs.current.set(p.pageNumber, el);
                        else canvasRefs.current.delete(p.pageNumber);
                      }}
                      className="pointer-events-none absolute inset-0"
                    />
                    {pageRects.map((r, idx) => (
                      <div
                        key={`r-${p.pageNumber}-${idx}`}
                        className="pointer-events-none absolute border border-ink/40 bg-white"
                        style={{
                          left: `${r.x * 100}%`,
                          top: `${r.y * 100}%`,
                          width: `${r.w * 100}%`,
                          height: `${r.h * 100}%`,
                        }}
                      />
                    ))}
                    {liveRect && liveRect.page === p.pageNumber && (
                      <div
                        className="pointer-events-none absolute border-2 border-dashed border-ink bg-white/60"
                        style={{
                          left: `${liveRect.x * 100}%`,
                          top: `${liveRect.y * 100}%`,
                          width: `${liveRect.w * 100}%`,
                          height: `${liveRect.h * 100}%`,
                        }}
                      />
                    )}
                    {showLogo && logo && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={logoSrc}
                        alt="BreakPoint logo (drag to reposition)"
                        data-brand-logo="true"
                        draggable={false}
                        onPointerDown={(e) => onLogoPointerDown(pageIndex, e)}
                        onPointerUp={onPointerEnd}
                        onPointerCancel={onPointerEnd}
                        onLostPointerCapture={onPointerEnd}
                        style={{
                          position: "absolute",
                          left: `${logo.xNorm * p.widthPx}px`,
                          top: `${logo.yNorm * p.heightPx}px`,
                          width: `${logo.widthPx}px`,
                          height: "auto",
                          cursor: "grab",
                          userSelect: "none",
                          // touch-action: none so the iOS WebView can't
                          // hijack a finger-drag on the logo for a pan.
                          touchAction: "none",
                          outline: "1px dashed rgba(15, 23, 42, 0.35)",
                          outlineOffset: "2px",
                        }}
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// pdfjs rejects a cancelled render with a RenderingCancelledException whose
// `.name` is "RenderingCancelledException". We match by name (the class
// isn't exported from our thin loader shim) so a deliberate cancel — the
// normal path when a fit-scale change or modal close re-runs/tears down the
// render effect — isn't surfaced to the user as a load error.
function isRenderingCancelled(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "name" in e &&
    (e as { name?: unknown }).name === "RenderingCancelledException"
  );
}
