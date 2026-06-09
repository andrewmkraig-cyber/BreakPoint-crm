// Generates three 40x40 PNG icons (green circle background, white glyph
// for envelope / phone / globe) used in the email signature. Outputs:
//   public/brand/icon-email.png
//   public/brand/icon-phone.png
//   public/brand/icon-globe.png
// And a TS module at src/lib/signature-icons.ts that exports each
// icon's base64 string (compiled into the bundle so the signature
// renderer never reads from disk on Vercel — same pattern as the
// signature logo at src/lib/default-brand-logo.ts).
//
// Display size in the signature HTML is 20×20 CSS px (see
// renderSignatureHtml in src/lib/signature.ts). Rendering the source
// PNG at 2× (40×40) gives retina/high-DPI clients enough resolution
// to draw a crisp curved phone handset — the earlier 20×20 source
// could only fit a chunky dumbbell silhouette that, at the small
// display size, didn't read as a phone. Email clients downscale the
// 40×40 PNG to 20×20 CSS px, so the visual size is unchanged.
//
// Run:
//   node scripts/generate-signature-icons.js

const fs = require("node:fs");
const path = require("node:path");
const { PNG } = require("pngjs");

const SIZE = 40;
const GREEN = [0x5a, 0x96, 0x42];
const WHITE = [255, 255, 255];

function newImg() {
  const png = new PNG({ width: SIZE, height: SIZE, colorType: 6 });
  png.data.fill(0);
  return png;
}

function blendPx(png, x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
  if (a <= 0) return;
  const idx = (y * SIZE + x) * 4;
  const dr = png.data[idx];
  const dg = png.data[idx + 1];
  const db = png.data[idx + 2];
  const da = png.data[idx + 3];
  // Source-over alpha compositing. Without this, drawing a white
  // glyph on top of an anti-aliased green rim would overwrite the
  // green's edge alpha and reintroduce jaggies along the circle
  // border where the glyph crosses it.
  const sa = a / 255;
  const dap = da / 255;
  const outA = sa + dap * (1 - sa);
  if (outA <= 0) return;
  png.data[idx] = Math.round((r * sa + dr * dap * (1 - sa)) / outA);
  png.data[idx + 1] = Math.round((g * sa + dg * dap * (1 - sa)) / outA);
  png.data[idx + 2] = Math.round((b * sa + db * dap * (1 - sa)) / outA);
  png.data[idx + 3] = Math.round(outA * 255);
}

// Filled disk with a 1-pixel anti-aliased rim. Used for both the
// green base and every white glyph primitive (bulbs, line joints).
function fillCircle(png, cx, cy, r, color) {
  const x0 = Math.max(0, Math.floor(cx - r - 1));
  const x1 = Math.min(SIZE - 1, Math.ceil(cx + r + 1));
  const y0 = Math.max(0, Math.floor(cy - r - 1));
  const y1 = Math.min(SIZE - 1, Math.ceil(cy + r + 1));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx + 0.5;
      const dy = y - cy + 0.5;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d <= r - 0.5) {
        blendPx(png, x, y, color[0], color[1], color[2], 255);
      } else if (d <= r + 0.5) {
        const a = Math.round(255 * (1 - (d - (r - 0.5))));
        blendPx(png, x, y, color[0], color[1], color[2], Math.max(0, Math.min(255, a)));
      }
    }
  }
}

// Stroke a straight line by stamping a filled circle at each step. A
// half-pixel step keeps the stroke continuous and anti-aliased; the
// `thickness` arg is the line's full width (so each stamp's radius
// is thickness/2).
function strokeLine(png, x0, y0, x1, y1, thickness, color) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.sqrt(dx * dx + dy * dy);
  const steps = Math.max(1, Math.ceil(len * 2));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    fillCircle(png, x0 + dx * t, y0 + dy * t, thickness / 2, color);
  }
}

// Filled rounded rectangle. (x, y) is the top-left corner; (w, h) is
// the size; r is the corner radius. A pixel's coverage is computed
// from its distance to the inner rect [x+r, x+w-r] × [y+r, y+h-r]:
// d ≤ r is inside, anti-aliased over a 1-px band at the boundary.
function fillRoundedRect(png, x, y, w, h, r, color) {
  const x0 = Math.max(0, Math.floor(x - 1));
  const x1 = Math.min(SIZE - 1, Math.ceil(x + w + 1));
  const y0 = Math.max(0, Math.floor(y - 1));
  const y1 = Math.min(SIZE - 1, Math.ceil(y + h + 1));
  for (let py = y0; py <= y1; py++) {
    for (let px = x0; px <= x1; px++) {
      const pxc = px + 0.5;
      const pyc = py + 0.5;
      const ix = Math.max(x + r, Math.min(pxc, x + w - r));
      const iy = Math.max(y + r, Math.min(pyc, y + h - r));
      const dx = pxc - ix;
      const dy = pyc - iy;
      const d = Math.sqrt(dx * dx + dy * dy);
      let a = 0;
      if (d <= r - 0.5) a = 255;
      else if (d <= r + 0.5) a = Math.round(255 * (r + 0.5 - d));
      if (a > 0) blendPx(png, px, py, color[0], color[1], color[2], Math.max(0, Math.min(255, a)));
    }
  }
}

// Stroke a ring (annulus) — distance band from radius `rInner` to
// `rOuter`, anti-aliased at both edges.
function strokeRing(png, cx, cy, rInner, rOuter, color) {
  const x0 = Math.max(0, Math.floor(cx - rOuter - 1));
  const x1 = Math.min(SIZE - 1, Math.ceil(cx + rOuter + 1));
  const y0 = Math.max(0, Math.floor(cy - rOuter - 1));
  const y1 = Math.min(SIZE - 1, Math.ceil(cy + rOuter + 1));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx + 0.5;
      const dy = y - cy + 0.5;
      const d = Math.sqrt(dx * dx + dy * dy);
      let a = 0;
      if (d >= rInner + 0.5 && d <= rOuter - 0.5) {
        a = 255;
      } else if (d >= rInner - 0.5 && d < rInner + 0.5) {
        a = Math.round(255 * (d - (rInner - 0.5)));
      } else if (d > rOuter - 0.5 && d <= rOuter + 0.5) {
        a = Math.round(255 * (1 - (d - (rOuter - 0.5))));
      }
      if (a > 0) blendPx(png, x, y, color[0], color[1], color[2], Math.max(0, Math.min(255, a)));
    }
  }
}

function makeBase(png) {
  fillCircle(png, SIZE / 2 - 0.5, SIZE / 2 - 0.5, SIZE / 2, GREEN);
}

function makeEnvelope() {
  const png = newImg();
  makeBase(png);
  // Envelope outline + V-fold, scaled 2× from the original 20×20
  // design with a 2-px stroke for visual weight matching the phone
  // and globe glyphs.
  //   Body rect: (8, 14) → (31, 26)
  //   V-fold:    upper-left (8, 14) and upper-right (31, 14) meet at
  //              the V's apex (19.5, 22).
  const t = 2;
  strokeLine(png, 8, 14, 31, 14, t, WHITE);
  strokeLine(png, 8, 26, 31, 26, t, WHITE);
  strokeLine(png, 8, 14, 8, 26, t, WHITE);
  strokeLine(png, 31, 14, 31, 26, t, WHITE);
  strokeLine(png, 8, 14, 19.5, 22, t, WHITE);
  strokeLine(png, 31, 14, 19.5, 22, t, WHITE);
  return png;
}

function makePhone() {
  const png = newImg();
  makeBase(png);
  // Smartphone silhouette — white rounded-rect body with a green
  // screen knockout, a green earpiece slot in the top bezel, and a
  // white home-indicator bar near the bottom of the screen. Replaces
  // the earlier tilted-handset Bézier: at the signature's 20×20
  // display size the bulbs+curved-handle muddied into a vague
  // diagonal blob, whereas the smartphone silhouette reads as a
  // phone even when downscaled.
  //
  //   Body            — 13w × 23h at (13, 8),    r=3.
  //   Screen knockout — 10w × 15h at (14.5, 12.5), r=1.
  //   Earpiece slot   — 4w × 1.2h at (17.5, 9.7), r=0.6.
  //   Home indicator  — 4w × 1.2h at (17.5, 25.6), r=0.6.
  fillRoundedRect(png, 13, 8, 13, 23, 3, WHITE);
  fillRoundedRect(png, 14.5, 12.5, 10, 15, 1, GREEN);
  fillRoundedRect(png, 17.5, 9.7, 4, 1.2, 0.6, GREEN);
  fillRoundedRect(png, 17.5, 25.6, 4, 1.2, 0.6, WHITE);
  return png;
}

function makeGlobe() {
  const png = newImg();
  makeBase(png);
  // Globe: outer ring + equator + polar axis + two meridian
  // ellipses, scaled 2× from the original 20×20 design.
  const cx = 19.5;
  const cy = 20;
  // Outer ring — radius 10.5 ± 1 px (2-px ring thickness).
  strokeRing(png, cx, cy, 9.5, 11.5, WHITE);
  // Equator — horizontal line at y = cy.
  strokeLine(png, cx - 10, cy, cx + 10, cy, 2, WHITE);
  // Polar axis — vertical line at x = cx.
  strokeLine(png, cx, cy - 10, cx, cy + 10, 2, WHITE);
  // Two meridian curves — vertical ellipses left and right of
  // center. Sampled densely so the curve reads as smooth.
  const meridianSamples = 80;
  for (let i = 0; i <= meridianSamples; i++) {
    const t = (i / meridianSamples) * 2 - 1; // -1..1
    const y = cy + t * 10;
    const ellipseX = 4.8 * Math.sqrt(Math.max(0, 1 - t * t));
    fillCircle(png, cx - ellipseX, y, 1, WHITE);
    fillCircle(png, cx + ellipseX, y, 1, WHITE);
  }
  return png;
}

function makeLinkedIn() {
  const png = newImg();
  makeBase(png);
  // Lowercase "in" mark (white on the green circle), matching the
  // LinkedIn wordmark glyph. Drawn from stroke primitives at 2× so it
  // reads cleanly when downscaled to the signature's 20×20 display.
  //   "i" — dot at (13.5, 14) + stem (13.5, 17.5)→(13.5, 27).
  //   "n" — left stem (20, 27)→(20, 20.5), a half-circle arch over the
  //         top from x=20 to x=26 (center 23, top y≈17.5), and a right
  //         stem (26, 20.5)→(26, 27).
  const t = 2.6;
  // "i"
  fillCircle(png, 13.5, 14, 1.7, WHITE);
  strokeLine(png, 13.5, 17.5, 13.5, 27, t, WHITE);
  // "n" left stem
  strokeLine(png, 20, 27, 20, 20.5, t, WHITE);
  // "n" arch (left stem top → over → right stem top)
  const archSamples = 48;
  const acx = 23;
  const acy = 20.5;
  const ar = 3;
  for (let i = 0; i <= archSamples; i++) {
    const a = Math.PI * (1 - i / archSamples); // PI (left) .. 0 (right)
    fillCircle(png, acx + Math.cos(a) * ar, acy - Math.sin(a) * ar, t / 2, WHITE);
  }
  // "n" right stem
  strokeLine(png, 26, 20.5, 26, 27, t, WHITE);
  return png;
}

function writePng(name, png) {
  const out = path.join(__dirname, "..", "public", "brand", name);
  const buf = PNG.sync.write(png, { colorType: 6 });
  fs.writeFileSync(out, buf);
  return buf.toString("base64");
}

const email = makeEnvelope();
const phone = makePhone();
const globe = makeGlobe();
const linkedin = makeLinkedIn();

const emailB64 = writePng("icon-email.png", email);
const phoneB64 = writePng("icon-phone.png", phone);
const globeB64 = writePng("icon-globe.png", globe);
const linkedinB64 = writePng("icon-linkedin.png", linkedin);

const tsModule = `// Email signature icons. Generated by
// scripts/generate-signature-icons.js — see that file for the source
// glyph definitions. Each is a 40x40 RGBA PNG with a green
// (#5A9642) circle background and a white glyph (envelope, phone,
// or globe) centered. Embedded as base64 strings so the signature
// renderer can drop them inline as data: URIs without ever
// touching the filesystem at runtime (Vercel serverless functions
// don't include /public in the function bundle, so any fs read of
// the PNG would ENOENT). Rendered at 2× the signature's 20×20 CSS
// display size so retina/high-DPI mail clients can show a crisp
// curved phone handset — the earlier 20×20 native source could not
// fit a curved receiver and rendered as a chunky dumbbell.

export const SIGNATURE_ICON_MIME = "image/png";

export const SIGNATURE_ICON_EMAIL_BASE64 =
  "${emailB64}";

export const SIGNATURE_ICON_PHONE_BASE64 =
  "${phoneB64}";

export const SIGNATURE_ICON_GLOBE_BASE64 =
  "${globeB64}";

export const SIGNATURE_ICON_LINKEDIN_BASE64 =
  "${linkedinB64}";
`;

fs.writeFileSync(path.join(__dirname, "..", "src", "lib", "signature-icons.ts"), tsModule);

console.log("wrote", "public/brand/icon-email.png", emailB64.length, "b64 chars");
console.log("wrote", "public/brand/icon-phone.png", phoneB64.length, "b64 chars");
console.log("wrote", "public/brand/icon-globe.png", globeB64.length, "b64 chars");
console.log("wrote", "src/lib/signature-icons.ts");
