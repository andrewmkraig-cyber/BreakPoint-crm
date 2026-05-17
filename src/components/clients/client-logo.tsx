"use client";

import { useMemo, useState } from "react";

function initials(name: string) {
  const parts = name.split(/[\s.,]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

// Stable per-name color from a small palette. Hardcoded hex values here
// are intentional — these are data-driven identity colors (same client
// always gets the same swatch), not theme-driven tokens. The Court Mode
// surfaces around the avatar still track the palette.
const CLIENT_COLOR_PALETTE = ["#3F6B2E", "#5A9642", "#1F2937", "#475569", "#92400E", "#7C2D12"];

export function clientIdentityColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return CLIENT_COLOR_PALETTE[h % CLIENT_COLOR_PALETTE.length];
}

export function ClientLogo({
  domain,
  name,
  size = 40,
  variant = "auto",
  shape = "rounded",
}: {
  domain?: string | null;
  name: string;
  size?: number;
  /**
   * "auto" (default) — favicon if domain is present, colored initials
   * square as fallback. "initials" — always the colored identity square,
   * never the favicon (used by the redesigned clients grid card where
   * the identity color is the card's accent anchor).
   */
  variant?: "auto" | "initials";
  /** "rounded" (default) — rounded-lg. "squircle" — rounded-xl, matches the directory card spec. */
  shape?: "rounded" | "squircle";
}) {
  const [failed, setFailed] = useState(false);
  const bg = useMemo(() => clientIdentityColor(name), [name]);
  const radius = shape === "squircle" ? "rounded-xl" : "rounded-lg";

  if (variant === "initials" || !domain || failed) {
    return (
      <div
        className={`flex shrink-0 items-center justify-center ${radius} font-extrabold text-white`}
        style={{ width: size, height: size, background: bg, fontSize: size * 0.32 }}
        aria-label={name}
      >
        {initials(name)}
      </div>
    );
  }

  // Plain <img>, not next/image — Google's favicon endpoint doesn't fit
  // Next's image-optimization model (size param controls output) and
  // adding it to the next.config images allow-list isn't worth it for
  // a 32-128px favicon.
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`https://www.google.com/s2/favicons?domain=${domain}&sz=128`}
      alt={`${name} logo`}
      width={size}
      height={size}
      className={`shrink-0 ${radius} border border-court-border bg-court-surface object-contain p-1`}
      style={{ width: size, height: size }}
      onError={() => setFailed(true)}
    />
  );
}
