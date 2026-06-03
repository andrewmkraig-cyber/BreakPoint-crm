"use client";

import { useMemo, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw, X, RotateCcw } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { INPUT_FRAME_RECT_CLASS, INPUT_CONTROL_CLASS } from "@/components/ui/input";

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
  // buttons. Keeping LaunchView's launch state in LaunchView (and the run
  // table state here) lets each component own its own state while this host
  // controls the top-to-bottom layout.
  controls?: ReactNode;
  summary?: ReactNode;
  launchButton?: ReactNode;
  launchHint?: ReactNode;
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
  launchButton,
  launchHint,
}: Props) {
  const router = useRouter();
  const [runs, setRuns] = useState<PendingBDRun[]>(initialRuns);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [triggerError, setTriggerError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [discoveryOpen, setDiscoveryOpen] = useState(false);
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

  async function onApprove(runId: string) {
    setActionError(null);
    markPending(runId, true);
    const res = await approveBDRun(runId, buildCuratedPayload(runId));
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
      {/* 1 - page heading, seated above everything like the other BD pages. */}
      <header className="flex flex-col gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-court-brand">
          Today&apos;s Batch
        </p>
      </header>

      {/* 2 - Vertical chip + Saved Search dropdown. */}
      {controls}

      {/* 3 - discovery results table. The empty state is the empty version
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
                onApprove={() => onApprove(run.id)}
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

      {/* 4 - green run-summary line (with the Last run pill top-right). */}
      {summary}

      {/* 5 - buttons last: Launch BD Run, then Run Discovery Now. Both match
          the BD Settings button size and stay w-auto. */}
      <div className="flex flex-wrap items-center gap-2">
        {launchButton}
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
        {launchHint}
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
    </section>
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
  onApprove,
  onDismiss,
  onRemoveContact,
  onSwapContact,
}: {
  run: PendingBDRun;
  carousels: Record<string, ContactCarousel>;
  busy: boolean;
  onApprove: () => void;
  onDismiss: () => void;
  onRemoveContact: (companyKey: string, contactId: string) => void;
  onSwapContact: (companyKey: string, contactId: string) => void;
}) {
  const preview = run.discoveredPayload.slice(0, MAX_PREVIEW_ROWS);
  const overflow = run.discoveredCount - preview.length;

  // Block approval if any previewed company has zero contacts left after
  // edits. Companies beyond the preview window can't be edited so we
  // don't consider them here.
  const companiesWithNoContacts = useMemo(
    () =>
      preview.filter((c) => {
        const carousel = carousels[normalizeCompanyKey(c.companyName)];
        if (!carousel) return false;
        return carousel.displayed.length === 0;
      }),
    [preview, carousels],
  );
  const approveBlocked = companiesWithNoContacts.length > 0;

  return (
    <div className="rounded-2xl border border-court-border bg-court-surface p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-court-brand-dark">
            {formatRunDate(run.createdAt)}
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

      {approveBlocked && (
        <p className="mt-3 text-[11px] text-amber-700 dark:text-amber-400">
          {companiesWithNoContacts.length === 1
            ? `${companiesWithNoContacts[0]?.companyName} has no contacts. Add at least one to approve.`
            : `${companiesWithNoContacts.length} companies have no contacts. Restore at least one each to approve.`}
        </p>
      )}

      <div className="mt-5 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onApprove}
          disabled={busy || approveBlocked}
          className="inline-flex items-center gap-2 rounded-md border border-court-brand bg-court-brand-tint px-4 py-2 text-sm font-semibold text-court-brand-dark shadow-sm transition hover:bg-court-brand/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-court-brand/50 focus-visible:ring-offset-2 focus-visible:ring-offset-court-bg disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          Approve &amp; Enroll
        </button>
        <button
          type="button"
          onClick={onDismiss}
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
  if (history.runCount === 0) {
    return (
      <span className="inline-flex w-fit items-center rounded-full border border-court-border bg-court-surface-subtle px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.1em] text-court-fg-muted">
        No prior outreach
      </span>
    );
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
  if (!carousel || carousel.displayed.length === 0) {
    return (
      <span className="inline-flex w-fit items-center rounded-full border border-court-border bg-court-surface-subtle px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.1em] text-court-fg-muted">
        No contacts found
      </span>
    );
  }
  const swapAvailable = carousel.pool.length > 0;
  return (
    <div className="flex flex-wrap gap-1.5">
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

const RUN_DATE_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function formatRunDate(iso: string): string {
  return RUN_DATE_FMT.format(new Date(iso));
}

function providerLabel(provider: string): string {
  if (provider === "theirstack") return "TheirStack";
  return provider;
}
