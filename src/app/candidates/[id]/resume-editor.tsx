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
import { loadPdfjs } from "@/lib/pdfjs-loader";

// Phase 5A.5.b — Edit Resume modal. The unified editor lets the
// recruiter both place the BreakPoint logo AND draw redaction
// rectangles on the same canvas, then saves the combined output as a
// new CandidateResume row in one call. Replaces the earlier
// two-tab Brand/Redact split.
//
// Render scale chosen to match the previous standalone editors so
// existing muscle memory carries over.

const RENDER_SCALE = 1.25;
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
  // Logo drag uses a ref instead of state so a fast mouse doesn't
  // lose deltas to async setState batching.
  const logoDragRef = useRef<{ pointerOffsetX: number; pointerOffsetY: number } | null>(null);

  // Load + render the base PDF.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const pdfjsLib = await loadPdfjs();
        const res = await fetch(baseResumeUrl, { credentials: "include" });
        if (!res.ok) throw new Error(`Couldn't load resume (${res.status}).`);
        const buf = await res.arrayBuffer();
        const doc = await pdfjsLib.getDocument({ data: buf }).promise;
        const metas: PageMeta[] = [];
        for (let i = 1; i <= doc.numPages; i++) {
          const page = await doc.getPage(i);
          const viewport = page.getViewport({ scale: RENDER_SCALE });
          metas.push({ pageNumber: i, widthPx: viewport.width, heightPx: viewport.height });
        }
        if (cancelled) return;
        setPages(metas);
        setLoadingDoc(false);
        // Default placement: center of page 1, default size.
        if (metas.length > 0) {
          const first = metas[0];
          setLogo({
            pageIndex: 0,
            xNorm: 0.5 - DEFAULT_LOGO_WIDTH / 2 / first.widthPx,
            yNorm: 0.5,
            widthPx: DEFAULT_LOGO_WIDTH,
          });
        }
        requestAnimationFrame(async () => {
          for (let i = 1; i <= doc.numPages; i++) {
            if (cancelled) return;
            const canvas = canvasRefs.current.get(i);
            if (!canvas) continue;
            const page = await doc.getPage(i);
            const viewport = page.getViewport({ scale: RENDER_SCALE });
            const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
            canvas.width = Math.floor(viewport.width * dpr);
            canvas.height = Math.floor(viewport.height * dpr);
            canvas.style.width = `${viewport.width}px`;
            canvas.style.height = `${viewport.height}px`;
            const ctx = canvas.getContext("2d");
            if (!ctx) continue;
            ctx.scale(dpr, dpr);
            await page.render({ canvasContext: ctx, viewport }).promise;
          }
        });
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

  // Logo handlers
  const onLogoMouseDown = useCallback(
    (pageIndex: number, e: React.MouseEvent<HTMLImageElement>) => {
      if (!logo) return;
      e.preventDefault();
      e.stopPropagation();
      const img = e.currentTarget.getBoundingClientRect();
      logoDragRef.current = {
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
  // by checking whether the mousedown target is the logo overlay.
  const onPageMouseDown = useCallback(
    (pageIndex: number, e: React.MouseEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement;
      if (target.dataset.brandLogo === "true") return; // logo handles its own drag start
      const meta = pages[pageIndex];
      if (!meta) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;
      setRedactDragStart({ page: pageIndex + 1, x, y });
      setRedactDragCurrent({ page: pageIndex + 1, x, y });
    },
    [pages],
  );

  const onPageMouseMove = useCallback(
    (pageIndex: number, e: React.MouseEvent<HTMLDivElement>) => {
      // Active logo drag wins over redaction drawing.
      if (logoDragRef.current && logo) {
        const meta = pages[pageIndex];
        if (!meta) return;
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
      if (redactDragStart && redactDragStart.page === pageIndex + 1) {
        const target = e.currentTarget.getBoundingClientRect();
        const x = Math.max(0, Math.min(1, (e.clientX - target.left) / target.width));
        const y = Math.max(0, Math.min(1, (e.clientY - target.top) / target.height));
        setRedactDragCurrent({ page: pageIndex + 1, x, y });
      }
    },
    [logo, pages, redactDragStart],
  );

  const onMouseUp = useCallback(() => {
    if (logoDragRef.current) {
      logoDragRef.current = null;
      return;
    }
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
  }, [redactDragStart, redactDragCurrent]);

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
            <button
              type="button"
              onClick={onSave}
              disabled={saving || loadingDoc || (!logo && rects.length === 0)}
              className="inline-flex items-center gap-1 rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-brand-dark disabled:opacity-60"
            >
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
              Save version
            </button>
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
          className="flex-1 overflow-auto bg-court-surface-subtle/60 p-4"
          onMouseUp={onMouseUp}
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
                    style={{ width: p.widthPx, height: p.heightPx }}
                    onMouseDown={(e) => onPageMouseDown(pageIndex, e)}
                    onMouseMove={(e) => onPageMouseMove(pageIndex, e)}
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
                        onMouseDown={(e) => onLogoMouseDown(pageIndex, e)}
                        style={{
                          position: "absolute",
                          left: `${logo.xNorm * p.widthPx}px`,
                          top: `${logo.yNorm * p.heightPx}px`,
                          width: `${logo.widthPx}px`,
                          height: "auto",
                          cursor: "grab",
                          userSelect: "none",
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
