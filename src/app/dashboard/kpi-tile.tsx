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
    <div className="flex flex-col gap-3 rounded-2xl bg-court-surface p-4 shadow-[0_1px_2px_rgba(16,36,24,0.04),0_8px_20px_rgba(16,36,24,0.03)]">
      <div
        className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-[#EFF5EB] text-[#1F6A3A] dark:bg-court-accent-tint dark:text-court-accent"
        aria-hidden
      >
        <Icon className="h-4 w-4" />
      </div>
      <div className="flex flex-col gap-1">
        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-court-fg-muted">
          {label}
        </div>
        <div className="font-serif text-[28px] font-extrabold leading-none tracking-[-0.04em] tabular-nums text-court-fg">
          {value}
        </div>
      </div>
    </div>
  );
}
