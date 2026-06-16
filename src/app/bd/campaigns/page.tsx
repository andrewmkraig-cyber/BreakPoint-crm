import { prisma } from "@/lib/prisma";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { dedupeDiscoveredByCompany } from "@/lib/bd/discovered-company";
import {
  getApolloSequenceByName,
  getApolloSequenceById,
  getDefaultApolloSequence,
} from "@/lib/bd/apollo-sequences";
import { formatBdDate } from "../date-format";

import { CampaignsList, type CampaignRowProps } from "./campaigns-list";

export const dynamic = "force-dynamic";

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
      // Active Campaigns shows only runs that became real enrolled
      // campaigns. APPROVED = user clicked Approve & Enroll; COMPLETE =
      // enrollment finished. Everything else (QUEUED / RUNNING / FAILED /
      // AWAITING_APPROVAL / DISMISSED) is pre-campaign or junk and is
      // surfaced elsewhere: AWAITING_APPROVAL lives in Today's Batch, and
      // history is read from BDActivity, not BDRun.status.
      status: { in: ["APPROVED", "COMPLETE"] },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      status: true,
      createdAt: true,
      approvedAt: true,
      discoveredCount: true,
      enrolledCount: true,
      discoveredPayload: true,
      plan: true,
      discoveryProvider: true,
      vertical: { select: { name: true } },
      savedSearch: { select: { name: true, criteria: true } },
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
    // The companies actually enrolled in this campaign are the single
    // most distinguishing thing a row carries — two org-wide cron runs
    // share every label fallback but enroll different companies. Dedupe
    // with the SAME helper the detail page and enroll extractor use so
    // the count here matches what the campaign actually pushed to Apollo.
    const companies = dedupeDiscoveredByCompany(run.discoveredPayload);
    const companyNames = companies.map((c) => c.companyName).filter(Boolean);
    // discoveredPayload can be empty on a legacy/partial run; fall back
    // to the stored counters so the row never reads "0 companies" for a
    // run that genuinely enrolled some.
    const companyCount =
      companyNames.length > 0
        ? companyNames.length
        : run.discoveredCount || run.enrolledCount || 0;
    // Sequence/label preference: plan snapshot (set at launch time) →
    // the real linked Campaign name → discovery-provider label as a last
    // resort (so cron-discovered rows don't all read "TheirStack
    // Discovery" by copy-paste).
    const planSequence =
      typeof plan?.sequenceName === "string" && plan.sequenceName.trim()
        ? plan.sequenceName.trim()
        : null;
    const campaignTitle = run.campaigns.find((c) => c.name?.trim())?.name?.trim() ?? null;
    const sequenceName =
      planSequence ?? campaignTitle ?? providerLabel(run.discoveryProvider);
    // Primary identity line: real saved-search name → real campaign name
    // → the enrolled companies themselves. Only when there is genuinely
    // nothing to show do we fall back to the generic discovery string.
    const campaignName =
      run.savedSearch?.name ??
      campaignTitle ??
      (companyNames.length > 0 ? null : "Org-wide BD discovery");
    return {
      runId: run.id,
      verticalName: run.vertical?.name ?? "Discovery",
      campaignName,
      companyCount,
      companyNames: companyNames.slice(0, 3),
      sequenceName,
      // approvedAt is when the user enrolled the campaign; createdAt is
      // discovery time. Prefer the enroll moment, fall back for legacy
      // rows approved before approvedAt was being stamped.
      startedLabel: formatBdDate(run.approvedAt ?? run.createdAt),
      // Real sequence length (Apollo step count) for the day-of counter.
      // Null only when no sequence can be resolved at all — the row then
      // hides the counter rather than showing a fabricated length.
      ...(() => {
        const sequenceDays = resolveSequenceSteps({
          planSequenceName: planSequence,
          campaignSequenceIds: run.campaigns.map((c) => c.apolloSequenceId),
          savedSearchSequenceName: sequenceNameFromCriteria(run.savedSearch?.criteria),
        });
        return {
          sequenceDays,
          dayNumber:
            sequenceDays != null
              ? computeDayNumber(run.approvedAt ?? run.createdAt, nowMs, sequenceDays)
              : null,
        };
      })(),
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

function computeDayNumber(startedAt: Date, nowMs: number, sequenceDays: number): number {
  const days = Math.floor((nowMs - startedAt.getTime()) / (24 * 60 * 60 * 1000));
  // Saturate at the real sequence length so a long-running BDRun never shows
  // "Day 99 of 5". (Note: the X is days-since-enrolled and the denominator is
  // the Apollo step count — Ace doesn't store per-step delays, so this is a
  // cycle-progress estimate, the same shape the old hardcoded "of 7" had.)
  return Math.min(sequenceDays, Math.max(1, days + 1));
}

// Reads the sequence NAME a saved search stores under criteria.apolloSequenceId
// (the dropdown persists the name string, not the Apollo id). Returns null when
// there is no usable string.
function sequenceNameFromCriteria(criteria: unknown): string | null {
  if (!criteria || typeof criteria !== "object") return null;
  const value = (criteria as Record<string, unknown>).apolloSequenceId;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

// Resolves a run's real Apollo sequence length (step count), preferring the
// most run-specific signal: the launch-time plan snapshot name, then any
// linked Campaign's real Apollo sequence id, then the saved search's mapped
// sequence name. Falls back to the org's default sequence — the enroll path
// defaults every run with no pinned sequence to it, so its step count is the
// run's true length today. Returns null only when NO sequence is configured at
// all, so the UI hides the counter instead of inventing a length. When a
// second sequence is added and runs can diverge, the explicit signals above
// the default fallback keep this honest.
function resolveSequenceSteps(args: {
  planSequenceName: string | null;
  campaignSequenceIds: string[];
  savedSearchSequenceName: string | null;
}): number | null {
  const byName = args.planSequenceName ?? args.savedSearchSequenceName;
  if (byName) {
    const seq = getApolloSequenceByName(byName);
    if (seq && seq.steps > 0) return seq.steps;
  }
  for (const id of args.campaignSequenceIds) {
    if (!id) continue;
    const seq = getApolloSequenceById(id);
    if (seq && seq.steps > 0) return seq.steps;
  }
  const fallback = getDefaultApolloSequence();
  return fallback && fallback.steps > 0 ? fallback.steps : null;
}
