"use client";

// Single cached loader for pdfjs-dist across every viewer in the app
// (pdf-canvas-viewer, resume-redactor, anything future). Centralized so
// library + worker versions stay locked in sync and the top-level module
// code evaluates once per page load instead of on every component mount.
//
// Why this file exists: the legacy build (legacy/build/pdf.mjs) ships a
// webpack-bundled core-js polyfill that at module-evaluation time calls
//   Object.defineProperty(createElement('div'), 'a', { get: () => 7 })
// inside a feature-detect helper. Under certain Next.js dev / HMR
// re-evaluation contexts that expression resolves to something whose
// first argument is not a real object, and the browser throws
//   "Object.defineProperty called on non-object"
// which the viewer then surfaces to the recruiter as
//   "Couldn't render this PDF in the browser: Object.defineProperty
//    called on non-object."
// The non-legacy build (build/pdf.mjs) omits the core-js polyfills — we
// only support modern browsers anyway, so the smaller bundle and the
// clean initialization path are both wins.
//
// The worker in /public/pdfjs/pdf.worker.min.mjs is copied from the
// matching non-legacy node_modules location; lib and worker MUST match
// version exactly or getDocument() init explodes in subtler ways.

type PdfJsDocument = {
  numPages: number;
  getPage(n: number): Promise<PdfJsPage>;
};
// Page viewport produced by getViewport(). Width/height are pixel
// dimensions at the requested scale; the full v5 viewport carries
// more (transform matrix, rotation) — typed loose since the text
// layer is the only consumer that touches the rest.
type PdfJsPageViewport = {
  width: number;
  height: number;
};
type PdfJsTextContent = unknown;
type PdfJsPage = {
  getViewport(args: { scale: number }): PdfJsPageViewport;
  render(args: {
    canvasContext: CanvasRenderingContext2D;
    viewport: PdfJsPageViewport;
  }): { promise: Promise<void> };
  // v5 text content stream consumed by TextLayer. Typed as unknown so
  // we don't have to import pdfjs's internal TextContent shape — the
  // text layer constructor accepts the raw value verbatim.
  getTextContent(): Promise<PdfJsTextContent>;
};
// v5 in-DOM text layer. Mounts positioned spans into `container` that
// mirror the rendered canvas at the same viewport — used here to
// overlay keyword highlights on top of canvas-rasterized resume PDFs.
type PdfJsTextLayerInstance = {
  render(): Promise<void>;
  cancel(): void;
  textDivs: HTMLElement[];
};
type PdfJsTextLayerCtor = new (params: {
  textContentSource: PdfJsTextContent;
  container: HTMLElement;
  viewport: PdfJsPageViewport;
}) => PdfJsTextLayerInstance;

type PdfJsLib = {
  getDocument: (src: {
    url?: string;
    data?: ArrayBuffer;
    withCredentials?: boolean;
  }) => { promise: Promise<PdfJsDocument> };
  GlobalWorkerOptions: { workerSrc: string };
  version: string;
  TextLayer: PdfJsTextLayerCtor;
};

let cachedLib: Promise<PdfJsLib> | null = null;

async function importAndConfigure(): Promise<PdfJsLib> {
  const lib = (await import("pdfjs-dist/build/pdf.mjs")) as unknown as PdfJsLib;
  // Set workerSrc to our self-hosted, same-origin worker. CSP script-src
  // covers 'self', so the browser is allowed to spawn the worker.
  lib.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
  return lib;
}

// Loads pdfjs, caches the resolved module across callers, and fails
// gracefully: on first-attempt rejection the cache is cleared so the
// next caller gets a fresh import instead of replaying a stuck
// rejection. Optional retryOnFirstFailure retries one more time after
// a brief delay, which papers over transient network blips when the
// worker file is being fetched for the first time on a cold dev server.
export async function loadPdfjs({
  retryOnFirstFailure = true,
}: { retryOnFirstFailure?: boolean } = {}): Promise<PdfJsLib> {
  if (!cachedLib) cachedLib = importAndConfigure();
  try {
    return await cachedLib;
  } catch (err) {
    cachedLib = null;
    if (!retryOnFirstFailure) throw err;
    // Short backoff before the retry — enough for a flaky worker fetch
    // to stabilize without noticeably slowing a real reload.
    await new Promise((resolve) => setTimeout(resolve, 500));
    try {
      cachedLib = importAndConfigure();
      return await cachedLib;
    } catch (retryErr) {
      cachedLib = null;
      throw retryErr;
    }
  }
}

export type {
  PdfJsDocument,
  PdfJsLib,
  PdfJsPage,
  PdfJsPageViewport,
  PdfJsTextLayerInstance,
};
