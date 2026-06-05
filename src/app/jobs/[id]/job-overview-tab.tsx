"use client";

import {
  Briefcase,
  CheckCircle2,
  CircleDashed,
  Copy,
  DollarSign,
  ExternalLink,
  EyeOff,
  Loader2,
  MapPin,
  Pencil,
  Percent,
  Save,
  Users,
  X,
} from "lucide-react";
import {
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { cn, formatDate } from "@/lib/utils";
import { LabeledField } from "@/app/candidates/[id]/editable-helpers";
import { INPUT_FRAME_RECT_CLASS, INPUT_CONTROL_CLASS } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { JobOverviewActionButtons } from "@/app/jobs/[id]/job-overview-action-buttons";
import {
  updateJobOverview,
  type JobLifecycle,
  type JobOverviewPatch,
} from "@/app/jobs/[id]/job-overview-actions";

// Overview tab body. Full-width single card with a top-right Edit
// button (mirrors the Client + Candidate overview cards): the whole
// card flips into an edit form, the recruiter changes the fields, then
// one Save batches every change through updateJobOverview and
// router.refresh() so downstream readers (find-matches, Game Plan
// context, pipeline) pick up the new values immediately. Lifecycle
// actions (Inactivate / Make Private / Reactivate / Delete) still ride
// the top bar, so Status / Fee / Last Edited stay read-only here.

export type JobOverviewSnapshot = {
  jobId: string;
  title: string;
  clientName: string;
  locations: string[];
  // Structured location columns backing the inline edit form. Null on
  // loose/region-only legacy jobs — those edit-fields render empty until
  // the recruiter supplies a valid City / State / Zip trio on save.
  locationCity: string | null;
  locationState: string | null;
  locationZip: string | null;
  lifecycle: JobLifecycle;
  employmentType: string | null;
  compensation: string;
  feePct: number | null;
  numberOfOpenings: number | null;
  lastEditedAt: string | null;
  applyLink: string | null;
  // Granular comp fields back the Compensation cell so the edit form can
  // patch lo / hi / currency / frequency without rebuilding from the
  // formatted display string.
  salaryRangeStart: number | null;
  salaryRangeEnd: number | null;
  salaryCurrency: string | null;
  salaryFrequency: "yearly" | "hourly" | null;
};

// Flat draft for the editable fields. Locations join/split on commas;
// salary fields stay strings while editing so partial input ("12", "")
// doesn't fight the number parse until Save.
type Draft = {
  employmentType: string;
  locationCity: string;
  locationState: string;
  locationZip: string;
  salaryLo: string;
  salaryHi: string;
  salaryCcy: string;
  salaryFreq: "yearly" | "hourly";
  openings: string;
};

function buildDraft(s: JobOverviewSnapshot): Draft {
  return {
    employmentType: s.employmentType ?? "",
    locationCity: s.locationCity ?? "",
    locationState: s.locationState ?? "",
    locationZip: s.locationZip ?? "",
    salaryLo: s.salaryRangeStart != null ? String(s.salaryRangeStart) : "",
    salaryHi: s.salaryRangeEnd != null ? String(s.salaryRangeEnd) : "",
    salaryCcy: s.salaryCurrency ?? "USD",
    salaryFreq: s.salaryFrequency === "hourly" ? "hourly" : "yearly",
    openings: s.numberOfOpenings != null ? String(s.numberOfOpenings) : "",
  };
}

export function JobOverviewTab({
  snapshot,
  jobRfId,
  jobCuid,
}: {
  snapshot: JobOverviewSnapshot;
  jobRfId: number | null;
  jobCuid: string | null;
}) {
  const router = useRouter();
  const [state, setState] = useState<JobOverviewSnapshot>(snapshot);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => buildDraft(snapshot));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Per-field inline errors for the required City / State / Zip trio.
  const [cityErr, setCityErr] = useState<string | null>(null);
  const [stateErr, setStateErr] = useState<string | null>(null);
  const [zipErr, setZipErr] = useState<string | null>(null);

  // Snapshot can change under us on revalidate. Refresh the read-only
  // state always; only re-seed the draft when we're not mid-edit so a
  // background refresh never clobbers in-progress typing.
  useEffect(() => {
    setState(snapshot);
    if (!editing) setDraft(buildDraft(snapshot));
  }, [snapshot, editing]);

  function clearLocationErrs() {
    setCityErr(null);
    setStateErr(null);
    setZipErr(null);
  }

  function startEdit() {
    setDraft(buildDraft(state));
    setErr(null);
    clearLocationErrs();
    setEditing(true);
  }

  function onCancel() {
    setDraft(buildDraft(state));
    setErr(null);
    clearLocationErrs();
    setEditing(false);
  }

  async function onSave() {
    if (saving) return;
    setErr(null);
    clearLocationErrs();

    // City / State / Zip are REQUIRED on every edit-save (enforce-on-
    // edit). State must be a 2-letter abbreviation, Zip 5 digits. Same
    // rule the New Job create path enforces; the server re-checks too.
    const city = draft.locationCity.trim();
    const stateAbbr = draft.locationState.trim();
    const zip = draft.locationZip.trim();
    let locationInvalid = false;
    if (!city) {
      setCityErr("City is required.");
      locationInvalid = true;
    }
    if (!stateAbbr) {
      setStateErr("State is required.");
      locationInvalid = true;
    } else if (!/^[A-Za-z]{2}$/.test(stateAbbr)) {
      setStateErr("Use the 2-letter state abbreviation.");
      locationInvalid = true;
    }
    if (!zip) {
      setZipErr("Zip is required.");
      locationInvalid = true;
    } else if (!/^\d{5}$/.test(zip)) {
      setZipErr("Enter a 5-digit US zip code.");
      locationInvalid = true;
    }
    if (locationInvalid) return;

    const lo = parseMoney(draft.salaryLo);
    const hi = parseMoney(draft.salaryHi);
    if (lo === "invalid" || hi === "invalid") {
      setErr("Salary must be a number.");
      toast.error("Salary must be a number.");
      return;
    }
    if (lo != null && hi != null && lo > hi) {
      setErr("Salary low can't be greater than salary high.");
      toast.error("Salary low can't be greater than salary high.");
      return;
    }

    const openTrim = draft.openings.trim();
    const openings = openTrim === "" ? null : Number(openTrim);
    if (
      openings != null &&
      (!Number.isFinite(openings) || !Number.isInteger(openings) || openings < 0)
    ) {
      setErr("Openings must be a positive whole number.");
      toast.error("Openings must be a positive whole number.");
      return;
    }

    const ccy = draft.salaryCcy.trim().toUpperCase().slice(0, 3) || null;
    const employmentType = draft.employmentType.trim() || null;
    const stateUpper = stateAbbr.toUpperCase();

    setSaving(true);

    // Pre-save US location round-trip (Nominatim / Zippopotam), same
    // endpoint the New Job form uses, so a bad city/zip points at the
    // right field. Network errors fail open server-side; the server
    // re-runs the same validators as defense-in-depth.
    try {
      const vres = await fetch("/api/location/validate-us", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ city, zip }),
      });
      if (vres.ok) {
        const vdata = (await vres.json()) as {
          ok: boolean;
          errors: { city?: string; zip?: string };
        };
        if (!vdata.ok) {
          if (vdata.errors.city) setCityErr(vdata.errors.city);
          if (vdata.errors.zip) setZipErr(vdata.errors.zip);
          setSaving(false);
          return;
        }
      }
      // Non-ok response → fail open (matches the lib's policy).
    } catch {
      // Fail open on network errors — the server still re-validates.
    }

    const patch: JobOverviewPatch = {
      employmentType,
      locationCity: city,
      locationState: stateUpper,
      locationZip: zip,
      numberOfOpenings: openings,
      salaryRangeStart: lo,
      salaryRangeEnd: hi,
      salaryCurrency: ccy,
      salaryFrequency: draft.salaryFreq,
    };

    const res = await updateJobOverview({ jobRfId, jobCuid, patch });
    setSaving(false);
    if (!res.ok) {
      setErr(res.error);
      toast.error("Couldn't save", { description: res.error });
      return;
    }

    const nextComp: CompState = {
      salaryRangeStart: lo,
      salaryRangeEnd: hi,
      salaryCurrency: ccy,
      salaryFrequency: draft.salaryFreq,
    };
    const composedLocation = [
      [city, stateUpper].filter(Boolean).join(", "),
      zip,
    ]
      .filter(Boolean)
      .join(" ")
      .trim();
    setState((s) => ({
      ...s,
      employmentType,
      locationCity: city,
      locationState: stateUpper,
      locationZip: zip,
      locations: composedLocation ? [composedLocation] : [],
      numberOfOpenings: openings,
      salaryRangeStart: lo,
      salaryRangeEnd: hi,
      salaryCurrency: ccy,
      salaryFrequency: draft.salaryFreq,
      compensation: formatCompSummary(nextComp),
    }));
    setEditing(false);
    toast.success("Saved");
    router.refresh();
  }

  return (
    <div className="space-y-5">
      <section className="flex flex-wrap items-center justify-end">
        <JobOverviewActionButtons jobId={state.jobId} lifecycle={state.lifecycle} />
      </section>

      <section className="rounded-xl border border-court-border/40 bg-court-surface p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="font-serif text-base font-semibold text-court-fg">Details</h2>
          {!editing && (
            <button
              type="button"
              onClick={startEdit}
              className="inline-flex items-center gap-1 rounded-md border border-court-border bg-court-surface px-2.5 py-1 text-[11px] font-medium text-court-fg-muted shadow-sm transition hover:border-brand/40 hover:text-court-fg"
            >
              <Pencil className="h-3 w-3" /> Edit
            </button>
          )}
        </div>

        {editing ? (
          <div className="mt-3 space-y-3 text-sm">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <LabeledField
                label="Employment"
                value={draft.employmentType}
                onChange={(v) => setDraft({ ...draft, employmentType: v })}
                placeholder="Full-time" frameClassName={INPUT_FRAME_RECT_CLASS}
              />
              <LabeledField
                label="Openings"
                type="number"
                value={draft.openings}
                onChange={(v) => setDraft({ ...draft, openings: v })}
                placeholder="1" frameClassName={INPUT_FRAME_RECT_CLASS}
              />
            </div>

            {/* Location is the required City / State (2-letter) / Zip
                (5-digit) trio — enforced on save, same as the New Job
                form. Rect court-input-rect frame per the Input Field
                Treatment. */}
            <div className="pt-1 text-[11px] font-semibold uppercase tracking-wider text-court-fg-muted">
              Location
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <RectField
                label="City"
                value={draft.locationCity}
                onChange={(v) => {
                  setDraft({ ...draft, locationCity: v });
                  if (cityErr) setCityErr(null);
                }}
                error={cityErr}
              />
              <RectField
                label="State"
                value={draft.locationState}
                onChange={(v) => {
                  setDraft({ ...draft, locationState: v });
                  if (stateErr) setStateErr(null);
                }}
                error={stateErr}
              />
              <RectField
                label="Zip"
                value={draft.locationZip}
                onChange={(v) => {
                  setDraft({ ...draft, locationZip: v });
                  if (zipErr) setZipErr(null);
                }}
                error={zipErr}
              />
            </div>

            <div className="pt-1 text-[11px] font-semibold uppercase tracking-wider text-court-fg-muted">
              Compensation
            </div>
            <div className="flex items-center gap-3 text-[11px] text-court-fg-muted">
              <label className="inline-flex items-center gap-1">
                <input
                  type="radio"
                  name="comp-freq"
                  checked={draft.salaryFreq === "yearly"}
                  onChange={() => setDraft({ ...draft, salaryFreq: "yearly" })}
                />
                Salary
              </label>
              <label className="inline-flex items-center gap-1">
                <input
                  type="radio"
                  name="comp-freq"
                  checked={draft.salaryFreq === "hourly"}
                  onChange={() => setDraft({ ...draft, salaryFreq: "hourly" })}
                />
                Hourly
              </label>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <LabeledField
                label="Salary low"
                currency
                value={draft.salaryLo}
                onChange={(v) => setDraft({ ...draft, salaryLo: v })} frameClassName={INPUT_FRAME_RECT_CLASS}
              />
              <LabeledField
                label="Salary high"
                currency
                value={draft.salaryHi}
                onChange={(v) => setDraft({ ...draft, salaryHi: v })} frameClassName={INPUT_FRAME_RECT_CLASS}
              />
              <LabeledField
                label="Currency"
                value={draft.salaryCcy}
                onChange={(v) => setDraft({ ...draft, salaryCcy: v })}
                placeholder="USD" frameClassName={INPUT_FRAME_RECT_CLASS}
              />
            </div>

            {err && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">
                {err}
              </div>
            )}
            <div className="flex items-center justify-end gap-2 border-t border-court-border pt-3">
              <button
                type="button"
                onClick={onCancel}
                disabled={saving}
                className="inline-flex items-center gap-1 rounded-md border border-court-border bg-court-surface px-3 py-1.5 text-xs font-medium text-court-fg-muted shadow-sm transition hover:text-court-fg disabled:opacity-60"
              >
                <X className="h-3 w-3" /> Cancel
              </button>
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={onSave}
                disabled={saving}
              >
                {saving ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Save className="h-3 w-3" />
                )}
                Save
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <ReadOnlyCell
              icon={<Briefcase className="h-3.5 w-3.5" />}
              label="Employment"
              value={
                state.employmentType || <span className="text-court-fg-muted">—</span>
              }
            />
            <ReadOnlyCell
              icon={<MapPin className="h-3.5 w-3.5" />}
              label="Location"
              value={
                state.locations.length ? (
                  state.locations.join(", ")
                ) : (
                  <span className="text-court-fg-muted">—</span>
                )
              }
            />
            <StatusCell lifecycle={state.lifecycle} />
            <ReadOnlyCell
              icon={<DollarSign className="h-3.5 w-3.5" />}
              label="Compensation"
              value={state.compensation}
            />
            <ReadOnlyCell
              icon={<Percent className="h-3.5 w-3.5" />}
              label="Fee"
              value={state.feePct != null ? `${state.feePct}%` : "—"}
            />
            <ReadOnlyCell
              icon={<Users className="h-3.5 w-3.5" />}
              label="Openings"
              value={
                state.numberOfOpenings != null ? (
                  String(state.numberOfOpenings)
                ) : (
                  <span className="text-court-fg-muted">—</span>
                )
              }
            />
            <ReadOnlyCell label="Last Edited" value={formatDate(state.lastEditedAt)} />
          </div>
        )}

        {state.applyLink && <ApplyLinkSection url={state.applyLink} />}
      </section>
    </div>
  );
}

// Rectangular form field (court-input-rect frame) with an optional
// inline error, mirroring the New Job form's City/State/Zip treatment.
// LabeledField uses the pill frame; the structured-location trio follows
// the Input Field Treatment's rectangular variant for forms.
function RectField({
  label,
  value,
  onChange,
  error,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string | null;
  type?: string;
}) {
  return (
    <label className="block text-sm">
      <span className="text-[11px] uppercase tracking-wider text-court-fg-muted">{label}</span>
      <div className={cn(INPUT_FRAME_RECT_CLASS, "mt-1 w-full", error && "border-red-300 bg-red-50")}>
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`${INPUT_CONTROL_CLASS} text-sm`}
        />
      </div>
      {error && <span className="mt-1 block text-[11px] font-medium text-red-700">{error}</span>}
    </label>
  );
}

function CellShell({
  icon,
  label,
  children,
}: {
  icon?: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-court-fg-muted">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-sm text-court-fg">{children}</div>
    </div>
  );
}

function ReadOnlyCell({
  icon,
  label,
  value,
}: {
  icon?: ReactNode;
  label: string;
  value: ReactNode;
}) {
  return (
    <CellShell icon={icon} label={label}>
      {value}
    </CellShell>
  );
}

function StatusCell({ lifecycle }: { lifecycle: JobLifecycle }) {
  const icon =
    lifecycle === "active" ? (
      <CheckCircle2 className="h-3.5 w-3.5" />
    ) : lifecycle === "private" ? (
      <EyeOff className="h-3.5 w-3.5" />
    ) : (
      <CircleDashed className="h-3.5 w-3.5" />
    );
  return (
    <CellShell icon={icon} label="Status">
      <span
        className={cn(
          "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider",
          lifecycle === "active"
            ? "bg-brand-tint text-brand-dark"
            : lifecycle === "private"
              ? "bg-amber-50 text-amber-700"
              : "bg-red-100 text-red-700",
        )}
      >
        {lifecycle === "active"
          ? "Active"
          : lifecycle === "private"
            ? "Private"
            : "Inactive"}
      </span>
    </CellShell>
  );
}

type CompState = {
  salaryRangeStart: number | null;
  salaryRangeEnd: number | null;
  salaryCurrency: string | null;
  salaryFrequency: "yearly" | "hourly";
};

function ApplyLinkSection({ url }: { url: string }) {
  return (
    <div className="mt-4 space-y-1.5 border-t border-court-border pt-3">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-court-fg-muted">
        Public Apply Link
      </div>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(url);
              toast.success("Apply link copied");
            } catch {
              toast.error("Couldn't copy link");
            }
          }}
          title="Copy public apply link"
          className="inline-flex items-center gap-1.5 rounded-md border border-court-border bg-court-surface px-2 py-1 text-[11px] font-medium text-court-fg-muted shadow-sm transition hover:bg-court-surface-subtle hover:text-court-fg"
        >
          <Copy className="h-3.5 w-3.5" /> Copy link
        </button>
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          title="Open public apply link in a new tab"
          className="inline-flex items-center gap-1.5 rounded-md border border-court-border bg-court-surface px-2 py-1 text-[11px] font-medium text-court-fg-muted shadow-sm transition hover:bg-court-surface-subtle hover:text-court-fg"
        >
          <ExternalLink className="h-3.5 w-3.5" /> Open
        </a>
      </div>
    </div>
  );
}

// Tolerates "$120,000" / "120k" / "120000" / "" forms. Returns null for
// empty input, "invalid" sentinel for unparseable, number otherwise.
function parseMoney(raw: string): number | null | "invalid" {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const cleaned = trimmed.replace(/[$,\s]/g, "");
  if (/^\d+k$/i.test(cleaned)) {
    const n = Number(cleaned.slice(0, -1)) * 1000;
    return Number.isFinite(n) ? n : "invalid";
  }
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return "invalid";
  return n;
}

function formatCompSummary(state: CompState): string {
  const { salaryRangeStart: lo, salaryRangeEnd: hi, salaryCurrency, salaryFrequency } = state;
  if (lo == null && hi == null) return "—";
  const ccy = (salaryCurrency ?? "USD").toUpperCase();
  const symbol = ccy === "USD" ? "$" : `${ccy} `;
  const fmt = (n: number) => `${symbol}${n.toLocaleString()}`;
  const suffix = salaryFrequency === "hourly" ? " / hr" : " / yr";
  if (lo != null && hi != null && lo !== hi) return `${fmt(lo)} – ${fmt(hi)}${suffix}`;
  const only = lo ?? hi!;
  return `${fmt(only)}${suffix}`;
}
