import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// Shared table header styling for the recruiter-facing list views
// (Pipeline, Jobs, Candidates, Applicants, Clients). Centralized so the
// next round of tweaks lands in one file instead of five.
//
// The header is intentionally quieter than the data rows — muted
// foreground, soft border, light surface tint — so the eye stops on
// candidates/jobs/clients first and reads the column labels only when
// it needs to.
const HEAD_CLS =
  "border-b border-court-border-soft bg-court-surface-subtle/60 text-[11px] uppercase tracking-wide text-court-fg-muted";

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
  return (
    <th className={cn("px-5 py-4 font-semibold", alignCls, className)}>
      {children}
    </th>
  );
}
