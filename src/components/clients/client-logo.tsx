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
function initialsBg(name: string) {
  const palette = ["#3F6B2E", "#5A9642", "#1F2937", "#475569", "#92400E", "#7C2D12"];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}

export function ClientLogo({
  domain,
  name,
  size = 40,
}: {
  domain?: string | null;
  name: string;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);
  const bg = useMemo(() => initialsBg(name), [name]);

  if (!domain || failed) {
    return (
      <div
        className="flex shrink-0 items-center justify-center rounded-lg font-semibold text-white"
        style={{ width: size, height: size, background: bg, fontSize: size * 0.38 }}
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
      className="shrink-0 rounded-lg border border-court-border bg-court-surface object-contain p-1"
      style={{ width: size, height: size }}
      onError={() => setFailed(true)}
    />
  );
}
