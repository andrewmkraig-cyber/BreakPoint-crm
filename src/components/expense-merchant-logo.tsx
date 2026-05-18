"use client";

import { useState } from "react";

function initials(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9]/g, "");
  return (cleaned.slice(0, 2) || "??").toUpperCase();
}

function normalizeDomain(d: string): string {
  return d.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
}

export function ExpenseMerchantLogo({
  domain,
  name,
  size = 20,
}: {
  domain?: string | null;
  name: string;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);

  if (!domain || failed) {
    return (
      <span
        className="inline-flex shrink-0 items-center justify-center rounded-md bg-court-surface-subtle font-bold text-court-fg-muted"
        style={{ width: size, height: size, fontSize: Math.round(size * 0.45) }}
        aria-label={name}
      >
        {initials(name)}
      </span>
    );
  }

  const host = normalizeDomain(domain);
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`https://www.google.com/s2/favicons?domain=${host}&sz=32`}
      alt={`${name} logo`}
      width={size}
      height={size}
      className="shrink-0 rounded-md border border-court-border bg-court-surface object-contain"
      style={{ width: size, height: size }}
      onError={() => setFailed(true)}
    />
  );
}
