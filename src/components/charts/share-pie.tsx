"use client";

import { useState } from "react";
import { formatMoneyShort } from "@/lib/placements-map-geo";

// Part-to-whole donut for the Placements breakdown panels. Pairs with
// BreakdownViewSwitch, which flips a ranked list into this view.
//
// Rules this follows (dataviz skill):
// - At most six categorical slices; everything past that folds into one
//   "Other" slice so hues are assigned in fixed order and never cycled.
// - Colors are Court Mode tokens (--court-series-N / --court-ordinal-N),
//   validated per surface in globals.css. Text never wears a series color:
//   identity comes from the swatch beside the label.
// - Slices are separated by a 2px gap in the surface color, not a border.
// - Every slice is a hover + keyboard-focus hit target with a tooltip; the
//   legend beside the donut carries every value without hovering, and the
//   list view the switch toggles back to is the table view.

export type PieSlice = {
  key: string;
  label: string;
  value: number;
  // Optional secondary figure (placement count when value is money).
  count?: number;
};

export type PieValueKind = "money" | "count";
export type PieColorMode = "categorical" | "ordinal";

const CATEGORICAL_SLOTS = 6;
const ORDINAL_SLOTS = 4;

// SVG geometry. viewBox is 200x200; the ring is 32 units thick.
const SIZE = 200;
const CENTER = SIZE / 2;
const OUTER_R = 92;
const INNER_R = 60;

function fillFor(mode: PieColorMode, index: number): string {
  if (mode === "ordinal") {
    return `rgb(var(--court-ordinal-${Math.min(index + 1, ORDINAL_SLOTS)}))`;
  }
  return `rgb(var(--court-series-${Math.min(index + 1, CATEGORICAL_SLOTS)}))`;
}

function formatValue(kind: PieValueKind, value: number): string {
  if (kind === "money") return value > 0 ? formatMoneyShort(value) : "—";
  return String(Math.round(value));
}

function foldSlices(slices: PieSlice[], mode: PieColorMode): PieSlice[] {
  const positive = slices.filter((s) => Number.isFinite(s.value) && s.value > 0);
  if (mode === "ordinal") {
    // Ordinal buckets keep the caller's order (it IS the scale).
    return positive.slice(0, ORDINAL_SLOTS);
  }
  const sorted = [...positive].sort((a, b) => b.value - a.value);
  if (sorted.length <= CATEGORICAL_SLOTS) return sorted;
  const head = sorted.slice(0, CATEGORICAL_SLOTS - 1);
  const rest = sorted.slice(CATEGORICAL_SLOTS - 1);
  const hasCounts = rest.some((s) => s.count != null);
  return [
    ...head,
    {
      key: "__other",
      label: `Other (${rest.length})`,
      value: rest.reduce((s, r) => s + r.value, 0),
      count: hasCounts ? rest.reduce((s, r) => s + (r.count ?? 0), 0) : undefined,
    },
  ];
}

function polar(angle: number, radius: number): { x: number; y: number } {
  return { x: CENTER + radius * Math.cos(angle), y: CENTER + radius * Math.sin(angle) };
}

function arcPath(startAngle: number, endAngle: number): string {
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
  const o0 = polar(startAngle, OUTER_R);
  const o1 = polar(endAngle, OUTER_R);
  const i0 = polar(startAngle, INNER_R);
  const i1 = polar(endAngle, INNER_R);
  return [
    `M ${o0.x.toFixed(2)} ${o0.y.toFixed(2)}`,
    `A ${OUTER_R} ${OUTER_R} 0 ${largeArc} 1 ${o1.x.toFixed(2)} ${o1.y.toFixed(2)}`,
    `L ${i1.x.toFixed(2)} ${i1.y.toFixed(2)}`,
    `A ${INNER_R} ${INNER_R} 0 ${largeArc} 0 ${i0.x.toFixed(2)} ${i0.y.toFixed(2)}`,
    "Z",
  ].join(" ");
}

export function SharePie({
  slices,
  valueKind,
  colorMode = "categorical",
  ariaLabel,
  centerLabel = "Total",
}: {
  slices: PieSlice[];
  valueKind: PieValueKind;
  colorMode?: PieColorMode;
  ariaLabel: string;
  // Caption under the total in the donut's center.
  centerLabel?: string;
}) {
  const [active, setActive] = useState<string | null>(null);
  const folded = foldSlices(slices, colorMode);
  const total = folded.reduce((s, r) => s + r.value, 0);

  if (folded.length === 0 || total <= 0) {
    return <p className="text-sm text-court-fg-muted">Nothing to chart yet.</p>;
  }

  // Geometry per slice: start/end angles from 12 o'clock, plus the
  // centroid the tooltip anchors to (works the same for hover and focus).
  let cursor = -Math.PI / 2;
  const geo = folded.map((s, index) => {
    const fraction = s.value / total;
    const start = cursor;
    const end = cursor + fraction * Math.PI * 2;
    cursor = end;
    const mid = polar((start + end) / 2, (OUTER_R + INNER_R) / 2);
    return {
      slice: s,
      index,
      fraction,
      pct: Math.round(fraction * 100),
      start,
      end,
      midX: (mid.x / SIZE) * 100,
      midY: (mid.y / SIZE) * 100,
      fill: fillFor(colorMode, index),
    };
  });
  const activeGeo = active ? geo.find((g) => g.slice.key === active) ?? null : null;
  const single = geo.length === 1;

  return (
    // Stacked: the donut takes the top of the card at a readable size and
    // the legend runs full width beneath it, so a client name like "Mowat
    // Mackie & Anderson LLP" reads in full instead of truncating beside a
    // small ring.
    <div className="flex flex-col gap-4">
      <div className="relative mx-auto h-[200px] w-[200px] shrink-0">
        <svg
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          className="h-full w-full"
          role="group"
          aria-label={ariaLabel}
          onMouseLeave={() => setActive(null)}
        >
          {geo.map((g) =>
            single ? (
              <circle
                key={g.slice.key}
                cx={CENTER}
                cy={CENTER}
                r={(OUTER_R + INNER_R) / 2}
                fill="none"
                stroke={g.fill}
                strokeWidth={OUTER_R - INNER_R}
                role="img"
                tabIndex={0}
                aria-label={`${g.slice.label}: ${formatValue(valueKind, g.slice.value)}, 100%`}
                onMouseEnter={() => setActive(g.slice.key)}
                onFocus={() => setActive(g.slice.key)}
                onBlur={() => setActive(null)}
                className="outline-none"
              />
            ) : (
              <path
                key={g.slice.key}
                d={arcPath(g.start, g.end)}
                fill={g.fill}
                // 2px surface-colored gap between neighbors. Drawn as a
                // stroke because SVG has no gap primitive; visually it
                // is negative space, not a border.
                stroke="rgb(var(--court-surface))"
                strokeWidth={2}
                strokeLinejoin="round"
                role="img"
                tabIndex={0}
                aria-label={`${g.slice.label}: ${formatValue(valueKind, g.slice.value)}, ${g.pct}%`}
                onMouseEnter={() => setActive(g.slice.key)}
                onFocus={() => setActive(g.slice.key)}
                onBlur={() => setActive(null)}
                className="cursor-default outline-none transition-opacity"
                style={{ opacity: active && active !== g.slice.key ? 0.45 : 1 }}
              />
            ),
          )}
        </svg>
        {/* Hero number in the hole. */}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="font-sans text-2xl font-extrabold leading-none tracking-tight tabular-nums text-court-fg">
            {formatValue(valueKind, total)}
          </span>
          <span className="mt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-court-fg-muted">
            {centerLabel}
          </span>
        </div>
        {activeGeo && (
          <div
            role="tooltip"
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-[calc(100%+6px)] whitespace-nowrap rounded-md border border-court-border bg-court-surface px-2 py-1 text-[11px] shadow-md"
            style={{ left: `${activeGeo.midX}%`, top: `${activeGeo.midY}%` }}
          >
            <span className="font-semibold tabular-nums text-court-fg">
              {formatValue(valueKind, activeGeo.slice.value)}
            </span>
            <span className="text-court-fg-muted"> · {activeGeo.pct}%</span>
            <span className="text-court-fg-muted"> · {activeGeo.slice.label}</span>
            {activeGeo.slice.count != null && valueKind === "money" && (
              <span className="text-court-fg-muted">
                {" "}
                · {activeGeo.slice.count} placement{activeGeo.slice.count === 1 ? "" : "s"}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Legend: every slice, every value, no hover required. */}
      <ul className="flex w-full flex-col gap-1.5">
        {geo.map((g) => (
          <li
            key={g.slice.key}
            className="flex items-baseline justify-between gap-3 rounded px-1 text-[13px] transition-opacity"
            style={{ opacity: active && active !== g.slice.key ? 0.55 : 1 }}
            onMouseEnter={() => setActive(g.slice.key)}
            onMouseLeave={() => setActive(null)}
          >
            <span className="flex min-w-0 flex-1 items-start gap-2">
              <span
                aria-hidden="true"
                className="inline-block h-3 w-3 shrink-0 rounded-sm"
                style={{ backgroundColor: g.fill }}
              />
              <span className="min-w-0 font-medium leading-snug text-court-fg" title={g.slice.label}>
                {g.slice.label}
              </span>
            </span>
            <span className="shrink-0 tabular-nums text-court-fg-muted">
              {formatValue(valueKind, g.slice.value)} ·{" "}
              <span className="font-semibold text-court-fg">{g.pct}%</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
