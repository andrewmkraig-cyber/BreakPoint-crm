// Worker-scope shim for pdfjs-dist 5.6.
//
// pdfjs calls Map.prototype.getOrInsertComputed natively, but Safari
// (incl. iOS) hasn't shipped that TC39 method yet, so the worker crashed
// with "getOrInsertComputed is not a function" on Safari. The worker runs
// in its own global scope, so the main-thread polyfill (pdfjs-loader.ts)
// doesn't reach it — install it here, then load the real worker.
//
// pdfjs spawns this with { type: "module" }, so top-level await + dynamic
// import work and run AFTER the polyfill below is in place.
if (typeof Map.prototype.getOrInsertComputed !== "function") {
  Object.defineProperty(Map.prototype, "getOrInsertComputed", {
    value(key, callbackfn) {
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

await import("./pdf.worker.min.mjs");
