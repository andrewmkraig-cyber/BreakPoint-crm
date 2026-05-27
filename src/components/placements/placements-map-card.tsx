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
// rest of the dashboard server-rendered. The per-city revenue rows that
// used to sit in their own card now live above the map inside this
// card so the geography (map) and the dollars (list) read as one
// surface.
const PlacementsLeafletMap = dynamic(
  () =>
    import("@/components/placements/placements-leaflet-map").then(
      (m) => m.PlacementsLeafletMap,
    ),
  {
    ssr: false,
    loading: () => (
      <div
        className="flex h-[380px] w-full items-center justify-center rounded-xl bg-court-surface-subtle text-[12px] text-court-fg-muted"
        aria-label="Loading placement map"
      >
        Loading map…
      </div>
    ),
  },
);

const STATUS_ORDER: PlacementsDashboardBillingStatus[] = [
  "COLLECTED",
  "PARTIALLY_PAID",
  "BILLED",
  "INVOICED",
  "INVOICE_DRAFT",
  "PENDING_START",
  "OVERDUE",
];

type Props = {
  cities: CityAggregate[];
  totalFee: number;
};

export function PlacementsMapCard({ cities, totalFee }: Props) {
  return (
    <div className="rounded-3xl bg-court-surface p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_20px_rgba(0,0,0,0.08)]">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-court-fg-muted">
            Placement Map
          </p>
          <p className="mt-0.5 text-xs text-court-fg-muted">
            Paid, billed, pending start, and overdue placements by location
          </p>
        </div>
        <p className="shrink-0 text-[11px] text-court-fg-muted">
          {cities.length === 0
            ? "No placement cities yet"
            : `${cities.length} ${cities.length === 1 ? "city" : "cities"}`}
        </p>
      </div>

      <RevenueByCity cities={cities} totalFee={totalFee} />

      {/* placements-map-tiles scopes a brightness/contrast filter to
          the OSM tile pane in Court Mode dark themes — keeps the
          bright white tiles from blowing out the dark surface while
          leaving the colored bubbles alone (see globals.css). */}
      <div className="placements-map-tiles mt-2.5">
        <PlacementsLeafletMap cities={cities} />
      </div>

      <Legend />
    </div>
  );
}

function RevenueByCity({
  cities,
  totalFee,
}: {
  cities: CityAggregate[];
  totalFee: number;
}) {
  if (cities.length === 0) return null;
  const maxFee = cities.reduce((m, c) => Math.max(m, c.totalFee), 0);
  return (
    <div className="mt-3 border-b border-court-border-soft pb-3">
      <p className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-court-fg-muted">
        Revenue by City
      </p>
      <ul className="mt-2 flex flex-col gap-1.5">
        {cities.map((city) => {
          const pct =
            totalFee > 0 ? Math.round((city.totalFee / totalFee) * 100) : 0;
          const barWidth =
            maxFee > 0 ? Math.round((city.totalFee / maxFee) * 100) : 0;
          return (
            <li key={city.key} className="flex flex-col gap-0.5">
              {/* City + numbers sit on one inline-flex row so the dollar
                  amount + percentage hug the right edge of the city
                  name instead of being pushed to the far side of the
                  card. */}
              <div className="inline-flex items-baseline gap-2 self-start">
                <span className="truncate text-sm text-court-fg">
                  {city.city}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-court-fg">
                  {city.totalFee > 0 ? formatMoneyShort(city.totalFee) : "—"}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-court-fg-muted">
                  {pct}%
                </span>
              </div>
              <div className="h-0.5 w-full max-w-[120px] overflow-hidden rounded-full bg-court-surface-subtle">
                <div
                  className="h-full rounded-full bg-court-brand"
                  style={{ width: `${barWidth}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Legend() {
  return (
    <div className="mt-2 flex items-center gap-3 text-xs text-court-fg-muted">
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
