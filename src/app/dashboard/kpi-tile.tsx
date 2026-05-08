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
    <div className="flex flex-col gap-5 rounded-3xl bg-white p-8 shadow-[0_1px_2px_rgba(16,36,24,0.04),0_12px_32px_rgba(16,36,24,0.03)] dark:bg-court-surface">
      <div
        className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[#EFF5EB] text-[#1F6A3A] dark:bg-court-accent-tint dark:text-court-accent"
        aria-hidden
      >
        <Icon className="h-5 w-5" />
      </div>
      <div className="flex flex-col gap-2">
        <div className="text-[12px] font-semibold uppercase tracking-[0.18em] text-court-fg-muted">
          {label}
        </div>
        <div className="font-stat text-[56px] font-semibold leading-none tracking-[-0.06em] tabular-nums text-court-fg">
          {value}
        </div>
      </div>
    </div>
  );
}
