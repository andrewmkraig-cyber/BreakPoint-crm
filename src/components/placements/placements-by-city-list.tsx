import {
  STATUS_LABELS,
  formatMoneyShort,
  type CityAggregate,
} from "@/lib/placements-map-geo";
import type { PlacementsDashboardBillingStatus } from "@/lib/placements-dashboard";

// City bar list. Lived inside placements-map-card.tsx until the
// breakdowns row reorganization moved it into the top-row combined
// card. Stays a server component — pure presentation, no Leaflet or
// other client-only deps — so the new combined card can render it
// directly from the placements tab tree.

const STATUS_ORDER: PlacementsDashboardBillingStatus[] = [
  "COLLECTED",
  "BILLED",
  "PENDING_START",
  "OVERDUE",
];

const STATUS_BAR_CLASSES: Record<PlacementsDashboardBillingStatus, string> = {
  COLLECTED: "bg-court-brand",
  BILLED: "bg-court-brand/50",
  PENDING_START: "bg-amber-300",
  OVERDUE: "bg-red-300",
};

export function PlacementsByCityList({
  cities,
  totalFee,
}: {
  cities: CityAggregate[];
  totalFee: number;
}) {
  if (cities.length === 0) {
    return (
      <p className="text-sm text-court-fg-muted">
        No placements with a city captured in this window.
      </p>
    );
  }
  return (
    <ul className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
      {cities.map((city) => (
        <CityRow key={city.key} city={city} totalFee={totalFee} />
      ))}
    </ul>
  );
}

function CityRow({
  city,
  totalFee,
}: {
  city: CityAggregate;
  totalFee: number;
}) {
  const pct = totalFee > 0 ? Math.round((city.totalFee / totalFee) * 100) : 0;
  return (
    <li className="flex flex-col gap-1 py-2">
      <div className="flex items-baseline justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-court-fg">
            {city.city}
          </p>
          <p className="truncate text-[11px] text-court-fg-muted">
            {city.leadClient ?? "—"}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-sm font-semibold tabular-nums text-court-fg">
            {city.totalFee > 0 ? formatMoneyShort(city.totalFee) : "—"}
          </p>
          <p className="text-[11px] tabular-nums text-court-fg-muted">{pct}%</p>
        </div>
      </div>
      <StatusBar statusMix={city.statusMix} count={city.count} />
    </li>
  );
}

function StatusBar({
  statusMix,
  count,
}: {
  statusMix: Record<PlacementsDashboardBillingStatus, number>;
  count: number;
}) {
  if (count <= 0) return null;
  return (
    <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-court-surface-subtle">
      {STATUS_ORDER.map((status) => {
        const v = statusMix[status];
        if (v <= 0) return null;
        const pct = (v / count) * 100;
        return (
          <div
            key={status}
            className={STATUS_BAR_CLASSES[status]}
            style={{ width: `${pct}%` }}
            title={`${STATUS_LABELS[status]}: ${v}`}
          />
        );
      })}
    </div>
  );
}
