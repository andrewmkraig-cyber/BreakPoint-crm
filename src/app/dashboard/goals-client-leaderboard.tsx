"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import {
  DataTableBody,
  DataTableHead,
  DataTableRow,
  DataTableSortableHeaderCell,
} from "@/components/ui/data-table";
import { TabStrip } from "@/components/ui/tab-strip";

const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const DATE = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "numeric",
  year: "numeric",
});

// Serialized shape - Dates cross the server/client boundary as ISO strings.
export type ClientLeaderboardRowView = {
  clientId: string;
  slug: string;
  name: string;
  revenueCollected: number;
  revenueBilled: number;
  revenueEarned: number;
  placements: number;
  jobOrdersOpened: number;
  activeJobs: number;
  avgDealSize: number | null;
  feePct: number | null;
  lastPlacementIso: string | null;
};

type SortKey =
  | "name"
  | "revenueCollected"
  | "revenueBilled"
  | "placements"
  | "jobOrdersOpened"
  | "activeJobs"
  | "avgDealSize"
  | "feePct"
  | "lastPlacement";

const COLUMNS: Array<{
  key: SortKey;
  label: string;
  align: "left" | "right";
  numeric: boolean;
}> = [
  { key: "name", label: "Client", align: "left", numeric: false },
  { key: "revenueCollected", label: "Collected", align: "right", numeric: true },
  { key: "revenueBilled", label: "Billed", align: "right", numeric: true },
  { key: "placements", label: "Placements", align: "right", numeric: true },
  { key: "jobOrdersOpened", label: "Jobs Opened", align: "right", numeric: true },
  { key: "activeJobs", label: "Active Jobs", align: "right", numeric: true },
  { key: "avgDealSize", label: "Avg Deal", align: "right", numeric: true },
  { key: "feePct", label: "Fee %", align: "right", numeric: true },
  { key: "lastPlacement", label: "Last Placement", align: "right", numeric: true },
];

export type LeaderboardScope = "PERIOD" | "ALL_TIME";

export function GoalsClientLeaderboard({
  rows,
  scope,
  onScopeChange,
  periodLabel,
}: {
  rows: ClientLeaderboardRowView[];
  scope: LeaderboardScope;
  onScopeChange: (next: LeaderboardScope) => void;
  periodLabel: string;
}) {
  // Default sort is revenue collected, highest first - the server already
  // returns them that way, and this keeps the header state honest.
  const [sortKey, setSortKey] = useState<SortKey>("revenueCollected");
  const [desc, setDesc] = useState(true);

  const sorted = useMemo(() => {
    const value = (r: ClientLeaderboardRowView): number | string | null => {
      switch (sortKey) {
        case "name":
          return r.name.toLowerCase();
        case "lastPlacement":
          return r.lastPlacementIso ? Date.parse(r.lastPlacementIso) : null;
        default:
          return r[sortKey];
      }
    };
    return [...rows].sort((a, b) => {
      const av = value(a);
      const bv = value(b);
      // Nulls always sink, whichever direction the column is sorted -
      // "no data" is not a small number and should not lead the table.
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      if (typeof av === "string" || typeof bv === "string") {
        const cmp = String(av).localeCompare(String(bv));
        return desc ? -cmp : cmp;
      }
      return desc ? bv - av : av - bv;
    });
  }, [rows, sortKey, desc]);

  return (
    <section className="rounded-3xl bg-court-surface p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_32px_rgba(0,0,0,0.10)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-court-brand-dark">
            Clients
          </p>
          <h3 className="mt-1 font-serif text-base font-bold tracking-tight text-court-fg sm:text-lg">
            Client leaderboard
          </h3>
          <p className="mt-0.5 text-xs text-court-fg-muted">
            {scope === "ALL_TIME" ? "All time" : periodLabel} · clients with no
            activity in the window are omitted.
          </p>
        </div>
        <TabStrip<LeaderboardScope>
          items={[
            { id: "PERIOD", label: "This period" },
            { id: "ALL_TIME", label: "All time" },
          ]}
          activeId={scope}
          ariaLabel="Leaderboard scope"
          onChange={onScopeChange}
        />
      </div>

      {sorted.length === 0 ? (
        <p className="mt-4 text-[13px] text-court-fg-muted">
          No client activity in this window.
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[52rem] border-collapse text-left">
            <DataTableHead>
              <tr>
                {COLUMNS.map((c) => {
                  const active = sortKey === c.key;
                  return (
                    <DataTableSortableHeaderCell
                      key={c.key}
                      align={c.align}
                      active={active}
                      descending={desc}
                      onToggle={() => {
                        if (active) {
                          setDesc((d) => !d);
                        } else {
                          setSortKey(c.key);
                          // Numbers open descending (biggest first), names
                          // open ascending (A-Z).
                          setDesc(c.numeric);
                        }
                      }}
                    >
                      {c.label}
                    </DataTableSortableHeaderCell>
                  );
                })}
              </tr>
            </DataTableHead>
            <DataTableBody>
              {sorted.map((r) => (
                <DataTableRow key={r.clientId}>
                  {/* Ace 68.0: the client name is the ONE bold element in
                      the row. Every other cell is regular metadata weight
                      at a single metadata size. */}
                  <td className="px-3 py-2 align-middle">
                    <Link
                      href={`/clients/${r.slug}`}
                      className="text-[13px] font-semibold text-court-fg hover:text-court-brand"
                    >
                      {r.name}
                    </Link>
                  </td>
                  <Cell>{USD.format(Math.round(r.revenueCollected))}</Cell>
                  <Cell>{USD.format(Math.round(r.revenueBilled))}</Cell>
                  <Cell>{r.placements}</Cell>
                  <Cell>{r.jobOrdersOpened}</Cell>
                  <Cell>{r.activeJobs}</Cell>
                  {/* Null avg deal size means no placements, which is not
                      $0 - it renders as a dash. */}
                  <Cell>
                    {r.avgDealSize === null ? "—" : USD.format(Math.round(r.avgDealSize))}
                  </Cell>
                  <Cell>{r.feePct === null ? "—" : `${r.feePct}%`}</Cell>
                  <Cell>
                    {r.lastPlacementIso ? DATE.format(new Date(r.lastPlacementIso)) : "—"}
                  </Cell>
                </DataTableRow>
              ))}
            </DataTableBody>
          </table>
        </div>
      )}
    </section>
  );
}

function Cell({ children }: { children: React.ReactNode }) {
  return (
    <td className="px-3 py-2 text-right align-middle text-xs tabular-nums text-court-fg-muted">
      {children}
    </td>
  );
}
