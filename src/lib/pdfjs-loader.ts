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
type PdfJsViewport = {
  width: number;
  height: number;
  scale: number;
  transform: number[];
};
// Subset of pdfjs's TextItem shape. getTextContent.items also returns
// TextMarkedContent objects (no `str` field) — callers filter on `str in
// item` before reading these fields.
type PdfJsTextItem = {
  str: string;
  dir: "ltr" | "rtl";
  width: number;
  height: number;
  transform: number[];
  fontName: string;
  hasEOL?: boolean;
};
type PdfJsTextContent = {
  items: Array<PdfJsTextItem | { type: string }>;
};
type PdfJsPage = {
  getViewport(args: { scale: number }): PdfJsViewport;
  getTextContent(): Promise<PdfJsTextContent>;
  render(args: {
    canvasContext: CanvasRenderingContext2D;
    viewport: PdfJsViewport;
  }): { promise: Promise<void> };
};
type PdfJsLib = {
  getDocument: (src: {
    url?: string;
    data?: ArrayBuffer;
    withCredentials?: boolean;
  }) => { promise: Promise<PdfJsDocument> };
  GlobalWorkerOptions: { workerSrc: string };
  // Matrix composition used by the text-overlay math: combines
  // viewport.transform with item.transform to get on-screen baseline
  // coordinates.
  Util: { transform(m1: number[], m2: number[]): number[] };
  version: string;
};

let cachedLib: Promise<PdfJsLib> | null = null;

// pdfjs-dist 5.6 calls Map.prototype.getOrInsertComputed natively (no
// polyfill of its own). That method is a very recent TC39 proposal that
// desktop Chrome ships but Safari — including iOS Safari — does not yet,
// so PDF rendering blew up there with "getOrInsertComputed is not a
// function" while working fine on desktop. Install a tiny spec-shaped
// polyfill on the main thread before pdfjs runs. The worker thread has
// its own global scope and is patched separately by pdf.worker.shim.mjs.
function installMapGetOrInsertPolyfill(): void {
  if (typeof Map === "undefined") return;
  const proto = Map.prototype as unknown as {
    getOrInsertComputed?: (key: unknown, cb: (key: unknown) => unknown) => unknown;
  };
  if (typeof proto.getOrInsertComputed === "function") return;
  Object.defineProperty(Map.prototype, "getOrInsertComputed", {
    value(this: Map<unknown, unknown>, key: unknown, callbackfn: (key: unknown) => unknown) {
      if (this.has(key)) return this.get(key);
      const value = callbackfn(key);
      this.set(key, value);
      return value;
    },
    writable: true,
    configurable: true,
    enumerable: false,
  });
}

async function importAndConfigure(): Promise<PdfJsLib> {
  installMapGetOrInsertPolyfill();
  const lib = (await import("pdfjs-dist/build/pdf.mjs")) as unknown as PdfJsLib;
  // Point at the shim worker, which installs the same Map polyfill in the
  // worker scope and then loads the real self-hosted worker. CSP
  // script-src covers 'self', so the browser is allowed to spawn it.
  lib.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.shim.mjs";
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

export type { PdfJsDocument, PdfJsLib, PdfJsPage, PdfJsTextContent, PdfJsTextItem, PdfJsViewport };
