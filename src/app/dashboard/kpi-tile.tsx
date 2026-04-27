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
    <div className="flex items-center gap-3 rounded-2xl border border-court-border bg-court-surface p-5 shadow-sm transition hover:border-court-accent/40">
      <div className="inline-flex shrink-0 rounded-xl bg-court-accent-tint p-2">
        <Icon className="h-5 w-5 text-court-accent" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-semibold uppercase tracking-widest text-court-fg-muted">{label}</div>
        <div className="font-stat text-4xl font-bold leading-tight text-court-fg">{value}</div>
      </div>
    </div>
  );
}
