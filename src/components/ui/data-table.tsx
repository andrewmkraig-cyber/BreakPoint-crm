import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

// Shared table styling for the recruiter-facing list views
// (Pipeline, Jobs, Candidates, Applicants, Clients). Centralized so the
// next round of tweaks lands in one file instead of five.
//
// Cell padding tightened 2026-05-27 (Ace 67.15) from px-4 py-3 to px-3
// py-2 so the Pipeline Hired tab + Jobs/Candidates/Applicants/Clients
// list rows all fit more columns on a 13" laptop without horizontal
// scroll. Body cells in pipeline-view.tsx got the same px-3 py-2 update
// so headers and rows stay vertically aligned; other list pages that
// hand-roll their own <td> classes can opt in by replacing px-4 py-3
// with px-3 py-2 there too (no regression today — the shared header is
// the only place this is enforced).
const HEAD_CLS = "bg-court-surface-subtle";
const HEAD_CELL_CLS =
  "whitespace-nowrap px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-court-fg-muted";
const BODY_CLS = "divide-y divide-court-border-soft";
const ROW_CLS = "transition-colors hover:bg-court-surface-subtle/60";

export function DataTableHead({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <thead className={cn(HEAD_CLS, className)}>{children}</thead>;
}

export function DataTableHeaderCell({
  children,
  align = "left",
  className,
}: {
  children?: ReactNode;
  align?: "left" | "center" | "right";
  className?: string;
}) {
  const alignCls =
    align === "right"
      ? "text-right"
      : align === "center"
        ? "text-center"
        : "text-left";
  return <th className={cn(HEAD_CELL_CLS, alignCls, className)}>{children}</th>;
}

export function DataTableBody({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <tbody className={cn(BODY_CLS, className)}>{children}</tbody>;
}

export function DataTableRow({
  children,
  className,
  ...rest
}: HTMLAttributes<HTMLTableRowElement> & { children: ReactNode }) {
  return (
    <tr className={cn(ROW_CLS, className)} {...rest}>
      {children}
    </tr>
  );
}

// Sortable column header. Lives here rather than in each table because the
// clickable header is a raw <button> by necessity - it has to inherit the
// header cell's own uppercase micro-type, and the shared <Button> variants
// are all real buttons with borders and padding. src/components/ui/ is
// where the raw-button gate allows that, and a sortable header is a shared
// table primitive in any case.
//
// Pure props, no hooks: the owning client component holds the sort state.
export function DataTableSortableHeaderCell({
  children,
  align = "left",
  active,
  descending,
  onToggle,
  className,
}: {
  children: ReactNode;
  align?: "left" | "center" | "right";
  active: boolean;
  descending: boolean;
  onToggle: () => void;
  className?: string;
}) {
  return (
    <DataTableHeaderCell align={align} className={className}>
      <button
        type="button"
        onClick={onToggle}
        aria-sort={active ? (descending ? "descending" : "ascending") : "none"}
        className={cn(
          "inline-flex items-center gap-1 uppercase tracking-[0.18em] transition-colors hover:text-court-fg",
          active && "text-court-fg",
        )}
      >
        {children}
        <span aria-hidden className="text-[9px] leading-none">
          {active ? (descending ? "\u25BC" : "\u25B2") : ""}
        </span>
      </button>
    </DataTableHeaderCell>
  );
}
