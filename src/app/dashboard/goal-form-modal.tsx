"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/input";
import {
  GOAL_METRICS,
  GOAL_METRIC_LABELS,
  GOAL_PERIODS,
  GOAL_PERIOD_LABELS,
  defaultPeriodDates,
  isRatioMetric,
  metricNeedsManualLabel,
  periodHasDates,
  type GoalMetricValue,
  type GoalPeriodValue,
} from "@/lib/goals/goal-options";
import { createGoal, updateGoal } from "@/app/dashboard/goal-actions";

// Create / edit a goal.
//
// Everything this file imports is either pure (goal-options) or a
// "use server" module (goal-actions), which Next replaces with an RPC stub.
// Nothing reaches @/lib/prisma - see scripts/check-client-prisma.mjs.

export type AssignableUser = { id: string; name: string };
export type ParentGoalOption = { id: string; label: string };

export type GoalFormInitial = {
  id: string;
  scope: "COMPANY" | "USER";
  ownerUserId: string | null;
  metric: GoalMetricValue;
  period: GoalPeriodValue;
  targetValue: number;
  periodStart: string | null;
  periodEnd: string | null;
  manualLabel: string | null;
  notes: string | null;
  parentGoalId: string | null;
};

export function GoalFormModal({
  open,
  onClose,
  assignableUsers,
  parentOptions,
  canApprove,
  initial,
}: {
  open: boolean;
  onClose: () => void;
  assignableUsers: AssignableUser[];
  parentOptions: ParentGoalOption[];
  // Drives the "will be submitted for approval" line and the submit label.
  canApprove: boolean;
  // Present = edit mode. Metric and period are locked in that mode.
  initial?: GoalFormInitial | null;
}) {
  const router = useRouter();
  const isEdit = Boolean(initial);

  const [scope, setScope] = useState<"COMPANY" | "USER">(initial?.scope ?? "COMPANY");
  const [ownerUserId, setOwnerUserId] = useState(initial?.ownerUserId ?? "");
  const [metric, setMetric] = useState<GoalMetricValue>(initial?.metric ?? "REVENUE");
  const [period, setPeriod] = useState<GoalPeriodValue>(initial?.period ?? "QUARTERLY");
  const [target, setTarget] = useState(initial ? String(initial.targetValue) : "");
  const [start, setStart] = useState(initial?.periodStart ?? "");
  const [end, setEnd] = useState(initial?.periodEnd ?? "");
  const [parentGoalId, setParentGoalId] = useState(initial?.parentGoalId ?? "");
  const [manualLabel, setManualLabel] = useState(initial?.manualLabel ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Auto-fill the dates from the period choice. Create mode only: in edit
  // mode the period is locked, and silently rewriting a running goal's
  // window would move the goalposts underneath it.
  useEffect(() => {
    if (isEdit) return;
    const d = defaultPeriodDates(period);
    setStart(d?.start ?? "");
    setEnd(d?.end ?? "");
  }, [period, isEdit]);

  const showDates = periodHasDates(period);
  const isRatio = isRatioMetric(metric);
  const showManualLabel = metricNeedsManualLabel(metric);
  // A ratio goal is an average, which converges rather than accumulating,
  // so it has nothing to roll up into.
  const showParent = !isRatio && parentOptions.length > 0;
  const needsApproval = scope === "COMPANY" && !canApprove;

  const submitLabel = useMemo(() => {
    if (isEdit) return saving ? "Saving..." : "Save goal";
    if (needsApproval) return saving ? "Requesting..." : "Request goal";
    return saving ? "Creating..." : "Create goal";
  }, [isEdit, needsApproval, saving]);

  if (!open) return null;

  async function submit() {
    setError(null);
    const targetValue = Number(target.replace(/[^0-9.\-]/g, ""));
    if (!Number.isFinite(targetValue) || targetValue <= 0) {
      setError("Target must be a positive number.");
      return;
    }
    setSaving(true);
    try {
      const res = isEdit
        ? await updateGoal({
            goalId: initial!.id,
            targetValue,
            periodStart: showDates ? start : null,
            periodEnd: showDates ? end : null,
            notes,
            manualLabel: showManualLabel ? manualLabel : null,
            parentGoalId: showParent ? parentGoalId || null : null,
          })
        : await createGoal({
            scope,
            ownerUserId: scope === "USER" ? ownerUserId : null,
            metric,
            targetValue,
            period,
            periodStart: showDates ? start : null,
            periodEnd: showDates ? end : null,
            parentGoalId: showParent ? parentGoalId || null : null,
            manualLabel: showManualLabel ? manualLabel : null,
            notes,
          });
      if (!res.ok) {
        setError(res.error);
        setSaving(false);
        return;
      }
      router.refresh();
      onClose();
      setSaving(false);
    } catch (e) {
      // A permission failure THROWS rather than returning - see the header
      // of goal-actions.ts. Surface it plainly instead of swallowing it.
      setError(e instanceof Error ? e.message : "You cannot save that goal.");
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={isEdit ? "Edit goal" : "New goal"}
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-court-border bg-court-surface p-5 shadow-2xl"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 className="font-serif text-base font-semibold text-court-fg">
            {isEdit ? "Edit Goal" : "New Goal"}
          </h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            aria-label="Close"
            className="p-1 shadow-none"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex flex-col gap-4">
          <Select
            label="Scope"
            value={scope}
            disabled={isEdit}
            onChange={(e) => setScope(e.target.value as "COMPANY" | "USER")}
          >
            <option value="COMPANY">Company</option>
            {assignableUsers.length > 0 && <option value="USER">A specific person</option>}
          </Select>

          {scope === "USER" && (
            <Select
              label="Whose goal"
              value={ownerUserId}
              disabled={isEdit}
              onChange={(e) => setOwnerUserId(e.target.value)}
            >
              <option value="">Select a person</option>
              {/* Only people the actor may actually set goals for - the
                  server re-checks this on write regardless. */}
              {assignableUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          )}

          <Select
            label="Metric"
            value={metric}
            disabled={isEdit}
            onChange={(e) => setMetric(e.target.value as GoalMetricValue)}
          >
            {GOAL_METRICS.map((m) => (
              <option key={m} value={m}>
                {GOAL_METRIC_LABELS[m]}
              </option>
            ))}
          </Select>

          {showManualLabel && (
            <Input
              label="What this counts"
              value={manualLabel}
              placeholder="e.g. LinkedIn posts landed"
              onChange={(e) => setManualLabel(e.target.value)}
            />
          )}

          <Select
            label="Period"
            value={period}
            disabled={isEdit}
            onChange={(e) => setPeriod(e.target.value as GoalPeriodValue)}
          >
            {GOAL_PERIODS.map((p) => (
              <option key={p} value={p}>
                {GOAL_PERIOD_LABELS[p]}
              </option>
            ))}
          </Select>

          {isEdit && (
            <p className="-mt-2 text-xs text-court-fg-dim">
              Metric and period are locked. Changing either would rewrite what
              every reading already taken against this goal meant. Archive it
              and create a new one instead.
            </p>
          )}

          <Input
            label="Target"
            value={target}
            inputMode="decimal"
            placeholder="125000"
            onChange={(e) => setTarget(e.target.value)}
          />

          {/* A milestone is cumulative all-time and carries no window. */}
          {showDates ? (
            <div className="flex gap-3">
              <Input
                label="Starts"
                type="date"
                value={start}
                containerClassName="flex-1"
                onChange={(e) => setStart(e.target.value)}
              />
              <Input
                label="Ends"
                type="date"
                value={end}
                containerClassName="flex-1"
                onChange={(e) => setEnd(e.target.value)}
              />
            </div>
          ) : (
            <p className="text-xs text-court-fg-muted">
              A milestone is cumulative all time, so it has no start or end date.
            </p>
          )}

          {showParent && (
            <Select
              label="Rolls up into (optional)"
              value={parentGoalId}
              onChange={(e) => setParentGoalId(e.target.value)}
            >
              <option value="">No parent</option>
              {parentOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </Select>
          )}

          {isRatio && (
            <p className="-mt-1 text-xs text-court-fg-muted">
              An average deal size converges rather than accumulating, so it
              does not roll up into a longer goal and gets no progress bar.
            </p>
          )}

          <Textarea
            label="Notes (optional)"
            value={notes}
            rows={2}
            onChange={(e) => setNotes(e.target.value)}
          />

          {needsApproval && (
            <p className="text-xs text-court-fg-muted">
              You can request a company goal but not approve one, so this will
              be submitted for approval before it starts tracking.
            </p>
          )}

          {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button variant="primary" onClick={submit} disabled={saving}>
              {submitLabel}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// The Add Goal entry point, replacing the disabled placeholder.
export function GoalsAddButton(props: {
  assignableUsers: AssignableUser[];
  parentOptions: ParentGoalOption[];
  canApprove: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        Add Goal
      </Button>
      <GoalFormModal open={open} onClose={() => setOpen(false)} {...props} />
    </>
  );
}
