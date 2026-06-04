"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ChevronRight, Pause, X } from "lucide-react";

import { cn } from "@/lib/utils";

import { archiveBDRun } from "./actions";

const BOUNCE_RED_THRESHOLD = 0.08;
const SEQUENCE_DAYS = 7;

type EventTotals = {
  sent: number;
  opened: number;
  replied: number;
  bounced: number;
  unsub: number;
};

type DomainSlot = { name: string; status: string };

export type CampaignRowProps = {
  runId: string;
  verticalName: string;
  // Null when there is no saved-search / campaign name and the companies
  // themselves carry the identity — the row then leads with the company
  // line instead of a generic title.
  campaignName: string | null;
  companyCount: number;
  companyNames: ReadonlyArray<string>;
  sequenceName: string;
  startedLabel: string;
  dayNumber: number;
  totals: EventTotals;
  domains: ReadonlyArray<DomainSlot>;
};

export function CampaignsList({ rows }: { rows: ReadonlyArray<CampaignRowProps> }) {
  const [items, setItems] = useState<ReadonlyArray<CampaignRowProps>>(rows);

  function handleDismissed(runId: string) {
    setItems((prev) => prev.filter((r) => r.runId !== runId));
  }

  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-court-border bg-court-surface-subtle p-10 text-center">
        <p className="text-sm font-semibold text-court-fg">No active campaigns.</p>
        <p className="mt-1 text-sm text-court-fg-muted">Launch one from Today&apos;s Launch.</p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-court-border rounded-2xl border border-court-border bg-court-surface shadow-sm">
      {items.map((row) => (
        <CampaignRow key={row.runId} {...row} onDismissed={handleDismissed} />
      ))}
    </div>
  );
}

function CampaignRow({
  runId,
  verticalName,
  campaignName,
  companyCount,
  companyNames,
  sequenceName,
  startedLabel,
  dayNumber,
  totals,
  domains,
  onDismissed,
}: CampaignRowProps & { onDismissed: (runId: string) => void }) {
  const openedPct = totals.sent === 0 ? 0 : totals.opened / totals.sent;
  const repliedPct = totals.sent === 0 ? 0 : totals.replied / totals.sent;
  const bouncedPct = totals.sent === 0 ? 0 : totals.bounced / totals.sent;
  // Apollo writes CampaignEvent rows asynchronously; a freshly enrolled
  // campaign legitimately shows all zeros until the first webhook lands.
  // Flag it so an all-zero metrics row reads as "pending" rather than
  // broken — we do NOT fabricate any counts.
  const hasActivity =
    totals.sent + totals.opened + totals.replied + totals.bounced + totals.unsub > 0;
  // "Acme, Globex, Initech" — the companies enrolled are what actually
  // tells two org-wide campaigns apart; the count caps the visible names.
  const companyLabel =
    companyNames.length > 0
      ? companyNames.join(", ") +
        (companyCount > companyNames.length ? ` +${companyCount - companyNames.length}` : "")
      : null;
  // Lead line: explicit name when we have one, otherwise the company
  // summary, otherwise a neutral fallback so the row is never blank.
  const title =
    campaignName ??
    (companyCount > 0 ? `${companyCount} ${companyCount === 1 ? "company" : "companies"}` : "Campaign");

  return (
    <div className="group relative flex items-center gap-4 p-5 transition-colors hover:bg-court-surface-subtle">
      <Link
        href={`/bd/campaigns/${runId}`}
        className="absolute inset-0"
        aria-label={`Open ${title}`}
      />
      <div className="relative z-10 min-w-0 flex-1 pointer-events-none">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center rounded-md bg-court-surface-subtle px-2 py-0.5 text-[11px] font-medium text-court-fg-muted">
            {verticalName}
          </span>
          <span className="text-[11px] font-semibold uppercase tracking-wide text-court-fg-dim">
            Day {dayNumber} of {SEQUENCE_DAYS}
          </span>
        </div>
        <p className="mt-1 truncate text-sm font-semibold text-court-fg">{title}</p>
        {companyLabel ? (
          <p className="mt-0.5 truncate text-xs font-medium text-court-fg">{companyLabel}</p>
        ) : null}
        <p className="mt-0.5 truncate text-xs text-court-fg-muted">
          Enrolled {startedLabel} · Sequence {sequenceName}
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
          {hasActivity ? null : (
            <span className="text-[11px] italic text-court-fg-dim">
              awaiting Apollo activity
            </span>
          )}
        </div>
      </div>

      <div className="relative z-10 flex items-center gap-3">
        <DomainDots slots={domains} />
        <span
          title="Pause/resume ships in Phase 4"
          className="inline-flex h-8 w-8 cursor-not-allowed items-center justify-center rounded-md border border-court-border bg-court-surface text-court-fg-muted opacity-60"
          aria-label="Pause campaign"
        >
          <Pause className="h-3.5 w-3.5" />
        </span>
        <ArchiveButton runId={runId} onDismissed={onDismissed} />
        <ChevronRight className="h-4 w-4 text-court-fg-dim transition-transform group-hover:translate-x-0.5" />
      </div>
    </div>
  );
}

function ArchiveButton({
  runId,
  onDismissed,
}: {
  runId: string;
  onDismissed: (runId: string) => void;
}) {
  const [pending, startTransition] = useTransition();

  function handleClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    // Optimistic remove — if the server action fails, restore via a
    // hard reload so the row reappears with the real status. This keeps
    // the happy path snappy without leaving phantom state on errors.
    onDismissed(runId);
    startTransition(async () => {
      const result = await archiveBDRun(runId);
      if (!result.ok) {
        console.error("[archiveBDRun] failed:", result.error);
        if (typeof window !== "undefined") window.location.reload();
      }
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      title="Archive campaign"
      aria-label="Archive campaign"
      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-transparent text-court-fg-muted transition-colors hover:border-court-border hover:bg-court-surface hover:text-court-fg disabled:opacity-50"
    >
      <X className="h-3.5 w-3.5" />
    </button>
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

function formatPct(p: number): string {
  if (!Number.isFinite(p) || p === 0) return "0%";
  return `${(p * 100).toFixed(p >= 0.1 ? 0 : 1)}%`;
}
