"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Eraser, Loader2, Save, Undo2, X } from "lucide-react";
import { toast } from "sonner";
import { uploadFileInChunks } from "@/lib/chunked-upload";

// Redaction rectangle in page-space. x,y,w,h are in PDF points (bottom-left
// origin for PDF spec, but we use top-left in the editor and convert when
// saving). We keep them in top-left normalized 0..1 coordinates so the
// server-side pdf-lib code can scale to the actual PDF page dimensions.
type RedactionRect = {
  page: number; // 1-based
  // Normalized to the rendered page size (0..1)
  x: number;
  y: number;
  w: number;
  h: number;
};

type PageMeta = {
  pageNumber: number;
  widthPx: number;
  heightPx: number;
};

// Minimal type surface for pdfjs objects we touch. We import lazily inside the
// component so the pdfjs bundle is only pulled when the editor opens.
type PdfJsDocument = {
  numPages: number;
  getPage(n: number): Promise<PdfJsPage>;
};
type PdfJsPage = {
  getViewport(args: { scale: number }): { width: number; height: number };
  render(args: { canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number } }): { promise: Promise<void> };
};

// Fixed CSS scale at which we render the canvas. Device pixel ratio is applied
// inside renderPage so crisp on retina.
const RENDER_SCALE = 1.25;

export function ResumeRedactor({
  candidateRfId,
  originalUrl,
  originalFilename,
  onClose,
  onSaved,
}: {
  candidateRfId: number;
  originalUrl: string;
  originalFilename: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [loadingDoc, setLoadingDoc] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pages, setPages] = useState<PageMeta[]>([]);
  const [rects, setRects] = useState<RedactionRect[]>([]);
  const [dragStart, setDragStart] = useState<{ page: number; x: number; y: number } | null>(null);
  const [dragCurrent, setDragCurrent] = useState<{ page: number; x: number; y: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const canvasRefs = useRef<Map<number, HTMLCanvasElement>>(new Map());
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Load pdfjs and render all pages into <canvas> elements.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const pdfjsLib = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as {
          getDocument: (src: { url?: string; data?: ArrayBuffer }) => { promise: Promise<PdfJsDocument> };
          GlobalWorkerOptions: { workerSrc: string };
          version: string;
        };

        // Worker served from /public/pdfjs/ (self-hosted). The earlier
        // unpkg.com CDN URL was blocked by our CSP script-src, which is
        // why Edit Resume appeared to do nothing — the redactor was
        // failing silently when the worker failed to load.
        pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";

        const res = await fetch(originalUrl, { credentials: "include" });
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

        // Render after metas are committed so the <canvas> refs exist.
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
  }, [originalUrl]);

  const onMouseDown = useCallback((page: number, e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - target.left) / target.width;
    const y = (e.clientY - target.top) / target.height;
    setDragStart({ page, x, y });
    setDragCurrent({ page, x, y });
  }, []);

  const onMouseMove = useCallback(
    (page: number, e: React.MouseEvent<HTMLDivElement>) => {
      if (!dragStart || dragStart.page !== page) return;
      const target = e.currentTarget.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (e.clientX - target.left) / target.width));
      const y = Math.max(0, Math.min(1, (e.clientY - target.top) / target.height));
      setDragCurrent({ page, x, y });
    },
    [dragStart],
  );

  const onMouseUp = useCallback(() => {
    if (!dragStart || !dragCurrent || dragStart.page !== dragCurrent.page) {
      setDragStart(null);
      setDragCurrent(null);
      return;
    }
    const x = Math.min(dragStart.x, dragCurrent.x);
    const y = Math.min(dragStart.y, dragCurrent.y);
    const w = Math.abs(dragCurrent.x - dragStart.x);
    const h = Math.abs(dragCurrent.y - dragStart.y);
    if (w > 0.005 && h > 0.005) {
      setRects((prev) => [...prev, { page: dragStart.page, x, y, w, h }]);
    }
    setDragStart(null);
    setDragCurrent(null);
  }, [dragStart, dragCurrent]);

  function onUndo() {
    setRects((prev) => prev.slice(0, -1));
  }

  function onClearPage(page: number) {
    setRects((prev) => prev.filter((r) => r.page !== page));
  }

  async function onSave() {
    if (rects.length === 0) {
      toast.error("Draw at least one redaction first.");
      return;
    }
    setSaving(true);
    const toastId = toast.loading("Applying redactions…");
    try {
      const { PDFDocument, rgb } = await import("pdf-lib");

      const res = await fetch(originalUrl, { credentials: "include" });
      if (!res.ok) throw new Error(`Couldn't re-fetch original (${res.status}).`);
      const buf = await res.arrayBuffer();

      const pdfDoc = await PDFDocument.load(buf);
      const pdfPages = pdfDoc.getPages();

      for (const rect of rects) {
        const page = pdfPages[rect.page - 1];
        if (!page) continue;
        const { width, height } = page.getSize();
        const x = rect.x * width;
        // Rect y/h are in top-left space; pdf-lib uses bottom-left origin.
        const yTop = rect.y * height;
        const rectH = rect.h * height;
        const rectW = rect.w * width;
        page.drawRectangle({
          x,
          y: height - yTop - rectH,
          width: rectW,
          height: rectH,
          color: rgb(1, 1, 1),
          borderColor: rgb(1, 1, 1),
          borderWidth: 0,
        });
      }

      const bytes = await pdfDoc.save();
      // pdf.save returns a Uint8Array; wrap in a Blob+File so the chunked
      // upload helper can stream it through the same endpoint as the upload
      // + parse flow. Use a .pdf name derived from the original.
      const redactedName = originalFilename.replace(/\.pdf$/i, "") + "-redacted.pdf";
      // Copy into a fresh ArrayBuffer so the File constructor gets a non-shared
      // ArrayBuffer (avoids TS's SharedArrayBuffer vs ArrayBuffer complaint).
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      const file = new File([copy.buffer], redactedName, { type: "application/pdf" });

      await uploadFileInChunks(
        file,
        "/api/uploads/candidate-resume-redacted",
        { candidateRfId },
        {
          onProgress: (pct) => {
            toast.loading(`Saving redacted resume — ${pct}%`, { id: toastId });
          },
        },
      );

      toast.success("Redacted resume saved", { id: toastId });
      onSaved();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Save failed.";
      toast.error("Couldn't save redacted resume", { id: toastId, description: msg });
    } finally {
      setSaving(false);
    }
  }

  const liveRect = dragStart && dragCurrent && dragStart.page === dragCurrent.page
    ? {
        page: dragStart.page,
        x: Math.min(dragStart.x, dragCurrent.x),
        y: Math.min(dragStart.y, dragCurrent.y),
        w: Math.abs(dragCurrent.x - dragStart.x),
        h: Math.abs(dragCurrent.y - dragStart.y),
      }
    : null;

  const totalPerPage = useMemo(() => {
    const map = new Map<number, number>();
    for (const r of rects) map.set(r.page, (map.get(r.page) ?? 0) + 1);
    return map;
  }, [rects]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy/70 p-4" onMouseUp={onMouseUp}>
      <div className="flex h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-border bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div>
            <h2 className="font-serif text-lg font-semibold text-navy">Edit Resume — Redaction</h2>
            <p className="text-xs text-muted-foreground">
              Drag to draw a white rectangle over any section (phone, email, etc.). Original stays untouched.
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-2 text-xs">
          <div className="flex items-center gap-2">
            <Eraser className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-muted-foreground">
              {rects.length === 0
                ? "No redactions yet."
                : `${rects.length} redaction${rects.length === 1 ? "" : "s"} pending.`}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onUndo}
              disabled={rects.length === 0 || saving}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-white px-2 py-1 text-xs font-medium text-navy-400 shadow-sm transition hover:text-navy disabled:opacity-50"
            >
              <Undo2 className="h-3 w-3" /> Undo last
            </button>
            <button
              type="button"
              onClick={onSave}
              disabled={saving || rects.length === 0}
              className="inline-flex items-center gap-1 rounded-md bg-brand px-3 py-1 text-xs font-semibold text-white shadow-sm transition hover:bg-brand-dark disabled:opacity-60"
            >
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
              Save Redacted Copy
            </button>
          </div>
        </div>

        <div ref={containerRef} className="flex-1 overflow-auto bg-muted/30 p-4">
          {loadingDoc && (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading PDF…
            </div>
          )}
          {loadError && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{loadError}</div>
          )}
          {!loadingDoc && !loadError && pages.length === 0 && (
            <div className="text-sm text-muted-foreground">No pages rendered.</div>
          )}
          <div className="mx-auto flex max-w-3xl flex-col items-center gap-4">
            {pages.map((p) => {
              const pageRects = rects.filter((r) => r.page === p.pageNumber);
              return (
                <div key={p.pageNumber} className="w-fit">
                  <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>
                      Page {p.pageNumber} of {pages.length}
                      {(totalPerPage.get(p.pageNumber) ?? 0) > 0 &&
                        ` · ${totalPerPage.get(p.pageNumber)} redaction${totalPerPage.get(p.pageNumber) === 1 ? "" : "s"}`}
                    </span>
                    {(totalPerPage.get(p.pageNumber) ?? 0) > 0 && (
                      <button
                        type="button"
                        onClick={() => onClearPage(p.pageNumber)}
                        className="text-[11px] text-muted-foreground underline hover:text-navy"
                      >
                        Clear page
                      </button>
                    )}
                  </div>
                  <div
                    className="relative cursor-crosshair select-none border border-border bg-white shadow-sm"
                    style={{ width: p.widthPx, height: p.heightPx }}
                    onMouseDown={(e) => onMouseDown(p.pageNumber, e)}
                    onMouseMove={(e) => onMouseMove(p.pageNumber, e)}
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
                        className="pointer-events-none absolute border border-navy/40 bg-white"
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
                        className="pointer-events-none absolute border-2 border-dashed border-navy bg-white/60"
                        style={{
                          left: `${liveRect.x * 100}%`,
                          top: `${liveRect.y * 100}%`,
                          width: `${liveRect.w * 100}%`,
                          height: `${liveRect.h * 100}%`,
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
