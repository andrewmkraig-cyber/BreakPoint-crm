// Compact revenue-progress tile. Same surface chrome as KpiTile so the
// pair below Billing Tower reads as part of the dashboard's tile grid.
// Values + currency are pre-formatted server-side; the component is a
// dumb render of label, big number, goal subline, and a horizontal
// progress bar tinted brand-green.
export function RevenueGoalTile({
  label,
  valueLabel,
  goalLabel,
  pct,
}: {
  label: string;
  valueLabel: string;
  goalLabel: string;
  pct: number;
}) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div className="flex flex-col rounded-2xl bg-court-surface px-3 py-2.5 shadow-[0_1px_2px_rgba(16,36,24,0.04),0_8px_20px_rgba(16,36,24,0.03)]">
      <div className="text-[10px] font-extrabold uppercase tracking-[0.1em] text-court-fg-muted">
        {label}
      </div>
      <div className="mt-1 font-serif text-[26px] font-semibold leading-none tracking-[-0.04em] tabular-nums text-court-fg">
        {valueLabel}
      </div>
      <div className="mt-1 text-[11px] text-court-fg-muted">{goalLabel}</div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-court-surface-subtle">
        <div
          className="h-full rounded-full bg-court-brand transition-[width]"
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}
