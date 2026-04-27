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
    <div className="flex items-center gap-3 rounded-xl border border-court-border bg-court-surface px-4 py-2.5 shadow-sm transition hover:border-court-accent/40">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-court-accent-tint text-court-accent-dark">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-court-fg-muted">{label}</div>
        <div className="font-stat text-4xl leading-tight text-court-fg">{value}</div>
      </div>
    </div>
  );
}
