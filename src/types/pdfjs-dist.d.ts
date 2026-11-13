// The browser viewer no longer imports pdfjs-dist through webpack: it
// loads /pdfjs/pdf.min.mjs natively (see src/lib/pdfjs-loader.ts). This
// declaration stays so any remaining type-only reference compiles.
declare module "pdfjs-dist/build/pdf.mjs";

// The legacy worker bundle has no typings. We import it purely for its side
// effect (it sets globalThis.pdfjsWorker so pdfjs runs its message handler on
// the main thread in Node, avoiding a dynamic import of an untraced worker
// file in the Vercel lambda — see generate-resume-action.ts / redact-pdf.ts).
declare module "pdfjs-dist/legacy/build/pdf.worker.mjs";
