"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Settings2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { ApprovalQueue } from "@/components/bd/approval-queue";
import type { PendingBDRun } from "./bd-run-actions";

export type VerticalOption = { id: string; name: string; slug: string };
export type SavedSearchOption = {
  id: string;
  verticalId: string;
  name: string;
  contactCap: number;
};
export type DomainPreview = { domain: string; status: string };
export type LastRun = {
  id: string;
  status:
    | "QUEUED"
    | "RUNNING"
    | "AWAITING_APPROVAL"
    | "APPROVED"
    | "ENROLLING"
    | "COMPLETE"
    | "FAILED"
    | "DISMISSED";
  createdAt: string;
  companies: number | null;
};

type Props = {
  verticals: VerticalOption[];
  savedSearches: SavedSearchOption[];
  domains: DomainPreview[];
  lastRun: LastRun | null;
  defaultContactCap: number;
  initialRuns: PendingBDRun[];
};

const ESTIMATED_CONTACTS_PER_COMPANY = 4;
const SEQUENCE_NAME_PLACEHOLDER = "BD Outbound v1";

export function LaunchView({
  verticals,
  savedSearches,
  domains,
  lastRun,
  defaultContactCap,
  initialRuns,
}: Props) {
  const [verticalId, setVerticalId] = useState<string | null>(verticals[0]?.id ?? null);
  const visibleSearches = useMemo(
    () => savedSearches.filter((s) => s.verticalId === verticalId),
    [savedSearches, verticalId],
  );
  const [savedSearchId, setSavedSearchId] = useState<string | null>(
    visibleSearches[0]?.id ?? null,
  );
  // Reset the search selection whenever the visible list changes due to
  // a vertical switch — the previously-selected id may now be invisible.
  const visibleIds = visibleSearches.map((s) => s.id).join(",");
  useMemoizedReset(visibleIds, () => setSavedSearchId(visibleSearches[0]?.id ?? null));

  const selectedSearch = visibleSearches.find((s) => s.id === savedSearchId) ?? null;
  const contactCap = selectedSearch?.contactCap ?? defaultContactCap;

  const noVerticals = verticals.length === 0;

  // Slot 1 - Vertical chip + Saved Search dropdown, seated directly under
  // the page heading by ApprovalQueue.
  const controls = noVerticals ? (
    <EmptyState message="No verticals configured yet. Add one in BD Settings (coming soon)." />
  ) : (
    <div className="flex flex-col gap-5">
      <div>
        <label className="block text-xs font-semibold uppercase tracking-wide text-court-fg-muted">
          Vertical
        </label>
        <div className="mt-2 inline-flex flex-wrap items-center gap-1.5 rounded-lg border border-court-border bg-court-surface-subtle p-1">
          {verticals.map((v) => {
            const active = v.id === verticalId;
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => setVerticalId(v.id)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors",
                  active
                    ? "bg-court-surface text-court-brand-dark shadow-sm"
                    : "text-court-fg-muted hover:bg-court-surface/70 hover:text-court-fg",
                )}
              >
                {v.name}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <label
          htmlFor="bd-saved-search"
          className="block text-xs font-semibold uppercase tracking-wide text-court-fg-muted"
        >
          Saved search
        </label>
        <select
          id="bd-saved-search"
          value={savedSearchId ?? ""}
          onChange={(e) => setSavedSearchId(e.target.value || null)}
          disabled={visibleSearches.length === 0}
          className="mt-2 block w-full max-w-md rounded-md border border-court-border bg-court-surface px-3 py-2 text-sm text-court-fg shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-court-brand/40 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {visibleSearches.length === 0 ? (
            <option value="">No saved searches for this vertical</option>
          ) : (
            <>
              <option value="">Select a saved search…</option>
              {visibleSearches.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </>
          )}
        </select>
      </div>
    </div>
  );

  // Top-right of the card - Last run pill + the page-local BD Settings
  // button. The shared top-row BD Settings is hidden on /bd/launch (see
  // bd/layout.tsx) so this is the only Settings entry on this page.
  const cardHeaderRight = (
    <>
      <LastRunChip lastRun={lastRun} />
      <Link
        href="/settings/bd"
        className="inline-flex items-center gap-1.5 rounded-md border border-court-border bg-court-surface px-2.5 py-1 text-[13px] font-medium text-court-fg-muted shadow-sm transition hover:bg-court-surface-subtle hover:text-court-fg"
      >
        <Settings2 className="h-3.5 w-3.5" />
        BD Settings
      </Link>
    </>
  );

  // Slot 2 - green run-summary line, below the table.
  const summary = noVerticals ? null : (
    <PreviewChip
      contactCap={contactCap}
      estimatedCompanies={Math.max(1, Math.round(contactCap / ESTIMATED_CONTACTS_PER_COMPANY))}
      sequenceName={SEQUENCE_NAME_PLACEHOLDER}
      domains={domains}
    />
  );

  return (
    <ApprovalQueue
      initialRuns={initialRuns}
      controls={controls}
      summary={summary}
      cardHeaderRight={cardHeaderRight}
    />
  );
}

function LastRunChip({ lastRun }: { lastRun: LastRun | null }) {
  if (!lastRun) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-court-border bg-court-surface-subtle px-2.5 py-1 text-[11px] font-medium text-court-fg-muted">
        <span className="h-1.5 w-1.5 rounded-full bg-court-fg-dim" aria-hidden />
        No runs yet
      </span>
    );
  }
  const tone =
    lastRun.status === "COMPLETE"
      ? "border-court-brand/30 bg-court-brand-tint text-court-brand-dark"
      : lastRun.status === "FAILED"
        ? "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200"
        : "border-court-border bg-court-surface-subtle text-court-fg-muted";
  const dotColor =
    lastRun.status === "COMPLETE"
      ? "bg-court-brand"
      : lastRun.status === "FAILED"
        ? "bg-red-500"
        : "bg-court-fg-dim";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium",
        tone,
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", dotColor)} aria-hidden />
      Last run · {formatStatus(lastRun.status)} · {formatRelative(lastRun.createdAt)}
    </span>
  );
}

function PreviewChip({
  contactCap,
  estimatedCompanies,
  sequenceName,
  domains,
}: {
  contactCap: number;
  estimatedCompanies: number;
  sequenceName: string;
  domains: DomainPreview[];
}) {
  // Always render exactly 5 slots — fill with placeholder dots if the
  // org has fewer than 5 sending domains configured.
  const slots: ReadonlyArray<DomainPreview | null> = Array.from({ length: 5 }, (_, i) => domains[i] ?? null);
  return (
    <div className="inline-flex w-fit max-w-full flex-wrap items-center gap-x-3 gap-y-2 self-start rounded-lg border border-court-brand/30 bg-court-brand-tint px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-court-brand">
      <span>{estimatedCompanies} companies</span>
      <span className="text-court-brand/60">→</span>
      <span>up to {contactCap} contacts</span>
      <span className="text-court-brand/60">·</span>
      <span>{sequenceName}</span>
      <span className="text-court-brand/60">·</span>
      <span className="inline-flex items-center gap-1" aria-label="Rotating sending domains">
        {slots.map((slot, i) => (
          <span
            key={i}
            title={slot?.domain ?? "unassigned slot"}
            className={cn(
              "inline-block h-2 w-2 rounded-full",
              slot
                ? slot.status === "COOLED"
                  ? "bg-court-fg-dim"
                  : slot.status === "WARMING"
                    ? "bg-court-brand/40"
                    : "bg-court-brand"
                : "border border-court-brand/40 bg-transparent",
            )}
          />
        ))}
      </span>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="mt-6 rounded-lg border border-dashed border-court-border bg-court-surface-subtle p-6 text-center text-sm text-court-fg-muted">
      {message}
    </div>
  );
}

function formatStatus(status: LastRun["status"]): string {
  switch (status) {
    case "QUEUED":
      return "Queued";
    case "RUNNING":
      return "Running";
    case "AWAITING_APPROVAL":
      return "Awaiting approval";
    case "APPROVED":
      return "Approved";
    case "ENROLLING":
      return "Enrolling";
    case "COMPLETE":
      return "Complete";
    case "FAILED":
      return "Failed";
    case "DISMISSED":
      return "Dismissed";
  }
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const deltaSec = Math.max(0, Math.round((now - then) / 1000));
  if (deltaSec < 60) return "just now";
  const min = Math.round(deltaSec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  return `${day}d ago`;
}

// React 18 doesn't have a one-liner "run this effect when dep changes
// at render time without firing on mount." This tiny helper re-syncs
// the saved-search default when the vertical changes, without dragging
// in useEffect (which would flash a frame of stale selection).
function useMemoizedReset(key: string, reset: () => void) {
  const [last, setLast] = useState(key);
  if (last !== key) {
    setLast(key);
    reset();
  }
}
