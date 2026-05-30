"use client";

// Single cached loader for pdfjs-dist across every viewer in the app
// (pdf-canvas-viewer, resume-redactor, anything future). Centralized so
// library + worker versions stay locked in sync and the top-level module
// code evaluates once per page load instead of on every component mount.
//
// Build selection (see importAndConfigure): pdfjs-dist 5.6 calls
// bleeding-edge JS natively, so the modern build (build/pdf.mjs) crashes
// on iOS Safari — first "getOrInsertComputed is not a function", then
// other missing ES2024/2025 APIs. The legacy build (legacy/build/pdf.mjs)
// is babel-transpiled + core-js-polyfilled for older browsers, so it runs
// on those phones. We use legacy in production and the modern build in dev
// (legacy ships a core-js polyfill that calls
//   Object.defineProperty(createElement('div'), 'a', { get: () => 7 })
// at module-eval, which can throw "Object.defineProperty called on
// non-object" under Next.js dev/HMR re-evaluation — but that DOM
// feature-detect doesn't run in production, nor in a worker scope).
//
// The worker in /public/pdfjs/pdf.worker.min.mjs is the LEGACY worker
// copied from node_modules/pdfjs-dist/legacy/build/. It self-polyfills,
// is safe in worker scope (no DOM), and is the same 5.6.205 version as
// either lib build — lib and worker MUST match version exactly or
// getDocument() init explodes in subtler ways. Re-copy it from the
// legacy build location whenever pdfjs-dist is upgraded.

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
type PdfJsRenderTask = { promise: Promise<void>; cancel(): void };
type PdfJsPage = {
  getViewport(args: { scale: number }): PdfJsViewport;
  getTextContent(): Promise<PdfJsTextContent>;
  // The underlying pdfjs RenderTask exposes cancel() alongside promise;
  // we surface it so callers can abort an in-flight render before starting
  // a new one on the same (reused) canvas — see ResumeEditor's render loop,
  // which otherwise hit "Cannot use the same canvas during multiple
  // render() operations" and a transform-corrupted (flipped) page.
  render(args: {
    canvasContext: CanvasRenderingContext2D;
    viewport: PdfJsViewport;
  }): PdfJsRenderTask;
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

// Belt-and-suspenders main-thread polyfill for the dev path: in
// production the legacy pdfjs build polyfills Map.prototype.
// getOrInsertComputed itself, but in dev we load the modern build, so
// this guards the rare case of a dev browser without that very-new TC39
// method. No-ops when the method already exists. The worker scope is
// covered by the legacy worker's own bundled polyfills.
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
  // pdfjs-dist 5.6 targets very recent browsers and calls ES2024/2025
  // APIs natively (Map.prototype.getOrInsertComputed, Iterator helpers,
  // ...) that iOS Safari hasn't shipped — the modern build crashed there
  // with "getOrInsertComputed is not a function", then "undefined is not
  // a function" once that was patched. The legacy build is babel-
  // transpiled + core-js-polyfilled for exactly these older browsers, so
  // use it in production (where real phones live). In dev we keep the
  // modern build: smaller, the dev browser is current, and the legacy
  // build's core-js DOM feature-detect can throw under Next HMR
  // re-evaluation (the original reason this app moved off legacy).
  const lib = (
    process.env.NODE_ENV === "production"
      ? await import("pdfjs-dist/legacy/build/pdf.mjs")
      : await import("pdfjs-dist/build/pdf.mjs")
  ) as unknown as PdfJsLib;
  // Self-hosted worker is the LEGACY worker — it bundles the same
  // polyfills (safe in worker scope, which has no DOM) and is the same
  // 5.6.205 version as either lib build, so the worker version check
  // passes in both dev and prod. CSP script-src covers 'self'.
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

export type { PdfJsDocument, PdfJsLib, PdfJsPage, PdfJsRenderTask, PdfJsTextContent, PdfJsTextItem, PdfJsViewport };
