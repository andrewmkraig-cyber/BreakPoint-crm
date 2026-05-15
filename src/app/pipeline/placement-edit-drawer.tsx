"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { StageBadge } from "@/components/stage-badge";
import { cn } from "@/lib/utils";
import { updatePlacement } from "@/app/pipeline/placement-update-action";

export type PlacementDrawerContext = {
  placementId: string;
  candidateName: string;
  clientName: string;
  jobTitle: string;
  stage: "offer" | "pending_start" | "hired";
  stageLabel: string;
  // ISO string (Date.toISOString) — the drawer normalizes to the
  // "YYYY-MM-DD" shape <input type="date"> expects.
  expectedStartDate: string | null;
  acceptedSalary: number | null;
  feeTotal: number | null;
  feePercentage: number | null;
  placementNotes: string | null;
  candidateSource: string | null;
  // Placement.cityOverride. Empty = fall back to client.location.city
  // when the dashboard derives the per-placement city.
  cityOverride: string | null;
};

// Lead source channels the desk uses. Stored as the display string so
// the Financial Performance "By source" chart groups cleanly.
const SOURCE_OPTIONS = [
  "Network",
  "Referral",
  "LinkedIn",
  "Indeed",
  "Cold Outreach",
  "BreakPoint Website",
  "Other",
] as const;

type Props = {
  open: boolean;
  context: PlacementDrawerContext | null;
  onClose: () => void;
};

const INPUT_CLS =
  "h-[38px] w-full rounded-md border border-court-border bg-court-surface px-3 text-[13.5px] text-court-fg outline-none placeholder:text-court-fg-dim focus:border-court-brand focus:ring-2 focus:ring-court-brand/20";

function isoToDateInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function parseNumberOrNull(value: string): number | null {
  const t = value.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function PlacementEditDrawer({ open, context, onClose }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [startDate, setStartDate] = useState("");
  const [salary, setSalary] = useState("");
  const [feeTotal, setFeeTotal] = useState("");
  const [feePct, setFeePct] = useState("");
  const [notes, setNotes] = useState("");
  const [source, setSource] = useState("");
  const [city, setCity] = useState("");

  // Re-seed the form whenever a different placement is loaded into the
  // drawer (or the same one is re-opened after a close). Keying on
  // placementId + open keeps the inputs from leaking edits across rows.
  useEffect(() => {
    if (!context) return;
    setStartDate(isoToDateInput(context.expectedStartDate));
    setSalary(context.acceptedSalary != null ? String(context.acceptedSalary) : "");
    setFeeTotal(context.feeTotal != null ? String(context.feeTotal) : "");
    setFeePct(context.feePercentage != null ? String(context.feePercentage) : "");
    setNotes(context.placementNotes ?? "");
    setSource(context.candidateSource ?? "");
    setCity(context.cityOverride ?? "");
  }, [context, open]);

  function handleSave() {
    if (!context) return;
    startTransition(async () => {
      const res = await updatePlacement({
        placementId: context.placementId,
        expectedStartDate: startDate.trim() ? startDate.trim() : null,
        acceptedSalary: parseNumberOrNull(salary),
        feeTotal: parseNumberOrNull(feeTotal),
        feePercentage: parseNumberOrNull(feePct),
        placementNotes: notes,
        candidateSource: source.trim() ? source.trim() : null,
        cityOverride: city.trim() ? city.trim() : null,
      });
      if (!res.ok) {
        toast.error("Couldn't save changes", { description: res.error });
        return;
      }
      toast.success("Placement updated");
      onClose();
      router.refresh();
    });
  }

  return (
    <>
      <div
        onClick={onClose}
        className={cn(
          // Leaflet renders panes up to z-index 700, so the drawer
          // overlay + aside live above that band on z-[1100] / z-[1101]
          // (matching the modal precedent in candidates-view.tsx).
          "fixed inset-0 z-[1100] bg-black/30 backdrop-blur-[2px] transition-opacity",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        aria-hidden="true"
      />
      <aside
        role="dialog"
        aria-label="Edit placement"
        className={cn(
          "fixed inset-y-0 right-0 z-[1101] flex w-full max-w-[520px] flex-col border-l border-court-border bg-court-surface shadow-2xl transition-transform duration-200",
          open ? "translate-x-0" : "translate-x-full",
        )}
      >
        <div className="flex items-start gap-3 border-b border-court-border px-6 pb-4 pt-5">
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-court-fg-muted">
              Edit placement
            </div>
            <h2 className="mt-1 truncate font-serif text-[22px] font-bold tracking-tight text-court-fg">
              {context?.candidateName ?? "Placement"}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close drawer"
            className="grid h-9 w-9 place-items-center rounded-full border border-court-border bg-court-surface text-court-fg-muted hover:border-court-brand/40 hover:bg-court-brand-tint hover:text-court-brand-dark"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          <div className="grid grid-cols-2 gap-3">
            <ReadOnly label="Candidate" value={context?.candidateName ?? "—"} />
            <ReadOnly label="Client" value={context?.clientName ?? "—"} />
            <ReadOnly label="Job" value={context?.jobTitle ?? "—"} />
            <div>
              <FieldLabel>Stage</FieldLabel>
              <div className="flex h-[38px] items-center">
                {context ? (
                  <StageBadge bucket={context.stage} label={context.stageLabel} />
                ) : null}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <FieldLabel>Start date</FieldLabel>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className={INPUT_CLS}
              />
            </div>
            <div>
              <FieldLabel>Base salary (USD)</FieldLabel>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                value={salary}
                onChange={(e) => setSalary(e.target.value)}
                placeholder="0"
                className={INPUT_CLS}
              />
            </div>
            <div>
              <FieldLabel>Fee amount (USD)</FieldLabel>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                value={feeTotal}
                onChange={(e) => setFeeTotal(e.target.value)}
                placeholder="0"
                className={INPUT_CLS}
              />
            </div>
            <div>
              <FieldLabel>Fee percentage (%)</FieldLabel>
              <input
                type="number"
                step="0.01"
                inputMode="decimal"
                min={0}
                value={feePct}
                onChange={(e) => setFeePct(e.target.value)}
                placeholder="0"
                className={INPUT_CLS}
              />
            </div>
          </div>

          <div>
            <FieldLabel>City</FieldLabel>
            <input
              type="text"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="e.g. Pittsburgh — leave blank to use client's city"
              className={INPUT_CLS}
            />
          </div>

          <div>
            <FieldLabel>Lead Source</FieldLabel>
            <select
              value={source}
              onChange={(e) => setSource(e.target.value)}
              className={INPUT_CLS}
            >
              <option value="">—</option>
              {SOURCE_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
              {/* Preserve any legacy value (e.g. "Pin", "Apollo BD",
                  "Apollo") that isn't in the canonical option list so
                  it shows selected instead of silently reverting to "—". */}
              {source &&
                !SOURCE_OPTIONS.some(
                  (o) => o.toLowerCase() === source.toLowerCase(),
                ) && (
                  <option value={source}>{source}</option>
                )}
            </select>
          </div>

          <div>
            <FieldLabel>Notes</FieldLabel>
            <textarea
              rows={4}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Internal notes on this placement"
              className="w-full resize-y rounded-md border border-court-border bg-court-surface px-3 py-2.5 text-[13.5px] leading-relaxed text-court-fg outline-none placeholder:text-court-fg-dim focus:border-court-brand focus:ring-2 focus:ring-court-brand/20"
            />
          </div>
        </div>

        <div className="flex items-center gap-2.5 border-t border-court-border bg-court-surface-subtle px-6 py-4">
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={onClose}
            disabled={pending}
            className="h-9 rounded-full px-4 text-[12.5px]"
          >
            Cancel
          </Button>
          <div className="flex-1" />
          <Button
            type="button"
            size="md"
            onClick={handleSave}
            disabled={pending || !context}
            className="h-9 gap-1.5 rounded-full px-4 text-[12.5px]"
          >
            {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            Save changes
          </Button>
        </div>
      </aside>
    </>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-court-fg-muted">
      {children}
    </div>
  );
}

function ReadOnly({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <div className="flex h-[38px] w-full items-center rounded-md border border-court-border bg-court-surface-subtle px-3 text-[13.5px] text-court-fg-muted">
        <span className="truncate">{value}</span>
      </div>
    </div>
  );
}
