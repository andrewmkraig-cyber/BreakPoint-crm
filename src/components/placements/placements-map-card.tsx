"use client";

import { useMemo, useState } from "react";

import {
  BREAKPOINT_HQ,
  MAP_VIEW_BOX,
  STATUS_COLORS,
  STATUS_LABELS,
  bubbleRadius,
  formatMoneyShort,
  projectLngLat,
  type CityAggregate,
} from "@/lib/placements-map-geo";
import type { PlacementsDashboardBillingStatus } from "@/lib/placements-dashboard";
import { UsMapShape } from "@/components/placements/us-map-shape";

const STATUS_ORDER: PlacementsDashboardBillingStatus[] = [
  "COLLECTED",
  "BILLED",
  "PENDING_START",
  "OVERDUE",
];

const BRAND_GREEN = "#5A9642";

type Props = {
  cities: CityAggregate[];
  totalFee: number;
};

export function PlacementsMapCard({ cities, totalFee }: Props) {
  const [hoverCity, setHoverCity] = useState<string | null>(null);

  const maxFee = useMemo(
    () => cities.reduce((max, c) => Math.max(max, c.totalFee), 0),
    [cities],
  );

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <div className="rounded-2xl border border-court-border bg-court-surface p-5 shadow-sm lg:col-span-2">
        <div className="flex items-baseline justify-between">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-court-fg-muted">
            Placement map
          </p>
          <p className="text-[11px] text-court-fg-muted">
            {cities.length === 0
              ? "No placement cities yet"
              : `${cities.length} ${cities.length === 1 ? "city" : "cities"}`}
          </p>
        </div>

        <div className="mt-3">
          <MapSvg
            cities={cities}
            maxFee={maxFee}
            hoverCity={hoverCity}
            onHover={setHoverCity}
          />
        </div>

        <Legend />
      </div>

      <div className="rounded-2xl border border-court-border bg-court-surface p-5 shadow-sm">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-court-fg-muted">
          By City
        </p>
        <h3 className="mt-1 font-serif text-lg font-extrabold tracking-tight text-court-fg">
          Where the billing comes from
        </h3>

        {cities.length === 0 ? (
          <p className="mt-4 text-sm text-court-fg-muted">
            No placements with a city captured in this window.
          </p>
        ) : (
          <ul className="mt-4 flex flex-col divide-y divide-court-border-soft">
            {cities.map((city) => (
              <CityRow
                key={city.key}
                city={city}
                totalFee={totalFee}
                isHovered={hoverCity === city.key}
                onHover={setHoverCity}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function MapSvg({
  cities,
  maxFee,
  hoverCity,
  onHover,
}: {
  cities: CityAggregate[];
  maxFee: number;
  hoverCity: string | null;
  onHover: (key: string | null) => void;
}) {
  const hqProjected = projectLngLat(BREAKPOINT_HQ.lng, BREAKPOINT_HQ.lat);

  return (
    <svg
      role="img"
      aria-label="US placement map"
      viewBox={`0 0 ${MAP_VIEW_BOX.w} ${MAP_VIEW_BOX.h}`}
      className="block h-auto w-full"
    >
      <UsMapShape />

      {/* HQ diamond pin */}
      <g
        transform={`translate(${hqProjected.x.toFixed(1)}, ${hqProjected.y.toFixed(1)})`}
        aria-hidden="true"
      >
        <rect
          x={-5}
          y={-5}
          width={10}
          height={10}
          transform="rotate(45)"
          fill="rgb(var(--court-fg))"
          stroke="rgb(var(--court-surface))"
          strokeWidth={1.5}
        />
        <text
          x={9}
          y={4}
          className="fill-court-fg-muted"
          style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.05em",
            textTransform: "uppercase",
          }}
        >
          BreakPoint HQ · Solon, OH
        </text>
      </g>

      {cities.map((city) => (
        <CityBubble
          key={city.key}
          city={city}
          maxFee={maxFee}
          isHovered={hoverCity === city.key}
          onHover={onHover}
        />
      ))}
    </svg>
  );
}

function CityBubble({
  city,
  maxFee,
  isHovered,
  onHover,
}: {
  city: CityAggregate;
  maxFee: number;
  isHovered: boolean;
  onHover: (key: string | null) => void;
}) {
  const r = bubbleRadius(city.totalFee, maxFee);
  const { x, y } = city.coords;

  return (
    <g
      transform={`translate(${x.toFixed(1)}, ${y.toFixed(1)})`}
      onMouseEnter={() => onHover(city.key)}
      onMouseLeave={() => onHover(null)}
      style={{ cursor: "pointer" }}
    >
      <StatusRing radius={r + 4} statusMix={city.statusMix} count={city.count} />

      {!city.isKnownCity ? (
        <PlusPin radius={r} />
      ) : (
        <circle
          r={r}
          fill={BRAND_GREEN}
          stroke="rgb(var(--court-surface))"
          strokeWidth={2}
          opacity={isHovered ? 1 : 0.92}
        />
      )}

      <text
        textAnchor="middle"
        dy={5}
        fill="white"
        style={{
          fontSize: Math.max(14, Math.min(20, r * 0.7)),
          fontWeight: 700,
          fontVariantNumeric: "tabular-nums",
          pointerEvents: "none",
        }}
      >
        {city.count}
      </text>

      <text
        textAnchor="middle"
        y={r + 22}
        className="fill-court-fg"
        style={{ fontSize: 12, fontWeight: 700, pointerEvents: "none" }}
      >
        {city.city}
      </text>
      <text
        textAnchor="middle"
        y={r + 36}
        className="fill-court-fg-muted"
        style={{
          fontSize: 11,
          fontVariantNumeric: "tabular-nums",
          pointerEvents: "none",
        }}
      >
        {city.totalFee > 0 ? formatMoneyShort(city.totalFee) : "—"}
      </text>

      {isHovered && (
        <circle
          r={r + 9}
          fill="none"
          stroke={BRAND_GREEN}
          strokeOpacity={0.35}
          strokeWidth={2}
        />
      )}
    </g>
  );
}

function PlusPin({ radius }: { radius: number }) {
  const r = radius;
  return (
    <g>
      <circle
        r={r}
        fill="rgb(var(--court-surface))"
        stroke={BRAND_GREEN}
        strokeWidth={2}
        strokeDasharray="3 3"
      />
      <line
        x1={-r * 0.45}
        y1={0}
        x2={r * 0.45}
        y2={0}
        stroke={BRAND_GREEN}
        strokeWidth={3}
        strokeLinecap="round"
      />
      <line
        x1={0}
        y1={-r * 0.45}
        x2={0}
        y2={r * 0.45}
        stroke={BRAND_GREEN}
        strokeWidth={3}
        strokeLinecap="round"
      />
    </g>
  );
}

function StatusRing({
  radius,
  statusMix,
  count,
}: {
  radius: number;
  statusMix: Record<PlacementsDashboardBillingStatus, number>;
  count: number;
}) {
  if (count <= 0) return null;
  const segments: { status: PlacementsDashboardBillingStatus; value: number }[] = [];
  for (const status of STATUS_ORDER) {
    const v = statusMix[status];
    if (v > 0) segments.push({ status, value: v });
  }
  if (segments.length === 0) return null;

  // Single segment: just draw a full ring — arc with start==end renders
  // nothing in SVG, so we substitute a plain circle.
  if (segments.length === 1) {
    return (
      <circle
        r={radius}
        cx={0}
        cy={0}
        fill="none"
        stroke={STATUS_COLORS[segments[0].status]}
        strokeWidth={4}
      />
    );
  }

  let start = -Math.PI / 2;
  const gapRad = 0.04;
  return (
    <g>
      {segments.map(({ status, value }, i) => {
        const sweep = (value / count) * Math.PI * 2;
        const a0 = start + gapRad / 2;
        const a1 = start + sweep - gapRad / 2;
        const x0 = Math.cos(a0) * radius;
        const y0 = Math.sin(a0) * radius;
        const x1 = Math.cos(a1) * radius;
        const y1 = Math.sin(a1) * radius;
        const largeArc = sweep > Math.PI ? 1 : 0;
        const d = `M${x0.toFixed(2)},${y0.toFixed(2)} A${radius},${radius} 0 ${largeArc} 1 ${x1.toFixed(
          2,
        )},${y1.toFixed(2)}`;
        start += sweep;
        return (
          <path
            key={`${status}-${i}`}
            d={d}
            fill="none"
            stroke={STATUS_COLORS[status]}
            strokeWidth={4}
            strokeLinecap="round"
          />
        );
      })}
    </g>
  );
}

function CityRow({
  city,
  totalFee,
  isHovered,
  onHover,
}: {
  city: CityAggregate;
  totalFee: number;
  isHovered: boolean;
  onHover: (key: string | null) => void;
}) {
  const pct = totalFee > 0 ? Math.round((city.totalFee / totalFee) * 100) : 0;
  return (
    <li
      onMouseEnter={() => onHover(city.key)}
      onMouseLeave={() => onHover(null)}
      className={
        "flex flex-col gap-1.5 py-2.5 transition " +
        (isHovered ? "bg-court-brand-tint/40" : "")
      }
    >
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
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-court-fg-muted">
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
