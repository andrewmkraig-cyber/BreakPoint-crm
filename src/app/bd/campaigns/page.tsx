import Link from "next/link";
import { ChevronRight, Pause } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { cn } from "@/lib/utils";
import { formatBdDate } from "../date-format";

export const dynamic = "force-dynamic";

// Phase 2 hardcoded sequence length until Apollo sequence metadata
// flows into Ace. Day-of-cycle math saturates at SEQUENCE_DAYS so a
// long-running BDRun never shows "Day 99 of 7".
const SEQUENCE_DAYS = 7;
const BOUNCE_RED_THRESHOLD = 0.08;

type EventKind = "OPEN" | "REPLY" | "BOUNCE" | "UNSUB" | "ENROLL";

export default async function CampaignsPage() {
  const org = await getCurrentOrg();
  const nowMs = Date.now();

  const runs = await prisma.bDRun.findMany({
    where: { organizationId: org.id },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      status: true,
      createdAt: true,
      plan: true,
      vertical: { select: { name: true } },
      savedSearch: { select: { name: true } },
      campaigns: { select: { id: true, apolloSequenceId: true, name: true } },
    },
  });

  // One round-trip for event counts. groupBy keys on (campaignId, kind)
  // so we can fan results back out to per-run aggregates client-side.
  // Phase 2 has zero rows; this is wired so Apollo webhook writes light
  // it up without a follow-up DB shape change.
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

  // Current domain statuses keyed by name so each row can color its
  // 5-dot strip off the plan snapshot.
  const domainRows = await prisma.sendingDomain.findMany({
    where: { organizationId: org.id },
    select: { domain: true, status: true },
  });
  const domainStatusByName = new Map(domainRows.map((d) => [d.domain, d.status]));

  // Pre-shape every row into plain-string props so SignalRow / row
  // helpers never receive Date objects — eliminates any risk of locale
  // or timezone drift between SSR and the RSC payload.
  const rows = runs.map((run) => {
    const planDomains: string[] = Array.isArray((run.plan as { domains?: unknown } | null)?.domains)
      ? (((run.plan as { domains?: unknown }).domains as unknown[]).filter(
          (d): d is string => typeof d === "string",
        ) ?? [])
      : [];
    const totals = aggregateEvents(
      run.campaigns.map((c) => c.id),
      eventsByCampaign,
    );
    return {
      runId: run.id,
      verticalName: run.vertical.name,
      campaignName: run.savedSearch.name,
      sequenceName: run.campaigns[0]?.name ?? "BD Outbound v1",
      startedLabel: formatBdDate(run.createdAt),
      dayNumber: computeDayNumber(run.createdAt, nowMs),
      totals,
      planDomains,
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

      {rows.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="divide-y divide-court-border rounded-2xl border border-court-border bg-court-surface shadow-sm">
          {rows.map((row) => (
            <CampaignRow key={row.runId} {...row} />
          ))}
        </div>
      )}
    </section>
  );
}

function EmptyState() {
  return (
    <div className="rounded-2xl border border-dashed border-court-border bg-court-surface-subtle p-10 text-center">
      <p className="text-sm font-semibold text-court-fg">No active campaigns.</p>
      <p className="mt-1 text-sm text-court-fg-muted">Launch one from Today&apos;s Launch.</p>
    </div>
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

type DomainSlot = { name: string; status: string };

function CampaignRow({
  runId,
  verticalName,
  campaignName,
  sequenceName,
  startedLabel,
  dayNumber,
  totals,
  domains,
}: {
  runId: string;
  verticalName: string;
  campaignName: string;
  sequenceName: string;
  startedLabel: string;
  dayNumber: number;
  totals: EventTotals;
  domains: ReadonlyArray<DomainSlot>;
}) {
  const openedPct = totals.sent === 0 ? 0 : totals.opened / totals.sent;
  const repliedPct = totals.sent === 0 ? 0 : totals.replied / totals.sent;
  const bouncedPct = totals.sent === 0 ? 0 : totals.bounced / totals.sent;

  return (
    <Link
      href={`/bd/campaigns/${runId}`}
      className="group block p-5 transition-colors hover:bg-court-surface-subtle"
    >
      <div className="flex items-center gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center rounded-md bg-court-surface-subtle px-2 py-0.5 text-[11px] font-medium text-court-fg-muted">
              {verticalName}
            </span>
            <span className="text-[11px] font-semibold uppercase tracking-wide text-court-fg-dim">
              Day {dayNumber} of {SEQUENCE_DAYS}
            </span>
          </div>
          <p className="mt-1 truncate text-sm font-semibold text-court-fg">{campaignName}</p>
          <p className="mt-0.5 truncate text-xs text-court-fg-muted">
            Started {startedLabel} · Sequence {sequenceName}
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs">
            <Metric label="Sent" value={totals.sent.toString()} />
            <Metric
              label="Opened"
              value={`${totals.opened.toString()} · ${formatPct(openedPct)}`}
            />
            <Metric
              label="Replied"
              value={`${totals.replied.toString()} · ${formatPct(repliedPct)}`}
              accent="brand"
            />
            <Metric
              label="Bounced"
              value={`${totals.bounced.toString()} · ${formatPct(bouncedPct)}`}
              accent={bouncedPct > BOUNCE_RED_THRESHOLD ? "red" : undefined}
            />
            <Metric label="Unsub" value={totals.unsub.toString()} />
            <span className="text-court-fg-dim" aria-label="Sparkline placeholder">
              —
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <DomainDots slots={domains} />
          <span
            title="Pause/resume ships in Phase 4"
            className="inline-flex h-8 w-8 cursor-not-allowed items-center justify-center rounded-md border border-court-border bg-court-surface text-court-fg-muted opacity-60"
            aria-label="Pause campaign"
          >
            <Pause className="h-3.5 w-3.5" />
          </span>
          <ChevronRight className="h-4 w-4 text-court-fg-dim transition-transform group-hover:translate-x-0.5" />
        </div>
      </div>
    </Link>
  );
}

function Metric({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: "brand" | "red";
}) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="text-[11px] uppercase tracking-wide text-court-fg-dim">{label}</span>
      <span
        className={cn(
          "font-semibold tabular-nums",
          accent === "brand"
            ? "text-court-brand-dark"
            : accent === "red"
              ? "text-red-600 dark:text-red-300"
              : "text-court-fg",
        )}
      >
        {value}
      </span>
    </span>
  );
}

function DomainDots({ slots }: { slots: ReadonlyArray<DomainSlot> }) {
  const filled: ReadonlyArray<DomainSlot | null> = Array.from(
    { length: 5 },
    (_, i) => slots[i] ?? null,
  );
  return (
    <span className="inline-flex items-center gap-1" aria-label="Sending domain health">
      {filled.map((slot, i) => (
        <span
          key={i}
          title={slot ? `${slot.name} · ${slot.status}` : "unassigned slot"}
          className={cn(
            "inline-block h-2 w-2 rounded-full",
            slot
              ? slot.status === "COOLED"
                ? "bg-red-500"
                : slot.status === "WARMING"
                  ? "bg-court-brand/40"
                  : "bg-court-brand"
              : "border border-court-border bg-transparent",
          )}
        />
      ))}
    </span>
  );
}

function computeDayNumber(startedAt: Date, nowMs: number): number {
  const days = Math.floor((nowMs - startedAt.getTime()) / (24 * 60 * 60 * 1000));
  return Math.min(SEQUENCE_DAYS, Math.max(1, days + 1));
}

function formatPct(p: number): string {
  if (!Number.isFinite(p) || p === 0) return "0%";
  return `${(p * 100).toFixed(p >= 0.1 ? 0 : 1)}%`;
}
