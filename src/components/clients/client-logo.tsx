"use client";

import { useMemo, useState } from "react";

// Client.website rows are stored with whatever the recruiter pasted, so they
// can be "https://sheehanvending.com/", "www.sheehanvending.com", or just
// "sheehanvending.com". Clearbit only accepts the bare host, so we normalize
// down to that before building the logo URL.
function normalizeDomain(input: string | null | undefined): string | null {
  if (!input) return null;
  let v = input.trim();
  if (!v) return null;
  v = v.replace(/^https?:\/\//i, "");
  v = v.replace(/^www\./i, "");
  v = v.split("/")[0];
  v = v.replace(/\/+$/, "");
  return v || null;
}

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
  const normalizedDomain = useMemo(() => normalizeDomain(domain), [domain]);

  if (variant === "initials" || !normalizedDomain || failed) {
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

  const clearbitUrl = `https://logo.clearbit.com/${normalizedDomain}?size=${size}`;
  if (typeof window !== "undefined") {
    // Debug aid while the regression is fresh; logs the resolved Clearbit
    // URL so we can see when the request is firing and what domain it
    // resolved to before Clearbit 404s into the initials fallback.
    console.log("[ClientLogo] clearbit url", clearbitUrl);
  }
  // Clearbit returns the company's real logo (not a favicon), so size scales
  // to whatever the consumer asks for and we don't pad inside the chip.
  // Plain <img> instead of next/image — Clearbit isn't on the next.config
  // images allow-list and the URL is per-render, not a build-time asset.
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={clearbitUrl}
      alt={`${name} logo`}
      width={size}
      height={size}
      className={`shrink-0 ${radius} border border-court-border bg-court-surface object-contain`}
      style={{ width: size, height: size }}
      onError={() => setFailed(true)}
    />
  );
}
