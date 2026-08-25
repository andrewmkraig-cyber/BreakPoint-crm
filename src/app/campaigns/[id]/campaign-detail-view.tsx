"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { HeadlineStats } from "@/app/campaigns/headline-stats";
import { DailyTrendChart } from "@/app/campaigns/daily-trend-chart";
import { RepliesView } from "@/app/campaigns/replies-view";
import { InstantlyErrorState } from "@/app/campaigns/instantly-states";
import { campaignStatusLabel, type InstantlyHeadline } from "@/lib/instantly/metrics";
import type { InstantlyDailyPoint } from "@/lib/instantly/types";

// Campaign detail - that campaign's metrics, its daily trend, and its
// replies. Read-only throughout; no pause/edit/send controls.

type Payload =
  | {
      ok: true;
      name: string | null;
      status: number | null;
      headline: InstantlyHeadline;
      daily: InstantlyDailyPoint[];
    }
  | { ok: false; kind: string; message: string; hint: string };

export function CampaignDetailView({ campaignId }: { campaignId: string }) {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/instantly/analytics?campaignId=${encodeURIComponent(campaignId)}`,
        );
        const json = (await res.json()) as Payload;
        if (!cancelled) setData(json);
      } catch (e) {
        if (!cancelled) {
          setData({
            ok: false,
            kind: "unavailable",
            message: e instanceof Error ? e.message : "Could not load this campaign.",
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
  }, [campaignId]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Link
          href="/campaigns"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-court-fg-muted transition hover:text-court-fg"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          All campaigns
        </Link>
      </div>

      {loading ? (
        <DetailBodySkeleton />
      ) : data && data.ok === false ? (
        <InstantlyErrorState kind={data.kind} message={data.message} hint={data.hint} />
      ) : data && data.ok === true ? (
        <>
          <div>
            <h1 className="font-serif text-2xl font-semibold leading-tight text-court-fg">
              {data.name ?? "Campaign"}
            </h1>
            <div className="mt-1 text-xs text-court-fg-muted">
              {campaignStatusLabel(data.status)}
            </div>
          </div>

          <HeadlineStats headline={data.headline} scope="all" />

          <section className="rounded-xl border border-court-border/40 bg-court-surface p-5">
            <h2 className="mb-3 text-sm font-semibold text-court-fg">Daily activity</h2>
            <DailyTrendChart daily={data.daily} />
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-court-fg">Replies</h2>
            <RepliesView
              campaignOptions={[]}
              initialCampaignId={campaignId}
              lockCampaign
            />
          </section>
        </>
      ) : null}
    </div>
  );
}

function DetailBodySkeleton() {
  return (
    <div className="space-y-4">
      <div className="h-8 w-64 animate-pulse rounded bg-court-surface-subtle" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-[84px] animate-pulse rounded-2xl bg-court-surface-subtle" />
        ))}
      </div>
      <div className="h-56 animate-pulse rounded-xl bg-court-surface-subtle" />
    </div>
  );
}
