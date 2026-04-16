import Link from "next/link";
import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight } from "lucide-react";

type PaginationProps = {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  buildHref: (page: number) => string;
  label?: string;
};

function pageWindow(current: number, total: number): Array<number | "…"> {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const out: Array<number | "…"> = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  if (start > 2) out.push("…");
  for (let i = start; i <= end; i++) out.push(i);
  if (end < total - 1) out.push("…");
  out.push(total);
  return out;
}

export function Pagination({ page, totalPages, total, pageSize, buildHref, label = "results" }: PaginationProps) {
  const safeTotalPages = Math.max(1, totalPages);
  const safePage = Math.min(Math.max(1, page), safeTotalPages);
  const from = total === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const to = Math.min(safePage * pageSize, total);

  return (
    <div className="flex flex-col gap-3 border-t border-border bg-white px-5 py-3 text-xs text-muted-foreground md:flex-row md:items-center md:justify-between">
      <div>
        {total === 0
          ? `No ${label}`
          : `Showing ${from.toLocaleString()}–${to.toLocaleString()} of ${total.toLocaleString()} ${label}`}
      </div>
      <nav className="flex items-center gap-1">
        <PageLink
          href={buildHref(Math.max(1, safePage - 1))}
          disabled={safePage <= 1}
          ariaLabel="Previous page"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Prev</span>
        </PageLink>
        {pageWindow(safePage, safeTotalPages).map((p, idx) =>
          p === "…" ? (
            <span key={`e-${idx}`} className="px-2 text-muted-foreground/60">
              …
            </span>
          ) : (
            <PageLink
              key={p}
              href={buildHref(p)}
              active={p === safePage}
              ariaLabel={`Page ${p}`}
            >
              {p}
            </PageLink>
          ),
        )}
        <PageLink
          href={buildHref(Math.min(safeTotalPages, safePage + 1))}
          disabled={safePage >= safeTotalPages}
          ariaLabel="Next page"
        >
          <span className="hidden sm:inline">Next</span>
          <ChevronRight className="h-3.5 w-3.5" />
        </PageLink>
      </nav>
    </div>
  );
}

function PageLink({
  href,
  children,
  active,
  disabled,
  ariaLabel,
}: {
  href: string;
  children: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const base = "inline-flex h-8 min-w-8 items-center justify-center gap-1 rounded-md border px-2 text-xs font-medium transition-colors";
  if (disabled) {
    return (
      <span
        aria-disabled
        className={cn(base, "border-border bg-muted/40 text-muted-foreground/50")}
      >
        {children}
      </span>
    );
  }
  if (active) {
    return (
      <span
        aria-current="page"
        aria-label={ariaLabel}
        className={cn(base, "border-brand bg-brand text-white shadow-sm")}
      >
        {children}
      </span>
    );
  }
  return (
    <Link
      aria-label={ariaLabel}
      href={href}
      className={cn(base, "border-border bg-white text-navy-400 hover:border-brand/40 hover:text-navy")}
    >
      {children}
    </Link>
  );
}
