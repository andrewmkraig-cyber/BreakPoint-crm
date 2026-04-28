"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import { getCandidateNavSnapshot } from "@/lib/candidate-nav";

// Renders the candidate profile's "Back to all candidates" link plus
// optional Prev / Next arrows. Reads sessionStorage for an ordered
// list snapshot the source surface (candidates / pipeline /
// applicants / list-detail) stashed before navigating in. Skipped
// gracefully when no snapshot exists or the current candidate isn't
// in it — the back link still works.

export function CandidateProfileNav({ currentId }: { currentId: string }) {
  // Initial server render uses null so the link reads "Back to all
  // candidates" by default. Real snapshot loads in an effect to avoid
  // hydration mismatches (sessionStorage is browser-only).
  const [snapshot, setSnapshot] = useState<ReturnType<typeof getCandidateNavSnapshot>>(null);

  useEffect(() => {
    setSnapshot(getCandidateNavSnapshot());
  }, [currentId]);

  const { prevId, nextId, backHref, backLabel } = useMemo(() => {
    if (!snapshot) {
      return {
        prevId: null,
        nextId: null,
        backHref: "/candidates",
        backLabel: "Back to all candidates",
      };
    }
    const idx = snapshot.ids.indexOf(currentId);
    const prevId = idx > 0 ? snapshot.ids[idx - 1] : null;
    const nextId = idx >= 0 && idx < snapshot.ids.length - 1 ? snapshot.ids[idx + 1] : null;
    const backHref = snapshot.backHref ?? defaultBackHref(snapshot.source);
    const backLabel = labelFor(snapshot.source);
    return { prevId, nextId, backHref, backLabel };
  }, [snapshot, currentId]);

  return (
    <div className="flex items-center gap-3 text-xs text-court-fg-muted">
      <Link
        href={backHref}
        className="inline-flex items-center gap-1 transition hover:text-court-fg"
      >
        <ArrowLeft className="h-3 w-3" /> {backLabel}
      </Link>
      <div className="inline-flex items-center gap-1">
        <PrevNextButton
          href={prevId ? `/candidates/${prevId}` : null}
          disabled={!prevId}
          ariaLabel="Previous candidate"
          icon={<ChevronLeft className="h-4 w-4" />}
        />
        <PrevNextButton
          href={nextId ? `/candidates/${nextId}` : null}
          disabled={!nextId}
          ariaLabel="Next candidate"
          icon={<ChevronRight className="h-4 w-4" />}
        />
      </div>
    </div>
  );
}

function PrevNextButton({
  href,
  disabled,
  ariaLabel,
  icon,
}: {
  href: string | null;
  disabled: boolean;
  ariaLabel: string;
  icon: React.ReactNode;
}) {
  // Disabled buttons render as a plain span so keyboard tab order
  // skips them and there's no underline / hover effect on the
  // boundary edges (first / last candidate).
  if (disabled || !href) {
    return (
      <span
        aria-label={ariaLabel}
        aria-disabled="true"
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-transparent text-court-fg-muted/40"
      >
        {icon}
      </span>
    );
  }
  return (
    <Link
      href={href}
      aria-label={ariaLabel}
      title={ariaLabel}
      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-court-border bg-court-surface text-court-fg-muted shadow-sm transition hover:border-court-accent/40 hover:text-court-accent-dark"
    >
      {icon}
    </Link>
  );
}

function labelFor(source: string): string {
  switch (source) {
    case "candidates":
      return "Back to all candidates";
    case "pipeline":
      return "Back to pipeline";
    case "applicants":
      return "Back to applicants";
    case "list":
      return "Back to list";
    default:
      return "Back to all candidates";
  }
}

function defaultBackHref(source: string): string {
  switch (source) {
    case "pipeline":
      return "/pipeline";
    case "applicants":
      return "/applicants";
    default:
      return "/candidates";
  }
}
