"use client";

// The "Fell off" block that sits above Cancel in both placement editors
// (the candidate-profile Edit Placement dialog and the /pipeline drawer).
//
// Two states:
//   - Standing: an amber "Fall Off" button. Clicking it expands an
//     inline form: date left, reason, what happened, "we owe a
//     replacement", refund amount + date. Save calls markPlacementFellOff.
//   - Fallen off: a status card ("Fell off Oct 3, 2026 · Laid off", chips
//     for Replacement owed / $5,000 refunded) with Edit and Undo.
//
// It is inline rather than a nested popup so it works identically inside
// the dialog and the drawer, neither of which exposes a shared modal.

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, RotateCcw, UserMinus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/input";
import { cn, formatDate } from "@/lib/utils";
import {
  clearPlacementFellOff,
  markPlacementFellOff,
} from "@/app/pipeline/placement-fell-off-action";
import {
  FELL_OFF_REASONS,
  FELL_OFF_REASON_LABEL,
  fellOffChips,
  normalizeFellOffReason,
  type FellOffReason,
  type FellOffSnapshot,
} from "@/lib/placement-fell-off";

const EMPTY: FellOffSnapshot = {
  fellOffAt: null,
  fellOffReason: null,
  fellOffNotes: null,
  replacementOwed: false,
  refundAmount: null,
  refundedAt: null,
};

function isoToDateInput(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "";
}

function todayInput(): string {
  return new Date().toISOString().slice(0, 10);
}

export function FellOffSection({
  placementId,
  feeTotal,
  snapshot,
  disabled,
  onSaved,
  className,
}: {
  placementId: string;
  // Resolved fee in whole dollars, used only to cap the refund box.
  feeTotal: number | null;
  snapshot: FellOffSnapshot | null | undefined;
  disabled?: boolean;
  // Fired after a successful save or undo, after router.refresh().
  onSaved?: () => void;
  className?: string;
}) {
  const router = useRouter();
  // What this section last saved. The dialogs hand in the row snapshot they
  // opened with and do not re-read it until they are reopened, so without
  // this the block would still say "Fall Off" right after a save.
  // Cleared whenever the parent's snapshot actually changes.
  const [local, setLocal] = useState<FellOffSnapshot | null>(null);
  const propKey = [
    snapshot?.fellOffAt ?? "",
    snapshot?.fellOffReason ?? "",
    snapshot?.fellOffNotes ?? "",
    String(snapshot?.replacementOwed ?? false),
    String(snapshot?.refundAmount ?? ""),
    snapshot?.refundedAt ?? "",
  ].join("|");
  useEffect(() => {
    setLocal(null);
  }, [propKey]);
  const snap = local ?? snapshot ?? EMPTY;
  const fellOff = Boolean(snap.fellOffAt);
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const [date, setDate] = useState(() => isoToDateInput(snap.fellOffAt) || todayInput());
  const [reason, setReason] = useState<FellOffReason>(() =>
    normalizeFellOffReason(snap.fellOffReason ?? "laid_off"),
  );
  const [notes, setNotes] = useState(snap.fellOffNotes ?? "");
  const [replacementOwed, setReplacementOwed] = useState(
    fellOff ? snap.replacementOwed : true,
  );
  const [refund, setRefund] = useState(
    snap.refundAmount != null && snap.refundAmount > 0 ? String(snap.refundAmount) : "",
  );
  const [refundDate, setRefundDate] = useState(isoToDateInput(snap.refundedAt));

  function openForm() {
    setErr(null);
    setDate(isoToDateInput(snap.fellOffAt) || todayInput());
    setReason(normalizeFellOffReason(snap.fellOffReason ?? "laid_off"));
    setNotes(snap.fellOffNotes ?? "");
    setReplacementOwed(fellOff ? snap.replacementOwed : true);
    setRefund(snap.refundAmount != null && snap.refundAmount > 0 ? String(snap.refundAmount) : "");
    setRefundDate(isoToDateInput(snap.refundedAt));
    setOpen(true);
  }

  function save() {
    setErr(null);
    const refundNum = refund.trim() ? Number(refund.replace(/[$,\s]/g, "")) : null;
    if (refundNum != null && !Number.isFinite(refundNum)) {
      setErr("Refund amount must be a number.");
      return;
    }
    startTransition(async () => {
      const res = await markPlacementFellOff({
        placementId,
        fellOffAt: date,
        reason,
        notes,
        replacementOwed,
        refundAmount: refundNum,
        refundedAt: refundDate || null,
      });
      if (!res.ok) {
        setErr(res.error);
        toast.error("Couldn't save the fall off", { description: res.error });
        return;
      }
      const bits = fellOffChips({ replacementOwed, refundAmount: refundNum });
      setLocal({
        fellOffAt: `${date}T00:00:00.000Z`,
        fellOffReason: reason,
        fellOffNotes: notes.trim() || null,
        replacementOwed,
        refundAmount: refundNum && refundNum > 0 ? Math.round(refundNum) : null,
        refundedAt:
          refundNum && refundNum > 0 ? `${refundDate || date}T00:00:00.000Z` : null,
      });
      toast.success("Placement fell off", {
        description: bits.length
          ? bits.join(" · ")
          : "The deal stays on the books. No replacement owed, no refund.",
      });
      setOpen(false);
      router.refresh();
      onSaved?.();
    });
  }

  function undo() {
    setErr(null);
    startTransition(async () => {
      const res = await clearPlacementFellOff(placementId);
      if (!res.ok) {
        setErr(res.error);
        toast.error("Couldn't undo", { description: res.error });
        return;
      }
      setLocal({ ...EMPTY });
      toast.success("Fall-off cleared", {
        description: "The placement reads as standing again.",
      });
      setOpen(false);
      router.refresh();
      onSaved?.();
    });
  }

  const refundTooBig =
    feeTotal != null &&
    refund.trim() !== "" &&
    Number(refund.replace(/[$,\s]/g, "")) > feeTotal;

  return (
    <div className={cn("border-t border-court-border/40 pt-3", className)}>
      {fellOff && !open ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-900 dark:bg-amber-950/30">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-amber-800 dark:text-amber-200">
              <UserMinus className="h-3.5 w-3.5" />
              Fell off {formatDate(snap.fellOffAt)}
            </span>
            <span className="text-[12px] text-amber-800/80 dark:text-amber-200/80">
              · {FELL_OFF_REASON_LABEL[normalizeFellOffReason(snap.fellOffReason)]}
            </span>
            {fellOffChips(snap).map((chip) => (
              <span
                key={chip}
                className="rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900 dark:border-amber-800 dark:bg-amber-900/50 dark:text-amber-100"
              >
                {chip}
              </span>
            ))}
            {snap.refundedAt && snap.refundAmount ? (
              <span className="text-[11px] text-amber-800/70 dark:text-amber-200/70">
                refunded {formatDate(snap.refundedAt)}
              </span>
            ) : null}
          </div>
          {snap.fellOffNotes ? (
            <p className="mt-1.5 whitespace-pre-wrap text-[12px] leading-relaxed text-amber-900/90 dark:text-amber-100/90">
              {snap.fellOffNotes}
            </p>
          ) : null}
          <div className="mt-2 flex items-center gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={openForm} disabled={pending || disabled}>
              Edit
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={undo}
              disabled={pending || disabled}
              title="Clear the fall off. The placement reads as standing again."
            >
              {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
              Undo
            </Button>
          </div>
        </div>
      ) : !open ? (
        <>
          <Button type="button" variant="apply" size="sm" onClick={openForm} disabled={pending || disabled}>
            <UserMinus className="h-3 w-3" />
            Fall Off
          </Button>
          <p className="mt-1 text-[11px] text-court-fg-muted">
            The candidate started and then left. The deal stays on the books and the
            revenue stays unless you enter a refund. Use this when the client paid and
            you owe them a replacement.
          </p>
        </>
      ) : (
        <div className="rounded-lg border border-amber-200 bg-amber-50/40 p-3 dark:border-amber-900 dark:bg-amber-950/20">
          <div className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-court-fg">
            <UserMinus className="h-3.5 w-3.5 text-amber-600" />
            {fellOff ? "Edit fall off" : "Fall off"}
          </div>
          <div className="grid grid-cols-1 gap-x-3 gap-y-3 sm:grid-cols-2">
            <Input
              label="Date they left"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              disabled={pending}
            />
            <Select
              label="Reason"
              value={reason}
              onChange={(e) => setReason(e.target.value as FellOffReason)}
              disabled={pending}
            >
              {FELL_OFF_REASONS.map((r) => (
                <option key={r} value={r}>
                  {FELL_OFF_REASON_LABEL[r]}
                </option>
              ))}
            </Select>
          </div>
          <div className="mt-3">
            <Textarea
              label="What happened (optional)"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={pending}
              placeholder="Laid off in a department cut, client wants a replacement by December."
            />
          </div>
          <label className="mt-3 flex cursor-pointer items-start gap-2 text-sm text-court-fg">
            <input
              type="checkbox"
              checked={replacementOwed}
              onChange={(e) => setReplacementOwed(e.target.checked)}
              disabled={pending}
              className="mt-0.5 h-4 w-4 rounded border-court-border accent-amber-600"
            />
            <span>
              <span className="font-semibold">We owe the client a replacement</span>
              <span className="block text-[11px] text-court-fg-muted">
                Shows on the Replacements Owed list until a replacement deal is booked against it.
              </span>
            </span>
          </label>
          <div className="mt-3 grid grid-cols-1 gap-x-3 gap-y-3 sm:grid-cols-2">
            <Input
              label="Refund sent back ($, optional)"
              type="number"
              inputMode="numeric"
              min={0}
              value={refund}
              onChange={(e) => setRefund(e.target.value)}
              disabled={pending}
              placeholder="0"
              error={
                refundTooBig && feeTotal != null
                  ? `More than the $${feeTotal.toLocaleString("en-US")} fee`
                  : undefined
              }
            />
            <Input
              label="Refund date"
              type="date"
              value={refundDate}
              onChange={(e) => setRefundDate(e.target.value)}
              disabled={pending || !refund.trim()}
            />
          </div>
          <p className="mt-1.5 text-[11px] text-court-fg-muted">
            A refund comes off Revenue and Collected on the refund date. Leave it blank if
            the client kept paying in full. Refund date defaults to the date they left.
          </p>
          {err ? (
            <div className="mt-2 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-800">
              <AlertTriangle className="mr-1 inline h-3 w-3" />
              {err}
            </div>
          ) : null}
          <div className="mt-3 flex items-center gap-2">
            <Button type="button" variant="apply" size="sm" onClick={save} disabled={pending || disabled || refundTooBig || !date}>
              {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <UserMinus className="h-3 w-3" />}
              {fellOff ? "Save changes" : "Fall Off"}
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(false)} disabled={pending}>
              Never mind
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
