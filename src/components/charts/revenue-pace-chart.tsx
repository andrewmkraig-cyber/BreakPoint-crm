"use client";

import { useRef, useState } from "react";
import { formatMoneyShort } from "@/lib/placements-map-geo";

// Cumulative revenue across the quarter against a straight run to goal,
// with the forecast close dashed on past today. Plain SVG, Court tokens.
//
// Series (dataviz emphasis form: one hue for the subject, gray for context):
//   Actual   - solid brand line, cumulative billed revenue by day
//   Forecast - dashed brand line from today to the projected close
//   Goal     - dashed muted line, $0 at day 1 to the goal on the last day
// One y axis (dollars), x is the quarter's days with month ticks. A
// crosshair + tooltip follows the pointer; a legend names every line and
// the three end labels carry the closing values.

export type RevenuePaceChartProps = {
  quarterLabel: string;
  daysInQuarter: number;
  // Days elapsed including today (1..daysInQuarter).
  daysElapsed: number;
  // Cumulative revenue at the end of each elapsed day; length = daysElapsed.
  cumulative: number[];
  goalUsd: number;
  forecastUsd: number;
  // Day index (0-based) where each month of the quarter starts, with label.
  monthTicks: Array<{ day: number; label: string }>;
};

const W = 360;
const H = 170;
const PAD = { top: 12, right: 92, bottom: 24, left: 44 };
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;

export function RevenuePaceChart({
  quarterLabel,
  daysInQuarter,
  daysElapsed,
  cumulative,
  goalUsd,
  forecastUsd,
  monthTicks,
}: RevenuePaceChartProps) {
  const [hoverDay, setHoverDay] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const actualNow = cumulative[cumulative.length - 1] ?? 0;
  const yMax = Math.max(goalUsd, forecastUsd, actualNow, 1) * 1.05;
  const lastDay = Math.max(1, daysInQuarter - 1);
  const x = (day: number) => PAD.left + (Math.min(day, lastDay) / lastDay) * PLOT_W;
  const y = (usd: number) => PAD.top + PLOT_H - (Math.max(0, usd) / yMax) * PLOT_H;

  const actualPath = cumulative
    .map((v, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`)
    .join(" ");
  const todayIndex = Math.max(0, daysElapsed - 1);
  const forecastPath = `M ${x(todayIndex).toFixed(1)} ${y(actualNow).toFixed(1)} L ${x(lastDay).toFixed(1)} ${y(forecastUsd).toFixed(1)}`;
  const goalPath = `M ${x(0).toFixed(1)} ${y(0).toFixed(1)} L ${x(lastDay).toFixed(1)} ${y(goalUsd).toFixed(1)}`;

  // Value of each line at a given day, for the tooltip.
  const paceAt = (day: number) => (goalUsd * day) / lastDay;
  const forecastAt = (day: number) =>
    day <= todayIndex
      ? null
      : actualNow + ((forecastUsd - actualNow) * (day - todayIndex)) / Math.max(1, lastDay - todayIndex);
  const actualAt = (day: number) => (day < cumulative.length ? cumulative[day] : null);

  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const day = Math.round(((px - PAD.left) / PLOT_W) * lastDay);
    setHoverDay(Math.max(0, Math.min(lastDay, day)));
  }

  const brand = "rgb(var(--court-brand))";
  const muted = "rgb(var(--court-fg-muted))";
  const ink = "rgb(var(--court-fg))";
  const grid = "rgb(var(--court-border) / 0.6)";

  // Y ticks: $0, goal, and the top when the forecast overshoots.
  const yTicks = Array.from(new Set([0, goalUsd, ...(forecastUsd > goalUsd * 1.08 ? [forecastUsd] : [])]));

  // End labels, nudged apart when two lines finish close together.
  const ends = [
    { key: "goal", usd: goalUsd, label: `Goal ${formatMoneyShort(goalUsd)}`, color: muted },
    { key: "forecast", usd: forecastUsd, label: `Forecast ${formatMoneyShort(forecastUsd)}`, color: brand },
  ]
    .sort((a, b) => b.usd - a.usd)
    .map((e) => ({ ...e, yPos: y(e.usd) }));
  for (let i = 1; i < ends.length; i++) {
    if (ends[i].yPos - ends[i - 1].yPos < 12) ends[i].yPos = ends[i - 1].yPos + 12;
  }

  const hover =
    hoverDay != null
      ? {
          day: hoverDay,
          actual: actualAt(hoverDay),
          pace: paceAt(hoverDay),
          forecast: forecastAt(hoverDay),
        }
      : null;
  const hoverMonth = (day: number) => {
    let label = monthTicks[0]?.label ?? "";
    let dayInMonth = day + 1;
    for (const t of monthTicks) {
      if (day >= t.day) {
        label = t.label;
        dayInMonth = day - t.day + 1;
      }
    }
    return `${label} ${dayInMonth}`;
  };

  return (
    <div className="mt-4">
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-court-fg-muted">
        Pace to goal · {quarterLabel}
      </p>
      <div className="relative mt-1.5">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full"
          role="img"
          aria-label={`Cumulative revenue for ${quarterLabel}: ${formatMoneyShort(actualNow)} so far against a ${formatMoneyShort(goalUsd)} goal, forecast ${formatMoneyShort(forecastUsd)}`}
          onPointerMove={onPointerMove}
          onPointerLeave={() => setHoverDay(null)}
        >
          {/* Gridlines + y labels */}
          {yTicks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={PAD.left + PLOT_W} y1={y(t)} y2={y(t)} stroke={grid} strokeWidth={1} />
              <text x={PAD.left - 6} y={y(t) + 3.5} textAnchor="end" fontSize={9} fill={muted}>
                {formatMoneyShort(t)}
              </text>
            </g>
          ))}
          {/* Month ticks */}
          {monthTicks.map((t) => (
            <g key={t.label}>
              <line x1={x(t.day)} x2={x(t.day)} y1={PAD.top + PLOT_H} y2={PAD.top + PLOT_H + 4} stroke={muted} strokeWidth={1} />
              <text x={x(t.day)} y={H - 8} textAnchor="start" fontSize={9} fontWeight={600} fill={muted}>
                {t.label.toUpperCase()}
              </text>
            </g>
          ))}
          {/* Goal pace */}
          <path d={goalPath} fill="none" stroke={muted} strokeWidth={2} strokeDasharray="4 4" strokeLinecap="round" />
          {/* Forecast */}
          {daysElapsed < daysInQuarter && (
            <path d={forecastPath} fill="none" stroke={brand} strokeWidth={2} strokeDasharray="2 4" strokeLinecap="round" />
          )}
          {/* Actual */}
          <path d={actualPath} fill="none" stroke={brand} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          <circle cx={x(todayIndex)} cy={y(actualNow)} r={4} fill={brand} stroke="rgb(var(--court-surface))" strokeWidth={2} />
          {/* End labels */}
          {ends.map((e) => (
            <text key={e.key} x={PAD.left + PLOT_W + 6} y={e.yPos + 3.5} fontSize={9} fontWeight={600} fill={ink}>
              {e.label}
            </text>
          ))}
          {/* Crosshair */}
          {hover && (
            <g>
              <line x1={x(hover.day)} x2={x(hover.day)} y1={PAD.top} y2={PAD.top + PLOT_H} stroke={muted} strokeWidth={1} strokeDasharray="2 2" />
              {hover.actual != null && (
                <circle cx={x(hover.day)} cy={y(hover.actual)} r={3.5} fill={brand} stroke="rgb(var(--court-surface))" strokeWidth={2} />
              )}
            </g>
          )}
          {/* Hit area */}
          <rect x={PAD.left} y={PAD.top} width={PLOT_W} height={PLOT_H} fill="transparent" />
        </svg>
        {hover && (
          <div
            role="tooltip"
            className="pointer-events-none absolute top-0 z-10 rounded-md border border-court-border bg-court-surface px-2 py-1 text-[11px] shadow-md"
            style={{
              left: `${(x(hover.day) / W) * 100}%`,
              transform: x(hover.day) > W * 0.6 ? "translateX(calc(-100% - 8px))" : "translateX(8px)",
            }}
          >
            <div className="font-semibold text-court-fg">{hoverMonth(hover.day)}</div>
            {hover.actual != null && (
              <div className="tabular-nums text-court-fg">
                <span className="mr-1.5 inline-block h-0.5 w-3 align-middle" style={{ background: brand }} />
                {formatMoneyShort(hover.actual)} <span className="text-court-fg-muted">actual</span>
              </div>
            )}
            {hover.forecast != null && (
              <div className="tabular-nums text-court-fg">
                <span className="mr-1.5 inline-block h-0.5 w-3 border-t-2 border-dotted align-middle" style={{ borderColor: brand }} />
                {formatMoneyShort(hover.forecast)} <span className="text-court-fg-muted">forecast</span>
              </div>
            )}
            <div className="tabular-nums text-court-fg">
              <span className="mr-1.5 inline-block h-0.5 w-3 border-t-2 border-dashed align-middle" style={{ borderColor: muted }} />
              {formatMoneyShort(hover.pace)} <span className="text-court-fg-muted">goal pace</span>
            </div>
          </div>
        )}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-court-fg-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4" style={{ background: brand }} /> Actual
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-4 border-t-2 border-dotted" style={{ borderColor: brand }} /> Forecast
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-4 border-t-2 border-dashed" style={{ borderColor: muted }} /> Goal pace
        </span>
      </div>
    </div>
  );
}
