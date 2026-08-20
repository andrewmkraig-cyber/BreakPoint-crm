"use client";

import Link from "next/link";

// Stage dot color classes. Brand greens (submitted/hired) ride Court
// Mode tokens so they retheme with Hard/Clay/Grass/Night; typed stages
// (interviewing/offer/pending_start) use the same Tailwind hues the
// canonical StageBadge uses so semantic meaning stays consistent.
const DOT_CLASSES: Record<string, string> = {
  submitted: "bg-court-brand-dark",
  interviewing: "bg-blue-700",
  offer: "bg-purple-600",
  pending_start: "bg-amber-700",
  hired: "bg-court-brand",
};

const STAGE_LABELS: Record<string, string> = {
  submitted: "Submitted",
  interviewing: "Interviewing",
  offer: "Offer",
  pending_start: "Pending Start",
  hired: "Hired",
};

export function PipelinePill({
  stage,
  count,
  href,
  compact = false,
}: {
  stage: string;
  count: number;
  href?: string;
  // Dot + count only, sized to a uniform width. Used by the clients LIST
  // view, where five labeled pills per row wrapped and center-aligned into a
  // ragged block; fixed-width chips in fixed stage columns line up down the
  // table. The stage name moves to the tooltip.
  compact?: boolean;
}) {
  const label = STAGE_LABELS[stage] ?? stage;
  const pill = compact ? (
    <span
      title={`${count} ${label}`}
      className="inline-flex w-full items-center justify-center gap-1.5 rounded-full border border-court-border bg-court-surface-subtle px-2 py-1 text-[11px] font-medium text-court-fg"
    >
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT_CLASSES[stage] ?? "bg-court-fg-muted"}`}
      />
      <span className="font-semibold tabular-nums">{count}</span>
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-court-border bg-court-surface-subtle px-2.5 py-1 text-[11px] font-medium text-court-fg">
      <span
        className={`h-1.5 w-1.5 rounded-full ${DOT_CLASSES[stage] ?? "bg-court-fg-muted"}`}
      />
      <span className="font-semibold">{count}</span>
      <span className="text-court-fg-muted">{label}</span>
    </span>
  );

  if (href) {
    return (
      <Link
        href={href}
        onClick={(e) => e.stopPropagation()}
        className={`transition-opacity hover:opacity-80${compact ? " block w-full" : ""}`}
      >
        {pill}
      </Link>
    );
  }
  return pill;
}
