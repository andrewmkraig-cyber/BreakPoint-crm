"use client";

import { Mail, X } from "lucide-react";
import { useMinimizedDrafts } from "@/lib/minimized-drafts-context";

// Bottom-left pill rail for minimized composer drafts. New pills stack
// to the right. Click the pill body → restore. Click the X → discard
// the entire draft. Court Mode tokens only — no hardcoded colors.
export function MinimizedTray() {
  const { drafts } = useMinimizedDrafts();
  if (drafts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed bottom-3 left-3 z-[120] flex max-w-[calc(100vw-1.5rem)] flex-wrap gap-2">
      {drafts.map((d) => (
        <div
          key={d.id}
          className="pointer-events-auto flex h-12 items-center gap-2 rounded-full border border-court-border bg-court-surface pl-4 pr-2 text-sm text-court-fg shadow-md transition hover:border-brand/40 hover:bg-court-surface-subtle"
        >
          <button
            type="button"
            onClick={d.onRestore}
            className="flex items-center gap-2"
            aria-label={`Restore draft: ${d.subject || "(no subject)"}`}
          >
            <Mail className="h-4 w-4 text-court-fg-muted" />
            <span className="max-w-[260px] truncate font-medium">
              {truncate(d.subject || "New Email", 30)}
            </span>
          </button>
          <button
            type="button"
            onClick={d.onDiscard}
            aria-label={`Discard draft: ${d.subject || "(no subject)"}`}
            className="rounded-full p-2 text-court-fg-muted transition hover:bg-court-fg/5 hover:text-court-fg"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  );
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + "…";
}
