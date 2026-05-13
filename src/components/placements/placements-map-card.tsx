"use client";

import dynamic from "next/dynamic";

import {
  STATUS_COLORS,
  STATUS_LABELS,
  formatMoneyShort,
  type CityAggregate,
} from "@/lib/placements-map-geo";
import type { PlacementsDashboardBillingStatus } from "@/lib/placements-dashboard";

// Leaflet touches `window` during module evaluation, so the map needs
// to load client-side only. Dynamic-import with ssr:false keeps the
// rest of the dashboard server-rendered.
const PlacementsLeafletMap = dynamic(
  () =>
    import("@/components/placements/placements-leaflet-map").then(
      (m) => m.PlacementsLeafletMap,
    ),
  {
    ssr: false,
    loading: () => (
      <div
        className="flex h-[440px] w-full items-center justify-center rounded-xl bg-court-surface-subtle text-[12px] text-court-fg-muted"
        aria-label="Loading placement map"
      >
        Loading map…
      </div>
    ),
  },
);

const STATUS_ORDER: PlacementsDashboardBillingStatus[] = [
  "COLLECTED",
  "BILLED",
  "PENDING_START",
  "OVERDUE",
];

type Props = {
  cities: CityAggregate[];
  totalFee: number;
};

export function PlacementsMapCard({ cities, totalFee }: Props) {
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
      <div className="rounded-2xl bg-court-surface p-4 shadow-[0_1px_2px_rgba(16,36,24,0.04),0_8px_20px_rgba(16,36,24,0.03)] lg:col-span-2">
        <div className="flex items-baseline justify-between">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-court-fg-muted">
            Placement map
          </p>
          <p className="text-[11px] text-court-fg-muted">
            {cities.length === 0
              ? "No placement cities yet"
              : `${cities.length} ${cities.length === 1 ? "city" : "cities"}`}
          </p>
        </div>

        {/* placements-map-tiles scopes a brightness/contrast filter to
            the OSM tile pane in Court Mode dark themes — keeps the
            bright white tiles from blowing out the dark surface while
            leaving the colored bubbles alone (see globals.css). */}
        <div className="placements-map-tiles mt-2.5">
          <PlacementsLeafletMap cities={cities} />
        </div>

        <Legend />
      </div>

      <div className="rounded-2xl bg-court-surface p-4 shadow-[0_1px_2px_rgba(16,36,24,0.04),0_8px_20px_rgba(16,36,24,0.03)]">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-court-fg-muted">
          By City
        </p>
        <h3 className="mt-0.5 font-serif text-base font-extrabold tracking-tight text-court-fg">
          Where the billing comes from
        </h3>

        {cities.length === 0 ? (
          <p className="mt-3 text-sm text-court-fg-muted">
            No placements with a city captured in this window.
          </p>
        ) : (
          <ul className="mt-2.5 flex flex-col divide-y divide-court-border-soft">
            {cities.map((city) => (
              <CityRow
                key={city.key}
                city={city}
                totalFee={totalFee}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
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
            style={{ width: `${pct}%`, backgroundColor: STATUS_COLORS[status] }}
            title={`${STATUS_LABELS[status]}: ${v}`}
          />
        );
      })}
    </div>
  );
}

function Legend() {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[11px] text-court-fg-muted">
      {STATUS_ORDER.map((status) => (
        <span key={status} className="inline-flex items-center gap-1.5">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: STATUS_COLORS[status] }}
          />
          {STATUS_LABELS[status]}
        </span>
      ))}
    </div>
  );
}
