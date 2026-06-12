"use client";

import { useState } from "react";
import {
  Building2,
  CalendarDays,
  DollarSign,
  FileSignature,
  Handshake,
  Send,
  type LucideIcon,
} from "lucide-react";

import { KpiTile } from "@/app/dashboard/kpi-tile";
import { KpiDetailDialog } from "@/app/dashboard/kpi-detail-dialog";
import type { TimeRangeSelection } from "@/lib/time-range";

// The six Clubhouse activity-strip counters, in render order. Each tile
// is clickable and opens the KPI drill-down popup for its category at the
// dashboard's current period. Counts are computed server-side in
// my-dashboard.tsx and passed in; this client wrapper only adds the
// click-to-drill-down behavior (the shared KpiTile stays presentational
// so the Finances / Metrics surfaces that reuse it are unaffected).
export type ClubhouseCounts = {
  new_clients: number;
  agreements_signed: number;
  candidates_submitted: number;
  interviews_scheduled: number;
  offers_extended: number;
  placements_made: number;
};

type Category = keyof ClubhouseCounts;

const TILES: ReadonlyArray<{ category: Category; label: string; icon: LucideIcon }> = [
  { category: "new_clients", label: "New Clients", icon: Building2 },
  { category: "agreements_signed", label: "Agreements Signed", icon: FileSignature },
  { category: "candidates_submitted", label: "Candidates Submitted", icon: Send },
  { category: "interviews_scheduled", label: "Interviews Scheduled", icon: CalendarDays },
  { category: "offers_extended", label: "Offers Extended", icon: DollarSign },
  { category: "placements_made", label: "Placements Made", icon: Handshake },
];

export function ClubhouseKpiGrid({
  counts,
  selection,
}: {
  counts: ClubhouseCounts;
  selection: TimeRangeSelection;
}) {
  const [open, setOpen] = useState<{ category: Category; label: string } | null>(null);

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-6">
        {TILES.map((t) => {
          const value = counts[t.category];
          return (
            <div
              key={t.category}
              role="button"
              tabIndex={0}
              aria-label={`${t.label} details`}
              onClick={() => setOpen({ category: t.category, label: t.label })}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setOpen({ category: t.category, label: t.label });
                }
              }}
              className="cursor-pointer rounded-2xl transition hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-court-brand/40 hover:ring-2 hover:ring-court-brand/30"
            >
              <KpiTile label={t.label} value={value} icon={t.icon} live={value > 0} />
            </div>
          );
        })}
      </div>

      {open && (
        <KpiDetailDialog
          category={open.category}
          title={open.label}
          defaultSelection={selection}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
}
