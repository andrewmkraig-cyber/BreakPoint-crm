// Pure-JS DOMMatrix polyfill for server-side pdfjs text extraction.
//
// WHY THIS EXISTS
// pdfjs-dist's legacy Node build (the one we use for headless PDF text
// extraction in editResumeWithClaude and the resume redactor) evaluates a
// MODULE-TOP-LEVEL `const SCALE_MATRIX = new DOMMatrix();`. Node has no
// DOMMatrix global. pdfjs's only fallback is the OPTIONAL native dependency
// `@napi-rs/canvas`, which it require()s at import time purely to copy
// `canvas.DOMMatrix` onto globalThis.
//
// On Vercel that native package never loads: Next.js output file tracing does
// not ship @napi-rs/canvas's platform-specific `.node` binary into the
// serverless lambda, so `require("@napi-rs/canvas")` throws there, pdfjs only
// warns ("Cannot polyfill DOMMatrix"), and the very next line
// (`new DOMMatrix()`) throws "DOMMatrix is not defined" — failing the import
// before a single page is read. The bug NEVER reproduced locally because the
// darwin binary loads fine on a Mac, so DOMMatrix was always defined in dev.
//
// THE FIX
// Install our own DOMMatrix on globalThis BEFORE pdfjs is imported. pdfjs
// guards with `if (!globalThis.DOMMatrix)`, so ours wins and pdfjs never needs
// the native package. We only EXTRACT TEXT (never render to a canvas), and
// text geometry comes back to us as plain `item.transform` arrays that pdfjs
// computes with its own pure-JS matrix math, so a correct 2D affine DOMMatrix
// is all that is ever exercised. ImageData / Path2D are stubbed too so pdfjs
// stops warning and stays fully decoupled from canvas. This is environment-
// independent: no native binary, no file-tracing, works identically in dev,
// `next start`, and the Vercel lambda.
//
// Call ensurePdfNodeGlobals() immediately before any
// `import("pdfjs-dist/legacy/build/pdf.mjs")`.

// A complete-enough 2D affine matrix. pdfjs's text path constructs identity
// and array matrices and calls translate / scale / rotate / multiply; all are
// implemented exactly per the DOMMatrix spec for the 2D case.
class DOMMatrixPolyfill {
  a = 1;
  b = 0;
  c = 0;
  d = 1;
  e = 0;
  f = 0;
  is2D = true;

  constructor(init?: number[] | string | DOMMatrixPolyfill) {
    if (init == null) return;
    if (typeof init === "string") {
      // pdfjs does not pass CSS transform strings into the Node text path;
      // accept the form defensively and leave identity if unparseable.
      const nums = init.match(/-?\d*\.?\d+(e-?\d+)?/gi)?.map(Number) ?? [];
      if (nums.length === 6) [this.a, this.b, this.c, this.d, this.e, this.f] = nums;
      return;
    }
    if (Array.isArray(init)) {
      if (init.length === 6) {
        [this.a, this.b, this.c, this.d, this.e, this.f] = init;
      } else if (init.length === 16) {
        // 4x4 column-major; pull the 2D components.
        this.a = init[0];
        this.b = init[1];
        this.c = init[4];
        this.d = init[5];
        this.e = init[12];
        this.f = init[13];
      }
      return;
    }
    // Copy-construct from another matrix-like.
    const m = init as DOMMatrixPolyfill;
    this.a = m.a;
    this.b = m.b;
    this.c = m.c;
    this.d = m.d;
    this.e = m.e;
    this.f = m.f;
  }

  // 4x4-named aliases pdfjs occasionally reads.
  get m11() {
    return this.a;
  }
  get m12() {
    return this.b;
  }
  get m21() {
    return this.c;
  }
  get m22() {
    return this.d;
  }
  get m41() {
    return this.e;
  }
  get m42() {
    return this.f;
  }

  get isIdentity() {
    return (
      this.a === 1 &&
      this.b === 0 &&
      this.c === 0 &&
      this.d === 1 &&
      this.e === 0 &&
      this.f === 0
    );
  }

  // this * other (other applied first), non-mutating per spec.
  multiply(other: DOMMatrixPolyfill): DOMMatrixPolyfill {
    const r = new DOMMatrixPolyfill();
    r.a = this.a * other.a + this.c * other.b;
    r.b = this.b * other.a + this.d * other.b;
    r.c = this.a * other.c + this.c * other.d;
    r.d = this.b * other.c + this.d * other.d;
    r.e = this.a * other.e + this.c * other.f + this.e;
    r.f = this.b * other.e + this.d * other.f + this.f;
    return r;
  }

  translate(tx = 0, ty = 0): DOMMatrixPolyfill {
    const m = new DOMMatrixPolyfill();
    m.e = tx;
    m.f = ty;
    return this.multiply(m);
  }

  scale(sx = 1, sy?: number): DOMMatrixPolyfill {
    const m = new DOMMatrixPolyfill();
    m.a = sx;
    m.d = sy ?? sx;
    return this.multiply(m);
  }

  rotate(deg = 0): DOMMatrixPolyfill {
    const rad = (deg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const m = new DOMMatrixPolyfill();
    m.a = cos;
    m.b = sin;
    m.c = -sin;
    m.d = cos;
    return this.multiply(m);
  }

  // Mutating variants (spec); pdfjs's text path does not call these, but they
  // are cheap to provide correctly.
  multiplySelf(other: DOMMatrixPolyfill): DOMMatrixPolyfill {
    return Object.assign(this, this.multiply(other));
  }
  translateSelf(tx = 0, ty = 0): DOMMatrixPolyfill {
    return Object.assign(this, this.translate(tx, ty));
  }
  scaleSelf(sx = 1, sy?: number): DOMMatrixPolyfill {
    return Object.assign(this, this.scale(sx, sy));
  }

  transformPoint(p?: { x?: number; y?: number }) {
    const x = p?.x ?? 0;
    const y = p?.y ?? 0;
    return {
      x: this.a * x + this.c * y + this.e,
      y: this.b * x + this.d * y + this.f,
      z: 0,
      w: 1,
    };
  }

  toString() {
    return `matrix(${this.a}, ${this.b}, ${this.c}, ${this.d}, ${this.e}, ${this.f})`;
  }
}

let installed = false;

/**
 * Installs DOMMatrix (and harmless ImageData / Path2D stubs) on globalThis if
 * absent. Idempotent. MUST run before pdfjs-dist's legacy Node build is
 * imported, so the build's module-level `new DOMMatrix()` resolves to our
 * polyfill instead of throwing or needing @napi-rs/canvas.
 */
export function ensurePdfNodeGlobals(): void {
  if (installed) return;
  installed = true;
  const g = globalThis as Record<string, unknown>;
  if (typeof g.DOMMatrix === "undefined") {
    g.DOMMatrix = DOMMatrixPolyfill;
  }
  if (typeof g.ImageData === "undefined") {
    // pdfjs only constructs ImageData inside canvas rendering, which the text
    // path never reaches; a minimal shape keeps the module from warning.
    g.ImageData = class ImageDataPolyfill {
      data: Uint8ClampedArray;
      width: number;
      height: number;
      constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
        this.data = new Uint8ClampedArray(Math.max(0, width * height * 4));
      }
    };
  }
  if (typeof g.Path2D === "undefined") {
    g.Path2D = class Path2DPolyfill {};
  }
}
