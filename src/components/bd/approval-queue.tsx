"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw, X, RotateCcw, ExternalLink, Eye, MapPin } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

import {
  approveBDRun,
  dismissBDRun,
  triggerManualDiscovery,
  type ApolloContact,
  type PendingBDRun,
  type SerializedOutreachHistory,
} from "@/app/bd/launch/bd-run-actions";
import { cn } from "@/lib/utils";
import { formatBdDateTime } from "@/app/bd/date-format";
import { Button } from "@/components/ui/button";
import { INPUT_FRAME_RECT_CLASS, INPUT_CONTROL_CLASS } from "@/components/ui/input";
import { ClientLogo } from "@/components/clients/client-logo";
import { Modal } from "@/components/placements/placement-shared";

const MAX_PREVIEW_ROWS = 5;
const MAX_DISPLAYED_CONTACTS = 5;

// Defaults the "Run Discovery Now" popup pre-fills. Mirror today's
// hardcoded behavior: 25 companies pulled, up to 4 contacts/company
// enrolled at approve time.
const DEFAULT_COMPANIES = 25;
const DEFAULT_CONTACTS_PER_COMPANY = 4;

type Props = {
  initialRuns: PendingBDRun[];
  // Slots supplied by LaunchView so the whole Today's Batch page renders as
  // one column in a fixed order: heading -> controls -> table -> summary ->
  // Run Discovery Now button. Each component owns its own state while this
  // host controls the top-to-bottom layout.
  controls?: ReactNode;
  summary?: ReactNode;
  // Pill + BD Settings button seated top-right inside the card.
  cardHeaderRight?: ReactNode;
};

type ContactCarousel = {
  displayed: ApolloContact[];
  pool: ApolloContact[];
};

// Per-run curated state keyed by run.id → company name (lowercased) →
// {displayed, pool}. Lives in the queue component so the run card can
// stay a presentational child.
type CuratedByRun = Record<string, Record<string, ContactCarousel>>;

function normalizeCompanyKey(name: string): string {
  return name.trim().toLowerCase();
}

function initialCarouselsForRun(run: PendingBDRun): Record<string, ContactCarousel> {
  const out: Record<string, ContactCarousel> = {};
  for (const c of run.discoveredPayload) {
    const all = c.contacts ?? [];
    out[normalizeCompanyKey(c.companyName)] = {
      displayed: all.slice(0, MAX_DISPLAYED_CONTACTS),
      pool: all.slice(MAX_DISPLAYED_CONTACTS),
    };
  }
  return out;
}

export function ApprovalQueue({
  initialRuns,
  controls,
  summary,
  cardHeaderRight,
}: Props) {
  const router = useRouter();
  const [runs, setRuns] = useState<PendingBDRun[]>(initialRuns);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [triggerError, setTriggerError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [discoveryOpen, setDiscoveryOpen] = useState(false);
  // Which run's company-selection popup is open (null = none). The popup
  // is where Approve & Enroll now lives.
  const [viewRunId, setViewRunId] = useState<string | null>(null);
  const [isTriggering, startTriggering] = useTransition();
  const [curated, setCurated] = useState<CuratedByRun>(() => {
    const seed: CuratedByRun = {};
    for (const r of initialRuns) seed[r.id] = initialCarouselsForRun(r);
    return seed;
  });

  function markPending(runId: string, on: boolean) {
    setPendingIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(runId);
      else next.delete(runId);
      return next;
    });
  }

  function updateCarousel(
    runId: string,
    companyKey: string,
    fn: (c: ContactCarousel) => ContactCarousel,
  ) {
    setCurated((prev) => {
      const runMap = prev[runId] ?? {};
      const existing = runMap[companyKey];
      if (!existing) return prev;
      return {
        ...prev,
        [runId]: { ...runMap, [companyKey]: fn(existing) },
      };
    });
  }

  function onRemoveContact(runId: string, companyKey: string, contactId: string) {
    updateCarousel(runId, companyKey, (c) => ({
      displayed: c.displayed.filter((x) => x.id !== contactId),
      pool: c.pool,
    }));
  }

  function onSwapContact(runId: string, companyKey: string, contactId: string) {
    updateCarousel(runId, companyKey, (c) => {
      if (c.pool.length === 0) return c;
      const idx = c.displayed.findIndex((x) => x.id === contactId);
      if (idx < 0) return c;
      const [next, ...restPool] = c.pool;
      const replaced = c.displayed[idx];
      const newDisplayed = [...c.displayed];
      newDisplayed[idx] = next;
      return { displayed: newDisplayed, pool: [...restPool, replaced] };
    });
  }

  function buildCuratedPayload(runId: string): Record<string, ApolloContact[]> {
    const out: Record<string, ApolloContact[]> = {};
    const runMap = curated[runId] ?? {};
    for (const [key, carousel] of Object.entries(runMap)) {
      out[key] = carousel.displayed;
    }
    return out;
  }

  // Enrolls only the companies whose indexes the popup passed in. The
  // curated per-company contact lists still ride along so contact-level
  // edits made on the card are preserved.
  async function onApprove(runId: string, selectedIndexes: number[]) {
    setActionError(null);
    markPending(runId, true);
    const res = await approveBDRun(runId, buildCuratedPayload(runId), selectedIndexes);
    if (res.success) {
      setViewRunId(null);
      setRuns((prev) => prev.filter((r) => r.id !== runId));
      setCurated((prev) => {
        const next = { ...prev };
        delete next[runId];
        return next;
      });
      router.refresh();
    } else {
      setActionError(res.error);
      markPending(runId, false);
    }
  }

  async function onDismiss(runId: string) {
    setActionError(null);
    markPending(runId, true);
    const res = await dismissBDRun(runId);
    if (res.success) {
      setRuns((prev) => prev.filter((r) => r.id !== runId));
      setCurated((prev) => {
        const next = { ...prev };
        delete next[runId];
        return next;
      });
      router.refresh();
    } else {
      setActionError(res.error);
      markPending(runId, false);
    }
  }

  function onRunDiscovery(companies: number, maxContactsPerCompany: number) {
    setTriggerError(null);
    startTriggering(async () => {
      const res = await triggerManualDiscovery({ companies, maxContactsPerCompany });
      if (res.success) {
        setDiscoveryOpen(false);
        router.refresh();
      } else {
        setTriggerError(res.error);
      }
    });
  }

  return (
    <section className="flex w-full flex-col gap-6">
      {/* Page heading stays ABOVE the card, like the other BD pages seat
          their eyebrow above their list panel. */}
      <header className="flex flex-col gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-court-brand">
          Today&apos;s Batch
        </p>
      </header>

      {/* Single contained card holding the whole batch body. Matches the
          dashboard big-panel chrome (rounded-3xl surface + two-tier
          shadow). Order top-to-bottom: header-right pill/settings ->
          controls -> table -> summary -> buttons. */}
      <div className="flex flex-col gap-6 rounded-3xl bg-court-surface p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_20px_rgba(0,0,0,0.08)]">
        {/* Top band: controls seated at the very top-left and the Last run
            pill + BD Settings top-right, on the same row, so the body
            starts at the top of the card instead of floating far down. */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          {/* Vertical chip + Saved Search dropdown. */}
          <div className="min-w-0 flex-1">{controls}</div>
          {cardHeaderRight && (
            <div className="flex flex-wrap items-center justify-end gap-2">
              {cardHeaderRight}
            </div>
          )}
        </div>

        {/* Discovery results table. The empty state is the empty version
            of the run-card list. */}
        <div className="flex flex-col gap-3">
          {triggerError && (
            <p className="text-xs text-red-600 dark:text-red-300">{triggerError}</p>
          )}
          {actionError && (
            <p className="text-xs text-red-600 dark:text-red-300">{actionError}</p>
          )}

          {runs.length === 0 ? (
            <p className="text-xs text-court-fg-muted">
              No discovery runs awaiting approval.
            </p>
          ) : (
            <div className="space-y-3">
              {runs.map((run) => (
                <RunCard
                  key={run.id}
                  run={run}
                  carousels={curated[run.id] ?? {}}
                  busy={pendingIds.has(run.id)}
                  onView={() => setViewRunId(run.id)}
                  onDismiss={() => onDismiss(run.id)}
                  onRemoveContact={(companyKey, contactId) =>
                    onRemoveContact(run.id, companyKey, contactId)
                  }
                  onSwapContact={(companyKey, contactId) =>
                    onSwapContact(run.id, companyKey, contactId)
                  }
                />
              ))}
            </div>
          )}
        </div>

        {/* Green run-summary line. */}
        {summary}

        {/* Run Discovery Now is the only action in this row, left-aligned.
            Sized to match the BD Settings button (px-2.5 py-1 text-[13px],
            rounded-md, w-auto). Opens the Run discovery dialog. */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setTriggerError(null);
              setDiscoveryOpen(true);
            }}
            disabled={isTriggering}
            className="inline-flex items-center gap-1.5 rounded-md border border-court-border bg-court-surface px-2.5 py-1 text-[13px] font-medium text-court-fg-muted shadow-sm transition hover:bg-court-surface-subtle hover:text-court-fg disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isTriggering ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Run Discovery Now
          </button>
        </div>
      </div>

      {discoveryOpen && (
        <DiscoveryModal
          submitting={isTriggering}
          onCancel={() => {
            if (!isTriggering) setDiscoveryOpen(false);
          }}
          onConfirm={onRunDiscovery}
        />
      )}

      {viewRunId &&
        (() => {
          const run = runs.find((r) => r.id === viewRunId);
          if (!run) return null;
          const busy = pendingIds.has(run.id);
          return (
            <CompanySelectionModal
              run={run}
              busy={busy}
              onClose={() => {
                if (!busy) setViewRunId(null);
              }}
              onApprove={(selectedIndexes) => onApprove(run.id, selectedIndexes)}
            />
          );
        })()}
    </section>
  );
}

// Company-selection popup for one discovered run. Lists every company in
// the run's payload with a checkbox (all checked by default), a live
// "Enroll X of N" count, and a single Approve & Enroll action that enrolls
// only the checked companies (by their index in this list). Reuses the
// shared Modal chrome and the campaigns/[id] company-row markup.
function CompanySelectionModal({
  run,
  busy,
  onClose,
  onApprove,
}: {
  run: PendingBDRun;
  busy: boolean;
  onClose: () => void;
  onApprove: (selectedIndexes: number[]) => void;
}) {
  const companies = run.discoveredPayload;
  const [selected, setSelected] = useState<Set<number>>(
    () => new Set(companies.map((_, i) => i)),
  );

  const allSelected = companies.length > 0 && selected.size === companies.length;

  function toggle(i: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(companies.map((_, i) => i)));
  }

  const footer = (
    <>
      <Button variant="secondary" size="sm" onClick={onClose} disabled={busy}>
        Cancel
      </Button>
      <Button
        variant="primary"
        size="sm"
        disabled={busy || selected.size === 0}
        onClick={() =>
          onApprove(Array.from(selected).sort((a, b) => a - b))
        }
      >
        {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
        Approve &amp; Enroll
      </Button>
    </>
  );

  return (
    <Modal
      title="Review companies"
      subtitle={`Enroll ${selected.size} of ${companies.length}`}
      onClose={onClose}
      footer={footer}
      wide
    >
      {companies.length === 0 ? (
        <div className="rounded-xl border border-dashed border-court-border bg-court-surface-subtle p-6 text-sm text-court-fg-muted">
          No companies were discovered for this run.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={toggleAll}
              className="text-xs font-medium text-court-brand transition-colors hover:text-court-brand-dark"
            >
              {allSelected ? "Clear all" : "Select all"}
            </button>
            <span className="text-xs font-medium text-court-fg-muted">
              {selected.size} of {companies.length} selected
            </span>
          </div>

          <ul className="flex flex-col gap-2">
            {companies.map((company, idx) => {
              const name = company.companyName?.trim() || "Unknown company";
              const url = company.jobPostingUrl?.trim();
              const checked = selected.has(idx);
              return (
                <li
                  key={`${name}-${company.jobTitle ?? ""}-${idx}`}
                  className={cn(
                    "flex items-start gap-3 rounded-xl border p-3 transition-colors",
                    checked
                      ? "border-court-border bg-court-surface-subtle"
                      : "border-court-border bg-court-surface opacity-60",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(idx)}
                    aria-label={`Enroll ${name}`}
                    className="mt-1 h-4 w-4 shrink-0 accent-court-brand"
                  />
                  <ClientLogo domain={company.domain} name={name} size={40} />
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <p className="truncate text-sm font-semibold text-court-fg">{name}</p>
                    {company.jobTitle ? (
                      <p className="truncate text-xs font-medium text-court-brand">
                        {company.jobTitle}
                      </p>
                    ) : null}
                    {company.jobLocation ? (
                      <p className="flex items-center gap-1 truncate text-xs text-court-fg-muted">
                        <MapPin className="h-3 w-3 shrink-0" />
                        <span className="truncate">{company.jobLocation}</span>
                      </p>
                    ) : null}
                  </div>
                  {url ? (
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex shrink-0 items-center gap-1 self-center rounded-lg border border-court-border bg-court-surface px-2.5 py-1.5 text-xs font-medium text-court-fg-muted transition-colors hover:text-court-fg"
                    >
                      <ExternalLink className="h-3.5 w-3.5" /> Job
                    </a>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Modal>
  );
}

// Popup for "Run Discovery Now". Two editable inputs pre-filled with the
// standing defaults: how many companies to discover (a free pull, no cap
// gate) and the max contacts per company to enroll at approve time (still
// bounded by the global daily cap downstream).
function DiscoveryModal({
  submitting,
  onCancel,
  onConfirm,
}: {
  submitting: boolean;
  onCancel: () => void;
  onConfirm: (companies: number, maxContactsPerCompany: number) => void;
}) {
  const [companies, setCompanies] = useState<number>(DEFAULT_COMPANIES);
  const [perCompany, setPerCompany] = useState<number>(DEFAULT_CONTACTS_PER_COMPANY);

  const companiesValid = !Number.isNaN(companies) && companies > 0;
  const perCompanyValid = !Number.isNaN(perCompany) && perCompany > 0;
  const canConfirm = companiesValid && perCompanyValid && !submitting;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="bd-discovery-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-court-border bg-court-surface p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2
              id="bd-discovery-title"
              className="font-serif text-lg font-bold tracking-tight text-court-fg"
            >
              Run discovery now
            </h2>
            <p className="mt-1 text-sm text-court-fg-muted">
              Pull a fresh batch of companies for approval. This surfaces a list to
              review; nothing sends until you approve and enroll.
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="rounded-md p-1 text-court-fg-muted hover:bg-court-surface-subtle hover:text-court-fg disabled:opacity-60"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="block text-[11px] font-semibold uppercase tracking-wide text-court-fg-muted">
              Number of companies
            </span>
            <div className={cn(INPUT_FRAME_RECT_CLASS, "mt-1 w-full")}>
              <input
                type="number"
                min={1}
                value={Number.isNaN(companies) ? "" : companies}
                onChange={(e) =>
                  setCompanies(e.target.value === "" ? NaN : Number(e.target.value))
                }
                className={`${INPUT_CONTROL_CLASS} text-sm`}
              />
            </div>
          </label>

          <label className="block">
            <span className="block text-[11px] font-semibold uppercase tracking-wide text-court-fg-muted">
              Max contacts per company
            </span>
            <div className={cn(INPUT_FRAME_RECT_CLASS, "mt-1 w-full")}>
              <input
                type="number"
                min={1}
                value={Number.isNaN(perCompany) ? "" : perCompany}
                onChange={(e) =>
                  setPerCompany(e.target.value === "" ? NaN : Number(e.target.value))
                }
                className={`${INPUT_CONTROL_CLASS} text-sm`}
              />
            </div>
          </label>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => onConfirm(companies, perCompany)}
            disabled={!canConfirm}
          >
            {submitting ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-1.5 h-4 w-4" />
            )}
            Run discovery
          </Button>
        </div>
      </div>
    </div>
  );
}

function RunCard({
  run,
  carousels,
  busy,
  onView,
  onDismiss,
  onRemoveContact,
  onSwapContact,
}: {
  run: PendingBDRun;
  carousels: Record<string, ContactCarousel>;
  busy: boolean;
  onView: () => void;
  onDismiss: () => void;
  onRemoveContact: (companyKey: string, contactId: string) => void;
  onSwapContact: (companyKey: string, contactId: string) => void;
}) {
  const preview = run.discoveredPayload.slice(0, MAX_PREVIEW_ROWS);
  const overflow = run.discoveredCount - preview.length;

  return (
    // The whole card opens the company-selection popup. Inner interactive
    // controls (contact chips, the action buttons) stopPropagation so they
    // keep their own behavior without also firing the card's open.
    <div
      role="button"
      tabIndex={0}
      onClick={onView}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onView();
        }
      }}
      className="cursor-pointer rounded-2xl border border-court-border bg-court-surface p-6 shadow-sm transition-colors hover:border-court-brand/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-court-brand/50"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-court-brand-dark">
            {formatBdDateTime(new Date(run.createdAt))}
          </p>
          <p className="mt-1 font-serif text-xl font-bold tracking-tight text-court-fg">
            {run.discoveredCount} {run.discoveredCount === 1 ? "company" : "companies"} discovered
          </p>
        </div>
        <span className="inline-flex items-center rounded-full border border-court-border bg-court-surface-subtle px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-court-fg-muted">
          {providerLabel(run.discoveryProvider)}
        </span>
      </div>

      {preview.length > 0 && (
        <ul className="mt-4 space-y-3">
          {preview.map((c, i) => {
            const key = normalizeCompanyKey(c.companyName);
            const carousel = carousels[key];
            return (
              <li key={i} className="flex flex-col gap-1.5">
                <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
                  <span className="font-medium text-court-fg">{c.companyName}</span>
                  {c.jobTitle && (
                    <span className="text-[12px] text-court-fg-muted">{c.jobTitle}</span>
                  )}
                </div>
                <OutreachHistoryRow history={c.history} />
                <ContactsRow
                  carousel={carousel}
                  onRemove={(contactId) => onRemoveContact(key, contactId)}
                  onSwap={(contactId) => onSwapContact(key, contactId)}
                />
              </li>
            );
          })}
          {overflow > 0 && (
            <li className="text-[11px] font-medium uppercase tracking-[0.1em] text-court-fg-muted">
              +{overflow} more
            </li>
          )}
        </ul>
      )}

      <div className="mt-5 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onView();
          }}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-md border border-court-brand bg-court-brand-tint px-4 py-2 text-sm font-semibold text-court-brand-dark shadow-sm transition hover:bg-court-brand/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-court-brand/50 focus-visible:ring-offset-2 focus-visible:ring-offset-court-bg disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Eye className="h-4 w-4" />
          View
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDismiss();
          }}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-court-fg-muted transition hover:bg-court-surface-subtle hover:text-court-fg disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          Dismiss
        </button>
      </div>
    </div>
  );
}

function OutreachHistoryRow({ history }: { history: SerializedOutreachHistory }) {
  // No prior outreach is the expected default at discovery, so render
  // nothing rather than a noise badge. Real outreach history still shows.
  if (history.runCount === 0) {
    return null;
  }
  const runLabel = `${history.runCount} time${history.runCount === 1 ? "" : "s"}`;
  const contactLabel = `${history.contactsTriedTotal} contact${history.contactsTriedTotal === 1 ? "" : "s"} tried`;
  const lastLabel = history.lastOutreachAt
    ? `Last: ${formatDistanceToNow(new Date(history.lastOutreachAt), { addSuffix: true })}`
    : null;
  return (
    <span className="text-[11px] text-court-fg-muted">
      Contacted {runLabel} · {contactLabel}
      {lastLabel ? ` · ${lastLabel}` : ""}
    </span>
  );
}

function ContactsRow({
  carousel,
  onRemove,
  onSwap,
}: {
  carousel: ContactCarousel | undefined;
  onRemove: (contactId: string) => void;
  onSwap: (contactId: string) => void;
}) {
  // Contacts are only found at Apollo enroll (after approval), so an empty
  // carousel is the expected state at discovery. Render nothing instead of
  // a noise badge; the chips still render once contacts exist.
  if (!carousel || carousel.displayed.length === 0) {
    return null;
  }
  const swapAvailable = carousel.pool.length > 0;
  return (
    // Interactive zone: swap/remove buttons and the LinkedIn link manage
    // their own clicks, so stop the card-level open from also firing here.
    <div className="flex flex-wrap gap-1.5" onClick={(e) => e.stopPropagation()}>
      {carousel.displayed.map((contact) => {
        const fullName = [contact.firstName, contact.lastName].filter(Boolean).join(" ") || "(unnamed)";
        return (
          <span
            key={contact.id}
            className="inline-flex items-center gap-1 rounded-full border border-court-border bg-court-surface-subtle px-2 py-0.5 text-[11px] text-court-fg"
          >
            {contact.linkedinUrl ? (
              <a
                href={contact.linkedinUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-court-brand hover:underline"
              >
                {fullName}
              </a>
            ) : (
              <span className="font-medium">{fullName}</span>
            )}
            {contact.title && (
              <span className="text-court-fg-muted">· {contact.title}</span>
            )}
            <button
              type="button"
              onClick={() => onSwap(contact.id)}
              disabled={!swapAvailable}
              title={swapAvailable ? "Swap for next candidate" : "No more candidates available"}
              className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded text-court-fg-muted transition hover:bg-court-surface hover:text-court-fg disabled:cursor-not-allowed disabled:opacity-40"
            >
              <RotateCcw className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={() => onRemove(contact.id)}
              title="Remove contact"
              className="inline-flex h-4 w-4 items-center justify-center rounded text-court-fg-muted transition hover:bg-court-surface hover:text-court-fg"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        );
      })}
    </div>
  );
}

function providerLabel(provider: string): string {
  if (provider === "theirstack") return "TheirStack";
  return provider;
}
