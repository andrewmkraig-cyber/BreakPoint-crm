import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

// Shared table styling for the recruiter-facing list views
// (Pipeline, Jobs, Candidates, Applicants, Clients). Centralized so the
// next round of tweaks lands in one file instead of five.
const HEAD_CLS = "bg-court-surface-subtle";
const HEAD_CELL_CLS =
  "whitespace-nowrap px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-court-fg-muted";
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
