// The non-legacy build of pdfjs-dist (build/pdf.mjs) ships without .d.mts
// typings — only legacy/build/pdf.mjs has them. We import the non-legacy
// entry from src/lib/pdfjs-loader.ts because the legacy bundle's embedded
// core-js polyfills trigger "Object.defineProperty called on non-object"
// during Next.js dev re-evaluation (see pdfjs-loader.ts for the full
// reasoning). The `any` type is fine — pdfjs-loader.ts casts to an
// explicit PdfJsLib shape before exposing anything to callers.
declare module "pdfjs-dist/build/pdf.mjs";

// The legacy worker bundle has no typings. We import it purely for its side
// effect (it sets globalThis.pdfjsWorker so pdfjs runs its message handler on
// the main thread in Node, avoiding a dynamic import of an untraced worker
// file in the Vercel lambda — see generate-resume-action.ts / redact-pdf.ts).
declare module "pdfjs-dist/legacy/build/pdf.worker.mjs";
