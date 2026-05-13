"use client";

import dynamic from "next/dynamic";

import {
  STATUS_COLORS,
  STATUS_LABELS,
  type CityAggregate,
} from "@/lib/placements-map-geo";
import type { PlacementsDashboardBillingStatus } from "@/lib/placements-dashboard";

// Leaflet touches `window` during module evaluation, so the map needs
// to load client-side only. Dynamic-import with ssr:false keeps the
// rest of the dashboard server-rendered. The per-city bar list that
// used to live in this file is now the "Revenue by City" compact card
// in placements-breakdowns.tsx; this component is map-only.
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
  "BILLED",
  "PENDING_START",
  "OVERDUE",
];

type Props = {
  cities: CityAggregate[];
};

export function PlacementsMapCard({ cities }: Props) {
  return (
    <div className="rounded-3xl bg-court-surface p-5 shadow-[0_1px_2px_rgba(16,36,24,0.04),0_12px_32px_rgba(16,36,24,0.04)]">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-court-fg-muted">
            Placement Map
          </p>
          <p className="mt-0.5 text-xs text-court-fg-muted">
            Collected, billed, pending start, and overdue placements by location
          </p>
        </div>
        <p className="shrink-0 text-[11px] text-court-fg-muted">
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
