"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { TabStrip } from "@/components/ui/tab-strip";
import { HeadlineStats } from "@/app/campaigns/headline-stats";
import { CampaignTable, type CampaignRow } from "@/app/campaigns/campaign-table";
import { RepliesView } from "@/app/campaigns/replies-view";
import { InstantlyErrorState } from "@/app/campaigns/instantly-states";
import type { InstantlyHeadline } from "@/lib/instantly/metrics";

// Campaigns - read-only Instantly monitoring.
//
// One sidebar tab, two panes behind the shared TabStrip (mandatory for
// grouped controls per the UI rules): Overview and Replies.
//
// Nothing on this surface creates, edits, pauses, sends, or replies. The
// only outbound action anywhere is the "Open in Instantly" link, which
// hands off to Instantly's own Unibox.

type Payload =
  | {
      ok: true;
      scope: CampaignScope;
      headline: InstantlyHeadline;
      campaigns: CampaignRow[];
      activeCount: number;
      totalCount: number;
      instantlyReplyCount: number;
      ownSenderCount: number;
    }
  | { ok: false; kind: string; message: string; hint: string };

type Pane = "overview" | "replies";

// Which campaigns the Overview describes. ONE piece of state - it drives
// the tiles and the table together, because they used to be filtered
// separately and disagreed (tiles 18 replies, table summing to 27).
// Default "all": a completed campaign's replies are still replies.
type CampaignScope = "all" | "active";

export function CampaignsView() {
  // A reply toast deep-links to /campaigns?tab=replies&reply=<id>, so
  // land on the right pane instead of Overview when that param is set.
  const searchParams = useSearchParams();
  const focusReplyId = searchParams?.get("reply") ?? undefined;
  const [pane, setPane] = useState<Pane>(
    searchParams?.get("tab") === "replies" || focusReplyId ? "replies" : "overview",
  );
  const [scope, setScope] = useState<CampaignScope>("all");
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/instantly/campaigns?scope=${scope}`);
        const json = (await res.json()) as Payload;
        if (!cancelled) setData(json);
      } catch (e) {
        if (!cancelled) {
          setData({
            ok: false,
            kind: "unavailable",
            message: e instanceof Error ? e.message : "Could not reach Ace's Instantly route.",
            hint: "Check your connection and reload.",
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [scope]);

  const campaignOptions =
    data?.ok === true
      ? data.campaigns.map((c) => ({ id: c.campaignId, name: c.name }))
      : [];

  return (
    <div className="space-y-4">
      <TabStrip<Pane>
        ariaLabel="Campaigns sections"
        items={[
          { id: "overview", label: "Overview" },
          { id: "replies", label: "Replies" },
        ]}
        activeId={pane}
        onChange={setPane}
      />

      {/* A failure on the campaigns fetch is shown on Overview, but must
          not block Replies - that pane loads independently and may well
          work when this one didn't. */}
      {pane === "overview" ? (
        loading ? (
          <OverviewSkeleton />
        ) : data && data.ok === false ? (
          <InstantlyErrorState kind={data.kind} message={data.message} hint={data.hint} />
        ) : data && data.ok === true ? (
          <div className="space-y-4">
            {/* Scope selector. Shared TabStrip, per the UI rules - and
                the single control behind both the tiles and the table. */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <TabStrip<CampaignScope>
                ariaLabel="Campaign scope"
                items={[
                  { id: "all", label: "All campaigns", count: data.totalCount },
                  { id: "active", label: "Active only", count: data.activeCount },
                ]}
                activeId={scope}
                onChange={setScope}
              />
            </div>
            <HeadlineStats
              headline={data.headline}
              scopeLabel={
                scope === "active"
                  ? `Across ${data.headline.campaignCount} active campaign${data.headline.campaignCount === 1 ? "" : "s"}`
                  : `Across all ${data.headline.campaignCount} campaign${data.headline.campaignCount === 1 ? "" : "s"}`
              }
              instantlyReplyCount={data.instantlyReplyCount}
            />
            <CampaignTable campaigns={data.campaigns} />
          </div>
        ) : null
      ) : (
        <RepliesView campaignOptions={campaignOptions} focusReplyId={focusReplyId} />
      )}
    </div>
  );
}

function OverviewSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-[84px] animate-pulse rounded-2xl bg-court-surface-subtle" />
        ))}
      </div>
      <div className="h-64 animate-pulse rounded-xl bg-court-surface-subtle" />
    </div>
  );
}
