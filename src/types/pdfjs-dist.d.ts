// The non-legacy build of pdfjs-dist (build/pdf.mjs) ships without .d.mts
// typings — only legacy/build/pdf.mjs has them. We import the non-legacy
// entry from src/lib/pdfjs-loader.ts because the legacy bundle's embedded
// core-js polyfills trigger "Object.defineProperty called on non-object"
// during Next.js dev re-evaluation (see pdfjs-loader.ts for the full
// reasoning). The `any` type is fine — pdfjs-loader.ts casts to an
// explicit PdfJsLib shape before exposing anything to callers.
declare module "pdfjs-dist/build/pdf.mjs";
