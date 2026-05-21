"use client";

import { useEffect, useRef } from "react";
import { signIn } from "next-auth/react";
import { BrandMark } from "@/components/brand-mark";

// Pre-auth sign-in surface — the "Dark Luxury Recruiter" command center
// the design landed on: a pitch-black field with a dotted world map of
// the BreakPoint desk, HQ glowing in Solon OH, connection arcs reaching
// the global markets, and a glassy card floating over a soft green glow.
//
// It's a deliberate fixed brand moment: it always renders Night Court ·
// Dark, independent of the visitor's in-app Court Mode (which doesn't
// apply until they sign in). The `signin-night` wrapper pins that palette
// (see globals.css), so every *-court-* utility below resolves to it with
// no flash and without mutating the user's stored theme. No hardcoded
// UI hex — colors come from Court Mode tokens (rule 12). The only fixed
// colors are brand assets: the Ace mark (via <BrandMark />) and the
// official Google "G" logo.

type City = { name: string; x: number; y: number; hq?: boolean };

// Recruiter desk, plotted on the 1000×500 SVG viewBox.
const CITIES: City[] = [
  { name: "Solon, OH", x: 268, y: 168, hq: true },
  { name: "New York", x: 290, y: 175 },
  { name: "San Francisco", x: 145, y: 180 },
  { name: "Chicago", x: 255, y: 165 },
  { name: "Toronto", x: 275, y: 158 },
  { name: "London", x: 510, y: 138 },
  { name: "Frankfurt", x: 530, y: 145 },
  { name: "Zurich", x: 528, y: 158 },
  { name: "Dubai", x: 625, y: 215 },
  { name: "Mumbai", x: 678, y: 235 },
  { name: "Singapore", x: 760, y: 280 },
  { name: "Hong Kong", x: 785, y: 225 },
  { name: "Tokyo", x: 838, y: 195 },
  { name: "Sydney", x: 850, y: 380 },
];

// Continents as overlapping ellipses [cx, cy, rx, ry] — the stipple is
// masked to whatever falls inside one of these.
const CONTINENTS: [number, number, number, number][] = [
  [195, 155, 95, 55], [220, 110, 80, 30], [240, 200, 35, 35],
  [355, 100, 22, 28],
  [295, 320, 38, 85], [275, 270, 30, 35],
  [520, 145, 50, 38],
  [535, 290, 55, 95],
  [605, 200, 45, 35],
  [720, 175, 110, 70],
  [780, 275, 50, 22],
  [685, 240, 22, 35],
  [840, 365, 45, 28],
  [505, 130, 12, 14],
  [840, 195, 12, 22],
];

const ARC_TARGETS = [
  "London", "Frankfurt", "San Francisco", "Tokyo", "Singapore", "Sydney", "Dubai",
];

export default function SignInPage() {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const netRef = useRef<SVGGElement | null>(null);

  useEffect(() => {
    const stage = stageRef.current;
    const net = netRef.current;
    if (!stage || !net) return;

    const NS = "http://www.w3.org/2000/svg";
    const frac = (n: number) => n - Math.floor(n);

    // Pull the network-viz greens from the pinned Court Mode tokens so
    // the artwork stays in the brand family with no hardcoded hex. The
    // vars resolve to R G B triplets ("123 184 91"), valid inside rgb().
    const cs = getComputedStyle(stage);
    const tok = (name: string, fallback: string) =>
      cs.getPropertyValue(name).trim() || fallback;
    const BRAND = tok("--court-brand", "123 184 91"); // #7BB85B
    const BRIGHT = tok("--court-accent-dark", "156 214 131"); // #9CD683
    const rgb = (triplet: string, alpha?: number) =>
      alpha == null ? `rgb(${triplet})` : `rgb(${triplet} / ${alpha})`;

    const frag = document.createDocumentFragment();
    const make = (tag: string, attrs: Record<string, string>) => {
      const el = document.createElementNS(NS, tag);
      for (const k in attrs) el.setAttribute(k, attrs[k]);
      return el;
    };

    // 1) Stippled continents — deterministic value noise so the dot
    //    field is stable across renders.
    const step = 7;
    for (let x = 20; x < 980; x += step) {
      for (let y = 20; y < 480; y += step) {
        const r1 = frac(Math.sin(x * 12.9898 + y * 78.233) * 43758.5453);
        const r2 = frac(Math.sin(x * 4.213 + y * 31.117) * 23421.631);
        const inside = CONTINENTS.some(([cx, cy, rx, ry]) => {
          const dx = (x - cx) / rx, dy = (y - cy) / ry;
          return dx * dx + dy * dy < 1;
        });
        if (!inside || r1 < 0.18) continue;
        const bright = r1 > 0.93;
        frag.appendChild(
          make("circle", {
            cx: String(x + (r2 - 0.5) * 2.5),
            cy: String(y + (r1 - 0.5) * 2.5),
            r: bright ? "1.2" : "0.8",
            fill: bright ? rgb(BRIGHT) : rgb(BRAND),
            opacity: bright ? "0.95" : "0.22",
          }),
        );
      }
    }

    // 2) Connection arcs from HQ to the global markets.
    const hq = CITIES[0];
    ARC_TARGETS.forEach((name) => {
      const city = CITIES.find((c) => c.name === name);
      if (!city) return;
      const mx = (hq.x + city.x) / 2;
      const my = (hq.y + city.y) / 2;
      const dist = Math.hypot(city.x - hq.x, city.y - hq.y);
      const lift = Math.min(dist * 0.45, 120);
      frag.appendChild(
        make("path", {
          d: `M ${hq.x} ${hq.y} Q ${mx} ${my - lift} ${city.x} ${city.y}`,
          stroke: rgb(BRAND, 0.55),
          "stroke-width": "0.6",
          fill: "none",
          "stroke-dasharray": "2 3",
        }),
      );
    });

    // 3) City nodes + glows, with the HQ marker brighter + ringed.
    CITIES.forEach((c) => {
      frag.appendChild(
        make("circle", {
          cx: String(c.x), cy: String(c.y),
          r: c.hq ? "14" : "8",
          fill: `url(#${c.hq ? "hq-glow" : "city-glow"})`,
        }),
      );
      frag.appendChild(
        make("circle", {
          cx: String(c.x), cy: String(c.y),
          r: c.hq ? "2.6" : "1.6",
          fill: c.hq ? rgb(BRIGHT) : rgb(BRAND),
        }),
      );
      if (c.hq) {
        frag.appendChild(
          make("circle", {
            cx: String(c.x), cy: String(c.y), r: "5",
            fill: "none", stroke: rgb(BRAND, 0.7), "stroke-width": "0.5",
          }),
        );
      }
    });

    // 4) HQ leader line + label.
    frag.appendChild(
      make("line", {
        x1: "268", y1: "168", x2: "268", y2: "120",
        stroke: rgb(BRAND, 0.7), "stroke-width": "0.6",
      }),
    );
    const lbl = make("text", {
      x: "272", y: "115",
      fill: rgb(BRAND),
      "font-size": "9",
      "font-family": "var(--font-inter), sans-serif",
      "font-weight": "600",
      "letter-spacing": "1.5",
    });
    lbl.textContent = "SOLON, OH · HQ";
    frag.appendChild(lbl);

    net.appendChild(frag);

    return () => {
      while (net.firstChild) net.removeChild(net.firstChild);
    };
  }, []);

  return (
    <div
      ref={stageRef}
      className="signin-night relative min-h-screen w-full overflow-hidden bg-court-bg text-court-fg"
    >
      {/* World map of the recruiter network */}
      <div className="absolute inset-0 z-[1]" aria-hidden>
        <svg
          viewBox="0 0 1000 500"
          preserveAspectRatio="xMidYMid meet"
          className="block h-full w-full"
        >
          <defs>
            <radialGradient id="city-glow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="rgb(var(--court-brand))" stopOpacity="0.85" />
              <stop offset="100%" stopColor="rgb(var(--court-brand))" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="hq-glow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="rgb(var(--court-accent-dark))" stopOpacity="1" />
              <stop offset="100%" stopColor="rgb(var(--court-accent-dark))" stopOpacity="0" />
            </radialGradient>
          </defs>
          <g ref={netRef} />
        </svg>
      </div>

      {/* Green vignette + black edge fade */}
      <div
        className="pointer-events-none absolute inset-0 z-[1] bg-[radial-gradient(ellipse_at_50%_55%,rgb(var(--court-brand)/0.12)_0%,transparent_55%)]"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-0 z-[2] bg-[linear-gradient(180deg,rgba(0,0,0,0.7)_0%,transparent_18%,transparent_78%,rgba(0,0,0,0.85)_100%)]"
        aria-hidden
      />

      {/* Top bar */}
      <div className="absolute left-5 right-5 top-9 z-[4] flex items-center md:left-12 md:right-12">
        <span className="relative flex h-2 w-2" aria-hidden>
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-court-brand opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-court-brand shadow-[0_0_16px_rgb(var(--court-brand)/0.7)]" />
        </span>
      </div>

      {/* Card */}
      <div className="absolute inset-0 z-[3] flex items-center justify-center p-4">
        <div className="relative">
          {/* Soft green glow underneath the card */}
          <div
            className="pointer-events-none absolute left-1/2 top-[62%] h-[200px] w-[540px] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 rounded-full blur-2xl bg-[radial-gradient(ellipse_at_center,rgb(var(--court-brand)/0.45)_0%,transparent_70%)]"
            aria-hidden
          />
          <div
            role="dialog"
            aria-labelledby="signin-welcome"
            className="relative w-[460px] max-w-[calc(100vw-2rem)] rounded-[20px] border border-court-brand/20 bg-court-surface/90 p-7 backdrop-blur-md shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8),0_0_0_1px_rgba(255,255,255,0.02)_inset] sm:px-11 sm:pt-11 sm:pb-9"
          >
            <div className="mb-8 flex justify-center">
              <BrandMark />
            </div>

            <div className="mx-auto mb-7 h-px w-10 bg-[linear-gradient(90deg,transparent,rgb(var(--court-brand)/0.6),transparent)]" />

            <h1
              id="signin-welcome"
              className="text-center font-serif text-[32px] font-semibold leading-[1.1] tracking-[-0.015em] text-court-fg sm:text-[34px]"
            >
              Welcome back.
            </h1>
            <p className="mx-auto mb-8 mt-2.5 max-w-[34ch] text-center text-[13px] leading-relaxed text-court-fg-muted">
              Sign in with your BreakPoint Talent Google account.
            </p>

            <button
              type="button"
              onClick={() => signIn("google", { callbackUrl: "/dashboard" })}
              className="flex w-full items-center justify-center gap-3 rounded-xl bg-court-brand px-5 py-3.5 text-sm font-semibold text-white ring-1 ring-inset ring-white/15 shadow-[0_8px_24px_-6px_rgb(var(--court-brand)/0.5),0_0_0_1px_rgba(255,255,255,0.08)_inset] transition-[transform,box-shadow] duration-150 hover:-translate-y-px hover:shadow-[0_12px_28px_-6px_rgb(var(--court-brand)/0.65),0_0_0_1px_rgba(255,255,255,0.12)_inset] active:translate-y-0"
            >
              <span className="inline-flex h-[22px] w-[22px] items-center justify-center rounded-full bg-white">
                {/* Official Google "G" — brand asset, fixed colors */}
                <svg width="14" height="14" viewBox="0 0 18 18" aria-hidden>
                  <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84c-.21 1.13-.84 2.08-1.79 2.72v2.26h2.9c1.7-1.56 2.69-3.87 2.69-6.62z" />
                  <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.8.54-1.83.87-3.06.87-2.35 0-4.34-1.59-5.05-3.72H.96v2.34A9 9 0 0 0 9 18z" />
                  <path fill="#FBBC05" d="M3.95 10.71A5.41 5.41 0 0 1 3.66 9c0-.59.1-1.17.29-1.71V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.05l2.99-2.34z" />
                  <path fill="#EA4335" d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l2.99 2.34C4.66 5.16 6.65 3.58 9 3.58z" />
                </svg>
              </span>
              Continue with Google
            </button>

            <p className="mt-5 border-t border-white/[0.06] pt-5 text-center text-[11px] tracking-[0.04em] text-court-fg-dim">
              Access is restricted to{" "}
              <span className="font-medium text-court-brand-dark">@breakpointtalent.com</span>{" "}
              accounts.
            </p>
          </div>
        </div>
      </div>

      {/* Bottom bar */}
      <div className="absolute bottom-8 left-5 right-5 z-[4] flex justify-between text-[10px] font-semibold uppercase tracking-[0.24em] text-court-fg-dim/70 md:left-12 md:right-12">
        <span>BreakPoint Talent · Solon, OH · Est. 2026</span>
        <span className="hidden sm:inline">Secure sign-in · Google</span>
      </div>
    </div>
  );
}
