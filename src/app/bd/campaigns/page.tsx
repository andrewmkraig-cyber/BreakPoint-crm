import { prisma } from "@/lib/prisma";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { formatBdDate } from "../date-format";

import { CampaignsList, type CampaignRowProps } from "./campaigns-list";

export const dynamic = "force-dynamic";

// Phase 2 hardcoded sequence length until Apollo sequence metadata
// flows into Ace. Day-of-cycle math saturates at SEQUENCE_DAYS so a
// long-running BDRun never shows "Day 99 of 7".
const SEQUENCE_DAYS = 7;

type EventKind = "OPEN" | "REPLY" | "BOUNCE" | "UNSUB" | "ENROLL";

// Maps the free-form discoveryProvider string to a human label so the
// row caption isn't bare "theirstack". Fallback titlecases the slug
// when we add a provider we haven't hand-labeled yet.
const PROVIDER_LABEL: Record<string, string> = {
  theirstack: "TheirStack Discovery",
  indeed: "Indeed Discovery",
  manual: "Manual Discovery",
};

function providerLabel(slug: string): string {
  const known = PROVIDER_LABEL[slug];
  if (known) return known;
  if (!slug) return "Discovery";
  return `${slug.charAt(0).toUpperCase()}${slug.slice(1)} Discovery`;
}

export default async function CampaignsPage() {
  const org = await getCurrentOrg();
  const nowMs = Date.now();

  const runs = await prisma.bDRun.findMany({
    where: {
      organizationId: org.id,
      // Archived rows tombstone-only: keep BDActivity history but pull
      // them out of Active Campaigns.
      status: { not: "DISMISSED" },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      status: true,
      createdAt: true,
      plan: true,
      discoveryProvider: true,
      vertical: { select: { name: true } },
      savedSearch: { select: { name: true } },
      campaigns: { select: { id: true, apolloSequenceId: true, name: true } },
    },
  });

  // One round-trip for event counts. groupBy keys on (campaignId, kind)
  // so we can fan results back out to per-run aggregates client-side.
  const campaignIds = runs.flatMap((r) => r.campaigns.map((c) => c.id));
  const eventCounts =
    campaignIds.length === 0
      ? []
      : await prisma.campaignEvent.groupBy({
          by: ["campaignId", "kind"],
          where: { organizationId: org.id, campaignId: { in: campaignIds } },
          _count: { _all: true },
        });

  const eventsByCampaign = new Map<string, Partial<Record<EventKind, number>>>();
  for (const row of eventCounts) {
    const bucket = eventsByCampaign.get(row.campaignId) ?? {};
    bucket[row.kind as EventKind] = row._count._all;
    eventsByCampaign.set(row.campaignId, bucket);
  }

  const domainRows = await prisma.sendingDomain.findMany({
    where: { organizationId: org.id },
    select: { domain: true, status: true },
  });
  const domainStatusByName = new Map(domainRows.map((d) => [d.domain, d.status]));

  const rows: CampaignRowProps[] = runs.map((run) => {
    const plan = (run.plan ?? null) as Record<string, unknown> | null;
    const planDomains: string[] = Array.isArray(plan?.domains)
      ? ((plan?.domains as unknown[]).filter((d): d is string => typeof d === "string") ?? [])
      : [];
    const totals = aggregateEvents(
      run.campaigns.map((c) => c.id),
      eventsByCampaign,
    );
    // Sequence name preference: plan snapshot (set at launch time) →
    // discovery-provider label (so cron-discovered rows don't all read
    // "BD Outbound v1" by copy-paste).
    const planSequence =
      typeof plan?.sequenceName === "string" && plan.sequenceName.trim()
        ? plan.sequenceName.trim()
        : null;
    const sequenceName = planSequence ?? providerLabel(run.discoveryProvider);
    return {
      runId: run.id,
      verticalName: run.vertical?.name ?? "Discovery",
      campaignName: run.savedSearch?.name ?? "Org-wide BD discovery",
      sequenceName,
      startedLabel: formatBdDate(run.createdAt),
      dayNumber: computeDayNumber(run.createdAt, nowMs),
      totals,
      domains: planDomains.slice(0, 5).map((name) => ({
        name,
        status: domainStatusByName.get(name) ?? "HEALTHY",
      })),
    };
  });

  return (
    <section className="flex flex-col gap-5">
      <header className="flex flex-col gap-2">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-court-brand-dark">
          Active Campaigns
        </p>
        <h1 className="font-serif text-2xl font-bold text-court-fg sm:text-3xl">
          Outbound in flight
        </h1>
        <p className="max-w-2xl text-sm text-court-fg-muted">
          One row per BD run. Counters update as Apollo writes opens, replies, and bounces back
          via webhook.
        </p>
      </header>

      <CampaignsList rows={rows} />
    </section>
  );
}

type EventTotals = {
  sent: number;
  opened: number;
  replied: number;
  bounced: number;
  unsub: number;
};

function aggregateEvents(
  campaignIds: string[],
  bucket: Map<string, Partial<Record<EventKind, number>>>,
): EventTotals {
  let sent = 0;
  let opened = 0;
  let replied = 0;
  let bounced = 0;
  let unsub = 0;
  for (const id of campaignIds) {
    const row = bucket.get(id);
    if (!row) continue;
    sent += row.ENROLL ?? 0;
    opened += row.OPEN ?? 0;
    replied += row.REPLY ?? 0;
    bounced += row.BOUNCE ?? 0;
    unsub += row.UNSUB ?? 0;
  }
  return { sent, opened, replied, bounced, unsub };
}

function computeDayNumber(startedAt: Date, nowMs: number): number {
  const days = Math.floor((nowMs - startedAt.getTime()) / (24 * 60 * 60 * 1000));
  return Math.min(SEQUENCE_DAYS, Math.max(1, days + 1));
}
