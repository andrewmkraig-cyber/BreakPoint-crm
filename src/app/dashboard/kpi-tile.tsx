import type { LucideIcon } from "lucide-react";

export function KpiTile({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: number | string;
  icon: LucideIcon;
}) {
  return (
    // Compact KPI tile: smaller padding, inline icon + label header,
    // value centered below. h-full keeps every tile in the grid the
    // same height so the centered numbers all sit on one baseline.
    <div className="flex h-full flex-col rounded-2xl bg-court-surface px-3 py-2.5 shadow-[0_1px_2px_rgba(16,36,24,0.04),0_8px_20px_rgba(16,36,24,0.03)]">
      <div className="flex items-center gap-2">
        <div
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-[#EFF5EB] text-[#1F6A3A] dark:bg-court-accent-tint dark:text-court-accent"
          aria-hidden
        >
          <Icon className="h-3 w-3" />
        </div>
        <div className="min-w-0 flex-1 text-[10px] font-extrabold uppercase tracking-[0.1em] text-court-fg-muted">
          {label}
        </div>
      </div>
      <div className="mt-2 text-center font-serif text-[26px] font-semibold leading-none tracking-[-0.04em] tabular-nums text-court-fg">
        {value}
      </div>
    </div>
  );
}
