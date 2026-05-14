"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";

import {
  approveBDRun,
  dismissBDRun,
  triggerManualDiscovery,
  type PendingBDRun,
} from "@/app/bd/launch/bd-run-actions";

const MAX_PREVIEW_ROWS = 5;

type Props = {
  initialRuns: PendingBDRun[];
};

export function ApprovalQueue({ initialRuns }: Props) {
  const router = useRouter();
  const [runs, setRuns] = useState<PendingBDRun[]>(initialRuns);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [triggerError, setTriggerError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isTriggering, startTriggering] = useTransition();

  function markPending(runId: string, on: boolean) {
    setPendingIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(runId);
      else next.delete(runId);
      return next;
    });
  }

  async function onApprove(runId: string) {
    setActionError(null);
    markPending(runId, true);
    const res = await approveBDRun(runId);
    if (res.success) {
      setRuns((prev) => prev.filter((r) => r.id !== runId));
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
      router.refresh();
    } else {
      setActionError(res.error);
      markPending(runId, false);
    }
  }

  function onTrigger() {
    setTriggerError(null);
    startTriggering(async () => {
      const res = await triggerManualDiscovery();
      if (res.success) {
        router.refresh();
      } else {
        setTriggerError(res.error);
      }
    });
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-court-brand">
          Discovery Queue
        </p>
        <button
          type="button"
          onClick={onTrigger}
          disabled={isTriggering}
          className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold text-court-fg-muted transition hover:bg-court-surface-subtle hover:text-court-fg disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isTriggering ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          Run Discovery Now
        </button>
      </div>

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
              busy={pendingIds.has(run.id)}
              onApprove={() => onApprove(run.id)}
              onDismiss={() => onDismiss(run.id)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function RunCard({
  run,
  busy,
  onApprove,
  onDismiss,
}: {
  run: PendingBDRun;
  busy: boolean;
  onApprove: () => void;
  onDismiss: () => void;
}) {
  const preview = run.discoveredPayload.slice(0, MAX_PREVIEW_ROWS);
  const overflow = run.discoveredCount - preview.length;
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
        <ul className="mt-4 space-y-1.5">
          {preview.map((c, i) => (
            <li key={i} className="flex flex-wrap items-baseline gap-x-2 text-sm">
              <span className="font-medium text-court-fg">{c.companyName}</span>
              {c.jobTitle && (
                <span className="text-[12px] text-court-fg-muted">{c.jobTitle}</span>
              )}
            </li>
          ))}
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
          onClick={onApprove}
          disabled={busy}
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
