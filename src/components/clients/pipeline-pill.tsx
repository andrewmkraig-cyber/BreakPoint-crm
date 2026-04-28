"use client";

import Link from "next/link";

// Stage dot colors — kept fixed (not Court Mode tokens) because these
// are semantic stage indicators that should mean the same thing in
// every theme. Court tokens carry the surrounding pill chrome.
const DOT_COLORS: Record<string, string> = {
  submitted: "#3F6B2E",
  interviewing: "#1D4ED8",
  offer: "#7C3AED",
  pending_start: "#B45309",
  hired: "#16A34A",
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
}: {
  stage: string;
  count: number;
  href?: string;
}) {
  const pill = (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-court-border bg-court-surface-subtle px-2.5 py-1 text-[11px] font-medium text-court-fg">
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: DOT_COLORS[stage] ?? "#6B7280" }}
      />
      <span className="font-semibold">{count}</span>
      <span className="text-court-fg-muted">{STAGE_LABELS[stage] ?? stage}</span>
    </span>
  );

  if (href) {
    return (
      <Link
        href={href}
        onClick={(e) => e.stopPropagation()}
        className="transition-opacity hover:opacity-80"
      >
        {pill}
      </Link>
    );
  }
  return pill;
}
