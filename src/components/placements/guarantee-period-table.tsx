"use client";

import { useEffect, useMemo, useState } from "react";
import { formatDate } from "@/lib/utils";

// Inputs the parent surface passes for each candidate guarantee-eligible row.
// Each surface (Placements tab + Pipeline Hired tab) does its own status /
// start-date / guarantee resolution upstream, then hands us a flat list. The
// component owns the live "days remaining" countdown and the at-0 row drop.
//
// `startDateIso` and `guaranteeEndIso` are pre-resolved ISO strings — the
// upstream caller decides whether `customGuaranteeDate` or
// `startDate + guaranteePeriod` wins, so the rules stay in one place.
export type GuaranteePeriodRow = {
  placementId: string;
  candidateName: string;
  clientName: string;
  roleTitle: string | null;
  startDateIso: string;
  guaranteeEndIso: string;
};

const MS_PER_DAY = 86_400_000;

export function GuaranteePeriodTable({
  rows,
  className,
}: {
  rows: GuaranteePeriodRow[];
  className?: string;
}) {
  // Recompute "days remaining" off a ticking `now` so the column counts down
  // without a page refresh. 24-hour interval per spec, plus an initial
  // schedule to next-midnight so a row sitting in a foregrounded tab flips
  // on the day boundary instead of 24h after first render.
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const nowMs = Date.now();
    const next = new Date(nowMs);
    next.setHours(24, 0, 0, 0);
    const msUntilMidnight = Math.max(60_000, next.getTime() - nowMs);
    const initial = setTimeout(() => {
      tick();
      // After the first boundary, keep ticking once per 24h.
    }, msUntilMidnight);
    const daily = setInterval(tick, MS_PER_DAY);
    return () => {
      clearTimeout(initial);
      clearInterval(daily);
    };
  }, []);

  // Compute days remaining + drop rows that have hit 0 / gone negative.
  // Math.ceil((end - now) / 86400000) per spec — a row whose end-date is
  // later today still reads "1 day"; only rows whose end has actually passed
  // are removed.
  const active = useMemo(() => {
    return rows
      .map((r) => {
        const endMs = new Date(r.guaranteeEndIso).getTime();
        if (!Number.isFinite(endMs)) return null;
        const daysRemaining = Math.ceil((endMs - now) / MS_PER_DAY);
        if (daysRemaining <= 0) return null;
        return { row: r, daysRemaining };
      })
      .filter(
        (x): x is { row: GuaranteePeriodRow; daysRemaining: number } =>
          x !== null,
      );
  }, [rows, now]);

  if (active.length === 0) return null;

  return (
    <div
      className={
        "rounded-3xl bg-court-surface shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_20px_rgba(0,0,0,0.08)] " +
        (className ?? "")
      }
    >
      <div className="px-4 pt-4">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-court-fg-muted">
          Candidates Still in Guarantee Period
        </p>
      </div>

      {/* pb-2 matches the visual bottom whitespace the placements ledger gets
          "for free" from its two-line rows (client name + industry sub-line).
          Guarantee rows are single-line, so without explicit bottom padding
          the last row's border-b sits right against the card edge. */}
      <div className="mt-2.5 overflow-x-auto px-4 pb-2">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-y border-court-border-soft text-left text-[10px] uppercase tracking-wide text-court-fg-muted">
              <th className="py-1.5 pr-3 font-semibold">Candidate</th>
              <th className="px-3 py-1.5 font-semibold">Client</th>
              <th className="px-3 py-1.5 font-semibold">Role</th>
              <th className="px-3 py-1.5 font-semibold">Start</th>
              <th className="px-3 py-1.5 font-semibold">Guarantee ends</th>
              <th className="py-1.5 pl-3 text-right font-semibold">
                Days remaining
              </th>
            </tr>
          </thead>
          <tbody>
            {active.map(({ row, daysRemaining }) => (
              <tr
                key={row.placementId}
                className="border-b border-court-border-soft"
              >
                {/* Row td padding bumped from py-1.5 to py-3 in Ace 67.20
                    so single-line guarantee rows match the ~38px row
                    height of the placements-ledger table next door (whose
                    rows pack two lines of content per Client cell: name +
                    industry sub-line at lines 310-313 of placements-
                    ledger.tsx). Header padding stays at py-1.5 so the
                    column-header strip still aligns visually between the
                    two tables. */}
                <td className="py-3 pr-3 align-middle font-medium text-court-fg">
                  {row.candidateName || "-"}
                </td>
                <td className="px-3 py-3 align-middle text-court-fg">
                  {row.clientName || "-"}
                </td>
                <td className="px-3 py-3 align-middle text-court-fg-muted">
                  {row.roleTitle ?? "-"}
                </td>
                <td className="px-3 py-3 align-middle tabular-nums text-court-fg-muted">
                  {formatDate(row.startDateIso)}
                </td>
                <td className="px-3 py-3 align-middle tabular-nums text-court-fg-muted">
                  {formatDate(row.guaranteeEndIso)}
                </td>
                <td className="py-3 pl-3 text-right align-middle tabular-nums font-semibold text-court-fg">
                  {daysRemaining}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// resolveGuaranteeEnd lives in ./guarantee-period-utils so the placements
// Server Component can invoke it during render. A "use client" module's
// exports become Client References on the server and aren't callable.
