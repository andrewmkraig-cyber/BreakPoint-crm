// Generates three 20x20 PNG icons (green circle background, white glyph
// for envelope / phone / globe) used in the email signature. Outputs:
//   public/brand/icon-email.png
//   public/brand/icon-phone.png
//   public/brand/icon-globe.png
// And a TS module at src/lib/signature-icons.ts that exports each
// icon's base64 string (compiled into the bundle so the signature
// renderer never reads from disk on Vercel — same pattern as the
// signature logo at src/lib/default-brand-logo.ts).
//
// Run:
//   node scripts/generate-signature-icons.js

const fs = require("node:fs");
const path = require("node:path");
const { PNG } = require("pngjs");

const SIZE = 20;
const GREEN = [0x5a, 0x96, 0x42];
const WHITE = [255, 255, 255];
const TRANSPARENT = [0, 0, 0, 0];

function newImg() {
  const png = new PNG({ width: SIZE, height: SIZE, colorType: 6 });
  png.data.fill(0);
  return png;
}

function setPx(png, x, y, r, g, b, a = 255) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
  const idx = (y * SIZE + x) * 4;
  png.data[idx] = r;
  png.data[idx + 1] = g;
  png.data[idx + 2] = b;
  png.data[idx + 3] = a;
}

function fillCircle(png, cx, cy, r, color) {
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const dx = x - cx + 0.5;
      const dy = y - cy + 0.5;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d <= r - 0.5) {
        setPx(png, x, y, color[0], color[1], color[2], 255);
      } else if (d <= r + 0.5) {
        // 1-pixel anti-alias rim — softens the circle edge so it doesn't
        // look pixelated at 20px display size.
        const a = Math.round(255 * (1 - (d - (r - 0.5))));
        setPx(png, x, y, color[0], color[1], color[2], Math.max(0, Math.min(255, a)));
      }
    }
  }
}

function drawLine(png, x1, y1, x2, y2, color) {
  let dx = Math.abs(x2 - x1);
  let sx = x1 < x2 ? 1 : -1;
  let dy = -Math.abs(y2 - y1);
  let sy = y1 < y2 ? 1 : -1;
  let err = dx + dy;
  while (true) {
    setPx(png, x1, y1, color[0], color[1], color[2], 255);
    if (x1 === x2 && y1 === y2) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x1 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y1 += sy;
    }
  }
}

function drawRectOutline(png, x0, y0, x1, y1, color) {
  drawLine(png, x0, y0, x1, y0, color);
  drawLine(png, x0, y1, x1, y1, color);
  drawLine(png, x0, y0, x0, y1, color);
  drawLine(png, x1, y0, x1, y1, color);
}

function makeBase(png) {
  fillCircle(png, 10, 10, 10, GREEN);
}

function makeEnvelope() {
  const png = newImg();
  makeBase(png);
  // 12x7 envelope, centered at (10, 10): rect (4,7)→(15,13)
  drawRectOutline(png, 4, 7, 15, 13, WHITE);
  // V from (4,7) and (15,7) meeting at (9,11)
  drawLine(png, 4, 7, 9, 11, WHITE);
  drawLine(png, 15, 7, 9, 11, WHITE);
  return png;
}

function makePhone() {
  const png = newImg();
  makeBase(png);
  // Classic telephone handset glyph. Two solid rounded-rectangle
  // pads (earpiece top-left, mouthpiece bottom-right) joined by a
  // bold curved arc handle that sweeps right-and-down between
  // them. Designed at 20×20 to read as a phone at the signature's
  // display size — bold filled shapes, no 1-px outlines, and a
  // curved (not diagonal) handle so the silhouette can't be
  // mistaken for a dumbbell or a key.
  function fill(x, y) {
    setPx(png, x, y, WHITE[0], WHITE[1], WHITE[2], 255);
  }
  // Rounded-rectangle pad helper. Fills [x0..x1] × [y0..y1], with
  // the four outer corner pixels trimmed so each pad reads as a
  // soft rounded rect rather than a hard square. Pads at this
  // scale (5×4) only need single-pixel corner trimming to look
  // rounded — anything heavier eats into the pad's body.
  function roundedPad(x0, y0, x1, y1) {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const isCorner =
          (x === x0 && y === y0) ||
          (x === x1 && y === y0) ||
          (x === x0 && y === y1) ||
          (x === x1 && y === y1);
        if (isCorner) continue;
        fill(x, y);
      }
    }
  }
  // Earpiece — 5×4 rounded rect, cols 3–7, rows 3–6.
  roundedPad(3, 3, 7, 6);
  // Mouthpiece — mirror, 5×4 rounded rect, cols 12–16, rows 13–16.
  roundedPad(12, 13, 16, 16);
  // Curved arc handle, joining the inside corners of the two
  // pads. Drawn by sampling a quadratic Bezier
  //   P0 = (6, 6) — inside the earpiece's bottom-right corner
  //   P1 = (14, 8) — control point pulling the curve up and right
  //                  so the arc bulges away from the diagonal line
  //   P2 = (13, 13) — inside the mouthpiece's top-left corner
  // and filling a 2×2 block at every sample. Dense sampling
  // (80 steps) keeps the band continuous through the diagonal
  // transition; the 2×2 block gives the handle a bold ~2–3 px
  // depth so it matches the visual weight of the two pads.
  // Endpoints sit *inside* each pad so the arc fuses cleanly
  // with both, rather than leaving a 1-px diagonal gap.
  const samples = 80;
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const omt = 1 - t;
    const cx = omt * omt * 6 + 2 * omt * t * 14 + t * t * 13;
    const cy = omt * omt * 6 + 2 * omt * t * 8 + t * t * 13;
    const px = Math.round(cx);
    const py = Math.round(cy);
    fill(px, py);
    fill(px + 1, py);
    fill(px, py + 1);
    fill(px + 1, py + 1);
  }
  return png;
}

function makeGlobe() {
  const png = newImg();
  makeBase(png);
  // Outer globe outline (smaller circle) — draw as ring by checking
  // distance band.
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const dx = x - 9.5;
      const dy = y - 10 + 0.5;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > 5.0 && d < 6.0) {
        setPx(png, x, y, 255, 255, 255, 255);
      }
    }
  }
  // Equator
  drawLine(png, 5, 10, 14, 10, WHITE);
  // Two meridian curves — vertical ellipse cross.
  for (let y = 5; y <= 15; y++) {
    const t = (y - 10) / 5; // -1..1
    const ellipseX = Math.round(2.4 * Math.sqrt(Math.max(0, 1 - t * t)));
    setPx(png, 9 - ellipseX, y, ...WHITE);
    setPx(png, 9 + ellipseX, y, ...WHITE);
  }
  // Single vertical line through the center for the polar axis.
  drawLine(png, 9, 5, 9, 15, WHITE);
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

const emailB64 = writePng("icon-email.png", email);
const phoneB64 = writePng("icon-phone.png", phone);
const globeB64 = writePng("icon-globe.png", globe);

const tsModule = `// Email signature icons. Generated by
// scripts/generate-signature-icons.js — see that file for the source
// glyph definitions. Each is a 20x20 RGBA PNG with a green
// (#5A9642) circle background and a white glyph (envelope, phone,
// or globe) centered. Embedded as base64 strings so the signature
// renderer can drop them inline as data: URIs without ever
// touching the filesystem at runtime (Vercel serverless functions
// don't include /public in the function bundle, so any fs read of
// the PNG would ENOENT).

export const SIGNATURE_ICON_MIME = "image/png";

export const SIGNATURE_ICON_EMAIL_BASE64 =
  "${emailB64}";

export const SIGNATURE_ICON_PHONE_BASE64 =
  "${phoneB64}";

export const SIGNATURE_ICON_GLOBE_BASE64 =
  "${globeB64}";
`;

fs.writeFileSync(path.join(__dirname, "..", "src", "lib", "signature-icons.ts"), tsModule);

console.log("wrote", "public/brand/icon-email.png", emailB64.length, "b64 chars");
console.log("wrote", "public/brand/icon-phone.png", phoneB64.length, "b64 chars");
console.log("wrote", "public/brand/icon-globe.png", globeB64.length, "b64 chars");
console.log("wrote", "src/lib/signature-icons.ts");
