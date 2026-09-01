"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { approveCompanyGoal, declineCompanyGoal } from "@/app/dashboard/goal-actions";

export type PendingGoalRow = {
  id: string;
  requesterName: string;
  scopeLabel: string;
  metricLabel: string;
  targetLabel: string;
  periodLabel: string;
  notes: string | null;
};

// Company goals waiting on the owner's sign-off.
//
// The PANEL ITSELF is only rendered when there is something in it - see
// goals-tab.tsx. An always-present empty panel would train the eye to skip
// the one place an actual request has to be noticed.
export function GoalsApprovalQueue({ rows }: { rows: PendingGoalRow[] }) {
  return (
    <section className="rounded-3xl bg-court-surface p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_32px_rgba(0,0,0,0.10)]">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-court-brand-dark">
          Approvals
        </p>
        <h3 className="mt-1 font-serif text-base font-bold tracking-tight text-court-fg sm:text-lg">
          Waiting on you
        </h3>
        <p className="mt-0.5 text-xs text-court-fg-muted">
          {rows.length} company {rows.length === 1 ? "goal" : "goals"} requested and not
          yet started tracking.
        </p>
      </div>
      <div className="mt-4 divide-y divide-court-border-soft">
        {rows.map((r) => (
          <PendingRow key={r.id} row={r} />
        ))}
      </div>
    </section>
  );
}

function PendingRow({ row }: { row: PendingGoalRow }) {
  const router = useRouter();
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fn();
      if (!res.ok) {
        setError(res.error ?? "That did not work.");
        setBusy(false);
        return;
      }
      router.refresh();
    } catch (e) {
      // Permission failures throw rather than returning - goal-actions.ts.
      setError(e instanceof Error ? e.message : "You cannot approve or decline this.");
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
      {/* Ace 68.0 row standard: the metric label is the one bold element. */}
      <div className="min-w-[10rem] flex-1">
        <p className="text-[13px] font-semibold text-court-fg">{row.metricLabel}</p>
        <p className="text-xs text-court-fg-muted">
          {row.scopeLabel} · {row.periodLabel} · requested by {row.requesterName}
        </p>
        {row.notes && (
          <p className="mt-0.5 text-xs italic text-court-fg-muted">{row.notes}</p>
        )}
      </div>
      <div className="w-24 text-xs text-court-fg-muted">{row.targetLabel}</div>

      {declining ? (
        <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
          {/* A reason is required, so the field opens inline rather than the
              decline firing straight from the button. */}
          <Input
            value={reason}
            placeholder="Why turn this down?"
            containerClassName="min-w-[12rem] flex-1"
            onChange={(e) => setReason(e.target.value)}
          />
          <Button variant="secondary" onClick={() => setDeclining(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="reject"
            disabled={busy || reason.trim().length === 0}
            onClick={() => run(() => declineCompanyGoal(row.id, reason))}
          >
            <XCircle className="mr-1.5 h-3.5 w-3.5" />
            Decline
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          {/* Confirm treatment: the brand-green action-row button, with
              CheckCircle2 inheriting its colour (Ace 71.0 icon semantics). */}
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => run(() => approveCompanyGoal(row.id))}
          >
            <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
            Approve
          </Button>
          <Button variant="reject" disabled={busy} onClick={() => setDeclining(true)}>
            <XCircle className="mr-1.5 h-3.5 w-3.5" />
            Decline
          </Button>
        </div>
      )}

      {error && (
        <p className="w-full text-right text-xs text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}
