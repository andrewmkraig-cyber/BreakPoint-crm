import { cn } from "@/lib/utils";

export function StageAgePill({ value }: { value: number | null }) {
  if (value == null) {
    return <span className="text-court-fg-muted">—</span>;
  }
  return (
    <span
      className={cn(
        "inline-flex min-w-8 items-center justify-center rounded-full px-2 py-0.5 text-xs font-semibold",
        value >= 14
          ? "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-200"
          : value >= 7
            ? "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-200"
            : "bg-court-surface-subtle text-court-fg-muted",
      )}
    >
      {value}d
    </span>
  );
}
