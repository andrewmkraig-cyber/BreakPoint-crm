"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DataTableHead,
  DataTableHeaderCell,
  DataTableBody,
  DataTableRow,
} from "@/components/ui/data-table";
import {
  campaignStatusLabel,
  formatCount,
  formatRate,
  isActiveCampaignStatus,
  type CampaignMetrics,
} from "@/lib/instantly/metrics";
import { InstantlyEmptyState } from "@/app/campaigns/instantly-states";

export type CampaignRow = CampaignMetrics & { lastActivity: string | null };

// Campaign list. Shared DataTable primitives + the standard list-page
// panel chrome (overflow-hidden rounded-xl border bg-court-surface) that
// /clients and /jobs use. Sortable by reply count and reply rate, per
// spec; name and sent are sortable too since the header pattern is the
// same and it costs nothing.
//
// Read-only: a row click navigates to the detail view. There is no
// pause, edit, or send affordance anywhere on this table.

type SortKey = "name" | "leadsContacted" | "emailsSent" | "genuineReplies" | "replyRate" | "bounceRate";

export function CampaignTable({ campaigns }: { campaigns: CampaignRow[] }) {
  const router = useRouter();
  const [sortKey, setSortKey] = useState<SortKey>("genuineReplies");
  const [desc, setDesc] = useState(true);

  const sorted = useMemo(() => {
    const rows = [...campaigns];
    rows.sort((a, b) => {
      let cmp: number;
      if (sortKey === "name") {
        cmp = a.name.localeCompare(b.name);
      } else {
        // null rates sort last regardless of direction - a campaign that
        // contacted nobody has no rate, and floating it to the top on a
        // desc sort would be noise.
        const av = a[sortKey];
        const bv = b[sortKey];
        if (av === null && bv === null) cmp = 0;
        else if (av === null) return 1;
        else if (bv === null) return -1;
        else cmp = av - bv;
      }
      return desc ? -cmp : cmp;
    });
    return rows;
  }, [campaigns, sortKey, desc]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setDesc((d) => !d);
      return;
    }
    setSortKey(key);
    setDesc(true);
  }

  if (campaigns.length === 0) {
    return (
      <InstantlyEmptyState title="No campaigns yet">
        Campaigns created in Instantly will appear here automatically. Ace only
        reads them.
      </InstantlyEmptyState>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-court-border/40 bg-court-surface">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <DataTableHead>
            <tr>
              <SortableHeader label="Campaign" sortKey="name" active={sortKey} desc={desc} onSort={toggleSort} />
              <DataTableHeaderCell>Status</DataTableHeaderCell>
              <SortableHeader label="Contacted" sortKey="leadsContacted" align="right" active={sortKey} desc={desc} onSort={toggleSort} />
              <SortableHeader label="Sent" sortKey="emailsSent" align="right" active={sortKey} desc={desc} onSort={toggleSort} />
              <SortableHeader label="Replies" sortKey="genuineReplies" align="right" active={sortKey} desc={desc} onSort={toggleSort} />
              <SortableHeader label="Reply rate" sortKey="replyRate" align="right" active={sortKey} desc={desc} onSort={toggleSort} />
              <SortableHeader label="Bounce rate" sortKey="bounceRate" align="right" active={sortKey} desc={desc} onSort={toggleSort} />
              <DataTableHeaderCell align="right">Last activity</DataTableHeaderCell>
            </tr>
          </DataTableHead>
          <DataTableBody>
            {sorted.map((c) => (
              <DataTableRow
                key={c.campaignId}
                className="cursor-pointer"
                onClick={() => router.push(`/campaigns/${c.campaignId}`)}
              >
                <td className="px-3 py-2">
                  <div className="font-semibold text-court-fg">{c.name}</div>
                </td>
                <td className="px-3 py-2">
                  <StatusChip status={c.status} />
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-court-fg">{formatCount(c.leadsContacted)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-court-fg">{formatCount(c.emailsSent)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-court-fg">{formatCount(c.genuineReplies)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-court-fg">{formatRate(c.replyRate)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-court-fg">{formatRate(c.bounceRate)}</td>
                <td className="px-3 py-2 text-right text-xs text-court-fg-muted">
                  {formatLastActivity(c.lastActivity)}
                </td>
              </DataTableRow>
            ))}
          </DataTableBody>
        </table>
      </div>
    </div>
  );
}

function SortableHeader({
  label,
  sortKey,
  align = "left",
  active,
  desc,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  align?: "left" | "right";
  active: SortKey;
  desc: boolean;
  onSort: (k: SortKey) => void;
}) {
  const isActive = active === sortKey;
  return (
    <DataTableHeaderCell align={align}>
      {/* Shared Button (ghost) rather than a raw tag - these files are
          new and carry no raw-button grandfathering. */}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => onSort(sortKey)}
        aria-label={`Sort by ${label}`}
        className={cn(
          "!px-1 !py-0 text-[10px] font-semibold uppercase tracking-[0.18em] shadow-none",
          align === "right" ? "ml-auto" : "",
          isActive ? "text-court-fg" : "text-court-fg-muted",
        )}
      >
        {label}
        {isActive ? (
          desc ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />
        ) : null}
      </Button>
    </DataTableHeaderCell>
  );
}

function StatusChip({ status }: { status: number | null }) {
  const active = isActiveCampaignStatus(status);
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold",
        active
          ? "bg-court-brand-tint text-court-brand-dark"
          : "bg-court-surface-subtle text-court-fg-muted",
      )}
    >
      {campaignStatusLabel(status)}
    </span>
  );
}

function formatLastActivity(iso: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
