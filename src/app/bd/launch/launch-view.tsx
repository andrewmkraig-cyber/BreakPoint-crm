"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Rocket, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";

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
  contactsUsedToday: number;
  pauseAll: boolean;
};

// Amber #F59E0B is reserved for the Launch CTA per the BD handoff —
// the only hardcoded hex allowed in BD pages. Hover deepens to #D97706
// (Tailwind amber-600) so the button still reads as the amber family
// in both Court Mode light and dark themes.
const LAUNCH_CTA_CLASS =
  "inline-flex items-center gap-2 rounded-md border border-[#D97706] bg-[#F59E0B] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#D97706] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F59E0B]/50 focus-visible:ring-offset-2 focus-visible:ring-offset-court-bg disabled:cursor-not-allowed disabled:opacity-50";

const ESTIMATED_CONTACTS_PER_COMPANY = 4;
const SEQUENCE_NAME_PLACEHOLDER = "BD Outbound v1";

export function LaunchView({
  verticals,
  savedSearches,
  domains,
  lastRun,
  defaultContactCap,
  contactsUsedToday,
  pauseAll,
}: Props) {
  const router = useRouter();
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
  const dailyCapHit = contactsUsedToday >= contactCap;

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canLaunch = !!savedSearchId && !pauseAll && !dailyCapHit && !submitting;

  async function handleLaunch() {
    if (!verticalId || !savedSearchId) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/bd/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ verticalId, savedSearchId }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `Launch failed (HTTP ${res.status})`);
      }
      setConfirmOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Launch failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <section className="rounded-2xl border border-court-border bg-court-surface p-6 shadow-sm sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-court-brand-dark">
              Today&apos;s Launch
            </p>
            <h1 className="mt-1 font-serif text-2xl font-bold text-court-fg sm:text-3xl">
              Ready to roll outbound
            </h1>
          </div>
          <LastRunChip lastRun={lastRun} />
        </div>

        {verticals.length === 0 ? (
          <EmptyState message="No verticals configured yet. Add one in BD Settings (coming soon)." />
        ) : (
          <>
            <div className="mt-6">
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

            <div className="mt-5">
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

            <PreviewChip
              contactCap={contactCap}
              estimatedCompanies={Math.max(1, Math.round(contactCap / ESTIMATED_CONTACTS_PER_COMPANY))}
              sequenceName={SEQUENCE_NAME_PLACEHOLDER}
              domains={domains}
            />

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={!canLaunch}
                onClick={() => setConfirmOpen(true)}
                className={LAUNCH_CTA_CLASS}
              >
                <Rocket className="h-4 w-4" />
                Launch BD Run
              </button>
              {dailyCapHit && (
                <span className="text-xs text-court-fg-muted">
                  Daily cap of {contactCap} contacts already used today.
                </span>
              )}
              {pauseAll && (
                <span className="text-xs text-court-fg-muted">BD is paused (see BD Settings).</span>
              )}
              {!savedSearchId && visibleSearches.length > 0 && (
                <span className="text-xs text-court-fg-muted">Pick a saved search to launch.</span>
              )}
            </div>
          </>
        )}
      </section>

      {confirmOpen && (
        <ConfirmModal
          onCancel={() => {
            if (!submitting) setConfirmOpen(false);
          }}
          onConfirm={handleLaunch}
          submitting={submitting}
          error={error}
          contactCap={contactCap}
          estimatedCompanies={Math.max(1, Math.round(contactCap / ESTIMATED_CONTACTS_PER_COMPANY))}
          sequenceName={SEQUENCE_NAME_PLACEHOLDER}
          domains={domains}
          searchName={selectedSearch?.name ?? ""}
        />
      )}
    </>
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
    <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-court-brand/30 bg-court-brand-tint px-3 py-2 text-[13px] text-court-brand-dark">
      <span className="font-semibold">{estimatedCompanies} companies</span>
      <span className="text-court-brand-dark/60">→</span>
      <span className="font-semibold">up to {contactCap} contacts</span>
      <span className="text-court-brand-dark/60">·</span>
      <span>{sequenceName}</span>
      <span className="text-court-brand-dark/60">·</span>
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

function ConfirmModal({
  onCancel,
  onConfirm,
  submitting,
  error,
  contactCap,
  estimatedCompanies,
  sequenceName,
  domains,
  searchName,
}: {
  onCancel: () => void;
  onConfirm: () => void;
  submitting: boolean;
  error: string | null;
  contactCap: number;
  estimatedCompanies: number;
  sequenceName: string;
  domains: DomainPreview[];
  searchName: string;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="bd-confirm-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-court-border bg-court-surface p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="bd-confirm-title" className="font-serif text-lg font-bold text-court-fg">
              Launch this BD run?
            </h2>
            <p className="mt-1 text-sm text-court-fg-muted">
              Enqueues {searchName ? <em className="not-italic font-medium text-court-fg">“{searchName}”</em> : "the selected search"} for the next morning scan.
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md p-1 text-court-fg-muted hover:bg-court-surface-subtle hover:text-court-fg"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4">
          <PreviewChip
            contactCap={contactCap}
            estimatedCompanies={estimatedCompanies}
            sequenceName={sequenceName}
            domains={domains}
          />
        </div>

        {error && (
          <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
            {error}
          </div>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="inline-flex items-center rounded-md border border-court-border bg-court-surface px-3 py-1.5 text-sm font-medium text-court-fg shadow-sm transition hover:bg-court-surface-subtle disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={submitting}
            className={LAUNCH_CTA_CLASS}
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
            Launch
          </button>
        </div>
      </div>
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
