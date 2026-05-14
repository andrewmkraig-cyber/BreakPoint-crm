"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

// Renders a square rounded avatar for a client. Prefers `logoUrl`
// (Clearbit-derived at client-create time, stored on Client.logoUrl);
// falls back to a 2-letter initials chip when the URL is missing or
// the image 404s. Client component because we listen for the onError
// signal — server components can't.
export function ClientLogo({
  name,
  logoUrl,
  size = 40,
  className,
}: {
  name: string;
  logoUrl?: string | null;
  size?: number;
  className?: string;
}) {
  const [errored, setErrored] = useState(false);
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("") || "?";
  const px = `${size}px`;

  if (!logoUrl || errored) {
    return (
      <span
        style={{ width: px, height: px }}
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-full bg-court-fg font-mono text-xs font-bold tracking-wider text-court-surface",
          className,
        )}
        aria-hidden="true"
      >
        {initials}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={logoUrl}
      alt=""
      style={{ width: px, height: px }}
      className={cn(
        "shrink-0 rounded-full bg-court-surface object-contain ring-1 ring-court-border",
        className,
      )}
      onError={() => setErrored(true)}
    />
  );
}
