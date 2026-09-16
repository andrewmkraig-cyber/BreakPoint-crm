"use client";

import { useEffect, useState, type ReactNode } from "react";
import { List, PieChart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Header row + body for a Placements breakdown panel that can show its
// ranking either as the original list/table or as a SharePie. The chosen
// view is remembered per panel in localStorage (per browser, best effort).
//
// The caller keeps its own card chrome and passes the title node so each
// surface (Breakdowns eyebrow, Revenue serif title, Map sub-section) keeps
// its existing look. `list` is the table view and stays the accessible
// fallback for the chart.

type View = "list" | "pie";

function storageKeyFor(key: string): string {
  return `ace.breakdown-view.${key}`;
}

export function BreakdownViewSwitch({
  storageKey,
  title,
  ariaLabel,
  list,
  pie,
  bodyClassName = "mt-2.5",
}: {
  storageKey: string;
  title: ReactNode;
  // Names the panel for the toggle's accessible label, e.g. "By Industry".
  ariaLabel: string;
  list: ReactNode;
  pie: ReactNode;
  bodyClassName?: string;
}) {
  const [view, setView] = useState<View>("list");

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(storageKeyFor(storageKey));
      if (saved === "pie" || saved === "list") setView(saved);
    } catch {
      // Storage unavailable (private mode, blocked): stay on the list.
    }
  }, [storageKey]);

  function choose(next: View) {
    setView(next);
    try {
      window.localStorage.setItem(storageKeyFor(storageKey), next);
    } catch {
      // Best effort only.
    }
  }

  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">{title}</div>
        <div
          role="group"
          aria-label={`${ariaLabel} view`}
          className="flex shrink-0 items-center gap-0.5 rounded-md border border-court-border bg-court-surface p-0.5"
        >
          <ViewButton
            active={view === "list"}
            label="List view"
            onClick={() => choose("list")}
          >
            <List className="h-3.5 w-3.5" />
          </ViewButton>
          <ViewButton
            active={view === "pie"}
            label="Pie chart view"
            onClick={() => choose("pie")}
          >
            <PieChart className="h-3.5 w-3.5" />
          </ViewButton>
        </div>
      </div>
      <div className={bodyClassName}>{view === "pie" ? pie : list}</div>
    </>
  );
}

function ViewButton({
  active,
  label,
  onClick,
  children,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-pressed={active}
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "h-6 w-6 rounded p-0 shadow-none",
        active
          ? "bg-court-brand-tint text-court-brand-dark hover:bg-court-brand-tint"
          : "text-court-fg-muted hover:bg-court-surface-subtle hover:text-court-fg",
      )}
    >
      {children}
    </Button>
  );
}
