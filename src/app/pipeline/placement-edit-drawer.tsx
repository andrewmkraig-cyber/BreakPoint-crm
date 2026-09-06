"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronUp, Loader2, PartyPopper, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input, Textarea, Select } from "@/components/ui/input";
import { StageBadge } from "@/components/stage-badge";
import { TabStrip } from "@/components/ui/tab-strip";
import { cn } from "@/lib/utils";
import { updatePlacement } from "@/app/pipeline/placement-update-action";
import { buildDealAnnouncement } from "@/app/pipeline/deal-announcement-action";
import { useComposerManager } from "@/lib/composer-manager";
import { LEAD_SOURCES } from "@/lib/lead-sources";
import { DEAL_TYPES, DEAL_TYPE_LABEL, normalizeDealType, type DealType } from "@/lib/deal-type";
import {
  formatPlacementCompensation,
  normalizePlacementCompensationType,
  resolvePlacementFee,
  seedFlatFeeOverride,
  type PlacementCompensationType,
} from "@/lib/placement-compensation";

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
  acceptedCompensationType: PlacementCompensationType | null;
  feeTotal: number | null;
  feePercentage: number | null;
  minFee: number | null;
  placementNotes: string | null;
  candidateSource: string | null;
  // Placement.dealType. Absent on consumers that don't thread it yet, in
  // which case the drawer opens on "new" and Save writes that value.
  dealType?: string | null;
  // Placement.cityOverride. Empty = fall back to client.location.city
  // when the dashboard derives the per-placement city.
  cityOverride: string | null;
  // Custom payment agreement. All optional: the consumers that render
  // this drawer do not yet thread these values into the context, so when
  // a field is absent the section opens off/empty and Save leaves the
  // matching column untouched (see handleSave). Once a consumer provides
  // them the section round-trips like every other field with no drawer
  // change. customGuaranteeDate is an ISO string, normalized to the
  // "YYYY-MM-DD" shape the date input wants (same as expectedStartDate).
  useCustomTerms?: boolean;
  installmentCount?: number | null;
  inst1Amount?: number | null;
  inst1DaysAfterStart?: number | null;
  inst2Amount?: number | null;
  inst2DaysAfterStart?: number | null;
  inst3Amount?: number | null;
  inst3DaysAfterStart?: number | null;
  customGuaranteeDate?: string | null;
};

// Lead source options — canonical list shared with the candidate-
// profile RecordPlacementModal. See src/lib/lead-sources.ts.
const SOURCE_OPTIONS = LEAD_SOURCES;

type Props = {
  open: boolean;
  context: PlacementDrawerContext | null;
  onClose: () => void;
};

// Compact sizing for the drawer's shared rect-framed fields: the bespoke
// INPUT_CLS rendered a 38px-tall row at 13.5px text, so the migrated <Input>/
// <Select> keep that height (frame) + font (control) for an identical density.
const FIELD_FRAME_CLS = "h-[38px]";
const FIELD_TEXT_CLS = "text-[13.5px]";

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

// "Days after start" maps to an Int column, so coerce to a whole number.
function parseIntOrNull(value: string): number | null {
  const t = value.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

export function PlacementEditDrawer({ open, context, onClose }: Props) {
  const router = useRouter();
  const composer = useComposerManager();
  const [pending, startTransition] = useTransition();
  const [announcing, setAnnouncing] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [salary, setSalary] = useState("");
  const [salaryType, setSalaryType] = useState<PlacementCompensationType>("salary");
  const [feeTotal, setFeeTotal] = useState("");
  const [feePct, setFeePct] = useState("");
  const [minFee, setMinFee] = useState("");
  const [notes, setNotes] = useState("");
  const [source, setSource] = useState("");
  const [dealType, setDealType] = useState<DealType>("new");
  const [city, setCity] = useState("");

  // Custom Payment Agreement section. Collapsed by default; the fields
  // below the toggle are grayed out and inert until useCustomTerms is on.
  const [termsOpen, setTermsOpen] = useState(false);
  const [useCustomTerms, setUseCustomTerms] = useState(false);
  const [installmentCount, setInstallmentCount] = useState<1 | 2 | 3>(1);
  const [inst1Amount, setInst1Amount] = useState("");
  const [inst1Days, setInst1Days] = useState("");
  const [inst2Amount, setInst2Amount] = useState("");
  const [inst2Days, setInst2Days] = useState("");
  const [inst3Amount, setInst3Amount] = useState("");
  const [inst3Days, setInst3Days] = useState("");
  const [guaranteeDate, setGuaranteeDate] = useState("");

  // Re-seed the form whenever a different placement is loaded into the
  // drawer (or the same one is re-opened after a close). Keying on
  // placementId + open keeps the inputs from leaking edits across rows.
  useEffect(() => {
    if (!context) return;
    setStartDate(isoToDateInput(context.expectedStartDate));
    setSalary(context.acceptedSalary != null ? String(context.acceptedSalary) : "");
    setSalaryType(normalizePlacementCompensationType(context.acceptedCompensationType));
    // The fee box is a flat OVERRIDE, so it seeds empty whenever the fee can
    // be calculated from compensation + fee % — pre-filling it from the saved
    // feeTotal silently froze the fee, and a later comp change wouldn't move
    // it. seedFlatFeeOverride only pre-fills when nothing is computable.
    setFeeTotal(
      seedFlatFeeOverride({
        amount: context.acceptedSalary,
        compensationType: normalizePlacementCompensationType(
          context.acceptedCompensationType,
        ),
        feePercentage: context.feePercentage,
        feeTotal: context.feeTotal,
      }),
    );
    setFeePct(context.feePercentage != null ? String(context.feePercentage) : "");
    setMinFee(context.minFee != null ? String(context.minFee) : "");
    setNotes(context.placementNotes ?? "");
    setSource(context.candidateSource ?? "");
    setDealType(normalizeDealType(context.dealType));
    setCity(context.cityOverride ?? "");

    setUseCustomTerms(context.useCustomTerms ?? false);
    const seededCount = context.installmentCount;
    setInstallmentCount(seededCount === 2 || seededCount === 3 ? seededCount : 1);
    setInst1Amount(context.inst1Amount != null ? String(context.inst1Amount) : "");
    setInst1Days(
      context.inst1DaysAfterStart != null ? String(context.inst1DaysAfterStart) : "",
    );
    setInst2Amount(context.inst2Amount != null ? String(context.inst2Amount) : "");
    setInst2Days(
      context.inst2DaysAfterStart != null ? String(context.inst2DaysAfterStart) : "",
    );
    setInst3Amount(context.inst3Amount != null ? String(context.inst3Amount) : "");
    setInst3Days(
      context.inst3DaysAfterStart != null ? String(context.inst3DaysAfterStart) : "",
    );
    setGuaranteeDate(isoToDateInput(context.customGuaranteeDate ?? null));
    // Always reopen collapsed so the section never carries open-state
    // across different placements.
    setTermsOpen(false);
  }, [context, open]);

  // Live fee resolution, shared with the candidate-profile Offer / Record
  // Placement dialogs so both surfaces agree on what a placement's fee is.
  // The drawer saves `fee.feeTotal`, never the raw override box.
  const salaryNum = parseNumberOrNull(salary);
  const fee = resolvePlacementFee({
    amount: salaryNum,
    compensationType: salaryType,
    feePercentage: parseNumberOrNull(feePct),
    minFee: parseNumberOrNull(minFee),
    overrideAmount: parseNumberOrNull(feeTotal),
  });

  // Opens the company-wide deal announcement as a DRAFT. Nothing is sent
  // here: Ace fills in the facts (fee, dates, industry, lead source), the
  // recipient list (everyone in the org, with the closer in Cc so Reply All
  // reaches them), and pins the sender to deals@. The recruiter writes the
  // story and drops the photo into the composer body, then hits Send there.
  //
  // Deliberately NOT wired to save: announcing is its own decision, and a
  // recruiter editing a fee months later must not re-broadcast the deal.
  async function handleAnnounce() {
    if (!context || announcing) return;
    setAnnouncing(true);
    try {
      const result = await buildDealAnnouncement(context.placementId);
      if (!result.ok) {
        toast.error("Couldn't build the announcement", {
          description: result.error,
        });
        return;
      }
      const { draft } = result;
      composer.open({
        defaultTo: draft.to,
        defaultCc: draft.cc,
        defaultSubject: draft.subject,
        defaultBody: draft.bodyHtml,
        lockedSendAsEmail: draft.fromEmail,
        // "people", not "teammates": the count includes the standing
        // outside Cc (DEAL_ANNOUNCEMENT_CC), so calling them all teammates would
        // misdescribe who is about to receive this.
        modalTitle: `Announce deal to ${draft.recipientCount} ${draft.recipientCount === 1 ? "person" : "people"}`,
        // No templates or merge fields: this draft is fully assembled and
        // applying a template would wipe the facts block.
        templates: [],
        mergeContext: {},
        nonBlocking: true,
      });
      onClose();
    } catch (err) {
      toast.error("Couldn't build the announcement", {
        description: err instanceof Error ? err.message : "Please try again.",
      });
    } finally {
      setAnnouncing(false);
    }
  }

  function handleSave() {
    if (!context) return;
    startTransition(async () => {
      // Only write the custom-term columns when the drawer actually holds
      // their state: the recruiter enabled the section this session, or a
      // consumer seeded the values into the context (context.useCustomTerms
      // is then defined). Otherwise leave them untouched so a routine
      // re-save can't wipe terms the drawer never loaded.
      const termsLoaded = context.useCustomTerms !== undefined;
      const termsPayload =
        useCustomTerms || termsLoaded
          ? {
              useCustomTerms,
              installmentCount: useCustomTerms ? installmentCount : null,
              inst1Amount: useCustomTerms ? parseNumberOrNull(inst1Amount) : null,
              inst1DaysAfterStart: useCustomTerms ? parseIntOrNull(inst1Days) : null,
              inst2Amount:
                useCustomTerms && installmentCount >= 2
                  ? parseNumberOrNull(inst2Amount)
                  : null,
              inst2DaysAfterStart:
                useCustomTerms && installmentCount >= 2
                  ? parseIntOrNull(inst2Days)
                  : null,
              inst3Amount:
                useCustomTerms && installmentCount >= 3
                  ? parseNumberOrNull(inst3Amount)
                  : null,
              inst3DaysAfterStart:
                useCustomTerms && installmentCount >= 3
                  ? parseIntOrNull(inst3Days)
                  : null,
              customGuaranteeDate:
                useCustomTerms && guaranteeDate.trim() ? guaranteeDate.trim() : null,
            }
          : {};

      const res = await updatePlacement({
        placementId: context.placementId,
        expectedStartDate: startDate.trim() ? startDate.trim() : null,
        acceptedSalary: parseNumberOrNull(salary),
        acceptedCompensationType: salaryType,
        // Resolved fee, not the override box: an empty box means "calculate
        // it", which must not persist as a null fee.
        feeTotal: fee.feeTotal > 0 ? fee.feeTotal : null,
        feePercentage: parseNumberOrNull(feePct),
        minFee: parseNumberOrNull(minFee),
        placementNotes: notes,
        candidateSource: source.trim() ? source.trim() : null,
        dealType,
        cityOverride: city.trim() ? city.trim() : null,
        ...termsPayload,
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

  // Visible installment rows are sliced to the selected count; each row
  // owns its own amount + days-after-start state.
  const installmentFields = [
    { n: 1, amount: inst1Amount, setAmount: setInst1Amount, days: inst1Days, setDays: setInst1Days },
    { n: 2, amount: inst2Amount, setAmount: setInst2Amount, days: inst2Days, setDays: setInst2Days },
    { n: 3, amount: inst3Amount, setAmount: setInst3Amount, days: inst3Days, setDays: setInst3Days },
  ];

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
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                frameClassName={FIELD_FRAME_CLS}
                className={FIELD_TEXT_CLS}
              />
            </div>
            <div>
              <FieldLabel>Compensation</FieldLabel>
              <div className="grid grid-cols-[minmax(0,1fr)_6.75rem] gap-2">
                <Input
                  type="number"
                  step={salaryType === "hourly" ? "0.01" : "1"}
                  inputMode="decimal"
                  min={0}
                  value={salary}
                  onChange={(e) => setSalary(e.target.value)}
                  frameClassName={FIELD_FRAME_CLS}
                  className={FIELD_TEXT_CLS}
                />
                <Select
                  value={salaryType}
                  onChange={(e) =>
                    setSalaryType(
                      normalizePlacementCompensationType(e.target.value),
                    )
                  }
                  frameClassName={FIELD_FRAME_CLS}
                  className={FIELD_TEXT_CLS}
                  aria-label="Compensation type"
                >
                  <option value="salary">Salary</option>
                  <option value="hourly">Hourly</option>
                </Select>
              </div>
            </div>
            <div>
              <FieldLabel>Fee percentage (%)</FieldLabel>
              <Input
                type="number"
                step="0.01"
                inputMode="decimal"
                min={0}
                value={feePct}
                onChange={(e) => setFeePct(e.target.value)}
                frameClassName={FIELD_FRAME_CLS}
                className={FIELD_TEXT_CLS}
              />
            </div>
            <div>
              <FieldLabel>Min fee (USD)</FieldLabel>
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                value={minFee}
                onChange={(e) => setMinFee(e.target.value)}
                frameClassName={FIELD_FRAME_CLS}
                className={FIELD_TEXT_CLS}
              />
            </div>
            <div>
              <FieldLabel>Fee amount (flat, overrides calc)</FieldLabel>
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                value={feeTotal}
                onChange={(e) => setFeeTotal(e.target.value)}
                frameClassName={FIELD_FRAME_CLS}
                className={FIELD_TEXT_CLS}
              />
            </div>
          </div>

          {/* What Save will actually write. Empty flat box = calculated, so
              the number has to be visible before saving rather than implied. */}
          <div className="flex items-baseline justify-between gap-3 rounded-lg border border-court-border-soft bg-court-surface-subtle px-3 py-2">
            <div className="min-w-0">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-court-fg-muted">
                {fee.usedOverride
                  ? "Fee (flat override)"
                  : fee.usedMinFee
                    ? "Fee (min fee)"
                    : "Fee (calculated)"}
              </div>
              <div className="mt-0.5 truncate text-[11px] text-court-fg-muted">
                {fee.usedOverride
                  ? "Flat-fee amount; compensation × fee % ignored."
                  : fee.basisAmount != null && parseNumberOrNull(feePct)
                    ? `${formatPlacementCompensation(fee.basisAmount, "USD", "salary")}${
                        salaryType === "hourly" ? " annualized" : ""
                      } × ${feePct}%${
                        fee.usedMinFee
                          ? ` (below ${formatPlacementCompensation(
                              parseNumberOrNull(minFee),
                              "USD",
                              "salary",
                            )} min fee)`
                          : ""
                      }`
                    : "Enter compensation + fee %, or a flat amount."}
              </div>
            </div>
            <div className="shrink-0 font-semibold tabular-nums text-court-fg">
              {fee.feeTotal > 0
                ? formatPlacementCompensation(fee.feeTotal, "USD", "salary")
                : "—"}
            </div>
          </div>

          <div>
            <FieldLabel>City</FieldLabel>
            <Input
              type="text"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              frameClassName={FIELD_FRAME_CLS}
              className={FIELD_TEXT_CLS}
            />
          </div>

          <div>
            <FieldLabel>Lead Source</FieldLabel>
            <Select
              value={source}
              onChange={(e) => setSource(e.target.value)}
              frameClassName={FIELD_FRAME_CLS}
              className={FIELD_TEXT_CLS}
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
            </Select>
          </div>

          {/* New placement vs replacement. Beside Lead Source because both
              classify the deal rather than price it, and both feed the
              company-wide announcement email. */}
          <div>
            <FieldLabel>Deal Type</FieldLabel>
            <Select
              value={dealType}
              onChange={(e) => setDealType(e.target.value as DealType)}
              frameClassName={FIELD_FRAME_CLS}
              className={FIELD_TEXT_CLS}
            >
              {DEAL_TYPES.map((opt) => (
                <option key={opt} value={opt}>
                  {DEAL_TYPE_LABEL[opt]}
                </option>
              ))}
            </Select>
          </div>

          <div>
            <FieldLabel>Notes</FieldLabel>
            <Textarea
              rows={4}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="resize-y text-[13.5px] leading-relaxed"
            />
          </div>

          {/* Custom Payment Agreement — collapsible advanced section.
              Collapsed by default; the chevron toggles it. */}
          <div className="border-t border-court-border pt-5">
            <button
              type="button"
              onClick={() => setTermsOpen((o) => !o)}
              aria-expanded={termsOpen}
              className="flex w-full items-center justify-between text-left"
            >
              <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-court-fg-muted">
                Custom Payment Agreement
              </span>
              {termsOpen ? (
                <ChevronUp className="h-4 w-4 text-court-fg-muted" />
              ) : (
                <ChevronDown className="h-4 w-4 text-court-fg-muted" />
              )}
            </button>

            {termsOpen ? (
              <div className="mt-4 space-y-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="text-sm font-semibold text-court-fg">
                    Use custom payment terms
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={useCustomTerms}
                    aria-label="Use custom payment terms"
                    onClick={() => setUseCustomTerms((v) => !v)}
                    className={cn(
                      "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors",
                      useCustomTerms ? "bg-court-brand" : "bg-court-border",
                    )}
                  >
                    <span
                      className={cn(
                        "inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform",
                        useCustomTerms ? "translate-x-[22px]" : "translate-x-0.5",
                      )}
                    />
                  </button>
                </div>

                <div
                  className={cn(
                    "space-y-4",
                    !useCustomTerms && "pointer-events-none opacity-50",
                  )}
                >
                  <div>
                    <FieldLabel>Number of installments</FieldLabel>
                    <TabStrip
                      ariaLabel="Number of installments"
                      items={[
                        { id: "1", label: "1" },
                        { id: "2", label: "2" },
                        { id: "3", label: "3" },
                      ]}
                      activeId={String(installmentCount)}
                      onChange={(id) =>
                        setInstallmentCount(Number(id) as 1 | 2 | 3)
                      }
                    />
                  </div>

                  {installmentFields.slice(0, installmentCount).map((f) => (
                    <div key={f.n}>
                      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-court-fg">
                        {`Installment ${f.n}`}
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <FieldLabel>Amount ($)</FieldLabel>
                          <Input
                            type="number"
                            inputMode="numeric"
                            min={0}
                            value={f.amount}
                            onChange={(e) => f.setAmount(e.target.value)}
                            placeholder="0"
                            frameClassName={FIELD_FRAME_CLS}
                            className={FIELD_TEXT_CLS}
                          />
                        </div>
                        <div>
                          <FieldLabel>Days after start</FieldLabel>
                          <Input
                            type="number"
                            inputMode="numeric"
                            min={0}
                            step={1}
                            value={f.days}
                            onChange={(e) => f.setDays(e.target.value)}
                            placeholder="0"
                            frameClassName={FIELD_FRAME_CLS}
                            className={FIELD_TEXT_CLS}
                          />
                        </div>
                      </div>
                    </div>
                  ))}

                  <div>
                    <FieldLabel>Guarantee end date (custom)</FieldLabel>
                    <Input
                      type="date"
                      value={guaranteeDate}
                      onChange={(e) => setGuaranteeDate(e.target.value)}
                      frameClassName={FIELD_FRAME_CLS}
                      className={FIELD_TEXT_CLS}
                    />
                    <div className="mt-1 text-[11px] text-court-fg-muted">
                      Overrides the guarantee days field above when set.
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex items-center gap-2.5 border-t border-court-border bg-court-surface-subtle px-6 py-4">
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={onClose}
            disabled={pending}
            className="h-9 rounded-md px-4 text-[12.5px]"
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="apply"
            size="md"
            onClick={() => void handleAnnounce()}
            disabled={pending || announcing || !context}
            title="Open a company-wide announcement draft for this deal"
            className="h-9 gap-1.5 rounded-md px-4 text-[12.5px]"
          >
            {announcing ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <PartyPopper className="h-3.5 w-3.5" />
            )}
            Announce deal
          </Button>
          <div className="flex-1" />
          <Button
            type="button"
            size="md"
            onClick={handleSave}
            disabled={pending || !context}
            className="h-9 gap-1.5 rounded-md px-4 text-[12.5px]"
          >
            {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            Save
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
