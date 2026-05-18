"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";

// Distinct-hue palette for multi-token highlighting. Each entry is a full
// class string so Tailwind's JIT picks it up — dynamic `bg-${color}` would
// be silently dropped. Court tokens are a single hue family and can't make
// ten visually distinct chips, so this palette predates and remains the
// canonical highlight palette for token chips + in-PDF marks.
const TOKEN_COLORS = [
  "bg-amber-100 text-amber-900",
  "bg-blue-100 text-blue-800",
  "bg-purple-100 text-purple-800",
  "bg-green-100 text-green-800",
  "bg-rose-100 text-rose-800",
  "bg-orange-100 text-orange-800",
  "bg-teal-100 text-teal-800",
  "bg-indigo-100 text-indigo-800",
  "bg-yellow-100 text-yellow-800",
  "bg-pink-100 text-pink-800",
] as const;

// Parallel bg-only classes for the in-PDF mark overlay. Index-aligned with
// TOKEN_COLORS so a chip and its in-doc highlight share the same hue. The
// 200/70 weight + mix-blend-multiply lands at a Jax-style marker pass —
// solidly visible over canvas glyphs but still letting the underlying
// letterforms read through. 100/35 was too faint to see at a glance.
// Literal class names are mandatory for the Tailwind JIT — dynamic
// `${bg}/70` would be silently dropped.
const TOKEN_MARK_BG_CLASSES = [
  "bg-amber-200/70",
  "bg-blue-200/70",
  "bg-purple-200/70",
  "bg-green-200/70",
  "bg-rose-200/70",
  "bg-orange-200/70",
  "bg-teal-200/70",
  "bg-indigo-200/70",
  "bg-yellow-200/70",
  "bg-pink-200/70",
] as const;

// Stable token → chip-class assignment. Used by HighlightTokenChips.
export function buildTokenColorMap(tokens: string[]): Map<string, string> {
  const m = new Map<string, string>();
  tokens.forEach((t, i) => {
    m.set(t, TOKEN_COLORS[i % TOKEN_COLORS.length]);
  });
  return m;
}

// Stable token → mark-bg-class assignment. Used by PdfCanvasViewer's
// highlight overlay so the same token shows the same hue in the chip and
// in the rendered PDF, but the mark gets the /35 alpha + mix-blend variant
// instead of the chip's solid 100 fill.
export function buildTokenMarkBgMap(tokens: string[]): Map<string, string> {
  const m = new Map<string, string>();
  tokens.forEach((t, i) => {
    m.set(t, TOKEN_MARK_BG_CLASSES[i % TOKEN_MARK_BG_CLASSES.length]);
  });
  return m;
}

// Right-rail chip strip. The matches-snippet panel + "no extracted resume
// text" messaging were removed in Ace 53 — the in-PDF highlight overlay on
// EditableResume's PdfCanvasViewer is now the primary surface for showing
// where tokens appear. The rail stays as a compact chip card so the right
// pane still announces what's being highlighted at a glance.
export function ResumeMatchesRail({ tokens }: { tokens: string[] }) {
  if (tokens.length === 0) return null;
  return (
    <section className="flex flex-col rounded-2xl border border-court-border bg-court-surface-subtle/60">
      <HighlightTokenChips tokens={tokens} className="px-3 py-2" />
    </section>
  );
}

// Shared chip row: label + colored pills, wrapping. Used by the rail's
// header and by EditableResume above the viewer so both surfaces read off
// the same TOKEN_COLORS palette as the in-PDF overlay's <mark> tags.
export function HighlightTokenChips({
  tokens,
  className,
  label = "Highlighting:",
}: {
  tokens: string[];
  className?: string;
  label?: string;
}) {
  const colorMap = useMemo(() => buildTokenColorMap(tokens), [tokens]);
  if (tokens.length === 0) return null;
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {label && (
        <span className="text-[11px] uppercase tracking-wider text-court-fg-muted">
          {label}
        </span>
      )}
      {tokens.map((t) => (
        <span
          key={t}
          className={cn(
            "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
            colorMap.get(t) ?? TOKEN_COLORS[0],
          )}
        >
          {t}
        </span>
      ))}
    </div>
  );
}
