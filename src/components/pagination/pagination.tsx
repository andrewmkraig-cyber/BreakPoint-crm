"use client";

import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { cn } from "@/lib/utils";

// Reusable pagination control. Drives prev / next / jump-to-page via a
// single onPageChange callback so the parent decides whether to update
// the URL, fire a server action, scroll to top, etc.
//
// Court Mode tokens only — disabled state uses opacity, hover lifts via
// court-fg/5 (matches the sidebar nav-item hover treatment so the
// pagination row reads as part of the same family).

export type PaginationProps = {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (next: number) => void;
  // True while the parent is loading data for a new page. Disables
  // controls + shows a small spinner so the user gets feedback.
  isLoading?: boolean;
  // Optional context noun, e.g. "candidates", "jobs". Defaults to "rows".
  itemLabel?: string;
  className?: string;
};

export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  isLoading = false,
  itemLabel = "rows",
  className,
}: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = total === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const end = Math.min(safePage * pageSize, total);

  function go(target: number) {
    const clamped = Math.min(Math.max(1, target), totalPages);
    if (clamped === safePage) return;
    onPageChange(clamped);
  }

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-between gap-3 rounded-xl border border-court-border bg-court-surface px-4 py-3 text-xs text-court-fg shadow-sm sm:flex-row",
        className,
      )}
    >
      <div className="flex items-center gap-2 text-court-fg-muted">
        {isLoading && <Loader2 className="h-3 w-3 animate-spin" />}
        <span>
          Page <span className="font-medium text-court-fg">{safePage}</span> of{" "}
          <span className="font-medium text-court-fg">{totalPages}</span>{" "}
          <span className="text-court-fg-muted">
            ({start.toLocaleString()}-{end.toLocaleString()} of {total.toLocaleString()} {itemLabel})
          </span>
        </span>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => go(safePage - 1)}
          disabled={safePage <= 1 || isLoading}
          aria-label="Previous page"
          className="inline-flex items-center gap-1 rounded-md border border-court-border bg-court-surface px-2 py-1 font-medium text-court-fg transition hover:bg-court-fg/5 disabled:opacity-50"
        >
          <ChevronLeft className="h-3.5 w-3.5" /> Previous
        </button>
        <JumpToPage
          totalPages={totalPages}
          isLoading={isLoading}
          onJump={(n) => go(n)}
        />
        <button
          type="button"
          onClick={() => go(safePage + 1)}
          disabled={safePage >= totalPages || isLoading}
          aria-label="Next page"
          className="inline-flex items-center gap-1 rounded-md border border-court-border bg-court-surface px-2 py-1 font-medium text-court-fg transition hover:bg-court-fg/5 disabled:opacity-50"
        >
          Next <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

// Tiny inline form so Enter triggers navigation. Out-of-range values
// clamp to [1, totalPages] silently (UX choice: no error toast for
// "type 999, get last page").
function JumpToPage({
  totalPages,
  isLoading,
  onJump,
}: {
  totalPages: number;
  isLoading: boolean;
  onJump: (n: number) => void;
}) {
  const [value, setValue] = useState("");

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 1) return;
    onJump(Math.min(parsed, totalPages));
    setValue("");
  }

  return (
    <form onSubmit={onSubmit} className="flex items-center gap-1">
      <label className="flex items-center gap-1 text-court-fg-muted">
        <span className="text-[10px] uppercase tracking-wider">Go to</span>
        <input
          // type=text + inputMode=numeric instead of type=number so
          // out-of-range values don't get rejected by HTML5 validation
          // before our onSubmit can clamp them. Spec wanted "type 999,
          // either clamps to the last page or shows a message" — we
          // clamp silently.
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={value}
          onChange={(e) => setValue(e.target.value.replace(/[^0-9]/g, ""))}
          disabled={isLoading}
          aria-label="Jump to page"
          className="w-14 rounded-md border border-court-border bg-court-surface px-2 py-1 text-center text-xs text-court-fg outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 disabled:opacity-50"
          placeholder="#"
        />
      </label>
    </form>
  );
}
