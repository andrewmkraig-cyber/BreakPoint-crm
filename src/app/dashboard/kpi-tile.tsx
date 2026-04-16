import type { LucideIcon } from "lucide-react";

export function KpiTile({
  label,
  value,
  icon: Icon,
  hint,
}: {
  label: string;
  value: number | string;
  icon: LucideIcon;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-white p-5 shadow-sm transition hover:border-brand/40">
      <div className="flex items-center justify-between">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-tint text-brand-dark">
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <div className="mt-3 font-serif text-3xl font-semibold text-navy">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}
